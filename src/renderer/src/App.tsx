import React, { useCallback, useEffect, useState } from 'react'
import type { AppSettings, GlobalLinks, ProjectRecord, RepoGroup, SkillInfo } from '@shared/types'
import { ToastProvider } from './toast'
import { TitleBar } from './components/TitleBar'
import { LibraryPage } from './pages/LibraryPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'

type View = 'library' | 'projects' | 'settings'

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>('library')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [groups, setGroups] = useState<RepoGroup[]>([])
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [global, setGlobal] = useState<GlobalLinks | null>(null)
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [s, snap, pr, g] = await Promise.all([
      window.trove.getSettings(),
      window.trove.scanLibrary(),
      window.trove.listProjects(),
      window.trove.getGlobalLinks()
    ])
    setSettings(s)
    setSkills(snap.skills)
    setGroups(snap.groups)
    setProjects(pr)
    setGlobal(g)
    const p = s.llmProfiles.find((x) => x.id === s.activeLlmProfileId)
    setActiveProfileName(p ? `${p.name} · ${p.model}` : null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <ToastProvider>
      <div className="shell">
        <TitleBar />
        <div className="app">
          <aside className="sidebar">
          <button
            className={`nav-item ${view === 'library' ? 'active' : ''}`}
            onClick={() => setView('library')}
          >
            🧩 技能库
            <span className="badge">{skills.length}</span>
          </button>
          <button
            className={`nav-item ${view === 'projects' ? 'active' : ''}`}
            onClick={() => setView('projects')}
          >
            📁 项目链接
            <span className="badge">{projects.length}</span>
          </button>
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            ⚙️ 设置
          </button>
          <div className="spacer" />
          <div className="llm-status">
            <div className="label">LLM</div>
            <div className="value">
              <span className={`dot ${activeProfileName ? 'on' : 'off'}`} />
              {activeProfileName ?? '未配置'}
            </div>
          </div>
        </aside>

        <main className="main">
          {view === 'library' && (
            <LibraryPage
              skills={skills}
              groups={groups}
              settings={settings}
              onChanged={() => void refresh()}
            />
          )}
          {view === 'projects' && (
            <ProjectsPage
              projects={projects}
              skills={skills}
              groups={groups}
              global={global}
              onChanged={() => void refresh()}
            />
          )}
          {view === 'settings' && (
            <SettingsPage
              settings={settings}
              onChanged={() => void refresh()}
            />
          )}
        </main>
        </div>
      </div>
    </ToastProvider>
  )
}