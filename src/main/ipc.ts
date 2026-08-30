import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type {
  AppSettings,
  InstallPreview,
  LinksSite,
  LlmProfile,
  SkillInfo,
  SkillStatus
} from '@shared/types'
import { SettingsManager } from './services/settings'
import { LibraryManager } from './services/library'
import { GitService, repoNameOf } from './services/git'
import { LinksManager } from './services/links'
import { LlmService } from './services/llm'

interface PendingPreview {
  cloneDir: string
  timer: NodeJS.Timeout
}

export class IpcRegistrar {
  private readonly llm = new LlmService()
  private pendingPreviews = new Map<string, PendingPreview>()

  constructor(
    private readonly settings: SettingsManager,
    private readonly library: LibraryManager,
    private readonly git: GitService,
    private readonly links: LinksManager,
    private readonly tmpDir: string,
    private readonly zhCacheDir: string
  ) {}

  register(): void {
    // ---------- 窗口控制（无边框标题栏） ----------
    ipcMain.handle('window:minimize', () => {
      BrowserWindow.getFocusedWindow()?.minimize()
    })
    ipcMain.handle('window:toggleMaximize', () => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    })
    ipcMain.handle('window:close', () => {
      BrowserWindow.getFocusedWindow()?.close()
    })
    ipcMain.handle('window:isMaximized', () => {
      return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false
    })

