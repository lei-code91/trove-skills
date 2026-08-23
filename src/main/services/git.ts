import { spawn } from 'child_process'
import path from 'path'
import { promises as fs } from 'fs'
import { parseFrontmatter } from './library'

export interface GitResult {
  stdout: string
  stderr: string
}

export type ProgressFn = (line: string) => void

/**
 * Git 服务：调用系统 git（设置页可配置路径），浅克隆安装 / 更新技能仓库。
 * 不执行仓库内任何脚本，只做版本控制操作。
 */
export class GitService {
  constructor(private readonly gitPath: () => string | Promise<string>) {}

  private async bin(): Promise<string> {
    const p = await this.gitPath()
    return p || 'git'
  }

  async version(): Promise<string> {
    const r = await this.run(['--version'])
    return r.stdout.trim() || 'git'
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.version()
      return true
    } catch {
      return false
    }
  }

  /** 校验远程仓库可达（ls-remote，不 clone 全量） */
  async checkRemote(url: string): Promise<{ ok: boolean; message: string }> {
    try {
      await this.run(['ls-remote', '--heads', url], undefined, 60_000)
      return { ok: true, message: '' }
    } catch (e) {
      return { ok: false, message: errMsg(e) }
    }
  }

  /** 浅克隆到 dest（dest 已存在则失败前先清理） */
  async cloneShallow(url: string, dest: string, onProgress?: ProgressFn): Promise<string> {
    await fs.rm(dest, { recursive: true, force: true })
    await fs.mkdir(path.dirname(dest), { recursive: true })
    const r = await this.run(
      ['clone', '--depth', '1', '--single-branch', url, dest],
      undefined,
      300_000,
      onProgress
    )
    return this.headCommit(dest).catch(() => '')
  }

  /** 更新既有克隆到远程最新（fetch + reset 到 FETCH_HEAD） */
  async updateToLatest(dir: string, onProgress?: ProgressFn): Promise<string> {
    await this.run(['-C', dir, 'fetch', '--depth', '1', 'origin'], undefined, 180_000, onProgress)
    await this.run(['-C', dir, 'reset', '--hard', 'FETCH_HEAD'], undefined, 60_000)
    return this.headCommit(dir)
  }

  async headCommit(dir: string): Promise<string> {
    const r = await this.run(['-C', dir, 'rev-parse', '--short', 'HEAD'])
    return r.stdout.trim()
  }

  async remoteUrl(dir: string): Promise<string | null> {
    try {
      const r = await this.run(['-C', dir, 'remote', 'get-url', 'origin'])
      return r.stdout.trim() || null
    } catch {
      return null
    }
  }

  /** 扫描克隆出的仓库，识别技能包：仓库根含 SKILL.md，或子目录（最多 4 层）含 SKILL.md */
  async detectSkills(repoDir: string): Promise<
    { name: string; repoPath: string; title: string; description: string }[]
  > {
    interface SkillResult {
      name: string
      repoPath: string
      title: string
      description: string
    }
    const results: SkillResult[] = []
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      if (results.length >= 100) return
      if (await fileExists(path.join(dir, 'SKILL.md'))) {
        results.push(await describeSkill(dir, rel))
        if (depth > 0) return // 子目录技能不再深入；仓库根技能则继续扫描子目录（支持混合仓库）
      }
      if (depth >= 4) return
      let entries: import('fs').Dirent[] = []
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      const subs = entries
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
        .sort((a, b) => a.name.localeCompare(b.name))
      for (const sub of subs) {
        await walk(path.join(dir, sub.name), rel === '.' ? sub.name : `${rel}/${sub.name}`, depth + 1)
      }
    }
    await walk(repoDir, '.', 0)
    if (results.length === 0) {
      throw new Error('仓库中未找到有效技能：需要包含 SKILL.md（仓库根或子目录）')
    }
    return results
  }

  /** 从克隆仓库提取描述（README 第一段，截断 300） */
  async repoDescription(repoDir: string): Promise<string> {
    return readRepoDescription(repoDir)
  }

  /** 从克隆仓库提取 README 样本（截断 4000，供 LLM 生成中文描述） */
  async repoSample(repoDir: string): Promise<string> {
    return readRepoSample(repoDir)
  }

  private run(
    args: string[],
    cwd?: string,
    timeoutMs = 60_000,
    onProgress?: ProgressFn
  ): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const bin = await this.bin()
        const child = spawn(bin, args, {
          cwd,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
        })
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => {
          child.kill()
          reject(new Error(`git 操作超时（${timeoutMs / 1000}s）: git ${args.join(' ')}`))
        }, timeoutMs)
        child.stdout.on('data', (d: Buffer) => {
          stdout += d.toString()
          onProgress?.(d.toString())
        })
        child.stderr.on('data', (d: Buffer) => {
          stderr += d.toString()
          onProgress?.(d.toString())
        })
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(new Error(`无法执行 git（${(e as Error).message}）。请确认已安装 git 或在设置中配置路径`))
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve({ stdout, stderr })
          else reject(new Error(lastMeaningfulLine(stderr) || `git 退出码 ${code}`))
        })
      })()
    })
  }
}

