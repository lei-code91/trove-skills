import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import type { GlobalLinks, LinksSite, ProjectLink, ProjectRecord } from '@shared/types'

/** 展开 ~ / ~/xxx 为用户主目录 */
function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** 目录归一化：展开 ~、解析为绝对路径、去尾部斜杠（比较用） */
export function normalizeDir(p: string): string {
  return path.resolve(expandHome(p)).replace(/[\\/]+$/, '')
}

/** 位点归一化：补 enabled（缺省启用） */
function normalizeSite(site: LinksSite): LinksSite {
  return { ...site, dir: normalizeDir(site.dir), enabled: site.enabled !== false }
}

/** 归一化后按目录去重（保留首个），避免同一目录以不同写法重复出现 */
function dedupeSites(sites: LinksSite[]): LinksSite[] {
  const seen = new Set<string>()
  const out: LinksSite[] = []
  for (const s of sites) {
    const dir = normalizeDir(s.dir)
    if (seen.has(dir)) continue
    seen.add(dir)
    out.push({ ...s, dir })
  }
  return out
}

/** 只返回启用位点（enabled 缺省视为启用） */
function enabledSites(sites: LinksSite[]): LinksSite[] {
  return sites.filter((s) => s.enabled !== false)
}

/** 判断是否为全局位点：类型标记或目录本身指向用户级通配目录 */
function isGlobalSite(site: LinksSite): boolean {
  return site.kind === 'global' || site.dir === normalizeDir('~/.agents/skills')
}

/** 旧项目数据的位点类型推导：全局目录 / 项目内 .claude/skills / 其它自定义（仅用于识别旧数据） */
function deduceKind(projectPath: string, dir: string): LinksSite['kind'] {
  const normalized = normalizeDir(dir)
  if (normalized === normalizeDir('~/.agents/skills')) return 'global'
  if (normalized.startsWith(normalizeDir(projectPath) + path.sep) && normalized.endsWith('.claude' + path.sep + 'skills')) {
    return 'claude'
  }
  return 'custom'
}

/** 全局配置迁移（兼容缺省/旧格式） */
function migrateGlobal(raw: Partial<GlobalLinks>): GlobalLinks {
  const now = new Date().toISOString()
  const sites =
    Array.isArray(raw.sites) && raw.sites.length > 0
      ? raw.sites.map(normalizeSite)
      : [{ dir: normalizeDir('~/.agents/skills'), kind: 'global' as const, label: '用户级通用 Agent' }]
  return {
    sites,
    links: Array.isArray(raw.links) ? raw.links.map((l) => ({ ...l, dir: l.dir || sites[0].dir })) : [],
    updatedAt: raw.updatedAt || now
  }
}

/** 合并新旧链接记录：以 (位点, 技能名) 为键，新记录优先 */
function mergeLinks(existing: ProjectLink[], fresh: ProjectLink[]): ProjectLink[] {
  const map = new Map<string, ProjectLink>()
  for (const l of existing) map.set(`${l.dir}\u0000${l.skillName}`, l)
  for (const l of fresh) map.set(`${l.dir}\u0000${l.skillName}`, l)
  return [...map.values()]
}

/**
 * 链接服务（全局 + 项目两级）：
 * - 全局：一套技能集链接到全局位点（默认 ~/.agents/skills），对所有 Agent 生效
 * - 项目：每个项目自己的技能集链接到该项目位点集合（仅项目级位点：claude / custom）
 * 位点可勾选/取消勾选（enabled）：取消勾选仅停用、保留位置，其下链接断开，重新勾选自动重建。
 */
export class LinksManager {
  private readonly projectsFile: string
  private readonly globalFile: string

  constructor(private readonly linksDir: () => string) {
    this.projectsFile = path.join(linksDir(), 'projects.json')
    this.globalFile = path.join(linksDir(), 'global-links.json')
  }

  // ---------- 数据读写 ----------

