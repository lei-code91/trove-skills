import { ipcMain, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type {
  AppSettings,
  InstallPreview,
  LlmProfile,
  SkillInfo,
  SkillStatus
} from '@shared/types'
import { SettingsManager } from './services/settings'
import { LibraryManager } from './services/library'
import { GitService } from './services/git'
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
    private readonly tmpDir: string
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
      return { repoUrl: url, cloneDir, skills, commit }
    })
    ipcMain.handle(
      'install:confirm',
      async (
        _e,
        preview: InstallPreview & { selections: { repoPath: string; name: string }[] }
      ) => {
        try {
          const results: { name: string; ok: boolean; message: string }[] = []
          for (const sel of preview.selections) {
            try {
              const srcDir = path.join(preview.cloneDir, sel.repoPath)
              const info = await this.library.install(srcDir, sel.name, {
                kind: 'git',
                url: preview.repoUrl,
                repoPath: sel.repoPath,
                installedAt: new Date().toISOString(),
                commit: preview.commit
              })
              results.push({ name: info.name, ok: true, message: '安装成功' })
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

    // ---------- 项目链接 ----------
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
    ipcMain.handle('links:addProjectByPath', (_e, projectPath: string) =>
      this.links.addProject(projectPath)
    )
    ipcMain.handle('links:removeProject', (_e, id: string, unlinkAll: boolean) =>
      this.links.removeProject(id, unlinkAll)
    )
    ipcMain.handle(
      'links:link',
      (_e, projectId: string, skillNames: string[]) =>
        this.links.linkSkills(projectId, skillNames, (name) =>
          this.library.resolveSkillDir(name)
        )
    )
    ipcMain.handle('links:unlink', (_e, projectId: string, skillName: string) =>
      this.links.unlinkSkill(projectId, skillName)
    )

    // ---------- LLM ----------
    ipcMain.handle('llm:listModels', (_e, profile: LlmProfile) => this.llm.listModels(profile))
    ipcMain.handle('llm:test', (_e, profile: LlmProfile) => this.llm.testProfile(profile))
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