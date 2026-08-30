import { promises as fs } from 'fs'
import path from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { LibrarySnapshot, RepoGroup, SkillInfo, SkillSource, SkillStatus } from '@shared/types'

const SKILL_FILE = 'SKILL.md'
/** 本地导入技能的固定分组目录名 */
const LOCAL_GROUP_DIR = '_local'
/** AI 生成技能的固定分组目录名 */
const AI_GROUP_DIR = '_ai'

interface SkillMeta {
  status: SkillStatus
  source?: SkillSource
  /** 中文描述（LLM 生成，存索引不写文件） */
  descriptionZh?: string
}

/** 索引文件结构：技能表 + 仓库分组表 */
interface LibraryIndex {
  skills: Record<string, SkillMeta>
  groups: Record<string, RepoGroup>
}

/** 读取索引；兼容旧格式（顶层直接是技能表） */
function migrateIndex(data: unknown): LibraryIndex {
  if (data && typeof data === 'object' && !('skills' in data)) {
    return { skills: data as Record<string, SkillMeta>, groups: {} }
  }
  const d = (data ?? {}) as { skills?: Record<string, SkillMeta>; groups?: Record<string, RepoGroup> }
  return { skills: d.skills ?? {}, groups: d.groups ?? {} }
}

/**
 * 技能库管理器：主库目录（trove）是唯一权威来源。
 * - 一个技能 = skillsDir/分组目录/技能目录，包含 SKILL.md（分组目录是仓库或本地/AI 的容器）
 * - 状态/来源元数据存索引文件（不依赖标记文件，用户手动改动目录也能识别）
 * - 布局变更：旧版扁平的 skillsDir/技能目录 会在 scan 时自动迁移进分组目录
 */
export class LibraryManager {
  constructor(
    private readonly skillsDir: () => Promise<string>,
    private readonly indexFile: string
  ) {}

  private async getIndex(): Promise<LibraryIndex> {
    try {
      const raw = await fs.readFile(this.indexFile, 'utf-8')
      return migrateIndex(JSON.parse(raw))
    } catch {
      return { skills: {}, groups: {} }
    }
  }

