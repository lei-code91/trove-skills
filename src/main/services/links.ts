import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import type { ProjectLink, ProjectRecord } from '@shared/types'

/** 展开 ~ / ~/xxx 为用户主目录 */
function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

/**
 * 项目链接服务：把主库中的技能用 junction（Windows）/ 符号链接（其它平台）映射到
 * 用户选择的项目文件夹的 skills 子目录。项目内的链接指向主库 → 主库更新后项目自动同步。
 * 链接与"安装"完全解耦：安装只进主库，永不直接写入 agent。
 */
export class LinksManager {
  private readonly projectsFile: string

  constructor(private readonly linksDir: () => string) {
    this.projectsFile = path.join(linksDir(), 'projects.json')
  }

  private async load(): Promise<ProjectRecord[]> {
    try {
      const raw = await fs.readFile(this.projectsFile, 'utf-8')
      const list = JSON.parse(raw) as ProjectRecord[]
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  private async save(list: ProjectRecord[]): Promise<void> {
    await fs.mkdir(this.linksDir(), { recursive: true })
    const tmp = this.projectsFile + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf-8')
    await fs.rename(tmp, this.projectsFile)
  }

  /** 添加项目（若已存在则返回现有记录）；linksRel：链接目录（相对项目根、绝对路径或 ~ 用户级目录），默认 skills */
  async addProject(projectPath: string, linksRel?: string): Promise<ProjectRecord> {
    const absolute = path.resolve(projectPath)
    const stat = await fs.stat(absolute)
    if (!stat.isDirectory()) throw new Error('所选路径不是文件夹')
    const list = await this.load()
    const existing = list.find((p) => path.resolve(p.path) === absolute)
    if (existing) return existing
    const rel = expandHome(linksRel ?? 'skills')
    const skillsDir = path.isAbsolute(rel)
      ? path.resolve(rel)
      : path.join(absolute, rel)
    await fs.mkdir(skillsDir, { recursive: true })
    const record: ProjectRecord = {
      id: randomUUID(),
      name: path.basename(absolute),
      path: absolute,
      skillsDir,
      linkedAt: new Date().toISOString(),
      links: []
    }
    list.push(record)
    await this.save(list)
    return record
  }

  /** 变更链接目录：断开全部旧链接 → 在新目录重建（保持链接集合） */
  async changeLinksDir(
    projectId: string,
    newDir: string,
    getSkillDir: (name: string) => Promise<string>
  ): Promise<ProjectRecord> {
    const list = await this.load()
    const record = list.find((p) => p.id === projectId)
    if (!record) throw new Error('项目不存在')
    const names = record.links.map((l) => l.skillName)
    for (const link of record.links) {
      await this.safeRemoveLink(link.linkPath)
    }
    record.links = []
    record.skillsDir = path.resolve(expandHome(newDir))
    await fs.mkdir(record.skillsDir, { recursive: true })
    // 先落盘再重建：linkSkills 内部会重新 load，视新目录为当前状态
    await this.save(list)
    return this.linkSkills(projectId, names, getSkillDir)
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
    // 同步实际链接状态：README 探活（若无 skillsDir 则不重建）
    for (const record of list) {
      const alive: ProjectLink[] = []
      for (const link of record.links) {
        try {
          const st = await fs.lstat(link.linkPath)
          if (st.isSymbolicLink()) {
            alive.push(link)
            continue
          }
        } catch {
          // 链接丢失
        }
      }
      record.links = alive
    }
    await this.save(list)
    return list
  }

  /** 把技能链接进项目 skills 目录（多个技能一次批量）；sync=true 时全量对齐：未勾选的既有链接一并断开 */
  async linkSkills(
    projectId: string,
    skillNames: string[],
    getSkillDir: (name: string) => Promise<string>,
    sync = false
  ): Promise<ProjectRecord> {
    const list = await this.load()
    const record = list.find((p) => p.id === projectId)
    if (!record) throw new Error('项目不存在')
    await fs.mkdir(record.skillsDir, { recursive: true })
    for (const name of skillNames) {
      if (record.links.some((l) => l.skillName === name)) continue
      const target = await getSkillDir(name) // 校验在主库
      const linkPath = path.join(record.skillsDir, name)
      const st = await lstatSafe(linkPath)
      if (st?.isSymbolicLink()) {
        // 已存在链接：视为既有链接，更新记录
        record.links.push({
          skillName: name,
          linkPath,
          targetPath: target,
          linkedAt: new Date().toISOString()
        })
        continue
      }
      if (st) {
        throw new Error(`项目 skills 目录已存在同名内容（非链接）：${linkPath}，请先处理`)
      }
      // junction：Windows 上目录链接不需要管理员权限；其它平台用 dir symlink
      const type = process.platform === 'win32' ? 'junction' : 'dir'
      await fs.symlink(target, linkPath, type)
      record.links.push({
        skillName: name,
        linkPath,
        targetPath: target,
        linkedAt: new Date().toISOString()
      })
    }
    // sync：断开未勾选的既有链接（管理弹窗“保存”语义）
    if (sync) {
      for (const link of [...record.links]) {
        if (!skillNames.includes(link.skillName)) {
          await this.safeRemoveLink(link.linkPath)
          record.links = record.links.filter((l) => l.skillName !== link.skillName)
        }
      }
    }
    await this.save(list)
    return record
  }

  async unlinkSkill(projectId: string, skillName: string): Promise<ProjectRecord> {
    const list = await this.load()
    const record = list.find((p) => p.id === projectId)
    if (!record) throw new Error('项目不存在')
    const link = record.links.find((l) => l.skillName === skillName)
    if (link) {
      await this.safeRemoveLink(link.linkPath)
      record.links = record.links.filter((l) => l.skillName !== skillName)
      await this.save(list)
    }
    return record
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