import React, { useState } from 'react'
import type { ProjectRecord, SkillInfo } from '@shared/types'
import { useToast } from '../toast'
import { Spinner } from '../components/Modal'

interface Props {
  projects: ProjectRecord[]
  skills: SkillInfo[]
  onChanged: () => void
}

export function ProjectsPage({ projects, skills, onChanged }: Props): React.JSX.Element {
  const { push } = useToast()
  const [pathInput, setPathInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [manageId, setManageId] = useState<string | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())

  const addProject = async (pathOverride?: string): Promise<void> => {
    setBusy('add')
    try {
      let record: ProjectRecord | null = null
      if (pathOverride) {
        record = await window.trove.addProjectByPath(pathOverride)
      } else {
        record = await window.trove.addProject()
      }
      if (!record) return
      push(`已添加项目 ${record.name}`)
      setPathInput('')
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const openManager = (p: ProjectRecord): void => {
    setManageId(p.id)
    setSelectedSkills(new Set(p.links.map((l) => l.skillName)))
  }

  const linkSelected = async (): Promise<void> => {
    if (!manageId) return
    setBusy('link')
    try {
      const record = await window.trove.linkSkills(manageId, [...selectedSkills])
      push(`已链接 ${record.links.length} 个技能`)
      setManageId(null)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const unlink = async (project: ProjectRecord, skillName: string): Promise<void> => {
    setBusy(`unlink-${skillName}`)
    try {
      await window.trove.unlinkSkill(project.id, skillName)
      push(`已断开 ${skillName}`)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const toggle = (name: string): void => {
    setSelectedSkills((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const managing = projects.find((p) => p.id === manageId) ?? null
  const effectiveSkills = skills.filter((s) => s.status !== 'broken')

  return (
    <div>
      <div className="page-head">
        <h2>项目链接</h2>
        <div className="actions">
          <button className="btn primary" onClick={() => void addProject()} disabled={busy === 'add'}>
            {busy === 'add' ? <Spinner /> : null} ＋ 添加项目
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
        <div className="settings-row" style={{ marginBottom: 0 }}>
          <input
            className="input mono"
            placeholder="也可以直接粘贴项目文件夹绝对路径…"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pathInput.trim()) void addProject(pathInput.trim())
            }}
          />
          <button
            className="btn"
            disabled={busy === 'add' || !pathInput.trim()}
            onClick={() => void addProject(pathInput.trim())}
          >
            添加
          </button>
          <button className="btn" onClick={() => void addProject()} disabled={busy === 'add'}>
            浏览…
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 34, marginBottom: 10 }}>📁</div>
          还没有项目。
          <br />
          添加一个项目文件夹后，可以把主库里的技能「链接」过去 —— 项目里的 skills 是指向主库的链接，
          <br />
          主库技能更新后项目自动同步，断开链接随时可做，不影响主库。
        </div>
      ) : (
        projects.map((p) => {
          const linked = p.links
          return (
            <div key={p.id} className="card project-card">
              <div className="head">
                <span style={{ fontSize: 18 }}>📁</span>
                <span className="name">{p.name}</span>
                <span className="muted mono">{p.path}</span>
                <span className="src-badge" style={{ marginLeft: 'auto' }}>
                  {linked.length} 个技能
                </span>
                <button className="btn small" onClick={() => openManager(p)}>
                  管理链接
                </button>
                <button
                  className="btn small danger"
                  disabled={busy === `rm-${p.id}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `移除项目「${p.name}」的链接管理记录？${linked.length > 0 ? '（同时断开所有链接）' : ''}`
                      )
                    ) {
                      setBusy(`rm-${p.id}`)
                      void window.trove
                        .removeProject(p.id, true)
                        .then(() => {
                          push('项目已移除')
                          onChanged()
                        })
                        .catch((e) => push(String(e), 'err'))
                        .finally(() => setBusy(null))
                    }
                  }}
                >
                  移除
                </button>
              </div>

              <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
                skills 目录：<span className="mono">{p.skillsDir}</span>（内容为指向主库的链接，主库更新自动同步）
              </div>

              {linked.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  暂无链接。点击「管理链接」选择需要链接的技能。
                </div>
              ) : (
                <div className="link-chips">
                  {linked.map((l) => (
                    <span key={l.skillName} className="link-chip" title={`→ ${l.targetPath}`}>
                      {l.skillName}
                      <span
                        className="x"
                        onClick={() => void unlink(p, l.skillName)}
                        title="断开链接"
                      >
                        ✕
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}

      {managing && (
        <div
          className="modal-mask"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setManageId(null)
          }}
        >
          <div className="modal">
            <div className="modal-head">
              <h3>管理链接 · {managing.name}</h3>
              <button className="close" onClick={() => setManageId(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="settings-hint">
                勾选要链接到 <span className="mono">{managing.skillsDir}</span> 的技能（链接到主库，不复制文件）。
                已勾选的技能若已在其它项目链接不受影响。
              </div>
              {effectiveSkills.length === 0 ? (
                <div className="empty">主库暂无可用技能，请先安装技能。</div>
              ) : (
                <div className="check-list">
                  {effectiveSkills.map((s) => {
                    const linkedNow = managing.links.some((l) => l.skillName === s.name)
                    return (
                      <label
                        key={s.name}
                        className={`check-item ${s.status === 'disabled' ? 'disabled-item' : ''}`}
                        title={s.status === 'disabled' ? '该技能已停用（仍可链接，建议先启用）' : s.description}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSkills.has(s.name)}
                          onChange={() => toggle(s.name)}
                        />
                        <span>
                          <b>{s.title}</b> {linkedNow && <span className="tag">已链接</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setManageId(null)}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={busy === 'link' || selectedSkills.size === 0}
                onClick={() => void linkSelected()}
              >
                {busy === 'link' ? <Spinner /> : null} 链接所选（{selectedSkills.size}）技能
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}