  /** 读取项目列表：迁移旧数据（补 sites/links.dir/enabled、剥离全局位点），有变更时落盘 */
  private async load(): Promise<ProjectRecord[]> {
    let list: ProjectRecord[] = []
    try {
      const raw = await fs.readFile(this.projectsFile, 'utf-8')
      const parsed = JSON.parse(raw)
      list = Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
    let changed = false
    const migrated: ProjectRecord[] = []
    for (const p of list) {
      const { record, changed: c } = await this.migrateProject(p)
      if (c) changed = true
      migrated.push(record)
    }
    if (changed) await this.save(migrated)
    return migrated
  }

  /** 旧项目数据迁移：补 sites 与 links 的 dir/enabled；项目位点只保留项目级，剥离旧全局位点（断开链接） */
  private async migrateProject(p: ProjectRecord): Promise<{ record: ProjectRecord; changed: boolean }> {
    const record: ProjectRecord = {
      ...p,
      skillsDir: p.skillsDir,
      sites: [],
      links: [...(p.links ?? [])]
    }
    let changed = false
    const rawSites =
      Array.isArray(p.sites) && p.sites.length > 0
        ? p.sites
        : [{ dir: p.skillsDir, kind: deduceKind(p.path, p.skillsDir) }]
    for (const raw of rawSites) {
      const site = normalizeSite(raw)
      if (isGlobalSite(site)) {
        // 旧「全局用户级」位点：断开其下链接并移除（用户自行到全局链接重新勾选）
        changed = true
        for (const link of [...record.links]) {
          if (normalizeDir(link.dir) === site.dir) {
            await this.safeRemoveLink(link.linkPath)
            record.links = record.links.filter((l) => l !== link)
          }
        }
        continue
      }
      record.sites.push(site)
    }
    // 无项目级位点 → 补默认 Claude 项目级位点，保证链接有一个落点
    if (record.sites.length === 0) {
      changed = true
      record.sites.push({
        dir: path.join(normalizeDir(p.path), '.claude', 'skills'),
        kind: 'claude'
      })
    }
    for (const l of record.links) {
      if (!l.dir) {
        l.dir = record.sites[0].dir
        changed = true
      }
    }
    record.skillsDir = record.sites[0].dir
    return { record, changed }
  }

  private async save(list: ProjectRecord[]): Promise<void> {
    await fs.mkdir(this.linksDir(), { recursive: true })
    const tmp = this.projectsFile + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf-8')
    await fs.rename(tmp, this.projectsFile)
  }

  private async loadGlobal(): Promise<GlobalLinks> {
    try {
      const raw = await fs.readFile(this.globalFile, 'utf-8')
      return migrateGlobal(JSON.parse(raw))
    } catch {
      return migrateGlobal({})
    }
  }

  private async saveGlobal(config: GlobalLinks): Promise<void> {
    await fs.mkdir(this.linksDir(), { recursive: true })
    const tmp = this.globalFile + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8')
    await fs.rename(tmp, this.globalFile)
  }

  /** 链接探活：只保留仍是符号链接的记录 */
  private async aliveLinks(links: ProjectLink[]): Promise<ProjectLink[]> {
    const alive: ProjectLink[] = []
    for (const link of links) {
      try {
        const st = await fs.lstat(link.linkPath)
        if (st.isSymbolicLink()) alive.push(link)
      } catch {
        // 链接丢失
      }
    }
    return alive
  }

  // ---------- 链接基本操作 ----------

  /** 对每个位点创建链接（缺失的建 junction/符号链接）；已有符号链接视为既有链接返回记录 */
  private async applyLinkSet(
    sites: LinksSite[],
    skillNames: string[],
    getSkillDir: (name: string) => Promise<string>
  ): Promise<ProjectLink[]> {
    const links: ProjectLink[] = []
    for (const site of sites) {
      await fs.mkdir(site.dir, { recursive: true })
      for (const name of skillNames) {
        const target = await getSkillDir(name) // 校验在主库
        const linkPath = path.join(site.dir, name)
        const st = await lstatSafe(linkPath)
        if (st?.isSymbolicLink()) {
          links.push({ skillName: name, dir: site.dir, linkPath, targetPath: target, linkedAt: new Date().toISOString() })
          continue
        }
        if (st) {
          throw new Error(`链接目录已存在同名内容（非链接）：${linkPath}，请先处理`)
        }
        // junction：Windows 上目录链接不需要管理员权限；其它平台用 dir symlink
        const type = process.platform === 'win32' ? 'junction' : 'dir'
        await fs.symlink(target, linkPath, type)
        links.push({ skillName: name, dir: site.dir, linkPath, targetPath: target, linkedAt: new Date().toISOString() })
      }
    }
    return links
  }

  /** 同步断开：断开 (位点, 技能) 不在目标组合内的既有链接，返回保留的链接 */
  private async syncRemove(
    links: ProjectLink[],
    sites: LinksSite[],
    skillNames: string[]
  ): Promise<ProjectLink[]> {
    const keepKeys = new Set(sites.flatMap((s) => skillNames.map((n) => `${s.dir}\u0000${n}`)))
    const kept: ProjectLink[] = []
    for (const link of links) {
      if (keepKeys.has(`${link.dir}\u0000${link.skillName}`)) kept.push(link)
      else await this.safeRemoveLink(link.linkPath)
    }
    return kept
  }

  /** 断开所有 dir 不在指定目录集合内的链接（用于位点删除/停用） */
  private async removeLinksOutside(links: ProjectLink[], keepDirs: Set<string>): Promise<ProjectLink[]> {
    const kept: ProjectLink[] = []
    for (const link of links) {
      if (keepDirs.has(link.dir)) kept.push(link)
      else {
        await this.safeRemoveLink(link.linkPath)
        // 仅丢弃当前这条，不在此处重建数组引用（由调用方统一赋值）
      }
    }
    return kept
  }

  // ---------- 项目 ----------

  /** 添加项目（已存在则返回现有记录）；sites 缺省时为项目内 skills 目录；项目位点只允许项目级 */
  async addProject(projectPath: string, sites?: LinksSite[]): Promise<ProjectRecord> {
    const absolute = path.resolve(projectPath)
    const stat = await fs.stat(absolute)
    if (!stat.isDirectory()) throw new Error('所选路径不是文件夹')
    const list = await this.load()
    const existing = list.find((p) => path.resolve(p.path) === absolute)
    if (existing) return existing
    const normalized = dedupeSites(sites ?? []).filter((s) => !isGlobalSite(s))
    if (normalized.length === 0) {
      normalized.push({ dir: path.join(absolute, 'skills'), kind: 'custom' })
    }
    for (const s of normalized) await fs.mkdir(s.dir, { recursive: true })
    const record: ProjectRecord = {
      id: randomUUID(),
      name: path.basename(absolute),
      path: absolute,
      skillsDir: normalized[0].dir,
      sites: normalized,
      linkedAt: new Date().toISOString(),
      links: []
    }
    list.push(record)
    await this.save(list)
    return record
  }

  /** 变更项目位点集合：断开不在启用位点的链接（含被停用/删除/全局位点），只在启用位点重建既有技能集 */
  async setSites(
    projectId: string,
    sites: LinksSite[],
    getSkillDir: (name: string) => Promise<string>
  ): Promise<ProjectRecord> {
    const list = await this.load()
    const record = list.find((p) => p.id === projectId)
    if (!record) throw new Error('项目不存在')
    // 项目位点只允许项目级：防御性滤除全局位点（其下链接由 removeLinksOutside 断开）
    const normalized = dedupeSites(sites).filter((s) => !isGlobalSite(s))
    const enabled = enabledSites(normalized)
    const enabledDirs = new Set(enabled.map((s) => s.dir))
    record.links = await this.removeLinksOutside(record.links, enabledDirs)
    const names = [...new Set(record.links.map((l) => l.skillName))]
    const fresh = await this.applyLinkSet(enabled, names, getSkillDir)
    record.sites = normalized
    record.skillsDir = normalized[0]?.dir ?? record.skillsDir
    record.links = mergeLinks(record.links, fresh)
    await this.save(list)
    return record
  }

  async removeProject(id: string, unlinkAll = true): Promise<void> {
    const list = await this.load()
    const idx = list.findIndex((p) => p.id === id)
    if (idx < 0) return
    const record = list[idx]
    if (unlinkAll) {
      for (const link of record.links) {
        await this.safeRemoveLink(link.linkPath)
      }
    }
    list.splice(idx, 1)
    await this.save(list)
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const list = await this.load()
    let changed = false
    for (const record of list) {
      const alive = await this.aliveLinks(record.links)
      if (alive.length !== record.links.length) {
        record.links = alive
        changed = true
      }
    }
    if (changed) await this.save(list)
    return list
  }

  /** 把技能链接进项目全部启用位点；sync=true 时全量对齐：未勾选的既有链接一并断开 */
  async linkProject(
    projectId: string,
    skillNames: string[],
    getSkillDir: (name: string) => Promise<string>,
    sync = false
  ): Promise<ProjectRecord> {
    const list = await this.load()
    const record = list.find((p) => p.id === projectId)
    if (!record) throw new Error('项目不存在')
    const enabled = enabledSites(record.sites)
    const fresh = await this.applyLinkSet(enabled, skillNames, getSkillDir)
    record.links = sync
      ? await this.syncRemove(record.links, enabled, skillNames)
      : record.links
    record.links = mergeLinks(record.links, fresh)
    await this.save(list)
    return record
  }

  async unlinkSkill(projectId: string, skillName: string): Promise<ProjectRecord> {
    const list = await this.load()
    const record = list.find((p) => p.id === projectId)
    if (!record) throw new Error('项目不存在')
    const targets = record.links.filter((l) => l.skillName === skillName)
    for (const link of targets) {
      await this.safeRemoveLink(link.linkPath)
    }
    if (targets.length > 0) {
      record.links = record.links.filter((l) => l.skillName !== skillName)
      await this.save(list)
    }
    return record
  }

  // ---------- 全局链接 ----------

  async getGlobalLinks(): Promise<GlobalLinks> {
    const config = await this.loadGlobal()
    const alive = await this.aliveLinks(config.links)
    if (alive.length !== config.links.length) {
      config.links = alive
      await this.saveGlobal(config)
    }
    return config
  }

  /** 设定全局位点集合：断开不在启用位点的链接，只在启用位点重建既有技能集 */
  async setGlobalSites(
    sites: LinksSite[],
    getSkillDir: (name: string) => Promise<string>
  ): Promise<GlobalLinks> {
    const config = await this.loadGlobal()
    const normalized = dedupeSites(sites)
    const enabled = enabledSites(normalized)
    const enabledDirs = new Set(enabled.map((s) => s.dir))
    config.links = await this.removeLinksOutside(config.links, enabledDirs)
    const names = [...new Set(config.links.map((l) => l.skillName))]
    const fresh = await this.applyLinkSet(enabled, names, getSkillDir)
    config.sites = normalized
    config.links = mergeLinks(config.links, fresh)
    config.updatedAt = new Date().toISOString()
    await this.saveGlobal(config)
    return config
  }

  /** 把技能链接进全局全部启用位点；sync=true 时未勾选的既有链接一并断开 */
  async linkGlobal(
    skillNames: string[],
    getSkillDir: (name: string) => Promise<string>,
    sync = false
  ): Promise<GlobalLinks> {
    const config = await this.loadGlobal()
    const enabled = enabledSites(config.sites)
    const fresh = await this.applyLinkSet(enabled, skillNames, getSkillDir)
    config.links = sync ? await this.syncRemove(config.links, enabled, skillNames) : config.links
    config.links = mergeLinks(config.links, fresh)
    config.updatedAt = new Date().toISOString()
    await this.saveGlobal(config)
    return config
  }

  async unlinkGlobal(skillName: string): Promise<GlobalLinks> {
    const config = await this.loadGlobal()
    const targets = config.links.filter((l) => l.skillName === skillName)
    for (const link of targets) {
      await this.safeRemoveLink(link.linkPath)
    }
    if (targets.length > 0) {
      config.links = config.links.filter((l) => l.skillName !== skillName)
      config.updatedAt = new Date().toISOString()
      await this.saveGlobal(config)
    }
    return config
  }

  /** 删除前再次确认是符号链接，绝不递归删除真实目录 */
  private async safeRemoveLink(linkPath: string): Promise<void> {
    const st = await lstatSafe(linkPath)
    if (!st) return
    if (!st.isSymbolicLink()) {
      throw new Error(`拒绝删除非链接路径：${linkPath}`)
    }
    await fs.rm(linkPath, { recursive: false, force: true })
  }
}

async function lstatSafe(p: string) {
  try {
    return await fs.lstat(p)
  } catch {
    return null
  }
}