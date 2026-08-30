import React, { useEffect, useMemo, useState } from 'react'
import type { AppSettings, RepoGroup, SkillInfo } from '@shared/types'
import { useToast } from '../toast'
import { renderMarkdown } from '../markdown'
import { shortUrl, formatTime } from '../utils'
import { InstallWizard } from '../components/InstallWizard'
import { AiDraftWizard } from '../components/AiDraftWizard'
import { Modal, Spinner } from '../components/Modal'

type Filter = 'all' | 'installed' | 'disabled' | 'broken'

interface Props {
  skills: SkillInfo[]
  groups: RepoGroup[]
  settings: AppSettings | null
  onChanged: () => void
}

interface GroupedSection {
  key: string
  name: string
  description: string
  group?: RepoGroup
  skills: SkillInfo[]
}

/** 更新结果明细弹窗：已更新 / 已是最新 / 失败 三区 */
function UpdateResultModal({
  title,
  results,
  onClose
}: {
  title: string
  results: { name: string; ok: boolean; message: string }[]
  onClose: () => void
}): React.JSX.Element {
  const updated = results.filter((r) => r.ok && r.message === '已更新')
  const latest = results.filter((r) => r.ok && r.message.includes('已是最新'))
  const failed = results.filter((r) => !r.ok)
  const chipList = (items: { name: string }[], emptyText: string): React.JSX.Element =>
    items.length === 0 ? (
      <div className="muted" style={{ fontSize: 13 }}>{emptyText}</div>
    ) : (
      <div className="link-chips">
        {items.map((i) => (
          <span key={i.name} className="link-chip">
            {i.name}
          </span>
        ))}
      </div>
    )
  return (
    <Modal
      title={`更新结果 · ${title}`}
      onClose={onClose}
      width={540}
      footer={
        <button className="btn primary" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="settings-hint" style={{ marginBottom: 4 }}>
        <b>已更新（{updated.length}）</b>
      </div>
      {chipList(updated, '无')}
      <div className="settings-hint" style={{ marginTop: 10, marginBottom: 4 }}>
        <b>已是最新（{latest.length}）</b>
      </div>
      {chipList(latest, '无')}
      <div className="settings-hint" style={{ marginTop: 10, marginBottom: 4 }}>
        <b>失败（{failed.length}）</b>
      </div>
      {failed.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>无</div>
      ) : (
        <div>
          {failed.map((f) => (
            <div key={f.name} className="err-box" style={{ marginBottom: 6 }}>
              <b>{f.name}</b>：{f.message}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function LibraryPage({ skills, groups, settings, onChanged }: Props): React.JSX.Element {
  const { push } = useToast()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<SkillInfo | null>(null)
  const [showInstall, setShowInstall] = useState(false)
  const [showDraft, setShowDraft] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ description: string; tags: string[] } | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  // 折叠的组 key
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // 视图（列表默认）/ 描述语言（中文优先）/ 批量勾选 / 备注编辑
  const [view, setView] = useState<'list' | 'grid'>(
    () => (localStorage.getItem('trove-view') as 'list' | 'grid') || 'list'
  )
  const [zhDesc, setZhDesc] = useState<boolean>(() => localStorage.getItem('trove-desc-zh') !== '0')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [noteFor, setNoteFor] = useState<RepoGroup | null>(null)
  const [noteText, setNoteText] = useState('')
  // 详情正文翻译（中文内容 + 切换）
  const [readmeZh, setReadmeZh] = useState<string | null>(null)
  const [showZh, setShowZh] = useState(false)
  const [translateBusy, setTranslateBusy] = useState(false)
  // 更新结果明细（全部更新 / 分组更新共用）
  const [updateResult, setUpdateResult] = useState<{
    title: string
    results: { name: string; ok: boolean; message: string }[]
  } | null>(null)

  // 切换选中技能时重置翻译状态
  useEffect(() => {
    setReadmeZh(null)
    setShowZh(false)
    setTranslateBusy(false)
  }, [selected?.name])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [skills, query, filter])

  // 按来源仓库分组：git 技能按 url 归组，本地/AI 技能归入杂项组
  const sections = useMemo<GroupedSection[]>(() => {
    const byUrl = new Map<string, GroupedSection>()
    for (const s of filtered) {
      const url = s.source?.kind === 'git' && s.source.url ? s.source.url : undefined
      const key = url ?? '__local__'
      let sec = byUrl.get(key)
      if (!sec) {
        const g = url ? groups.find((x) => x.url === url) : undefined
        sec = {
          key,
          name: g?.name ?? (url ? shortUrl(url) : '本地 / AI 技能'),
          description: g?.description ?? '',
          group: g,
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
  }, [filtered, groups])

  const toggleCollapse = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** 技能描述显示文本：中文优先（可全局切回原文） */
  const descOf = (s: SkillInfo): string =>
    zhDesc && s.descriptionZh ? s.descriptionZh : s.description || '（无描述）'

  const switchView = (v: 'list' | 'grid'): void => {
    setView(v)
    localStorage.setItem('trove-view', v)
  }

  const switchZh = (): void => {
    setZhDesc((prev) => {
      localStorage.setItem('trove-desc-zh', prev ? '0' : '1')
      return !prev
    })
  }

  const toggleChecked = (name: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  /** 全选 / 取消全选（作用于当前过滤+搜索结果） */
  const toggleSelectAll = (): void => {
    const visible = filtered.map((s) => s.name)
    const allChecked = visible.length > 0 && visible.every((n) => checked.has(n))
    setChecked(allChecked ? new Set() : new Set(visible))
  }

  /** 批量卸载勾选的技能 */
  const batchRemove = async (): Promise<void> => {
    const names = [...checked]
    if (names.length === 0) return
    if (!window.confirm(`确定批量卸载 ${names.length} 个技能？将从主库删除对应目录。`)) return
    setBusy('batch')
    try {
      const res = await window.trove.batchUninstall(names)
      const failed = res.filter((r) => !r.ok)
      if (failed.length === 0) push(`已批量卸载 ${res.length} 个技能`)
      else push(`${failed.length} 个卸载失败：${failed.map((f) => f.message).join('；')}`, 'err')
      setChecked(new Set())
      if (selected && names.includes(selected.name)) setSelected(null)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  /** 执行批量更新并弹出结果明细（全部更新 / 分组更新共用） */
  const runUpdate = async (title: string, busyKey: string, gitSkills: SkillInfo[]): Promise<void> => {
    setBusy(busyKey)
    try {
      const res = await window.trove.updateSkills(gitSkills)
      setUpdateResult({ title, results: res })
      const updated = res.filter((r) => r.ok && r.message === '已更新').length
      const upToDate = res.filter((r) => r.ok && r.message.includes('已是最新')).length
      const failed = res.filter((r) => !r.ok).length
      if (failed === 0) push(`更新完成：${updated} 个更新，${upToDate} 个最新`)
      else push(`更新完成：${updated} 个更新，${upToDate} 个最新，${failed} 个失败（详见明细）`, 'err')
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  /** 一键更新整个分组（同仓库所有 git 技能，仓库只克隆一次） */
  const updateGroupAll = async (sec: GroupedSection): Promise<void> => {
    const gitSkills = sec.skills.filter((s) => s.source?.kind === 'git')
    if (gitSkills.length === 0) return
    await runUpdate(`「${sec.name}」`, 'upd-' + sec.key, gitSkills)
  }

  /** 一键全部更新：更新主库所有 Git 来源技能（主进程按仓库分组、每仓库只克隆一次） */
  const updateAll = async (): Promise<void> => {
    const gitSkills = skills.filter((s) => s.source?.kind === 'git')
    if (gitSkills.length === 0) {
      push('没有可更新的 Git 来源技能', 'err')
      return
    }
    await runUpdate('全部更新', 'upd-all', gitSkills)
  }

  /** 批量生成中文描述（LLM）：勾选的技能逐个生成，跳过已有中文描述 */
  const batchZh = async (): Promise<void> => {
    const names = [...checked]
    if (names.length === 0) return
    if (!settings?.activeLlmProfileId) {
      push('未配置 LLM：请先在「设置」中添加并启用一个 LLM 配置', 'err')
      return
    }
    const targets = skills.filter((s) => names.includes(s.name))
    setBusy('batchzh')
    try {
      const res = await window.trove.batchSummarizeZh(targets)
      const ok = res.filter((r) => r.ok)
      const skipped = ok.filter((r) => r.message.includes('跳过')).length
      const failed = res.filter((r) => !r.ok)
      const gen = ok.length - skipped
      push(
        `已生成中文描述 ${gen} 个${skipped > 0 ? `，跳过已有 ${skipped} 个` : ''}` +
          (failed.length > 0 ? `；${failed.length} 个失败：${failed.map((f) => f.name).join('、')}` : '')
      )
      setChecked(new Set())
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  /** 更新单个技能（行内/详情按钮） */
  const updateOne = async (s: SkillInfo): Promise<void> => {
    setBusy('upd-' + s.name)
    try {
      const res = await window.trove.updateSkills([s])
      if (res.length === 0 || !res[0].ok) throw new Error(res[0]?.message ?? '更新失败')
      push(res[0].message === '已是最新，无需更新' ? `「${s.title}」已是最新` : `已更新「${s.title}」`)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  /** 删除整个仓库分组（同时卸载组内全部技能） */
  const removeGroupAll = async (g: RepoGroup, count: number): Promise<void> => {
    if (!window.confirm(`删除分组「${g.name}」？\n将同时卸载该组下 ${count} 个已安装技能（不可撤销，需重新安装才能恢复）。`)) return
    setBusy('group-' + g.url)
    try {
      const removed = await window.trove.removeGroup(g.url)
      push(`分组已删除，卸载 ${removed.length} 个技能`)
      if (selected && removed.includes(selected.name)) setSelected(null)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const openNote = (g: RepoGroup): void => {
    setNoteFor(g)
    setNoteText(g.note ?? '')
  }

  const saveNote = async (): Promise<void> => {
    if (!noteFor) return
    setBusy('note')
    try {
      await window.trove.setGroupNote(noteFor.url, noteText.trim())
      push('备注已保存')
      setNoteFor(null)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  /** 翻译技能正文为中文（LLM + 本地缓存） */
  const doTranslate = async (s: SkillInfo): Promise<void> => {
    if (!settings?.activeLlmProfileId) {
      push('未配置 LLM：请先在「设置」中添加并启用一个 LLM 配置', 'err')
      return
    }
    setTranslateBusy(true)
    try {
      const zh = await window.trove.translateSkillZh(s)
      setReadmeZh(zh)
      setShowZh(true)
      push(`「${s.title}」已翻译为中文`)
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setTranslateBusy(false)
    }
  }

  /** 为单个技能生成中文描述（LLM，存索引不写文件） */
  const genSkillZh = async (s: SkillInfo): Promise<void> => {
    if (!settings?.activeLlmProfileId) {
      push('未配置 LLM：请先在「设置」中添加并启用一个 LLM 配置', 'err')
      return
    }
    setBusy('zh-' + s.name)
    try {
      const res = await window.trove.summarizeSkill(s)
      const zh = res.summary.description.trim()
      if (!zh) throw new Error('模型返回为空，请重试')
      await window.trove.setSkillZh(s.name, zh)
      // 生成成功后自动切换到中文显示，保证立即可见
      setZhDesc(true)
      localStorage.setItem('trove-desc-zh', '1')
      push(`已生成「${s.title}」的中文描述`)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const act = async (name: string, fn: () => Promise<unknown>, okMsg: string): Promise<void> => {
    setBusy(name)
    try {
      await fn()
      push(okMsg)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  // 卸载：卡片与详情面板共用；成功后清理选中状态
  const doUninstall = async (s: SkillInfo): Promise<void> => {
    setBusy(s.name)
    try {
      await window.trove.uninstallSkill(s.name)
      push('已卸载')
      if (selected?.name === s.name) setSelected(null)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const importLocal = async (): Promise<void> => {
    const dir = await window.trove.chooseLocalSkillDir()
    if (!dir) return
    setBusy('import')
    try {
      const info = await window.trove.importLocalSkill(dir)
      push(`已导入技能 ${info.name}`)
      onChanged()
      setSelected(info)
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const doSummary = async (): Promise<void> => {
    if (!selected) return
    setSummaryBusy(true)
    setSummary(null)
    try {
      const res = await window.trove.summarizeSkill(selected)
      setSummary(res.summary)
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setSummaryBusy(false)
    }
  }

  const applySummary = async (): Promise<void> => {
    if (!selected || !summary) return
    setBusy('summary')
    try {
      await window.trove.applySummary(selected, summary.description, summary.tags)
      push('摘要已写入 SKILL.md')
      setSummary(null)
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const counts = useMemo(() => {
    return {
      all: skills.length,
      installed: skills.filter((s) => s.status === 'installed').length,
      disabled: skills.filter((s) => s.status === 'disabled').length,
      broken: skills.filter((s) => s.status === 'broken').length
    }
  }, [skills])

  return (
    <div className="library-layout">
      <div className="library-main">
        <div className="page-head">
        <h2>技能库</h2>
        <div className="actions">
          <button
            className="btn"
            onClick={() => void updateAll()}
            disabled={busy === 'upd-all' || !skills.some((s) => s.source?.kind === 'git')}
            title="一键更新主库全部 Git 来源技能"
          >
            {busy === 'upd-all' ? <Spinner /> : null} 🔄 全部更新
          </button>
          <button className="btn" onClick={() => setShowDraft(true)} disabled={!settings?.activeLlmProfileId}>
            ✨ AI 创建
          </button>
          <button className="btn" onClick={() => void importLocal()} disabled={busy === 'import'}>
            {busy === 'import' ? <Spinner /> : null} 导入本地技能
          </button>
          <button className="btn primary" onClick={() => setShowInstall(true)}>
            ⬇️ 从 Git 安装
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div className="settings-row" style={{ marginBottom: 0 }}>
          <button
            className={`btn small ${checked.size === filtered.length && filtered.length > 0 ? 'primary' : ''}`}
            onClick={toggleSelectAll}
            title="全选 / 取消全选当前过滤结果"
          >
            {checked.size === filtered.length && filtered.length > 0 ? '☐ 取消全选' : '☑ 全选'}
          </button>
          <input
            className="input"
            placeholder="🔍 搜索技能名称 / 描述 / 标签…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {(['all', 'installed', 'disabled', 'broken'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`btn small ${filter === f ? 'primary' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '全部' : f === 'installed' ? '已启用' : f === 'disabled' ? '已停用' : '异常'}
              <span className="muted" style={{ color: filter === f ? '#cfe0ff' : undefined }}>
                {counts[f]}
              </span>
            </button>
          ))}
          <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
            <button className={`btn small ${view === 'list' ? 'primary' : ''}`} onClick={() => switchView('list')} title="列表视图">
              ☰ 列表
            </button>
            <button className={`btn small ${view === 'grid' ? 'primary' : ''}`} onClick={() => switchView('grid')} title="卡片视图">
              ▦ 卡片
            </button>
            <button className="btn small" onClick={switchZh} title="技能描述：中文 / 原文切换">
              {zhDesc ? '🌏 中文' : '🌐 原文'}
            </button>
          </div>
        </div>
        {checked.size > 0 && (
          <div className="batch-bar">
            <span>已勾选 <b>{checked.size}</b> 个技能</span>
            <button
              className="btn small"
              disabled={busy === 'batchzh' || !settings?.activeLlmProfileId}
              title={settings?.activeLlmProfileId ? '为勾选技能批量生成中文描述（跳过已有）' : '需先在设置中配置并启用 LLM'}
              onClick={() => void batchZh()}
            >
              {busy === 'batchzh' ? <Spinner /> : null} 🌏 批量中文描述
            </button>
            <button
              className="btn small danger"
              disabled={busy === 'batch'}
              onClick={() => void batchRemove()}
            >
              {busy === 'batch' ? <Spinner /> : null} 删除所选
            </button>
            <button className="btn small" onClick={() => setChecked(new Set())}>
              取消选择
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          {skills.length === 0 ? (
            <>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🗃️</div>
              主库还是空的。
              <br />
              点击右上角「⬇️ 从 Git 安装」从仓库安装技能，或「导入本地技能」。
            </>
          ) : (
            '没有匹配的技能'
          )}
        </div>
      ) : (
        <div className="skill-groups">
          {sections.map((sec) => (
            <div key={sec.key} className="card group-card">
              <div
                className="group-head"
                onClick={() => toggleCollapse(sec.key)}
                title={sec.key === '__local__' ? '本地导入 / AI 生成的技能' : '点击折叠/展开'}
              >
                <span className={`caret ${collapsed.has(sec.key) ? 'collapsed' : ''}`}>▾</span>
                <span className="group-name">{sec.key === '__local__' ? '🧺' : '📦'} {sec.name}</span>
                <span className="badge-count">{sec.skills.length}</span>
                {sec.key !== '__local__' && sec.group?.note && (
                  <span className="group-note-inline" title="备注">💬 {sec.group.note}</span>
                )}
                <div className="group-actions" onClick={(e) => e.stopPropagation()}>
                  {sec.key !== '__local__' && sec.group && (
                    <>
                      <button
                        className="btn small"
                        title="一键更新该仓库下全部技能（重新拉取最新）"
                        disabled={busy === 'upd-' + sec.key}
                        onClick={() => void updateGroupAll(sec)}
                      >
                        {busy === 'upd-' + sec.key ? <Spinner /> : null} 🔄 更新
                      </button>
                      <button className="btn small" title="编辑备注" onClick={() => openNote(sec.group!)}>
                        ✎ 备注
                      </button>
                      <button
                        className="btn small danger"
                        title="删除整个分组（连同组内技能）"
                        disabled={busy === 'group-' + sec.key}
                        onClick={() => void removeGroupAll(sec.group!, sec.skills.length)}
                      >
                        {busy === 'group-' + sec.key ? <Spinner /> : null} 🗑 删除分组
                      </button>
                    </>
                  )}
                </div>
              </div>
              {!collapsed.has(sec.key) && (
                <div className="group-body">
                  <div className="group-desc">{sec.description ? sec.description.replace(/<[^>]+>/g, '').trim() || '（无描述）' : '（无描述）'}</div>
                  {view === 'grid' ? (
                    <div className="skill-grid">
                      {sec.skills.map((s) => (
                        <div
                          key={s.name}
                          className={`skill-card ${selected?.name === s.name ? 'selected' : ''}`}
                          onClick={() => {
                            if (selected?.name === s.name) {
                              setSelected(null)
                              return
                            }
                            setSelected(s)
                            setSummary(null)
                          }}
                        >
                          {s.source?.kind === 'git' && (
                            <button
                              className="card-del"
                              style={{ right: 32 }}
                              title={`更新技能 ${s.name}`}
                              disabled={busy === 'upd-' + s.name}
                              onClick={(e) => {
                                e.stopPropagation()
                                void updateOne(s)
                              }}
                            >
                              {busy === 'upd-' + s.name ? <Spinner /> : '🔄'}
                            </button>
                          )}
                          <button
                            className="card-del"
                            title={`卸载技能 ${s.name}`}
                            disabled={busy === s.name}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (window.confirm(`确定卸载技能「${s.name}」？将从主库删除该目录。`)) {
                                void doUninstall(s)
                              }
                            }}
                          >
                            {busy === s.name ? <Spinner /> : '✕'}
                          </button>
                          <div className="row">
                            <label className="card-check" title="勾选以批量删除" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={checked.has(s.name)}
                                onChange={() => toggleChecked(s.name)}
                              />
                            </label>
                            <span className={`status-dot ${s.status}`} title={s.status} />
                            <span className="title">{s.title}</span>
                            <span className="src-badge">{s.source?.kind === 'git' ? 'git' : s.source?.kind === 'ai' ? 'AI' : '本地'}</span>
                          </div>
                          <div className="desc">{descOf(s)}</div>
                          <div className="row">
                            {s.tags.slice(0, 3).map((t) => (
                              <span key={t} className="tag">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="skill-list">
                      {sec.skills.map((s) => (
                        <div
                          key={s.name}
                          className={`skill-row ${selected?.name === s.name ? 'selected' : ''}`}
                          onClick={() => {
                            if (selected?.name === s.name) {
                              setSelected(null)
                              return
                            }
                            setSelected(s)
                            setSummary(null)
                          }}
                        >
                          <label className="row-check" title="勾选以批量删除" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked.has(s.name)}
                              onChange={() => toggleChecked(s.name)}
                            />
                          </label>
                          <span className={`status-dot ${s.status}`} title={s.status} />
                          <span className="row-title">
                            <span className="title">{s.title}</span>
                            {s.name !== s.title && <span className="muted mono">{s.name}</span>}
                          </span>
                          <span className="row-desc" title={s.descriptionZh ? `${s.descriptionZh}｜原文：${s.description}` : s.description}>
                            {descOf(s)}
                          </span>
                          <span className="src-badge">
                            {s.source?.kind === 'git' ? 'git' : s.source?.kind === 'ai' ? 'AI' : '本地'}
                          </span>
                          {s.source?.kind === 'git' && (
                            <button
                              className="row-del"
                              title={`更新技能 ${s.name}`}
                              disabled={busy === 'upd-' + s.name}
                              onClick={(e) => {
                                e.stopPropagation()
                                void updateOne(s)
                              }}
                            >
                              {busy === 'upd-' + s.name ? <Spinner /> : '🔄'}
                            </button>
                          )}
                          <button
                            className="row-del"
                            title={`卸载技能 ${s.name}`}
                            disabled={busy === s.name}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (window.confirm(`确定卸载技能「${s.name}」？将从主库删除该目录。`)) {
                                void doUninstall(s)
                              }
                            }}
                          >
                            {busy === s.name ? <Spinner /> : '✕'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </div>

      {selected && (
        <aside className="detail-side card detail-panel">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`status-dot ${selected.status}`} />
              <h3 style={{ fontSize: 17 }}>{selected.title}</h3>
              {selected.name !== selected.title && <span className="muted mono">{selected.name}</span>}
            </div>
            <button className="side-close" title="关闭详情" onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {selected.status === 'installed' ? (
                <button
                  className="btn small"
                  disabled={busy === selected.name}
                  onClick={() =>
                    void act(
                      selected.name,
                      () => window.trove.setSkillStatus(selected.name, 'disabled'),
                      '已停用'
                    )
                  }
                >
                  停用
                </button>
              ) : (
                <button
                  className="btn small"
                  disabled={busy === selected.name}
                  onClick={() =>
                    void act(
                      selected.name,
                      () => window.trove.setSkillStatus(selected.name, 'installed'),
                      '已启用'
                    )
                  }
                >
                  启用
                </button>
              )}
              {selected.source?.kind === 'git' && (
                <button
                  className="btn small"
                  disabled={busy === 'upd-' + selected.name}
                  onClick={() => void updateOne(selected)}
                >
                  {busy === 'upd-' + selected.name ? <Spinner /> : null} 更新
                </button>
              )}
              <button
                className="btn small"
                disabled={summaryBusy || !settings?.activeLlmProfileId}
                onClick={() => void doSummary()}
              >
                {summaryBusy ? <Spinner /> : null} 🤖 AI 摘要
              </button>
              <button
                className="btn small"
                disabled={summaryBusy || busy === 'zh-' + selected.name || !!selected.descriptionZh}
                title={
                  selected.descriptionZh
                    ? '中文描述已生成'
                    : !settings?.activeLlmProfileId
                      ? '需先在设置中配置 LLM'
                      : '用 LLM 生成该技能的中文描述（存索引，不改 SKILL.md）'
                }
                onClick={() => void genSkillZh(selected)}
              >
                {busy === 'zh-' + selected.name ? <Spinner /> : null} 🌏 中文描述
              </button>
              <button
                className="btn small danger"
                disabled={busy === selected.name}
                onClick={() => {
                  if (window.confirm(`确定卸载技能「${selected.name}」？将从主库删除该目录。`)) {
                    void doUninstall(selected)
                  }
                }}
              >
                卸载
              </button>
          </div>

          {summary && (
            <div className="ok-box">
              <b>🤖 摘要建议</b>
              <div style={{ margin: '6px 0' }}>{summary.description || '（空）'}</div>
              <div>
                {summary.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                <button className="btn small primary" onClick={() => void applySummary()} disabled={busy === 'summary'}>
                  写入 SKILL.md
                </button>
                <button className="btn small" style={{ marginLeft: 6 }} onClick={() => setSummary(null)}>
                  放弃
                </button>
              </div>
            </div>
          )}

          <div className="meta">
            <div>
              <b>状态：</b>
              {selected.status === 'installed' ? '已启用' : selected.status === 'disabled' ? '已停用' : '异常'}
            </div>
            <div>
              <b>来源：</b>
              {selected.source?.kind === 'git'
                ? shortUrl(selected.source.url)
                : selected.source?.kind === 'ai'
                  ? 'AI 生成'
                  : '本地导入'}
            </div>
            {selected.descriptionZh && (
              <div>
                <b>中文描述：</b>
                {selected.descriptionZh}
              </div>
            )}
            {selected.source?.commit && <div><b>Commit：</b><span className="mono">{selected.source.commit}</span></div>}
            {selected.source?.lastUpdated && (
              <div><b>最近更新：</b>{formatTime(selected.source.lastUpdated)}</div>
            )}
            <div><b>路径：</b><span className="mono">{selected.path}</span></div>
            {selected.files.length > 0 && (
              <div><b>文件：</b>{selected.files.join('、')}</div>
            )}
          </div>

          {selected.readme ? (
            <div className="detail-readme-box">
              <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                <button
                  className="btn small"
                  disabled={!readmeZh}
                  title="原文 / 中文切换"
                  onClick={() => setShowZh((v) => !v)}
                >
                  {showZh ? '🌐 原文' : '🌏 中文'}
                </button>
                {!readmeZh && settings?.activeLlmProfileId && (
                  <button
                    className="btn small"
                    disabled={translateBusy}
                    onClick={() => void doTranslate(selected)}
                  >
                    {translateBusy ? <Spinner /> : null} 🌏 翻译成中文
                  </button>
                )}
                {readmeZh && settings?.activeLlmProfileId && (
                  <button
                    className="btn small"
                    disabled={translateBusy}
                    title="重新翻译（覆盖缓存）"
                    onClick={() => void doTranslate(selected)}
                  >
                    {translateBusy ? <Spinner /> : null} 🔄 重新翻译
                  </button>
                )}
                {showZh && readmeZh && <span className="muted" style={{ fontSize: 12 }}>（中文·缓存）</span>}
              </div>
              <div
                className="markdown"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(showZh && readmeZh ? readmeZh : selected.readme)
                }}
              />
            </div>
          ) : (
            <div className="muted">（SKILL.md 正文为空）</div>
          )}
        </aside>
      )}

      {showInstall && <InstallWizard llmReady={!!settings?.activeLlmProfileId} onDone={() => { setShowInstall(false); onChanged() }} />}
      {showDraft && <AiDraftWizard onDone={() => { setShowDraft(false); onChanged() }} />}

      {noteFor && (
        <Modal
          title={`备注 · ${noteFor.name}`}
          onClose={() => setNoteFor(null)}
          width={460}
          footer={
            <>
              <button className="btn" onClick={() => setNoteFor(null)}>
                取消
              </button>
              <button className="btn primary" disabled={busy === 'note'} onClick={() => void saveNote()}>
                {busy === 'note' ? <Spinner /> : null} 保存
              </button>
            </>
          }
        >
          <div className="settings-hint">备注只保存在本应用的分组索引中，不会写入仓库文件。</div>
          <input
            className="input"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="例如：工程流程技能，含 TDD / 代码评审 / 缺陷诊断"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveNote()
            }}
            autoFocus
          />
        </Modal>
      )}

      {updateResult && (
        <UpdateResultModal
          title={updateResult.title}
          results={updateResult.results}
          onClose={() => setUpdateResult(null)}
        />
      )}
    </div>
  )
}