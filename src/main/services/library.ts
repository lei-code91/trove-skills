import { promises as fs } from 'fs'
import path from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { SkillInfo, SkillSource, SkillStatus } from '@shared/types'

const SKILL_FILE = 'SKILL.md'

interface LibraryIndex {
  [skillName: string]: {
    status: SkillStatus
    source?: SkillSource
  }
}

/**
 * 技能库管理器：主库目录（trove）是唯一权威来源。
 * - 一个技能 = skillsDir 下的一级子目录，包含 SKILL.md
 * - 状态/来源元数据存索引文件（不依赖标记文件，用户手动改动目录也能识别）
 */
export class LibraryManager {
  constructor(
    private readonly skillsDir: () => Promise<string>,
    private readonly indexFile: string
  ) {}

  private async getIndex(): Promise<LibraryIndex> {
    try {
      const raw = await fs.readFile(this.indexFile, 'utf-8')
      return JSON.parse(raw) as LibraryIndex
    } catch {
      return {}
    }
  }

  private async saveIndex(index: LibraryIndex): Promise<void> {
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true })
    const tmp = this.indexFile + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf-8')
    await fs.rename(tmp, this.indexFile)
  }

  /** 解析一个技能目录，返回 SkillInfo；不是有效技能（无 SKILL.md）返回 null */
  async parseSkillDir(dir: string): Promise<SkillInfo | null> {
    const skillFile = path.join(dir, SKILL_FILE)
    let raw: string
    try {
      raw = await fs.readFile(skillFile, 'utf-8')
    } catch {
      return null
    }
    const { frontmatter, body } = parseFrontmatter(raw)
    const name = path.basename(dir)
    const title = str(frontmatter.name) || str(frontmatter.title) || name
    const description = str(frontmatter.description) || firstParagraph(body) || ''
    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.map(String).slice(0, 12)
      : []
    const version = str(frontmatter.version) || undefined

    let files: string[] = []
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      files = entries
        .filter((e) => e.isFile() && e.name !== SKILL_FILE)
        .map((e) => e.name)
    } catch {
      // 忽略
    }

    const stat = await fs.stat(dir)
    return {
      name,
      title,
      description,
      version,
      tags,
      status: 'installed',
      path: dir,
      frontmatter,
      readme: body.trim(),
      files,
      updatedAt: stat.mtime.toISOString()
    }
  }

  /** 扫描主库全部技能（合并索引中的状态与来源） */
  async scan(): Promise<SkillInfo[]> {
    const dir = await this.skillsDir()
    await fs.mkdir(dir, { recursive: true })
    const index = await this.getIndex()
    let entries: import('fs').Dirent[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const dirs = entries.filter((e) => e.isDirectory())
    const result: SkillInfo[] = []
    for (const d of dirs) {
      const info = await this.parseSkillDir(path.join(dir, d.name))
      if (!info) {
        result.push({
          name: d.name,
          title: d.name,
          description: '',
          tags: [],
          status: 'broken',
          path: path.join(dir, d.name),
          frontmatter: {},
          readme: '',
          files: [],
          updatedAt: ''
        })
        continue
      }
      const meta = index[info.name]
      if (meta) {
        info.status = meta.status
        info.source = meta.source
      } else {
        info.source = { kind: 'local', installedAt: info.updatedAt }
      }
      result.push(info)
    }
    // 技能名排序（中文按拼音近似，用 localeCompare）
    result.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    return result
  }

  /** 安装：将临时目录中的技能目录复制进主库（不含 .git） */
  async install(
    srcDir: string,
    name: string,
    source: SkillSource
  ): Promise<SkillInfo> {
    const dir = await this.skillsDir()
    await fs.mkdir(dir, { recursive: true })
    const dest = path.join(dir, name)
    if (await exists(dest)) {
      throw new Error(`技能 ${name} 已存在于主库（${dest}），请先卸载或用其它名字`)
    }
    await copyDir(srcDir, dest)
    const index = await this.getIndex()
    index[name] = { status: 'installed', source }
    await this.saveIndex(index)
    const info = await this.parseSkillDir(dest)
    if (!info) throw new Error(`安装后未找到有效 SKILL.md：${dest}`)
    info.status = 'installed'
    info.source = source
    return info
  }

  /** 更新：先删除旧目录再整体替换 */
  async update(name: string, srcDir: string, source: SkillSource): Promise<SkillInfo> {
    const dir = await this.skillsDir()
    const dest = path.join(dir, name)
    if (!(await exists(dest))) {
      throw new Error(`技能 ${name} 不在主库中，无法更新`)
    }
    await fs.rm(dest, { recursive: true, force: true })
    await copyDir(srcDir, dest)
    const index = await this.getIndex()
    const prev = index[name]
    index[name] = { status: prev?.status ?? 'installed', source }
    await this.saveIndex(index)
    const info = await this.parseSkillDir(dest)
    if (!info) throw new Error(`更新后未找到有效 SKILL.md：${dest}`)
    info.status = index[name].status
    info.source = source
    return info
  }

  async uninstall(name: string): Promise<void> {
    const dir = await this.skillsDir()
    const dest = path.join(dir, name)
    if (!(await exists(dest))) throw new Error(`技能 ${name} 不在主库中`)
    await fs.rm(dest, { recursive: true, force: true })
    const index = await this.getIndex()
    delete index[name]
    await this.saveIndex(index)
  }

  async setStatus(name: string, status: SkillStatus): Promise<void> {
    const index = await this.getIndex()
    if (!index[name]) index[name] = { status }
    else index[name].status = status
    await this.saveIndex(index)
  }

  async resolveSkillDir(name: string): Promise<string> {
    const dir = await this.skillsDir()
    const dest = path.join(dir, name)
    if (!(await exists(dest))) throw new Error(`技能 ${name} 不在主库中`)
    return dest
  }

  /** AI 生成的技能草稿：建目录 + 写 SKILL.md + 建索引 */
  async createDraft(name: string, content: string): Promise<SkillInfo> {
    const dir = await this.skillsDir()
    const dest = path.join(dir, sanitizeName(name))
    if (await exists(dest)) throw new Error(`技能 ${name} 已存在，请换一个目录名`)
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(path.join(dest, SKILL_FILE), content, 'utf-8')
    const info = await this.parseSkillDir(dest)
    if (!info) throw new Error('生成的 SKILL.md 无效')
    const source: SkillSource = { kind: 'ai', installedAt: new Date().toISOString() }
    info.status = 'installed'
    info.source = source
    const index = await this.getIndex()
    index[info.name] = { status: 'installed', source }
    await this.saveIndex(index)
    return info
  }

  /** AI 摘要应用：重写 SKILL.md 的 frontmatter description/tags */
  async applySummary(name: string, description: string, tags: string[]): Promise<SkillInfo> {
    const dest = path.join(await this.skillsDir(), name)
    const raw = await fs.readFile(path.join(dest, SKILL_FILE), 'utf-8')
    const { frontmatter, body } = parseFrontmatter(raw)
    const fm: Record<string, unknown> = { ...frontmatter, description, tags }
    const newRaw = `---\n${stringifyYaml(fm).trimEnd()}\n---\n\n${body}`
    await fs.writeFile(path.join(dest, SKILL_FILE), newRaw, 'utf-8')
    const info = await this.parseSkillDir(dest)
    if (info) {
      const index = await this.getIndex()
      const meta = index[name]
      if (meta) {
        info.status = meta.status
        info.source = meta.source
      }
    }
    return info ?? (await this.parseSkillDir(dest))!
  }

  /** 本地导入：把任意目录复制进主库 */
  async importLocal(srcDir: string, name?: string): Promise<SkillInfo> {
    const base = name || path.basename(srcDir)
    const clean = sanitizeName(base)
    const info = await this.parseSkillDir(srcDir)
    if (!info) {
      throw new Error('所选目录不是有效技能（缺少 SKILL.md）')
    }
    const source: SkillSource = {
      kind: 'local',
      installedAt: new Date().toISOString()
    }
    return this.install(srcDir, clean, source)
  }
}

/** 解析 SKILL.md：--- frontmatter --- + 正文 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { frontmatter: {}, body: raw }
  try {
    const frontmatter = (parseYaml(match[1]) ?? {}) as Record<string, unknown>
    return { frontmatter, body: match[2] ?? '' }
  } catch {
    return { frontmatter: {}, body: raw }
  }
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    if (e.name === '.git') continue
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) {
      await copyDir(s, d)
    } else if (e.isFile()) {
      await fs.copyFile(s, d)
    }
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export function sanitizeName(name: string): string {
  const clean = name.replace(/[^\w\u4e00-\u9fa5.-]/g, '-').replace(/^[.-]+|[.-]+$/g, '')
  return clean || 'skill'
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function firstParagraph(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (const line of lines) {
    if (line.startsWith('#')) continue
    return line.replace(/^[-*]\s*/, '').slice(0, 200)
  }
  return ''
}