  private async saveIndex(index: LibraryIndex): Promise<void> {
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true })
    const tmp = this.indexFile + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ skills: index.skills, groups: index.groups }, null, 2), 'utf-8')
    await fs.rename(tmp, this.indexFile)
  }

  // ---------- 分组目录定位 ----------

  /** 来源对应的分组目录名：git 用仓库短名，本地/AI 用固定分组 */
  private groupDirOf(index: LibraryIndex, source?: SkillSource): string | undefined {
    if (!source) return undefined
    if (source.kind === 'git' && source.url) {
      return index.groups[source.url]?.dir ?? sanitizeName(shortNameOf(source.url))
    }
    if (source.kind === 'ai') return AI_GROUP_DIR
    return LOCAL_GROUP_DIR
  }

  /** 推导主库根下技能目录：分组目录 + 技能名；无法推导返回 undefined */
  private destFromIndex(
    root: string,
    index: LibraryIndex,
    name: string,
    source?: SkillSource
  ): string | undefined {
    const groupDir = this.groupDirOf(index, source ?? index.skills[name]?.source)
    if (!groupDir) return undefined
    return path.join(root, groupDir, name)
  }

  /** 为仓库 url 分配分组目录名：优先复用已有 dir，否则按短名推导并处理冲突（-2、-3…） */
  private async ensureGroupDir(
    root: string,
    index: LibraryIndex,
    url: string,
    repoName: string
  ): Promise<string> {
    const prev = index.groups[url]
    if (prev?.dir) return prev.dir
    const used = new Set<string>(
      Object.values(index.groups)
        .map((g) => g.dir)
        .filter((x): x is string => !!x)
    )
    const base = sanitizeName(repoName)
    let candidate = base
    let i = 2
    const isFree = async (name: string): Promise<boolean> =>
      !used.has(name) && !(await exists(path.join(root, name)))
    while (!(await isFree(candidate))) candidate = `${base}-${i++}`
    index.groups[url] = {
      ...(prev ?? { url, name: repoName, description: '', installedAt: new Date().toISOString() }),
      dir: candidate
    }
    return candidate
  }

  /** 查找技能实际目录：优先索引推导，其次一级旧目录，再全盘搜索分组目录 */
  private async locateSkillDir(name: string): Promise<string | null> {
    const root = await this.skillsDir()
    const direct = path.join(root, name)
    if (await exists(direct)) return direct
    const index = await this.getIndex()
    const fromIndex = this.destFromIndex(root, index, name)
    if (fromIndex && (await exists(fromIndex))) return fromIndex
    return this.findSkillDir(root, name)
  }

  /** 全盘搜索：遍历所有分组目录找同名技能目录 */
  private async findSkillDir(root: string, name: string): Promise<string | null> {
    let entries: import('fs').Dirent[] = []
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      return null
    }
    for (const d of entries.filter((e) => e.isDirectory())) {
      const candidate = path.join(root, d.name, name)
      if (await exists(candidate)) return candidate
    }
    return null
  }

  // ---------- 解析 / 扫描 ----------

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

  /** 判断一级目录是否为分组容器：固定分组名 / 索引登记的分组目录名 / 含 SKILL.md 子目录 */
  private async looksLikeGroupDir(index: LibraryIndex, name: string, dirPath: string): Promise<boolean> {
    if (name === LOCAL_GROUP_DIR || name === AI_GROUP_DIR) return true
    if (Object.values(index.groups).some((g) => g.dir === name)) return true
    let children: import('fs').Dirent[] = []
    try {
      children = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return false
    }
    for (const c of children.filter((e) => e.isDirectory())) {
      if (await exists(path.join(dirPath, c.name, SKILL_FILE))) return true
    }
    return false
  }

  /** 扫描主库：先迁移旧扁平布局，再按「分组目录 → 技能目录」两层扫描 */
  async scan(): Promise<LibrarySnapshot> {
    const root = await this.skillsDir()
    await fs.mkdir(root, { recursive: true })
    let index = await this.getIndex()
    index = await this.migrateLegacyLayout(root, index)
    let entries: import('fs').Dirent[] = []
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      return { skills: [], groups: [] }
    }
    const dirs = entries.filter((e) => e.isDirectory())
    const result: SkillInfo[] = []
    for (const d of dirs) {
      const dirPath = path.join(root, d.name)
      if (!(await this.looksLikeGroupDir(index, d.name, dirPath))) {
        // 一级技能目录（迁移失败/手动放入/损坏目录）
        const info = await this.parseSkillDir(dirPath)
        if (info) {
          this.applyMeta(index, info)
          result.push(info)
        } else {
          result.push(this.brokenInfo(dirPath))
        }
        continue
      }
      let children: import('fs').Dirent[] = []
      try {
        children = await fs.readdir(dirPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const c of children.filter((e) => e.isDirectory())) {
        const skillPath = path.join(dirPath, c.name)
        const info = await this.parseSkillDir(skillPath)
        if (!info) continue
        this.applyMeta(index, info)
        result.push(info)
      }
    }
    // 技能名排序（中文按拼音近似，用 localeCompare）
    result.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    return { skills: result, groups: this.groupsFromIndex(index) }
  }

  /** 把索引元数据（状态 / 来源 / 中文描述）补到解析结果上；无索引记录时标记为本地来源 */
  private applyMeta(index: LibraryIndex, info: SkillInfo): void {
    const meta = index.skills[info.name]
    if (meta) {
      info.status = meta.status
      info.source = meta.source
      if (typeof meta.descriptionZh === 'string' && meta.descriptionZh.trim()) {
        info.descriptionZh = meta.descriptionZh
      }
    } else {
      info.source = { kind: 'local', installedAt: info.updatedAt }
    }
  }

  private brokenInfo(dirPath: string): SkillInfo {
    const name = path.basename(dirPath)
    return {
      name,
      title: name,
      description: '',
      tags: [],
      status: 'broken',
      path: dirPath,
      frontmatter: {},
      readme: '',
      files: [],
      updatedAt: ''
    }
  }

  /** 全部仓库分组（按短名排序） */
  private groupsFromIndex(index: LibraryIndex): RepoGroup[] {
    return Object.values(index.groups).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }

  /** 仓库分组：按 url 读取 */
  async getGroup(url: string): Promise<RepoGroup | undefined> {
    const index = await this.getIndex()
    return index.groups[url]
  }

  /** 仓库分组：建立或更新（url 为键，lastUpdated 自动刷新） */
  async upsertGroup(group: RepoGroup): Promise<void> {
    const index = await this.getIndex()
    const prev = index.groups[group.url]
    index.groups[group.url] = { ...prev, ...group, lastUpdated: new Date().toISOString() }
    await this.saveIndex(index)
  }

  /** 仓库分组：写入用户备注 */
  async setGroupNote(url: string, note: string): Promise<void> {
    const index = await this.getIndex()
    if (index.groups[url]) {
      index.groups[url].note = note.trim() || undefined
      index.groups[url].lastUpdated = new Date().toISOString()
      await this.saveIndex(index)
    }
  }

  /** 仓库分组：删除整组（卸载组内全部技能目录 + 移除分组元数据与空分组目录） */
  async removeGroup(url: string): Promise<string[]> {
    const root = await this.skillsDir()
    const removed: string[] = []
    const index = await this.getIndex()
    const groupDir = index.groups[url]?.dir
    for (const [name, meta] of Object.entries(index.skills)) {
      if (meta.source?.url === url) {
        const dest = groupDir ? path.join(root, groupDir, name) : path.join(root, name)
        if (await exists(dest)) {
          await fs.rm(dest, { recursive: true, force: true })
        }
        delete index.skills[name]
        removed.push(name)
      }
    }
    delete index.groups[url]
    if (groupDir) {
      await fs.rm(path.join(root, groupDir), { recursive: false, force: true }).catch(() => {})
    }
    await this.saveIndex(index)
    return removed
  }

  /** 技能级中文描述：写入索引（不修改 SKILL.md） */
  async setSkillZh(name: string, descriptionZh: string): Promise<void> {
    const index = await this.getIndex()
    const meta = index.skills[name]
    if (meta) {
      meta.descriptionZh = descriptionZh.trim().slice(0, 300) || undefined
      await this.saveIndex(index)
    } else {
      throw new Error(`技能 ${name} 不在索引中`)
    }
  }

  /** 安装：将临时目录中的技能目录复制进主库分组目录（不含 .git） */
  async install(
    srcDir: string,
    name: string,
    source: SkillSource
  ): Promise<SkillInfo> {
    const root = await this.skillsDir()
    await fs.mkdir(root, { recursive: true })
    const index = await this.getIndex()
    const groupDir =
      source.kind === 'git' && source.url
        ? await this.ensureGroupDir(root, index, source.url, shortNameOf(source.url))
        : source.kind === 'ai'
          ? AI_GROUP_DIR
          : LOCAL_GROUP_DIR
    const dest = path.join(root, groupDir, name)
    if (await exists(dest)) {
      throw new Error(`技能 ${name} 已存在于主库（${dest}），请先卸载或用其它名字`)
    }
    await copyDir(srcDir, dest)
    index.skills[name] = { status: 'installed', source }
    await this.saveIndex(index)
    const info = await this.parseSkillDir(dest)
    if (!info) throw new Error(`安装后未找到有效 SKILL.md：${dest}`)
    info.status = 'installed'
    info.source = source
    return info
  }

  /** 更新：先删除旧目录再整体替换（旧扁平位置也兼容，写回分组目录） */
  async update(name: string, srcDir: string, source: SkillSource): Promise<SkillInfo> {
    const root = await this.skillsDir()
    const index = await this.getIndex()
    const current = await this.locateSkillDir(name)
    if (!current) {
      throw new Error(`技能 ${name} 不在主库中，无法更新`)
    }
    await fs.rm(current, { recursive: true, force: true })
    const groupDir =
      source.kind === 'git' && source.url
        ? await this.ensureGroupDir(root, index, source.url, shortNameOf(source.url))
        : source.kind === 'ai'
          ? AI_GROUP_DIR
          : LOCAL_GROUP_DIR
    const dest = path.join(root, groupDir, name)
    await copyDir(srcDir, dest)
    const prev = index.skills[name]
    index.skills[name] = { status: prev?.status ?? 'installed', source }
    await this.saveIndex(index)
    const info = await this.parseSkillDir(dest)
    if (!info) throw new Error(`更新后未找到有效 SKILL.md：${dest}`)
    info.status = index.skills[name].status
    info.source = source
    return info
  }

  async uninstall(name: string): Promise<void> {
    const root = await this.skillsDir()
    const dest = await this.locateSkillDir(name)
    if (!dest) throw new Error(`技能 ${name} 不在主库中`)
    await fs.rm(dest, { recursive: true, force: true })
    const index = await this.getIndex()
    const url = index.skills[name]?.source?.url
    delete index.skills[name]
    // 组内最后一个技能被卸载时，移除空组与空分组目录
    if (url) {
      const stillHas = Object.values(index.skills).some((m) => m.source?.url === url)
      if (!stillHas) {
        const groupDir = index.groups[url]?.dir
        delete index.groups[url]
        if (groupDir) {
          await fs.rm(path.join(root, groupDir), { recursive: false, force: true }).catch(() => {})
        }
      }
    }
    await this.saveIndex(index)
  }

  async setStatus(name: string, status: SkillStatus): Promise<void> {
    const index = await this.getIndex()
    if (!index.skills[name]) index.skills[name] = { status }
    else index.skills[name].status = status
    await this.saveIndex(index)
  }

  async resolveSkillDir(name: string): Promise<string> {
    const dest = await this.locateSkillDir(name)
    if (!dest) throw new Error(`技能 ${name} 不在主库中`)
    return dest
  }

  /** AI 生成的技能草稿：建目录 + 写 SKILL.md + 建索引 */
  async createDraft(name: string, content: string): Promise<SkillInfo> {
    const root = await this.skillsDir()
    const dest = path.join(root, AI_GROUP_DIR, sanitizeName(name))
    if (await exists(dest)) throw new Error(`技能 ${name} 已存在，请换一个目录名`)
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(path.join(dest, SKILL_FILE), content, 'utf-8')
    const info = await this.parseSkillDir(dest)
    if (!info) throw new Error('生成的 SKILL.md 无效')
    const source: SkillSource = { kind: 'ai', installedAt: new Date().toISOString() }
    info.status = 'installed'
    info.source = source
    const index = await this.getIndex()
    index.skills[info.name] = { status: 'installed', source }
    await this.saveIndex(index)
    return info
  }

  /** AI 摘要应用：重写 SKILL.md 的 frontmatter description/tags */
  async applySummary(name: string, description: string, tags: string[]): Promise<SkillInfo> {
    const dest = await this.locateSkillDir(name)
    if (!dest) throw new Error(`技能 ${name} 不在主库中`)
    const raw = await fs.readFile(path.join(dest, SKILL_FILE), 'utf-8')
    const { frontmatter, body } = parseFrontmatter(raw)
    const fm: Record<string, unknown> = { ...frontmatter, description, tags }
    const newRaw = `---\n${stringifyYaml(fm).trimEnd()}\n---\n\n${body}`
    await fs.writeFile(path.join(dest, SKILL_FILE), newRaw, 'utf-8')
    const info = await this.parseSkillDir(dest)
    if (info) {
      const index = await this.getIndex()
      const meta = index.skills[name]
      if (meta) {
        info.status = meta.status
        info.source = meta.source
      }
    }
    return info ?? (await this.parseSkillDir(dest))!
  }

  /** 本地导入：把任意目录复制进主库（_local 分组） */
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

  // ---------- 旧布局迁移 ----------

  /**
   * 幂等迁移：把旧版扁平的 skillsDir/<技能>（含 SKILL.md）移动到 分组目录/<技能>。
   * 按索引来源推导目标分组（缺失来源补本地），并补齐 groups[url].dir。
   */
  private async migrateLegacyLayout(root: string, index: LibraryIndex): Promise<LibraryIndex> {
    let entries: import('fs').Dirent[] = []
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      return index
    }
    let changed = false
    for (const d of entries.filter((e) => e.isDirectory())) {
      const oldPath = path.join(root, d.name)
      if (!(await exists(path.join(oldPath, SKILL_FILE)))) continue
      // 已登记为分组目录的，不当作技能（异常时也跳过）
      if (Object.values(index.groups).some((g) => g.dir === d.name)) continue
      const meta = index.skills[d.name]
      let source = meta?.source
      if (!source) {
        source = { kind: 'local', installedAt: new Date().toISOString() }
        index.skills[d.name] = {
          status: meta?.status ?? 'installed',
          source
        }
        changed = true
      }
      let groupDir: string
      if (source.kind === 'git' && source.url) {
        const prevDir = index.groups[source.url]?.dir
        groupDir = await this.ensureGroupDir(root, index, source.url, shortNameOf(source.url))
        if (groupDir !== prevDir) changed = true
      } else {
        groupDir = source.kind === 'ai' ? AI_GROUP_DIR : LOCAL_GROUP_DIR
      }
      const dest = path.join(root, groupDir, d.name)
      if (await exists(dest)) continue // 目标已被占用，保留原目录（scan 仍识别）
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.rename(oldPath, dest)
      changed = true
    }
    if (changed) await this.saveIndex(index)
    return index
  }
}

/** 从仓库 url 提取短名（owner/repo），用于推导分组目录名 */
export function shortNameOf(url: string): string {
  const u = url.trim().replace(/\.git$/, '')
  const m =
    /(?:https?:\/\/|git@|ssh:\/\/git@)?([\w.-]+)\/([\w.-]+)$/.exec(u.replace(/^.*?:\/\//, ''))
  if (m) return `${m[1]}/${m[2]}`
  return u.replace(/^.*?:\/\//, '')
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