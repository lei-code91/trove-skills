import type { AiStats, CreateSkillDraft, LlmProfile, LlmSummary, SkillInfo } from '@shared/types'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  maxTokens?: number
  temperature?: number
}

/**
 * LLM 服务：OpenAI 兼容 /chat/completions。
 * 端点归一化：支持根域名（自动补 /v1）、已带 /v1 或 /api/v1 的地址。
 */
export class LlmService {
  static normalizeBase(baseUrl: string): string {
    let base = baseUrl.trim().replace(/\/+$/, '')
    base = base.replace(/\/api\/v1$/, '')
    if (!/\/v1$/.test(base)) base += '/v1'
    return base
  }

  async listModels(profile: LlmProfile): Promise<string[]> {
    const base = LlmService.normalizeBase(profile.baseUrl)
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${profile.apiKey}` }
    })
    if (!res.ok) throw new Error(`模型列表请求失败：HTTP ${res.status} ${await safeText(res)}`)
    const data = (await res.json()) as { data?: { id: string }[] }
    return (data.data ?? []).map((m) => m.id).sort()
  }

  async chat(
    profile: LlmProfile,
    messages: ChatMessage[],
    opts: ChatOptions = {}
  ): Promise<{ content: string; stats: AiStats }> {
    const base = LlmService.normalizeBase(profile.baseUrl)
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.apiKey}`
      },
      body: JSON.stringify({
        model: profile.model,
        messages,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.4
      })
    })
    if (!res.ok) throw new Error(`LLM 调用失败：HTTP ${res.status} ${await safeText(res)}`)
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    return {
      content,
      stats: {
        model: profile.model,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0
      }
    }
  }

  /** 校验配置可用性（测试连接） */
  async testProfile(profile: LlmProfile): Promise<{ ok: boolean; message: string }> {
    try {
      const models = await this.listModels(profile)
      const modelOk = models.length === 0 || !profile.model || models.includes(profile.model)
      return {
        ok: true,
        message: modelOk
          ? `连接成功，发现 ${models.length} 个模型`
          : `连接成功，但模型 "${profile.model}" 不在可用列表（发现 ${models.length} 个模型）`
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  /** AI 摘要：为技能生成中文描述与标签（要求输出 JSON） */
  async summarizeSkill(profile: LlmProfile, skill: SkillInfo): Promise<{ summary: LlmSummary; stats: AiStats }> {
    const prompt = `你是技能库管理助手。请阅读以下 AI Agent Skill（SKILL.md）内容，用中文生成：
1. description：一句 1-2 行的功能描述（60 字以内，说明该技能能帮 Agent / 用户做什么）
2. tags：3-6 个标签（英文小写，用连字符分隔单词）

只输出一个 JSON 对象，不要输出其它内容：
{"description": "...", "tags": ["...", "..."]}

技能名：${skill.name}
技能内容：
---
${skill.readme.slice(0, 6000)}
---`

    const { content, stats } = await this.chat(profile, [
      { role: 'system', content: '你只输出严格 JSON，不输出任何解释或 Markdown 代码块标记。' },
      { role: 'user', content: prompt }
    ])
    const parsed = parseJsonObject(content)
    return {
      summary: {
        description: String(parsed.description ?? '').slice(0, 300),
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 12) : []
      },
      stats
    }
  }

  /** AI 创建技能：一句话需求 → 完整 SKILL.md 草案 */
  async draftSkill(profile: LlmProfile, idea: string): Promise<{ draft: CreateSkillDraft; stats: AiStats }> {
    const prompt = `你是 AI Agent Skill 设计专家。请根据以下需求，生成一个技能（Skill）的完整定义。

需求：${idea}

输出一个 JSON 对象（只输出 JSON）：
{
  "name": "技能目录名（小写英文，连字符分隔，如 pdf-summarizer）",
  "title": "中文标题",
  "description": "一句话描述，说明触发场景与用途",
  "tags": ["英文小写标签"],
  "skillMd": "完整的 SKILL.md 内容：YAML frontmatter（name、description、version、tags）+ 正文 Markdown（含使用场景、输入输出、工作流程、注意事项等，语言用中文）"
}

要求：frontmatter 的 description 要与顶层 description 一致；正文要有实际可执行的步骤结构，不要空话。`

    const { content, stats } = await this.chat(profile, [
      { role: 'system', content: '你只输出严格 JSON，不输出任何解释或 Markdown 代码块标记。' },
      { role: 'user', content: prompt }
    ])
    const parsed = parseJsonObject(content)
    const name = String(parsed.name ?? 'new-skill').replace(/[^\w-]/g, '-').slice(0, 60)
    const draft: CreateSkillDraft = {
      name: name || 'new-skill',
      title: String(parsed.title ?? name ?? '新技能'),
      description: String(parsed.description ?? ''),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 12) : [],
      skillMd: String(parsed.skillMd ?? '')
    }
    if (!draft.skillMd.includes('---')) {
      throw new Error('AI 未生成有效 SKILL.md，请重试')
    }
    return { draft, stats }
  }
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  const candidate = (fenced ? fenced[1] : trimmed).trim()
  try {
    return JSON.parse(candidate) as Record<string, unknown>
  } catch {
    // 尝试截取第一个 { 到最后一个 }
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
      } catch {
        // 继续抛出原始错误
      }
    }
    throw new Error('LLM 返回内容不是有效 JSON')
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 300)
  } catch {
    return ''
  }
}