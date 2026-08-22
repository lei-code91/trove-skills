import React, { useState } from 'react'
import type { CreateSkillDraft } from '@shared/types'
import { Modal, Spinner } from './Modal'
import { useToast } from '../toast'
import { renderMarkdown } from '../markdown'

interface Props {
  onDone: () => void
}

export function AiDraftWizard({ onDone }: Props): React.JSX.Element {
  const { push } = useToast()
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<CreateSkillDraft | null>(null)
  const [stats, setStats] = useState<{ model: string; inputTokens: number; outputTokens: number } | null>(null)
  const [skillMd, setSkillMd] = useState('')
  const [saving, setSaving] = useState(false)

  const generate = async (): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      const res = await window.trove.draftSkill(idea)
      setDraft(res.draft)
      setSkillMd(res.draft.skillMd)
      setStats(res.stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    setError('')
    try {
      // 写入主库目录：<skillsDir>/<name>/SKILL.md
      const settings = await window.trove.getSettings()
      const dir = `${settings.skillsDir.replace(/[\\/]+$/, '')}/${draft.name}`
      // 走主进程创建目录与文件
      const ok = await window.trove.saveDraftSkill(draft.name, skillMd)
      if (!ok) throw new Error('保存失败')
      push(`技能 ${draft.name} 已创建到主库`)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="AI 创建技能"
      onClose={onDone}
      width={720}
      footer={
        !draft ? (
          <>
            <button className="btn" onClick={onDone}>
              取消
            </button>
            <button
              className="btn primary"
              onClick={() => void generate()}
              disabled={busy || idea.trim().length < 4}
            >
              {busy ? <Spinner /> : null} AI 生成
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setDraft(null)} disabled={saving}>
              重新生成
            </button>
            <button className="btn primary" onClick={() => void save()} disabled={saving || !skillMd.trim()}>
              {saving ? <Spinner /> : null} 保存到主库
            </button>
          </>
        )
      }
    >
      {!draft ? (
        <>
          <div className="field">
            <label>用一句话描述你想要的技能（用途、输入输出、场景）</label>
            <textarea
              className="textarea"
              rows={4}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="例如：帮我做一个文章润色器技能，输入中文文章，输出更通顺专业的版本，并保留原意"
            />
          </div>
          <div className="settings-hint">
            使用当前设置的 LLM 配置生成。生成内容包含 SKILL.md 骨架与正文，保存前可编辑。
          </div>
          {error && <div className="err-box">{error}</div>}
        </>
      ) : (
        <>
          <div className="settings-hint">
            已生成草稿（模型 {stats?.model}，输入 {stats?.inputTokens} / 输出 {stats?.outputTokens} tokens）
          </div>
          <div className="field">
            <label>技能目录名（保存目录：主库/{draft.name}）</label>
            <input
              className="input mono"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value.replace(/[^\w-]/g, '-') })}
            />
          </div>
          <div className="field">
            <label>SKILL.md 内容（可直接编辑）</label>
            <textarea
              className="textarea mono"
              rows={14}
              value={skillMd}
              onChange={(e) => setSkillMd(e.target.value)}
            />
          </div>
          <div className="settings-hint">预览：</div>
          <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(skillMd) }} />
          {error && <div className="err-box">{error}</div>}
        </>
      )}
    </Modal>
  )
}