/** 从仓库 url 提取短名（owner/repo），不支持时返回去协议后的原始串 */
export function repoNameOf(url: string): string {
  const u = url.trim().replace(/\.git$/, '')
  const m =
    /(?:https?:\/\/|git@|ssh:\/\/git@)?([\w.-]+)\/([\w.-]+)$/.exec(u.replace(/^.*?:\/\//, ''))
  if (m) return `${m[1]}/${m[2]}`
  return u.replace(/^.*?:\/\//, '')
}

/** 从克隆仓库提取描述：README 变体中第一个非标题段落，截断 300 字符 */
async function readRepoDescription(repoDir: string): Promise<string> {
  const candidates = ['README.md', 'Readme.md', 'readme.md', 'README', 'README.txt', 'README.rst']
  for (const name of candidates) {
    try {
      const raw = await fs.readFile(path.join(repoDir, name), 'utf-8')
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => {
          if (!l) return false
          if (l.startsWith('#') || l.startsWith('<!--') || l.startsWith('```')) return false
          if (/^<\/?[a-zA-Z][^>]*>$/.test(l)) return false // 纯 HTML 标签行（如 <p>）
          return true
        })
      const first = lines[0] ?? ''
      const clean = first
        .replace(/<[^>]+>/g, '') // 剥离行内标签
        .replace(/^[-*+\s]+/, '')
        .slice(0, 300)
        .trim()
      if (clean) return clean
    } catch {
      // 尝试下一个候选
    }
  }
  return ''
}

/** 从克隆仓库提取 README 样本（供 LLM 生成中文描述，截断 4000 字符） */
async function readRepoSample(repoDir: string): Promise<string> {
  const candidates = ['README.md', 'Readme.md', 'readme.md', 'README']
  for (const name of candidates) {
    try {
      const raw = await fs.readFile(path.join(repoDir, name), 'utf-8')
      const clean = raw.replace(/\r/g, '').trim()
      if (clean) return clean.slice(0, 4000)
    } catch {
      // 下一个候选
    }
  }
  return ''
}

function lastMeaningfulLine(s: string): string {
  const lines = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('remote: ') && !/^Receiving|^Resolving|^Enumerating|^Counting|^Writing|^Compressing|^Updating|^remote:/i.test(l))
  return lines[lines.length - 1] ?? s.trim().slice(0, 300)
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p)
    return st.isFile()
  } catch {
    return false
  }
}

async function describeSkill(dir: string, repoPath: string) {
  let title = path.basename(dir)
  let description = ''
  let fmName = ''
  try {
    const raw = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf-8')
    const { frontmatter, body } = parseFrontmatter(raw)
    if (typeof frontmatter.name === 'string' && frontmatter.name.trim()) {
      title = frontmatter.name.trim()
      fmName = frontmatter.name.trim()
    } else if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) title = frontmatter.title.trim()
    if (typeof frontmatter.description === 'string') description = frontmatter.description.trim().slice(0, 200)
    else {
      const first = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))[0]
      description = (first ?? '').slice(0, 200)
    }
  } catch {
    // 保持默认
  }
  // 技能名优先取 frontmatter.name（规范字段）；否则取目录名（子目录技能）或仓库名（仓库根技能）
  const name = sanitize(fmName) || sanitize(path.basename(dir))
  return { name, repoPath, title, description }
}

function sanitize(s: string): string {
  return s.replace(/[^\w\u4e00-\u9fa5.-]/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'skill'
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}