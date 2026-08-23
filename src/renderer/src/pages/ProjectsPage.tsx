import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectRecord, RepoGroup, SkillInfo } from '@shared/types'
import { useToast } from '../toast'
import { Modal, Spinner } from '../components/Modal'
import { shortUrl } from '../utils'

interface Props {
  projects: ProjectRecord[]
  skills: SkillInfo[]
  groups: RepoGroup[]
  onChanged: () => void
}

interface LinkSection {
  key: string
  name: string
  skills: SkillInfo[]
}

/** checkbox：支持半选态（indeterminate） */
function GroupCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange
}: {
  checked: boolean
  indeterminate: boolean
  disabled?: boolean
  onChange: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
}

export function ProjectsPage({ projects, skills, groups, onChanged }: Props): React.JSX.Element {
  const { push } = useToast()
  const [pathInput, setPathInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [manageId, setManageId] = useState<string | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  // 目录选择对话框（添加 / 变更）
  const [dirModal, setDirModal] = useState<
    | { mode: 'add' }
    | { mode: 'change'; project: ProjectRecord }
    | null
  >(null)
  const [modalPath, setModalPath] = useState('')
  const [preset, setPreset] = useState<'claude' | 'generic' | 'custom'>('claude')
  const [customDir, setCustomDir] = useState('')

  const closeDirModal = (): void => {
    setDirModal(null)
    setModalPath('')
    setPreset('claude')
    setCustomDir('')
  }

  const openAddModal = (prefill = ''): void => {
    setModalPath(prefill || pathInput)
    setPreset('claude')
    setCustomDir('')
    setDirModal({ mode: 'add' })
  }

  const openChangeModal = (project: ProjectRecord): void => {
    const p = project.path.replace(/\\/g, '/')
    const rel = project.skillsDir.replace(/\\/g, '/')
    let pre: 'claude' | 'generic' | 'custom' = 'custom'
    if (rel === p + '/.claude/skills') pre = 'claude'
    setModalPath(project.path)
    setPreset(pre)
    setCustomDir(pre === 'custom' ? project.skillsDir : '')
    setDirModal({ mode: 'change', project })
  }

  /** 当前预设对应的链接目录参数（相对项目根、~ 用户级或绝对路径） */
  const resolveDirArg = (): string | null => {
    if (preset === 'claude') return '.claude/skills'
    if (preset === 'generic') return '~/.agents/skills'
    const d = customDir.trim()
    return d || null
  }

  /** 添加项目（目录对话框确认） */
  const submitAdd = async (): Promise<void> => {
    const dirArg = resolveDirArg()
    if (!modalPath.trim() || !dirArg) {
      push('请填写项目路径' + (preset === 'custom' ? '与自定义目录' : ''), 'err')
      return
    }
    setBusy('add')
    try {
      const record = await window.trove.addProjectByPath(modalPath.trim(), dirArg)
      push(`已添加项目 ${record.name}（链接目录 ${record.skillsDir}）`)
      closeDirModal()
      setPathInput('')
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  /** 变更链接目录：断开旧链接并在新目录重建 */
  const submitChange = async (): Promise<void> => {
    if (!dirModal || dirModal.mode !== 'change') return
    const project = dirModal.project
    const dirArg = resolveDirArg()
    if (!dirArg) {
      push('请填写自定义目录', 'err')
      return
    }
    const abs =
      dirArg === '.claude/skills'
        ? `${project.path}/${dirArg}`
        : dirArg === '~/.agents/skills'
          ? dirArg
          : dirArg
    // 统一路径分隔符
    const newDir = abs.replace(/\\/g, '/')
    if (newDir.replace(/\/$/, '') === project.skillsDir.replace(/\\/g, '/').replace(/\/$/, '')) {
      push('目标目录与当前链接目录相同，无需变更')
      return
    }
    if (!window.confirm(`将断开 ${project.links.length} 个旧链接并在新目录重建（不影响主库）。继续？`)) return
    setBusy('changedir')
    try {
      const record = await window.trove.changeLinksDir(project.id, newDir)
      push(`链接目录已变更为 ${record.skillsDir}，重建 ${record.links.length} 个链接`)
      closeDirModal()
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
      const record = await window.trove.linkSkills(manageId, [...selectedSkills], true)
      push(`已保存链接：当前 ${record.links.length} 个技能`)
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

  // 按来源仓库分组（与技能库一致）；本地/AI 归入杂项组
  const sections = useMemo<LinkSection[]>(() => {
    const byUrl = new Map<string, LinkSection>()
    for (const s of effectiveSkills) {
      const url = s.source?.kind === 'git' && s.source.url ? s.source.url : undefined
      const key = url ?? '__local__'
      let sec = byUrl.get(key)
      if (!sec) {
        const g = url ? groups.find((x) => x.url === url) : undefined
        sec = {
          key,
          name: g?.name ?? (url ? shortUrl(url) : '本地 / AI 技能'),
          skills: []
        }
        byUrl.set(key, sec)
      }
      sec.skills.push(s)
    }
    return [...byUrl.values()].sort((a, b) => {
      if (a.key === '__local__') return 1
      if (b.key === '__local__') return -1
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
  }, [effectiveSkills, groups])

  /** 勾选 / 取消整个分组 */
  const toggleGroup = (sec: LinkSection): void => {
    const names = sec.skills.map((s) => s.name)
    const allSelected = names.every((n) => selectedSkills.has(n))
    setSelectedSkills((prev) => {
      const next = new Set(prev)
      for (const n of names) {
        if (allSelected) next.delete(n)
        else next.add(n)
      }
      return next
    })
  }

  /** 全选 / 取消全选（当前可用技能） */
  const toggleSelectAll = (): void => {
    const names = effectiveSkills.map((s) => s.name)
    const allSelected = names.every((n) => selectedSkills.has(n))
    setSelectedSkills(allSelected ? new Set() : new Set(names))
  }

  return (
    <div>
      <div className="page-head">
        <h2>项目链接</h2>
        <div className="actions">
          <button className="btn primary" onClick={() => openAddModal()} disabled={busy === 'add'}>
            ＋ 添加项目
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
        <div className="settings-row" style={{ marginBottom: 0 }}>
          <input
            className="input mono"
            placeholder="粘贴项目文件夹绝对路径，回车打开添加窗口…"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pathInput.trim()) openAddModal(pathInput.trim())
            }}
          />
          <button className="btn primary" disabled={!pathInput.trim()} onClick={() => openAddModal(pathInput.trim())}>
            添加
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
                <button className="btn small" onClick={() => openChangeModal(p)} title="更换 Agent 技能目录并重建链接">
                  变更目录
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
                链接目录：<span className="mono">{p.skillsDir}</span>（Agent 从此目录读取技能，内容为指向主库的链接，主库更新自动同步）
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
                <b>保存即生效：取消勾选的技能会被断开链接</b>；可以直接勾选整个仓库分组，一键加入该组全部技能。
              </div>
              {effectiveSkills.length === 0 ? (
                <div className="empty">主库暂无可用技能，请先安装技能。</div>
              ) : (
                <>
                  <div className="settings-row" style={{ marginBottom: 6 }}>
                    <button className="btn small" onClick={toggleSelectAll}>
                      {effectiveSkills.every((s) => selectedSkills.has(s.name)) && selectedSkills.size > 0
                        ? '☐ 取消全选'
                        : '☑ 全选'}
                    </button>
                    <span className="muted" style={{ fontSize: 12 }}>
                      已勾选 {selectedSkills.size} 个技能
                    </span>
                  </div>
                  <div className="check-list">
                    {sections.map((sec) => {
                      const allSel = sec.skills.every((s) => selectedSkills.has(s.name))
                      const someSel = sec.skills.some((s) => selectedSkills.has(s.name))
                      return (
                        <div key={sec.key} className="check-group">
                          <label className="check-group-head" title="勾选/取消整组">
                            <GroupCheckbox
                              checked={allSel}
                              indeterminate={someSel && !allSel}
                              onChange={() => toggleGroup(sec)}
                            />
                            <span>
                              <b>📦 {sec.name}</b>
                              <span className="muted">（{sec.skills.length} 个技能）</span>
                            </span>
                          </label>
                          <div className="check-group-body">
                            {sec.skills.map((s) => {
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
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setManageId(null)}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={busy === 'link'}
                title={
                  selectedSkills.size === 0 && managing.links.length > 0
                    ? '保存后将断开全部链接'
                    : '保存：勾选的技能将被链接，取消勾选的将被断开'
                }
                onClick={() => void linkSelected()}
              >
                {busy === 'link' ? <Spinner /> : null} 保存链接（{selectedSkills.size}）
              </button>
            </div>
          </div>
        </div>
      )}
      {dirModal && (
        <Modal
          title={dirModal.mode === 'add' ? '添加项目' : `变更链接目录 · ${dirModal.project.name}`}
          onClose={closeDirModal}
          width={560}
          footer={
            <>
              <button className="btn" onClick={closeDirModal}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={busy === 'add' || busy === 'changedir'}
                onClick={() =>
                  void (dirModal.mode === 'add' ? submitAdd() : submitChange())
                }
              >
                {busy === 'add' || busy === 'changedir' ? <Spinner /> : null}
                {dirModal.mode === 'add' ? '添加项目' : '变更并重建链接'}
              </button>
            </>
          }
        >
          {dirModal.mode === 'change' && (
            <div className="err-box">
              将断开 {dirModal.project.links.length} 个旧链接并在新目录重建（主库不受影响）。
            </div>
          )}
          <div className="field">
            <label>项目文件夹</label>
            <div className="settings-row" style={{ marginBottom: 0 }}>
              <input
                className="input mono"
                value={modalPath}
                readOnly={dirModal.mode === 'change'}
                onChange={(e) => setModalPath(e.target.value)}
                placeholder="D:\\Workspace\\Projects\\my-app"
              />
              {dirModal.mode === 'add' && (
                <button
                  className="btn"
                  onClick={() =>
                    void window.trove.chooseProjectDir().then((d) => {
                      if (d) setModalPath(d)
                    })
                  }
                >
                  浏览…
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <label>Agent 类型（决定链接目录，Agent 从该目录读取技能）</label>
            <div className="settings-row" style={{ marginBottom: 0 }}>
              <label className="preset-radio">
                <input
                  type="radio"
                  checked={preset === 'claude'}
                  onChange={() => setPreset('claude')}
                />
                Claude Code{' '}
                <span className="muted mono">项目/.claude/skills</span>
              </label>
              <label className="preset-radio">
                <input
                  type="radio"
                  checked={preset === 'generic'}
                  onChange={() => setPreset('generic')}
                />
                用户级通用{' '}
                <span className="muted mono">~/.agents/skills</span>
              </label>
              <label className="preset-radio">
                <input
                  type="radio"
                  checked={preset === 'custom'}
                  onChange={() => setPreset('custom')}
                />
                自定义
              </label>
            </div>
            {preset === 'custom' && (
              <div className="settings-row" style={{ marginBottom: 0 }}>
                <input
                  className="input mono"
                  value={customDir}
                  onChange={(e) => setCustomDir(e.target.value)}
                  placeholder="链接目录绝对路径，如 D:\\xxx\.cursor\skills"
                />
                <button
                  className="btn"
                  onClick={() =>
                    void window.trove.chooseLinksDir().then((d) => {
                      if (d) setCustomDir(d)
                    })
                  }
                >
                  浏览…
                </button>
              </div>
            )}
          </div>
          <div className="settings-hint">
            <b>Claude Code</b>：<span className="mono">.claude/skills</span>（项目级，Claude Code 直接识别）
            <br />
            <b>用户级通用</b>：<span className="mono">~/.agents/skills</span>（用户主目录，遵守该约定的 Agent 都能读到；所有项目共用，断开链接即移除该技能）
            <br />
            自定义：任意目录（如 Cursor 的 <span className="mono">.cursor/skills</span>）。
          </div>
        </Modal>
      )}
    </div>
  )
}