    // ---------- 设置 ----------
    ipcMain.handle('settings:get', () => this.settings.load())
    ipcMain.handle('settings:update', (_e, data: AppSettings) => this.settings.save(data))
    ipcMain.handle('app:version', () => ({
      version: app.getVersion(),
      buildAt: new Date().toLocaleString('zh-CN', { hour12: false })
    }))
    ipcMain.handle('settings:chooseSkillsDir', async () => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const r = await dialog.showOpenDialog(win, {
        title: '选择技能主库目录',
        properties: ['openDirectory', 'createDirectory']
      })
      return r.canceled ? null : r.filePaths[0]
    })
    ipcMain.handle('settings:chooseLocalSkillDir', async () => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const r = await dialog.showOpenDialog(win, {
        title: '选择要导入的技能文件夹（需包含 SKILL.md）',
        properties: ['openDirectory']
      })
      return r.canceled ? null : r.filePaths[0]
    })

    // ---------- 技能库 ----------
    ipcMain.handle('library:scan', () => this.library.scan())
    ipcMain.handle('library:setStatus', (_e, name: string, status: SkillStatus) =>
      this.library.setStatus(name, status)
    )
    ipcMain.handle('library:uninstall', (_e, name: string) => this.library.uninstall(name))
    ipcMain.handle('library:saveDraft', (_e, name: string, content: string) =>
      this.library.createDraft(name, content)
    )
    ipcMain.handle('library:applySummary', (_e, skill: SkillInfo, description: string, tags: string[]) =>
      this.library.applySummary(skill.name, description, tags)
    )

    // ---------- Git 安装 ----------
    ipcMain.handle('git:version', () => this.git.version())
    ipcMain.handle('install:checkRemote', (_e, url: string) => this.git.checkRemote(url))
    ipcMain.handle('install:preview', async (_e, url: string): Promise<InstallPreview> => {
      const check = await this.git.checkRemote(url)
      if (!check.ok) throw new Error(`仓库不可达：${check.message}`)
      const previewId = randomUUID()
      const cloneDir = path.join(this.tmpDir, `preview-${previewId}`)
      const timer = setTimeout(() => this.cleanupPreview(previewId), 10 * 60 * 1000)
      timer.unref()
      this.pendingPreviews.set(previewId, { cloneDir, timer })
      const commit = await this.git.cloneShallow(url, cloneDir, (line) => {
        const win = BrowserWindow.getFocusedWindow()
        // 过滤进度行噪音，只转发有意义信息
        const clean = line.replace(/\r/g, '').trim()
        if (clean) win?.webContents.send('install:progress', clean.slice(0, 160))
      })
      const skills = await this.git.detectSkills(cloneDir)
      const description = await this.git.repoDescription(cloneDir)
      return { repoUrl: url, repoName: repoNameOf(url), description, cloneDir, skills, commit }
    })
    ipcMain.handle(
      'install:confirm',
      async (
        _e,
        payload: InstallPreview & {
          selections: { repoPath: string; name: string }[]
          generateZh?: boolean
        }
      ) => {
        const { selections, generateZh, ...preview } = payload
        try {
          const results: { name: string; ok: boolean; message: string }[] = []
          let zhNote = ''
          let groupDone = false
          for (const sel of selections) {
            try {
              const srcDir = path.join(preview.cloneDir, sel.repoPath)
              const info = await this.library.install(srcDir, sel.name, {
                kind: 'git',
                url: preview.repoUrl,
                repoPath: sel.repoPath,
                installedAt: new Date().toISOString(),
                commit: preview.commit
              })
              // 同一仓库只维护一次分组元数据（首个成功技能）
              if (!groupDone) {
                groupDone = true
                const description = await this.git.repoDescription(preview.cloneDir)
                await this.library.upsertGroup({
                  url: preview.repoUrl,
                  name: preview.repoName,
                  description,
                  installedAt: new Date().toISOString()
                })
              }
              // 为每个技能生成中文描述（索引级，不修改 SKILL.md）
              if (generateZh) {
                try {
                  const s = await this.settings.load()
                  const profile = s.llmProfiles.find((p) => p.id === s.activeLlmProfileId)
                  if (profile) {
                    const { summary } = await this.llm.summarizeSkill(profile, info)
                    if (summary.description) {
                      await this.library.setSkillZh(info.name, summary.description)
                      zhNote = '，中文描述已生成'
                    }
                  }
                } catch (e) {
                  zhNote = `，中文描述生成失败（${e instanceof Error ? e.message : String(e)}）`
                }
              }
              results.push({ name: info.name, ok: true, message: '安装成功' + zhNote })
            } catch (e) {
              results.push({
                name: sel.name,
                ok: false,
                message: e instanceof Error ? e.message : String(e)
              })
            }
          }
          return results
        } finally {
          // 无论成败都清理临时 clone
          const previewId = preview.cloneDir ? preview.cloneDir.split('-').pop() : undefined
          if (previewId) this.cleanupPreview(previewId)
        }
      }
    )
    // 技能级中文描述写入（渲染层先用 llm:summarize 生成，再调用本接口存入索引）
    ipcMain.handle('skills:setZh', (_e, name: string, descriptionZh: string) =>
      this.library.setSkillZh(name, descriptionZh)
    )
    // 批量生成中文描述：逐个 LLM 摘要 + 存索引，跳过已有中文描述，逐个容错
    ipcMain.handle('skills:batchSummarizeZh', async (_e, skills: SkillInfo[]) => {
      const profile = await this.settings.getActiveProfile()
      if (!profile) throw new Error('请先在设置中配置并激活 LLM 配置')
      const results: { name: string; ok: boolean; message: string }[] = []
      for (const skill of skills) {
        try {
          if (skill.descriptionZh?.trim()) {
            results.push({ name: skill.name, ok: true, message: '已有中文描述，跳过' })
            continue
          }
          const { summary } = await this.llm.summarizeSkill(profile, skill)
          if (!summary.description?.trim()) {
            results.push({ name: skill.name, ok: false, message: '模型返回为空，请重试' })
            continue
          }
          await this.library.setSkillZh(skill.name, summary.description)
          results.push({ name: skill.name, ok: true, message: '已生成中文描述' })
        } catch (e) {
          results.push({ name: skill.name, ok: false, message: e instanceof Error ? e.message : String(e) })
        }
      }
      return results
    })
    // 批量卸载技能
    ipcMain.handle('skills:batchUninstall', async (_e, names: string[]) => {
      const results: { name: string; ok: boolean; message: string }[] = []
      for (const name of names) {
        try {
          await this.library.uninstall(name)
          results.push({ name, ok: true, message: '已卸载' })
        } catch (e) {
          results.push({ name, ok: false, message: e instanceof Error ? e.message : String(e) })
        }
      }
      return results
    })
    // 仓库分组：删除整组（卸载组内全部技能）
    ipcMain.handle('groups:remove', async (_e, url: string) => {
      const removed = await this.library.removeGroup(url)
      return removed
    })
    // 仓库分组：编辑备注
    ipcMain.handle('groups:setNote', (_e, url: string, note: string) =>
      this.library.setGroupNote(url, note)
    )
    ipcMain.handle('install:updateMany', async (_e, skills: SkillInfo[]) => {
      const results: { name: string; ok: boolean; message: string }[] = []
      // 按仓库分组：同一仓库只浅克隆一次
      const byUrl = new Map<string, SkillInfo[]>()
      for (const s of skills) {
        if (s.source?.kind !== 'git' || !s.source.url) continue
        const list = byUrl.get(s.source.url) ?? []
        list.push(s)
        byUrl.set(s.source.url, list)
      }
      for (const [url, list] of byUrl) {
        const previewId = randomUUID()
        const cloneDir = path.join(this.tmpDir, `preview-${previewId}`)
        let repoSkills: Awaited<ReturnType<typeof this.git.detectSkills>>
        try {
          const commit = await this.git.cloneShallow(url, cloneDir)
          repoSkills = await this.git.detectSkills(cloneDir)
          for (const skill of list) {
            const match = repoSkills.find(
              (s) =>
                s.name === skill.name || (skill.source?.repoPath && s.repoPath === skill.source.repoPath)
            )
            if (!match) {
              results.push({ name: skill.name, ok: false, message: '仓库中未再找到该技能，可能已被移除' })
              continue
            }
            // 与本地记录的上次 commit 相同 → 已是最新，跳过重写
            if (skill.source?.commit && skill.source.commit === commit) {
              results.push({ name: skill.name, ok: true, message: '已是最新，无需更新' })
              continue
            }
            try {
              await this.library.update(match.name, path.join(cloneDir, match.repoPath), {
                kind: 'git',
                url: skill.source?.url ?? url,
                repoPath: match.repoPath,
                installedAt: skill.source?.installedAt ?? new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                commit
              })
              results.push({ name: skill.name, ok: true, message: '已更新' })
            } catch (e) {
              results.push({ name: skill.name, ok: false, message: e instanceof Error ? e.message : String(e) })
            }
          }
        } catch (e) {
          for (const skill of list) {
            results.push({ name: skill.name, ok: false, message: e instanceof Error ? e.message : String(e) })
          }
        } finally {
          const previewIdFromDir = path.basename(cloneDir).split('-').pop()
          if (previewIdFromDir) this.cleanupPreview(previewIdFromDir)
        }
      }
      return results
    })
    ipcMain.handle('install:update', async (_e, skill: SkillInfo) => {
      if (skill.source?.kind !== 'git' || !skill.source.url) {
        throw new Error('该技能不是 Git 来源，无法更新')
      }
      const previewId = randomUUID()
      const cloneDir = path.join(this.tmpDir, `preview-${previewId}`)
      const commit = await this.git.cloneShallow(skill.source.url, cloneDir)
      const skills = await this.git.detectSkills(cloneDir)
      const match = skills.find(
        (s) => s.name === skill.name || (skill.source?.repoPath && s.repoPath === skill.source.repoPath)
      )
      if (!match) {
        await fs.rm(cloneDir, { recursive: true, force: true })
        throw new Error('仓库中未再找到该技能，可能已被仓库移除')
      }
      try {
        const info = await this.library.update(match.name, path.join(cloneDir, match.repoPath), {
          kind: 'git',
          url: skill.source.url,
          repoPath: match.repoPath,
          installedAt: skill.source.installedAt,
          lastUpdated: new Date().toISOString(),
          commit
        })
        return info
      } finally {
        await fs.rm(cloneDir, { recursive: true, force: true })
      }
    })
    ipcMain.handle('install:importLocal', async (_e, srcDir: string, name?: string) => {
      return this.library.importLocal(srcDir, name)
    })

    // ---------- 项目链接（全局 + 项目两级） ----------
    ipcMain.handle('links:listProjects', () => this.links.listProjects())
    ipcMain.handle('links:addProject', async () => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const r = await dialog.showOpenDialog(win, {
        title: '选择要链接技能的项目文件夹',
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || !r.filePaths[0]) return null
      return this.links.addProject(r.filePaths[0])
    })
    ipcMain.handle('links:chooseProjectDir', async () => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const r = await dialog.showOpenDialog(win, {
        title: '选择项目文件夹',
        properties: ['openDirectory']
      })
      return r.canceled ? null : r.filePaths[0]
    })
    ipcMain.handle('links:addProjectByPath', (_e, projectPath: string, sites: LinksSite[]) =>
      this.links.addProject(projectPath, sites)
    )
    ipcMain.handle('links:chooseLinksDirs', async () => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const r = await dialog.showOpenDialog(win, {
        title: '选择技能链接目录（Agent 从此目录读取技能，可多选）',
        properties: ['openDirectory', 'createDirectory', 'multiSelections']
      })
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths
    })
    ipcMain.handle('links:setSites', (_e, projectId: string, sites: LinksSite[]) =>
      this.links.setSites(projectId, sites, (name) => this.library.resolveSkillDir(name))
    )
    ipcMain.handle('links:removeProject', (_e, id: string, unlinkAll: boolean) =>
      this.links.removeProject(id, unlinkAll)
    )
    ipcMain.handle(
      'links:link',
      (_e, projectId: string, skillNames: string[], sync?: boolean) =>
        this.links.linkProject(
          projectId,
          skillNames,
          (name) => this.library.resolveSkillDir(name),
          sync
        )
    )
    ipcMain.handle('links:unlink', (_e, projectId: string, skillName: string) =>
      this.links.unlinkSkill(projectId, skillName)
    )
    // 全局链接：一套技能集，对所有项目 / Agent 生效
    ipcMain.handle('links:getGlobal', () => this.links.getGlobalLinks())
    ipcMain.handle('links:setGlobalSites', (_e, sites: LinksSite[]) =>
      this.links.setGlobalSites(sites, (name) => this.library.resolveSkillDir(name))
    )
    ipcMain.handle('links:linkGlobal', (_e, skillNames: string[], sync?: boolean) =>
      this.links.linkGlobal(skillNames, (name) => this.library.resolveSkillDir(name), sync)
    )
    ipcMain.handle('links:unlinkGlobal', (_e, skillName: string) =>
      this.links.unlinkGlobal(skillName)
    )

    // ---------- LLM ----------
    ipcMain.handle('llm:listModels', (_e, profile: LlmProfile) => this.llm.listModels(profile))
    ipcMain.handle('llm:test', (_e, profile: LlmProfile) => this.llm.testProfile(profile))
    // 技能正文翻译成中文（LLM + 本地缓存 userData/zh-cache/<name>.md）
    ipcMain.handle('skill:translateZh', async (_e, skill: SkillInfo) => {
      const cacheFile = path.join(this.zhCacheDir, `${skill.name}.md`)
      try {
        const cached = await fs.readFile(cacheFile, 'utf-8')
        if (cached.trim()) return cached
      } catch {
        // 无缓存，继续生成
      }
      const s = await this.settings.load()
      const profile = s.llmProfiles.find((p) => p.id === s.activeLlmProfileId)
      if (!profile) throw new Error('未配置 LLM，请先在设置中配置')
      const { content } = await this.llm.translateSkill(profile, skill)
      const zh = content.trim()
      if (!zh) throw new Error('翻译结果为空，请重试')
      await fs.mkdir(this.zhCacheDir, { recursive: true })
      await fs.writeFile(cacheFile, zh, 'utf-8')
      return zh
    })
    ipcMain.handle('llm:summarize', async (_e, skill: SkillInfo) => {
      const profile = await this.settings.getActiveProfile()
      if (!profile) throw new Error('请先在设置中配置并激活 LLM 配置')
      return this.llm.summarizeSkill(profile, skill)
    })
    ipcMain.handle('llm:draft', async (_e, idea: string) => {
      const profile = await this.settings.getActiveProfile()
      if (!profile) throw new Error('请先在设置中配置并激活 LLM 配置')
      return this.llm.draftSkill(profile, idea)
    })
  }

  private async cleanupPreview(previewId: string): Promise<void> {
    const p = this.pendingPreviews.get(previewId)
    if (!p) return
    this.pendingPreviews.delete(previewId)
    clearTimeout(p.timer)
    await fs.rm(p.cloneDir, { recursive: true, force: true }).catch(() => {})
  }

  async cleanupAllPreviews(): Promise<void> {
    for (const id of [...this.pendingPreviews.keys()]) {
      await this.cleanupPreview(id)
    }
  }
}