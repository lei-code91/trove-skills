import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  InstallPreview,
  LlmProfile,
  ProjectRecord,
  SkillInfo,
  SkillStatus
} from '../shared/types'

const api = {
  // 设置
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (data: AppSettings): Promise<void> => ipcRenderer.invoke('settings:update', data),
  chooseSkillsDir: (): Promise<string | null> => ipcRenderer.invoke('settings:chooseSkillsDir'),
  chooseLocalSkillDir: (): Promise<string | null> =>
    ipcRenderer.invoke('settings:chooseLocalSkillDir'),

  // 技能库
  scanLibrary: (): Promise<SkillInfo[]> => ipcRenderer.invoke('library:scan'),
  setSkillStatus: (name: string, status: SkillStatus): Promise<void> =>
    ipcRenderer.invoke('library:setStatus', name, status),
  uninstallSkill: (name: string): Promise<void> => ipcRenderer.invoke('library:uninstall', name),
  saveDraftSkill: (name: string, content: string): Promise<SkillInfo> =>
    ipcRenderer.invoke('library:saveDraft', name, content),
  applySummary: (
    skill: SkillInfo,
    description: string,
    tags: string[]
  ): Promise<SkillInfo> => ipcRenderer.invoke('library:applySummary', skill, description, tags),

  // Git 安装
  gitVersion: (): Promise<string> => ipcRenderer.invoke('git:version'),
  checkRemote: (url: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('install:checkRemote', url),
  previewInstall: (url: string): Promise<InstallPreview> =>
    ipcRenderer.invoke('install:preview', url),
  confirmInstall: (
    preview: InstallPreview,
    selections: { repoPath: string; name: string }[]
  ): Promise<{ name: string; ok: boolean; message: string }[]> =>
    ipcRenderer.invoke('install:confirm', { ...preview, selections }),
  updateSkill: (skill: SkillInfo): Promise<SkillInfo> =>
    ipcRenderer.invoke('install:update', skill),
  importLocalSkill: (dir: string, name?: string): Promise<SkillInfo> =>
    ipcRenderer.invoke('install:importLocal', dir, name),
  onInstallProgress: (cb: (line: string) => void): (() => void) => {
    const listener = (_e: unknown, line: string): void => cb(line)
    ipcRenderer.on('install:progress', listener)
    return () => ipcRenderer.removeListener('install:progress', listener)
  },

  // 项目链接
  listProjects: (): Promise<ProjectRecord[]> => ipcRenderer.invoke('links:listProjects'),
  addProject: (): Promise<ProjectRecord | null> => ipcRenderer.invoke('links:addProject'),
  chooseProjectDir: (): Promise<string | null> => ipcRenderer.invoke('links:chooseProjectDir'),
  addProjectByPath: (projectPath: string): Promise<ProjectRecord> =>
    ipcRenderer.invoke('links:addProjectByPath', projectPath),
  removeProject: (id: string, unlinkAll = true): Promise<void> =>
    ipcRenderer.invoke('links:removeProject', id, unlinkAll),
  linkSkills: (projectId: string, skillNames: string[]): Promise<ProjectRecord> =>
    ipcRenderer.invoke('links:link', projectId, skillNames),
  unlinkSkill: (projectId: string, skillName: string): Promise<ProjectRecord> =>
    ipcRenderer.invoke('links:unlink', projectId, skillName),

  // LLM
  listModels: (profile: LlmProfile): Promise<string[]> =>
    ipcRenderer.invoke('llm:listModels', profile),
  testLlm: (profile: LlmProfile): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('llm:test', profile),
  summarizeSkill: (
    skill: SkillInfo
  ): Promise<{ summary: { description: string; tags: string[] }; stats: { model: string; inputTokens: number; outputTokens: number } }> =>
    ipcRenderer.invoke('llm:summarize', skill),
  draftSkill: (
    idea: string
  ): Promise<{
    draft: {
      name: string
      title: string
      description: string
      tags: string[]
      skillMd: string
    }
    stats: { model: string; inputTokens: number; outputTokens: number }
  }> => ipcRenderer.invoke('llm:draft', idea)
}

export type TroveApi = typeof api

contextBridge.exposeInMainWorld('trove', api)