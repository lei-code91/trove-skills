/**
 * trove-skills 共享类型定义（main / preload / renderer 共用）
 */

/** 技能安装来源 */
export interface SkillSource {
  kind: 'git' | 'local' | 'ai'
  url?: string
  /** 仓库内技能相对路径（仓库根为 '.'） */
  repoPath?: string
  installedAt: string
  lastUpdated?: string
  commit?: string
  branch?: string
}

/** 技能状态 */
export type SkillStatus = 'installed' | 'disabled' | 'broken'

/** 技能信息（主库中一个技能目录） */
export interface SkillInfo {
  /** 技能唯一名（目录名） */
  name: string
  title: string
  description: string
  /** 中文描述（LLM 生成，存索引；可选，不修改 SKILL.md） */
  descriptionZh?: string
  version?: string
  tags: string[]
  status: SkillStatus
  source?: SkillSource
  /** 主库内绝对路径 */
  path: string
  /** 原始 frontmatter（解析后的 YAML 对象） */
  frontmatter: Record<string, unknown>
  /** SKILL.md 正文 Markdown */
  readme: string
  /** 目录里其它文件（相对路径） */
  files: string[]
  updatedAt: string
}

/** 仓库预览结果（clone 到临时目录后识别） */
export interface InstallPreview {
  repoUrl: string
  /** 仓库短名（owner/repo） */
  repoName: string
  /** 仓库描述（README 提取的原文，可为空） */
  description: string
  cloneDir: string
  skills: {
    name: string
    repoPath: string
    title: string
    description: string
  }[]
  commit?: string
}

/** Git 仓库分组：同一 url 下安装的技能归为一组 */
export interface RepoGroup {
  /** 仓库 url（组主键） */
  url: string
  /** 仓库短名（owner/repo） */
  name: string
  /** 原文描述（README 提取） */
  description: string
  /** 用户备注（可编辑） */
  note?: string
  installedAt: string
  lastUpdated?: string
}

/** 主库扫描快照：技能列表 + 仓库分组 */
export interface LibrarySnapshot {
  skills: SkillInfo[]
  groups: RepoGroup[]
}

/** 项目记录：项目文件夹 + 链接到库的技能 */
export interface ProjectRecord {
  id: string
  name: string
  path: string
  /** 项目内 skills 子目录（链接安放处） */
  skillsDir: string
  linkedAt: string
  links: ProjectLink[]
}

export interface ProjectLink {
  skillName: string
  linkPath: string
  targetPath: string
  linkedAt: string
}

/** LLM 配置档位（用户可保存多个并切换） */
export interface LlmProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  createdAt: string
}

/** 全局设置 */
export interface AppSettings {
  /** 主技能库目录（trove 库，唯一权威来源） */
  skillsDir: string
  /** git 可执行文件路径，留空使用 PATH 中的 git */
  gitPath: string
  llmProfiles: LlmProfile[]
  activeLlmProfileId: string | null
}

export interface LlmSummary {
  description: string
  tags: string[]
}

export interface AiStats {
  model: string
  inputTokens: number
  outputTokens: number
}

export interface CreateSkillDraft {
  name: string
  title: string
  description: string
  tags: string[]
  skillMd: string
}