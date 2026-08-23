import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  InstallPreview,
  LibrarySnapshot,
  LlmProfile,
  ProjectRecord,
  SkillInfo,
  SkillStatus
} from '../shared/types'

const api = {
  // 窗口控制（无边框标题栏）
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
    ipcRenderer.on('window:maximize-changed', listener)
    return () => ipcRenderer.removeListener('window:maximize-changed', listener)
  },

  // 设置
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (data: AppSettings): Promise<void> => ipcRenderer.invoke('settings:update', data),
  getAppVersion: (): Promise<{ version: string; buildAt: string }> => ipcRenderer.invoke('app:version'),
  chooseSkillsDir: (): Promise<string | null> => ipcRenderer.invoke('settings:chooseSkillsDir'),
  chooseLocalSkillDir: (): Promise<string | null> =>
    ipcRenderer.invoke('settings:chooseLocalSkillDir'),

  // 技能库
  scanLibrary: (): Promise<LibrarySnapshot> => ipcRenderer.invoke('library:scan'),
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
    selections: { repoPath: string; name: string }[],
    opts?: { generateZh?: boolean }
  ): Promise<{ name: string; ok: boolean; message: string }[]> =>
    ipcRenderer.invoke('install:confirm', {
      ...preview,
      selections,
      generateZh: opts?.generateZh
    }),
  updateSkill: (skill: SkillInfo): Promise<SkillInfo> =>
    ipcRenderer.invoke('install:update', skill),
  updateSkills: (skills: SkillInfo[]): Promise<{ name: string; ok: boolean; message: string }[]> =>
    ipcRenderer.invoke('install:updateMany', skills),
  batchUninstall: (names: string[]): Promise<{ name: string; ok: boolean; message: string }[]> =>
    ipcRenderer.invoke('skills:batchUninstall', names),
  setSkillZh: (name: string, descriptionZh: string): Promise<void> =>
    ipcRenderer.invoke('skills:setZh', name, descriptionZh),
  removeGroup: (url: string): Promise<string[]> =>
    ipcRenderer.invoke('groups:remove', url),
  setGroupNote: (url: string, note: string): Promise<void> =>
    ipcRenderer.invoke('groups:setNote', url, note),
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
  addProjectByPath: (projectPath: string, linksRel?: string): Promise<ProjectRecord> =>
    ipcRenderer.invoke('links:addProjectByPath', projectPath, linksRel),
  chooseLinksDir: (): Promise<string | null> => ipcRenderer.invoke('links:chooseLinksDir'),
  changeLinksDir: (projectId: string, newDir: string): Promise<ProjectRecord> =>
    ipcRenderer.invoke('links:changeDir', projectId, newDir),
  removeProject: (id: string, unlinkAll = true): Promise<void> =>
    ipcRenderer.invoke('links:removeProject', id, unlinkAll),
  linkSkills: (
    projectId: string,
    skillNames: string[],
    sync?: boolean
  ): Promise<ProjectRecord> => ipcRenderer.invoke('links:link', projectId, skillNames, sync),
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
  }> => ipcRenderer.invoke('llm:draft', idea),
  translateSkillZh: (skill: SkillInfo): Promise<string> =>
    ipcRenderer.invoke('skill:translateZh', skill)
}

export type TroveApi = typeof api

contextBridge.exposeInMainWorld('trove', api)