import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, LlmProfile } from '@shared/types'
import { useToast } from '../toast'
import { Spinner } from '../components/Modal'

interface Props {
  settings: AppSettings | null
  onChanged: () => void
}

function blankProfile(): LlmProfile {
  return {
    id: '',
    name: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    createdAt: ''
  }
}

export function SettingsPage({ settings, onChanged }: Props): React.JSX.Element {
  const { push } = useToast()
  const [saved, setSaved] = useState<AppSettings | null>(settings)
  const [draft, setDraft] = useState<AppSettings | null>(settings)
  const [busy, setBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [appVer, setAppVer] = useState('')

  useEffect(() => {
    void window.trove
      .getAppVersion()
      .then((v) => setAppVer(`${v.version} · 构建于 ${v.buildAt}`))
      .catch(() => setAppVer('未知'))
  }, [])

  // 编辑中的 profile（新增或编辑）
  const [editing, setEditing] = useState<LlmProfile | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [models, setModels] = useState<string[] | null>(null)

  const activeProfile = useMemo(() => {
    if (!draft || !draft.activeLlmProfileId) return null
    return draft.llmProfiles.find((p) => p.id === draft.activeLlmProfileId) ?? null
  }, [draft])

  const setSkillsDir = useCallback(async () => {
    const dir = await window.trove.chooseSkillsDir()
    if (!dir || !draft) return
    const next = { ...draft, skillsDir: dir }
    setDraft(next)
    setSaved(next)
    await window.trove.updateSettings(next)
    push(`主库目录已改为 ${dir}`)
    onChanged()
  }, [draft, push, onChanged])

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy('save')
    try {
      await window.trove.updateSettings(draft)
      setSaved(draft)
      push('设置已保存')
      onChanged()
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const checkGit = async (): Promise<void> => {
    setBusy('git')
    try {
      const v = await window.trove.gitVersion()
      push(`Git 可用：${v}`)
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const startAdd = (): void => {
    setEditing({ ...blankProfile(), id: `p-${Date.now()}` })
    setIsNew(true)
    setTestResult(null)
    setModels(null)
  }

  const startEdit = (p: LlmProfile): void => {
    setEditing({ ...p })
    setIsNew(false)
    setTestResult(null)
    setModels(null)
  }

  const saveProfile = async (): Promise<void> => {
    if (!draft || !editing) return
    if (!editing.name.trim() || !editing.baseUrl.trim()) {
      push('请填写配置名称与 Base URL', 'err')
      return
    }
    let profiles = draft.llmProfiles.filter((p) => p.id !== editing.id)
    profiles = [...profiles, { ...editing, createdAt: editing.createdAt || new Date().toISOString() }]
    const next: AppSettings = {
      ...draft,
      llmProfiles: profiles,
      activeLlmProfileId: draft.activeLlmProfileId ?? editing.id
    }
    setDraft(next)
    setSaved(next)
    await window.trove.updateSettings(next)
    setEditing(null)
    push(isNew ? 'LLM 配置已保存' : '配置已更新')
    onChanged()
  }

  const removeProfile = async (p: LlmProfile): Promise<void> => {
    if (!draft) return
    if (!window.confirm(`删除 LLM 配置「${p.name}」？`)) return
    const profiles = draft.llmProfiles.filter((x) => x.id !== p.id)
    const next: AppSettings = {
      ...draft,
      llmProfiles: profiles,
      activeLlmProfileId: draft.activeLlmProfileId === p.id ? (profiles[0]?.id ?? null) : draft.activeLlmProfileId
    }
    setDraft(next)
    setSaved(next)
    await window.trove.updateSettings(next)
    push('配置已删除')
    onChanged()
  }

  const activate = async (p: LlmProfile): Promise<void> => {
    if (!draft) return
    const next = { ...draft, activeLlmProfileId: p.id }
    setDraft(next)
    setSaved(next)
    await window.trove.updateSettings(next)
    push(`已切换至 ${p.name}`)
    onChanged()
  }

  const testEditing = async (): Promise<void> => {
    if (!editing) return
    setBusy('test')
    setTestResult(null)
    try {
      const r = await window.trove.testLlm(editing)
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const loadModels = async (): Promise<void> => {
    if (!editing) return
    setBusy('models')
    setModels(null)
    try {
      const list = await window.trove.listModels(editing)
      setModels(list)
      if (list.length > 0 && !editing.model) {
        setEditing({ ...editing, model: list[0] })
      }
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  if (!draft) {
    return <div className="empty">加载中…</div>
  }

  return (
    <div>
      <div className="page-head">
        <h2>设置</h2>
        <div className="actions">
          <button className="btn primary" onClick={() => void save()} disabled={busy === 'save'}>
            {busy === 'save' ? <Spinner /> : null} 保存设置
          </button>
        </div>
      </div>

      {/* 主库目录 */}
      <div className="card settings-section">
        <h3>📦 技能主库目录</h3>
        <div className="settings-row">
          <input className="input mono" value={draft.skillsDir} readOnly />
          <button className="btn" onClick={() => void setSkillsDir()}>
            选择目录…
          </button>
        </div>
        <div className="settings-hint">
          所有 Git 安装 / 本地导入 / AI 创建的技能都会放在这里（唯一权威来源）。
          项目里的技能通过链接指向此目录，主库更新后项目自动同步；更换目录会改变技能存放位置。
        </div>
      </div>

      {/* Git */}
      <div className="card settings-section">
        <h3>🔧 Git</h3>
        <div className="settings-row">
          <input
            className="input mono"
            placeholder="留空则使用系统 PATH 中的 git"
            value={draft.gitPath}
            onChange={(e) => setDraft({ ...draft, gitPath: e.target.value })}
          />
          <button className="btn" onClick={() => void checkGit()} disabled={busy === 'git'}>
            {busy === 'git' ? <Spinner /> : null} 检测
          </button>
        </div>
        <div className="settings-hint">安装技能需要本机可用 git。若检测失败请安装 Git for Windows 或在上面填写 git.exe 路径。</div>
      </div>

      {/* LLM */}
      <div className="card settings-section">
        <h3>🤖 LLM 配置</h3>
        <div className="settings-hint">
          可保存多个 API 配置（OpenAI 兼容端点）并随时切换。当前激活的配置用于 AI 摘要与 AI 创建技能。
        </div>

        {draft.llmProfiles.length === 0 && (
          <div className="warn-box">还没有 LLM 配置。点击「＋ 新增配置」添加（例如 OpenAI / DeepSeek / 其它兼容端点）。</div>
        )}

        {draft.llmProfiles.map((p) => (
          <div key={p.id} className={`profile-item ${activeProfile?.id === p.id ? 'active' : ''}`}>
            <div className="info">
              <div className="name">
                {activeProfile?.id === p.id && <span style={{ color: 'var(--accent)', marginRight: 6 }}>●</span>}
                {p.name}
              </div>
              <div className="sub mono">
                {p.baseUrl} · {p.model || '未选模型'}
              </div>
            </div>
            {activeProfile?.id !== p.id && (
              <button className="btn small primary" onClick={() => void activate(p)}>
                切换
              </button>
            )}
            <button className="btn small" onClick={() => startEdit(p)}>
              编辑
            </button>
            <button className="btn small danger" onClick={() => void removeProfile(p)}>
              删除
            </button>
          </div>
        ))}

        <button className="btn" onClick={startAdd}>
          ＋ 新增配置
        </button>
      </div>

      {/* 新增/编辑 LLM 弹窗 */}
      {editing && (
        <div
          className="modal-mask"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditing(null)
          }}
        >
          <div className="modal">
            <div className="modal-head">
              <h3>{isNew ? '新增 LLM 配置' : '编辑 LLM 配置'}</h3>
              <button className="close" onClick={() => setEditing(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>配置名称（自定义，如「Proma Cloud」「DeepSeek」）</label>
                <input
                  className="input"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如：DeepSeek 主用"
                />
              </div>
              <div className="field">
                <label>Base URL（OpenAI 兼容，自动补全 /v1）</label>
                <input
                  className="input mono"
                  value={editing.baseUrl}
                  onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com 或 https://api.openai.com/v1"
                />
              </div>
              <div className="field">
                <label>API Key（仅保存在本机配置文件中）</label>
                <input
                  className="input mono"
                  type="password"
                  value={editing.apiKey}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  placeholder="sk-…"
                />
              </div>
              <div className="field">
                <label>模型（可点「加载模型列表」自动获取）</label>
                <div className="settings-row" style={{ marginBottom: 0 }}>
                  <input
                    className="input mono"
                    value={editing.model}
                    onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                    placeholder="如 deepseek-chat / gpt-4o-mini"
                  />
                  <button className="btn small" onClick={() => void loadModels()} disabled={busy === 'models'}>
                    {busy === 'models' ? <Spinner /> : null} 加载模型
                  </button>
                </div>
                {models && (
                  <div className="check-list" style={{ marginTop: 8, maxHeight: 120 }}>
                    {models.slice(0, 30).map((m) => (
                      <label key={m} className="check-item" style={{ fontSize: 12 }}>
                        <input
                          type="radio"
                          name="model"
                          checked={editing.model === m}
                          onChange={() => setEditing({ ...editing, model: m })}
                        />
                        <span className="mono">{m}</span>
                      </label>
                    ))}
                    {models.length > 30 && <div className="muted">（共 {models.length} 个，仅显示前 30 个，可手动输入）</div>}
                  </div>
                )}
              </div>
              <div className="settings-row">
                <button className="btn" onClick={() => void testEditing()} disabled={busy === 'test'}>
                  {busy === 'test' ? <Spinner /> : null} 测试连接
                </button>
                {testResult && (
                  <span className={testResult.ok ? 'ok-box' : 'err-box'} style={{ flex: 1, margin: 0 }}>
                    {testResult.message}
                  </span>
                )}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="btn primary" onClick={() => void saveProfile()} disabled={busy === 'save'}>
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="muted" style={{ marginTop: 28, textAlign: 'center', fontSize: 12 }}>
        Trove Skills v{appVer || '…'}
      </div>
    </div>
  )
}