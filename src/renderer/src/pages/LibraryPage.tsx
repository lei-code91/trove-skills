import React, { useMemo, useState } from 'react'
import type { AppSettings, SkillInfo } from '@shared/types'
import { useToast } from '../toast'
import { renderMarkdown } from '../markdown'
import { shortUrl, formatTime } from '../utils'
import { InstallWizard } from '../components/InstallWizard'
import { AiDraftWizard } from '../components/AiDraftWizard'
import { Spinner } from '../components/Modal'

type Filter = 'all' | 'installed' | 'disabled' | 'broken'

interface Props {
  skills: SkillInfo[]
  settings: AppSettings | null
  onChanged: () => void
}

export function LibraryPage({ skills, settings, onChanged }: Props): React.JSX.Element {
  const { push } = useToast()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<SkillInfo | null>(null)
  const [showInstall, setShowInstall] = useState(false)
  const [showDraft, setShowDraft] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ description: string; tags: string[] } | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)

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
    <div>
      <div className="page-head">
        <h2>技能库</h2>
        <div className="actions">
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
        </div>
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
        <div className="skill-grid">
          {filtered.map((s) => (
            <div
              key={s.name}
              className={`skill-card ${selected?.name === s.name ? 'selected' : ''}`}
              onClick={() => {
                setSelected(s)
                setSummary(null)
              }}
            >
              <div className="row">
                <span className={`status-dot ${s.status}`} title={s.status} />
                <span className="title">{s.title}</span>
                <span className="src-badge">{s.source?.kind === 'git' ? 'git' : s.source?.kind === 'ai' ? 'AI' : '本地'}</span>
              </div>
              <div className="desc">{s.description || '（无描述）'}</div>
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
      )}

      {selected && (
        <div className="card detail-panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`status-dot ${selected.status}`} />
              <h3 style={{ fontSize: 17 }}>{selected.title}</h3>
              <span className="muted mono">{selected.name}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
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
                  disabled={busy === selected.name}
                  onClick={() =>
                    void act(selected.name, () => window.trove.updateSkill(selected), '更新完成')
                  }
                >
                  {busy === selected.name ? <Spinner /> : null} 更新
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
                className="btn small danger"
                disabled={busy === selected.name}
                onClick={() => {
                  if (window.confirm(`确定卸载技能「${selected.name}」？将从主库删除该目录。`)) {
                    void act(selected.name, () => window.trove.uninstallSkill(selected.name), '已卸载')
                  }
                }}
              >
                卸载
              </button>
            </div>
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
            <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.readme) }} />
          ) : (
            <div className="muted">（SKILL.md 正文为空）</div>
          )}
        </div>
      )}

      {showInstall && <InstallWizard onDone={() => { setShowInstall(false); onChanged() }} />}
      {showDraft && <AiDraftWizard onDone={() => { setShowDraft(false); onChanged() }} />}
    </div>
  )
}