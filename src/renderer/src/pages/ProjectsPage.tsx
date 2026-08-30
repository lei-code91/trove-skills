import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { GlobalLinks, LinksSite, ProjectRecord, RepoGroup, SkillInfo } from '@shared/types'
import { useToast } from '../toast'
import { Modal, Spinner } from '../components/Modal'
import { shortUrl } from '../utils'

interface Props {
  projects: ProjectRecord[]
  skills: SkillInfo[]
  groups: RepoGroup[]
  global: GlobalLinks | null
  onChanged: () => void
}

interface LinkSection {
  key: string
  name: string
  skills: SkillInfo[]
}

type SiteModalState =
  | { mode: 'add' }
  | { mode: 'manage'; project: ProjectRecord }
  | { mode: 'global' }
  | null

const LAST_CUSTOM_DIR_KEY = 'trove-last-custom-dir'

/** 去尾部斜杠，避免同目录以不同写法重复添加 */
const trimTrailing = (p: string): string => p.trim().replace(/[\\/]+$/, '')

const kindLabel = (kind: LinksSite['kind']): string =>
  kind === 'claude' ? '项目级' : kind === 'global' ? '全局' : '自定义'

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

/** 技能勾选弹窗（项目 / 全局共用）：单套技能集 + 全选/分组勾选 */
function SkillPickerModal({
  title,
  subtitle,
  skills,
  groups,
  selected,
  setSelected,
  busy,
  onClose,
  onSave
}: {
  title: string
  subtitle: string
  skills: SkillInfo[]
  groups: RepoGroup[]
  selected: Set<string>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
  busy: boolean
  onClose: () => void
  onSave: () => void
}): React.JSX.Element {
  const effectiveSkills = skills.filter((s) => s.status !== 'broken')
  const sections = useMemo<LinkSection[]>(() => {
    const byUrl = new Map<string, LinkSection>()
    for (const s of effectiveSkills) {
      const url = s.source?.kind === 'git' && s.source.url ? s.source.url : undefined
      const key = url ?? '__local__'
      let sec = byUrl.get(key)
      if (!sec) {
        const g = url ? groups.find((x) => x.url === url) : undefined
        sec = { key, name: g?.name ?? (url ? shortUrl(url) : '本地 / AI 技能'), skills: [] }
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

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleGroup = (sec: LinkSection): void => {
    const names = sec.skills.map((s) => s.name)
    const allSelected = names.every((n) => selected.has(n))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const n of names) {
        if (allSelected) next.delete(n)
        else next.add(n)
      }
      return next
    })
  }

  const toggleSelectAll = (): void => {
    const names = effectiveSkills.map((s) => s.name)
    const allSelected = names.every((n) => selected.has(n))
    setSelected(allSelected ? new Set() : new Set(names))
  }

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="settings-hint">{subtitle}</div>
          {effectiveSkills.length === 0 ? (
            <div className="empty">主库暂无可用技能，请先安装技能。</div>
          ) : (
            <>
              <div className="settings-row" style={{ marginBottom: 6 }}>
                <button className="btn small" onClick={toggleSelectAll}>
                  {effectiveSkills.every((s) => selected.has(s.name)) && selected.size > 0
                    ? '☐ 取消全选'
                    : '☑ 全选'}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  已勾选 {selected.size} 个技能
                </span>
              </div>
              <div className="check-list">
                {sections.map((sec) => {
                  const allSel = sec.skills.every((s) => selected.has(s.name))
                  const someSel = sec.skills.some((s) => selected.has(s.name))
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
                        {sec.skills.map((s) => (
                          <label
                            key={s.name}
                            className={`check-item ${s.status === 'disabled' ? 'disabled-item' : ''}`}
                            title={
                              s.status === 'disabled' ? '该技能已停用（仍可链接，建议先启用）' : s.description
                            }
                          >
                            <input type="checkbox" checked={selected.has(s.name)} onChange={() => toggle(s.name)} />
                            <span>
                              <b>{s.title}</b>
                              {selected.has(s.name) && <span className="tag">已勾选</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={busy}
            title={
              selected.size === 0 ? '保存后将断开全部链接' : '保存：勾选的技能将被链接，未勾选的将被断开'
            }
            onClick={onSave}
          >
            {busy ? <Spinner /> : null} 保存链接（{selected.size}）
          </button>
        </div>
      </div>
    </div>
  )
}

/** 位点目录列表（可移除） */
function SiteChips({
  sites,
  onRemove
}: {
  sites: LinksSite[]
  onRemove?: (dir: string) => void
}): React.JSX.Element {
  if (sites.length === 0) return <span className="muted" style={{ fontSize: 12 }}>（尚未添加位点目录）</span>
  return (
    <div className="link-chips" style={{ marginTop: 8 }}>
      {sites.map((s) => (
        <span key={s.dir} className="link-chip" title={`${kindLabel(s.kind)} · ${s.dir}`}>
          <span className="src-badge" style={{ marginRight: 4, fontSize: 11 }}>
            {kindLabel(s.kind)}
          </span>
          <span className="mono" style={{ fontSize: 12 }}>{s.dir}</span>
          {onRemove && (
            <span className="x" onClick={() => onRemove(s.dir)} title="移除位点">
              ✕
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

export function ProjectsPage({ projects, skills, groups, global, onChanged }: Props): React.JSX.Element {
  const { push } = useToast()
  const [pathInput, setPathInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [manageId, setManageId] = useState<string | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  // 全局链接管理弹窗
  const [globalManage, setGlobalManage] = useState(false)
  const [globalSelected, setGlobalSelected] = useState<Set<string>>(new Set())
  // 位点编辑弹窗（添加项目 / 管理项目位点 / 全局位点）
  const [siteModal, setSiteModal] = useState<SiteModalState>(null)
  const [modalPath, setModalPath] = useState('')
  const [siteDirs, setSiteDirs] = useState<LinksSite[]>([])
  const [customInput, setCustomInput] = useState<string>(
    () => localStorage.getItem(LAST_CUSTOM_DIR_KEY) ?? ''
  )

  const closeSiteModal = (): void => {
    setSiteModal(null)
    setModalPath('')
    setSiteDirs([])
  }

  const openAddModal = (prefill = ''): void => {
    setModalPath(prefill || pathInput)
    const hasPath = !!(prefill || pathInput)
    setSiteDirs(
      hasPath
        ? [{ dir: trimTrailing(prefill || pathInput) + '\\' + '.claude' + '\\' + 'skills', kind: 'claude' }]
        : []
    )
    setSiteModal({ mode: 'add' })
  }

  const openManageSites = (project: ProjectRecord): void => {
    setModalPath(project.path)
    setSiteDirs(project.sites.map((s) => ({ ...s })))
    setSiteModal({ mode: 'manage', project })
  }

  const openGlobalSites = (): void => {
    setModalPath('')
    setSiteDirs((global?.sites ?? []).map((s) => ({ ...s })))
    setSiteModal({ mode: 'global' })
  }

  /** 去重后加入一个位点 */
  const addSite = (site: LinksSite): void => {
    const dir = trimTrailing(site.dir)
    if (!dir) return
    if (siteDirs.some((s) => trimTrailing(s.dir) === dir)) {
      push('该目录已在位点列表中', 'err')
      return
    }
    setSiteDirs((prev) => {
      if (prev.some((s) => trimTrailing(s.dir) === dir)) return prev
      return [...prev, { ...site, dir }]
    })
  }

  /** 预设位点：Claude 项目级 / 全局用户级 */
  const addPreset = (kind: 'claude' | 'global'): void => {
    if (kind === 'claude') {
      if (!modalPath.trim()) {
        push('请先填写项目文件夹路径', 'err')
        return
      }
      addSite({
        dir: trimTrailing(modalPath) + '\\' + '.claude' + '\\' + 'skills',
        kind: 'claude'
      })
    } else {
      addSite({ dir: '~/.agents/skills', kind: 'global' })
    }
  }

  /** 自定义目录：输入添加或多个目录浏览添加 */
  const addCustom = (): void => {
    const dir = trimTrailing(customInput)
    if (!dir) {
      push('请填写自定义链接目录', 'err')
      return
    }
    addSite({ dir, kind: 'custom' })
    localStorage.setItem(LAST_CUSTOM_DIR_KEY, dir)
    setCustomInput('')
  }

  const browseCustom = async (): Promise<void> => {
    const dirs = await window.trove.chooseLinksDirs()
    if (!dirs || dirs.length === 0) return
    for (const d of dirs) addSite({ dir: trimTrailing(d), kind: 'custom' })
    // 记住最近的一个，方便下次追加
    localStorage.setItem(LAST_CUSTOM_DIR_KEY, trimTrailing(dirs[dirs.length - 1]))
  }

  /** 提交位点编辑：添加项目 / 变更项目位点 / 设定全局位点 */
  const submitSites = async (): Promise<void> => {
    if (!siteModal) return
    if (siteDirs.length === 0) {
      push('请至少添加一个链接目录位点', 'err')
      return
    }
    setBusy('sites')
    try {
      if (siteModal.mode === 'add') {
        if (!modalPath.trim()) {
          push('请填写项目文件夹路径', 'err')
          return
        }
        const record = await window.trove.addProjectByPath(modalPath.trim(), siteDirs)
        push(`已添加项目 ${record.name}（${record.sites.length} 个位点目录）`)
      } else if (siteModal.mode === 'manage') {
        const record = await window.trove.setProjectSites(siteModal.project.id, siteDirs)
        push(`已更新位点：${record.sites.length} 个目录，保留 ${record.links.length} 个链接`)
      } else {
        const config = await window.trove.setGlobalSites(siteDirs)
        push(`已更新全局位点：${config.sites.length} 个目录，保留 ${config.links.length} 个链接`)
      }
      closeSiteModal()
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

  const saveGlobal = async (): Promise<void> => {
    setBusy('globallink')
    try {
      const config = await window.trove.linkGlobal([...globalSelected], true)
      push(`已保存全局链接：当前 ${config.links.length} 个技能`)
      setGlobalManage(false)
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

  const unlinkGlobal = async (skillName: string): Promise<void> => {
    setBusy(`gunlink-${skillName}`)
    try {
      await window.trove.unlinkGlobal(skillName)
      push(`已从全局断开 ${skillName}`)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const managing = projects.find((p) => p.id === manageId) ?? null

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

      {/* 全局链接（对所有项目 / Agent 生效） */}
      <div className="card project-card" style={{ marginBottom: 16 }}>
        <div className="head">
          <span style={{ fontSize: 18 }}>🌐</span>
          <span className="name">全局链接</span>
          <span className="muted mono">{global?.sites[0]?.dir ?? '~/.agents/skills'}</span>
          <span className="src-badge" style={{ marginLeft: 'auto' }}>
            {global?.links.length ?? 0} 个技能
          </span>
          <button className="btn small" onClick={() => openGlobalSites()} title="管理全局链接位点目录">
            管理位点
          </button>
          <button
            className="btn small primary"
            disabled={busy === 'globallink'}
            onClick={() => {
              setGlobalSelected(new Set(global?.links.map((l) => l.skillName) ?? []))
              setGlobalManage(true)
            }}
          >
            管理全局链接
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
          全局位点：{global?.sites.map((s) => s.dir).join('、') ?? '~/.agents/skills'}
          （一套技能集同时链接到这些目录，所有项目 / Agent 共用；断开即移除该技能）
        </div>
        {!global || global.links.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            暂无全局链接。点击「管理全局链接」勾选需要全局生效的技能。
          </div>
        ) : (
          <div className="link-chips">
            {global.links.map((l) => (
              <span key={l.skillName + l.dir} className="link-chip" title={`→ ${l.targetPath}`}>
                {l.skillName}
                <span className="x" onClick={() => void unlinkGlobal(l.skillName)} title="断开全局链接">
                  ✕
                </span>
              </span>
            ))}
          </div>
        )}
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
                <button className="btn small" onClick={() => openManageSites(p)} title="更换 / 增加 Agent 位点目录并重建链接">
                  管理位点
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
                {p.sites.length > 1 ? '链接位点：' : '链接目录：'}
                {p.sites.length > 1 ? (
                  <span className="mono">{p.sites.map((s) => s.dir).join('、')}</span>
                ) : (
                  <span className="mono">{p.skillsDir}</span>
                )}
                （Agent 从这些目录读取技能，内容为指向主库的链接，主库更新自动同步）
              </div>
              <SiteChips sites={p.sites} />

              {linked.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  暂无链接。点击「管理链接」选择需要链接的技能。
                </div>
              ) : (
                <div className="link-chips">
                  {linked.map((l) => (
                    <span key={l.skillName + l.dir} className="link-chip" title={`→ ${l.targetPath}`}>
                      {l.skillName}
                      <span className="x" onClick={() => void unlink(p, l.skillName)} title="断开链接">
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
        <SkillPickerModal
          title={`管理链接 · ${managing.name}`}
          subtitle={`勾选要链接到 ${managing.sites.map((s) => s.dir).join('、')} 的技能（链接到主库，不复制文件）。保存即生效：取消勾选的技能会被断开链接。`}
          skills={skills}
          groups={groups}
          selected={selectedSkills}
          setSelected={setSelectedSkills}
          busy={busy === 'link'}
          onClose={() => setManageId(null)}
          onSave={() => void linkSelected()}
        />
      )}

      {globalManage && (
        <SkillPickerModal
          title="管理全局链接"
          subtitle={`勾选要全局生效的技能，将链接到：${global?.sites.map((s) => s.dir).join('、') ?? '~/.agents/skills'}。对所有项目 / Agent 生效；取消勾选的会被断开。`}
          skills={skills}
          groups={groups}
          selected={globalSelected}
          setSelected={setGlobalSelected}
          busy={busy === 'globallink'}
          onClose={() => setGlobalManage(false)}
          onSave={() => void saveGlobal()}
        />
      )}

      {/* 位点编辑弹窗（添加项目 / 管理项目位点 / 全局位点） */}
      {siteModal && (
        <Modal
          title={
            siteModal.mode === 'add'
              ? '添加项目'
              : siteModal.mode === 'manage'
                ? `管理位点 · ${siteModal.project.name}`
                : '管理全局位点'
          }
          onClose={closeSiteModal}
          width={620}
          footer={
            <>
              <button className="btn" onClick={closeSiteModal}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={busy === 'sites'}
                onClick={() => void submitSites()}
              >
                {busy === 'sites' ? <Spinner /> : null}
                {siteModal.mode === 'add' ? '添加项目' : '保存位点并重建链接'}
              </button>
            </>
          }
        >
          {siteModal.mode === 'manage' && (
            <div className="err-box">
              将断开不在新位点中的 {siteModal.project.links.length} 条旧链接并为新位点重建（主库不受影响）。
            </div>
          )}
          {siteModal.mode !== 'global' && (
            <div className="field">
              <label>{siteModal.mode === 'add' ? '项目文件夹' : '项目文件夹（只读）'}</label>
              <div className="settings-row" style={{ marginBottom: 0 }}>
                <input
                  className="input mono"
                  value={modalPath}
                  readOnly={siteModal.mode === 'manage'}
                  onChange={(e) => setModalPath(e.target.value)}
                  placeholder="D:\\Workspace\\Projects\\my-app"
                />
                {siteModal.mode === 'add' && (
                  <button
                    className="btn"
                    onClick={() =>
                      void window.trove.chooseProjectDir().then((d) => {
                        if (d) setModalPath(trimTrailing(d))
                      })
                    }
                  >
                    浏览…
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="field">
            <label>位点目录（Agent 从这些目录读取技能，可多条；技能集链接到全部位点）</label>
            <SiteChips sites={siteDirs} onRemove={(dir) => setSiteDirs((prev) => prev.filter((s) => s.dir !== dir))} />
            <div className="settings-row" style={{ marginTop: 8, marginBottom: 0 }}>
              <label className="preset-radio">
                <input type="checkbox" onChange={() => addPreset('claude')} disabled={siteModal.mode === 'global'} />
                Claude Code 项目级
                <span className="muted mono"> 项目/.claude/skills</span>
              </label>
              <label className="preset-radio">
                <input type="checkbox" onChange={() => addPreset('global')} />
                全局用户级
                <span className="muted mono"> ~/.agents/skills</span>
              </label>
            </div>
            <div className="settings-row" style={{ marginTop: 6, marginBottom: 0 }}>
              <input
                className="input mono"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="自定义目录（可记忆），如 D:\\xxx\\.cursor\\skills"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCustom()
                }}
              />
              <button className="btn" onClick={addCustom}>
                添加
              </button>
              <button className="btn" onClick={() => void browseCustom()}>
                浏览（多选）…
              </button>
            </div>
          </div>
          <div className="settings-hint">
            <b>项目级</b>：<span className="mono">.claude/skills</span>（Claude Code 直接识别）；<b>全局</b>：
            <span className="mono">~/.agents/skills</span>（遵守该约定的 Agent 都能读到，所有项目共用）；
            自定义：任意目录（如 Cursor 的 <span className="mono">.cursor/skills</span>）。
            {siteModal.mode === 'global'
              ? '全局位点建议只留全局用户级或自定义目录。'
              : '多个位点时，一次勾选的技能集会同时链接到所有位点目录。'}
          </div>
        </Modal>
      )}
    </div>
  )
}