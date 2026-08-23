import React, { useCallback, useEffect, useState } from 'react'
import type { InstallPreview } from '@shared/types'
import { Modal, Spinner } from './Modal'
import { useToast } from '../toast'
import { normalizeRepoUrl } from '../utils'

type Step = 'input' | 'preview' | 'result'

interface InstallResult {
  name: string
  ok: boolean
  message: string
}

interface Props {
  onDone: () => void
  /** 是否已配置 LLM（决定「生成中文描述」选项可用性） */
  llmReady?: boolean
}

export function InstallWizard({ onDone, llmReady = false }: Props): React.JSX.Element {
  const { push } = useToast()
  const [step, setStep] = useState<Step>('input')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<InstallPreview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<string[]>([])
  const [results, setResults] = useState<InstallResult[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  // 是否为仓库生成中文描述（需 LLM）
  const [generateZh, setGenerateZh] = useState(false)

  const close = (): void => {
    setStep('input')
    setUrl('')
    setPreview(null)
    setProgress([])
    setResults([])
    setError('')
    setGenerateZh(false)
    onDone()
  }

  // 监听 clone 进度
  useEffect(() => {
    if (step !== 'preview') return
    const off = window.trove.onInstallProgress((line) => {
      if (!line || /Cloning into|done\./.test(line)) return
      setProgress((prev) => [...prev.slice(-60), line])
    })
    return off
  }, [step])

  const startPreview = useCallback(async () => {
    setError('')
    setBusy(true)
    setProgress([])
    try {
      const repoUrl = normalizeRepoUrl(url)
      const p = await window.trove.previewInstall(repoUrl)
      setPreview(p)
      const all = new Set(p.skills.map((s) => s.repoPath))
      setSelected(all)
      setSelectedName(p.skills[0]?.name ?? null)
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [url])

  const confirmInstall = useCallback(async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const selections = preview.skills
        .filter((s) => selected.has(s.repoPath))
        .map((s) => ({ repoPath: s.repoPath, name: s.name }))
      if (selections.length === 0) {
        setError('请至少选择一个技能')
        return
      }
      const res = await window.trove.confirmInstall(preview, selections, { generateZh })
      setResults(res)
      setStep('result')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [preview, selected, generateZh])

  const finish = (): void => {
    const failed = results.filter((r) => !r.ok)
    if (failed.length === 0) push('技能安装完成')
    else push(`${failed.length} 个技能安装失败，详见列表`, 'err')
    close()
  }

  const toggle = (repoPath: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(repoPath)) next.delete(repoPath)
      else next.add(repoPath)
      return next
    })
  }

  return (
    <Modal
      title="从 Git 仓库安装技能"
      onClose={close}
      width={680}
      footer={
        step === 'input' ? (
          <>
            <button className="btn" onClick={close}>
              取消
            </button>
            <button className="btn primary" onClick={() => void startPreview()} disabled={busy || !url.trim()}>
              {busy ? <Spinner /> : null} 检查并预览
            </button>
          </>
        ) : step === 'preview' ? (
          <>
            <button className="btn" onClick={() => setStep('input')} disabled={busy}>
              返回
            </button>
            <button className="btn primary" onClick={() => void confirmInstall()} disabled={busy || selected.size === 0}>
              {busy ? <Spinner /> : null} 安装所选（{selected.size}）技能
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={close}>
              关闭
            </button>
            <button className="btn primary" onClick={finish}>
              完成
            </button>
          </>
        )
      }
    >
      {step === 'input' && (
        <>
          <div className="settings-hint">
            输入 Git 仓库地址，技能将安装到你的<strong>技能主库</strong>（可在设置中修改目录）。
            安装不会直接应用到任何 Agent / 项目 —— 之后可在"项目链接"中按需链接。
          </div>
          <div className="field">
            <label>仓库地址（支持 https / github.com/owner/repo / owner/repo / git@）</label>
            <input
              className="input mono"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/anthropics/skills 或 owner/repo"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void startPreview()
              }}
            />
          </div>
          <div className="settings-hint">仓库内所有包含 SKILL.md 的技能（仓库根或子目录）都会被识别出来供你勾选。</div>
          {error && <div className="err-box">{error}</div>}
        </>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="settings-hint mono">{preview.repoUrl}</div>
          <div className="card repo-card">
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 15 }}>📦</span>
              <b>{preview.repoName}</b>
              <span className="muted">（{preview.skills.length} 个技能）</span>
            </div>
            {preview.description && <div className="repo-desc">{preview.description}</div>}
            <label className="check-item" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={generateZh}
                onChange={(e) => setGenerateZh(e.target.checked)}
                disabled={busy || !llmReady}
              />
              <span>
                🌐 <b>为每个技能生成中文描述</b>
                {llmReady ? (
                  <span className="muted">（用 LLM 生成各技能的中文摘要，不修改原文）</span>
                ) : (
                  <span className="muted">（需先在设置中配置 LLM）</span>
                )}
              </span>
            </label>
          </div>
          {progress.length > 0 && (
            <div className="progress-log">
              {progress.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
          <div className="check-list">
            {preview.skills.map((s) => (
              <label
                key={s.repoPath}
                className={`check-item ${selectedName === s.name ? '' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.repoPath)}
                  onChange={() => toggle(s.repoPath)}
                  disabled={busy}
                />
                <span>
                  <b>{s.name}</b>
                  <span className="muted"> （{s.repoPath === '.' ? '仓库根' : s.repoPath}）</span>
                </span>
              </label>
            ))}
          </div>
          {preview.skills.length === 0 && <div className="empty">未识别到技能</div>}
          {error && <div className="err-box">{error}</div>}
        </>
      )}

      {step === 'result' && (
        <>
          {results.map((r) => (
            <div key={r.name} className={r.ok ? 'ok-box' : 'err-box'}>
              <b>{r.name}</b>：{r.message}
            </div>
          ))}
          <div className="settings-hint">
            安装即进入主库。若需要某个项目使用这些技能，请到"项目链接"中把技能链接到对应项目文件夹。
          </div>
          {error && <div className="err-box">{error}</div>}
        </>
      )}
    </Modal>
  )
}