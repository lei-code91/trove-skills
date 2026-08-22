import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { AppSettings, LlmProfile } from '@shared/types'

/**
 * 设置持久化管理：读写 userData/settings.json（原子写）
 * 不依赖 electron-store，逻辑简单可控。
 */
export class SettingsManager {
  private readonly file: string

  constructor(userDataDir?: string) {
    const dir = userDataDir ?? app.getPath('userData')
    this.file = path.join(dir, 'settings.json')
  }

  private defaults(): AppSettings {
    return {
      skillsDir: path.join(app.getPath('userData'), 'skills'),
      gitPath: '',
      llmProfiles: [],
      activeLlmProfileId: null
    }
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.file, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      return {
        ...this.defaults(),
        ...parsed,
        llmProfiles: Array.isArray(parsed.llmProfiles) ? parsed.llmProfiles : []
      }
    } catch {
      return this.defaults()
    }
  }

  async save(data: AppSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, this.file)
  }

  async getActiveProfile(): Promise<LlmProfile | null> {
    const s = await this.load()
    if (!s.activeLlmProfileId) return null
    return s.llmProfiles.find((p) => p.id === s.activeLlmProfileId) ?? null
  }
}