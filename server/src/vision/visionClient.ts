/// AI 视觉描述客户端（云端视觉大模型，为盲人做场景描述 + 图像问答；差距榜 #3）。
/// **provider 无关**：走 OpenAI 兼容的 /chat/completions 视觉接口，用户经环境变量指定厂商
/// （智谱 GLM-4V / 通义 Qwen-VL / OpenAI / 任何 OpenAI 兼容端点），无需改代码、不预设默认厂商。
/// Key/Base/Model 均从环境变量读取（仅后端持有，绝不进 App）。未配齐即视为未启用 → 路由 503 fail-closed。

export type VisionLang = 'zh' | 'en'

function cfg() {
  return {
    key: process.env.VISION_API_KEY?.trim(),
    base: process.env.VISION_API_BASE?.trim(),
    model: process.env.VISION_MODEL?.trim(),
    maxTokens: Number(process.env.VISION_MAX_TOKENS ?? '500'),
  }
}

/// 三者齐备才算配置完成（provider 无关，不预设任何默认厂商，避免把请求误发到错误端点）。
export function visionConfigured(): boolean {
  const c = cfg()
  return !!(c.key && c.base && c.model)
}

/// 视觉服务调用失败（鉴权/配额/网络/上游错误/空回复等）。携带 HTTP 状态与简短详情供诊断，绝不外泄密钥。
export class VisionError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(`vision ${status}: ${detail}`)
    this.name = 'VisionError'
    this.status = status
    this.detail = detail
  }
}

/// 盲人向系统提示：客观、简洁、优先障碍/危险/文字与相对位置；看不清就说看不清、不臆造；不猜任何人身份。
/// 这是产品逻辑（决定描述的可依赖性与安全性），不是罐头回复——真实内容全部由视觉模型生成。
function systemPrompt(lang: VisionLang): string {
  return lang === 'zh'
    ? '你是视障用户的视觉助手。用简洁、客观、可依赖的中文描述这张照片。优先说明可能的障碍物、台阶、门、车辆等危险，以及画面中的文字与标识；说清相对位置（左/中/右、近/远）。看不清或不确定的细节要如实说“看不清”，绝不编造。不要猜测或断言任何人的身份、年龄或情绪。如果用户提出了具体问题，请直接回答。控制在 2 到 4 句话。'
    : "You are a visual assistant for a blind user. Describe this photo in clear, objective, dependable English. Lead with possible hazards (obstacles, steps, doors, vehicles) and any visible text or signs, and give relative positions (left/center/right, near/far). If a detail is unclear, say so plainly — never invent. Do not guess or assert anyone's identity, age, or emotions. If the user asked a specific question, answer it directly. Keep it to 2–4 sentences."
}

function defaultQuestion(lang: VisionLang): string {
  return lang === 'zh' ? '请描述这张照片。' : 'Describe this photo.'
}

export interface DescribeInput {
  imageDataUrl: string // 形如 data:image/jpeg;base64,....
  question?: string    // 可选的用户提问（图像问答）
  lang: VisionLang
}

/// 调 OpenAI 兼容视觉接口，返回描述文本。空回复/异常状态一律抛 VisionError（**绝不返回罐头兜底文案**）。
export async function visionDescribe(input: DescribeInput): Promise<string> {
  const c = cfg()
  if (!c.key || !c.base || !c.model) throw new VisionError(503, 'not_configured')
  const url = `${c.base.replace(/\/+$/, '')}/chat/completions`
  const question = input.question?.trim() || defaultQuestion(input.lang)
  const body = {
    model: c.model,
    messages: [
      { role: 'system', content: systemPrompt(input.lang) },
      { role: 'user', content: [
        { type: 'text', text: question },
        { type: 'image_url', image_url: { url: input.imageDataUrl } },
      ] },
    ],
    max_tokens: Number.isFinite(c.maxTokens) && c.maxTokens > 0 ? c.maxTokens : 500,
    temperature: 0.2, // 低温：偏客观、少发挥（安全攸关，减少臆造）
  }
  // 超时（默认 30s）：视觉大模型推理慢，上游若挂起绝不能让请求无限等待——否则占住连接、限流槽、
  // 阻塞盲人用户拿描述。用 AbortController 硬性中止（VISION_TIMEOUT_MS 可调）。
  const toRaw = Number(process.env.VISION_TIMEOUT_MS ?? '30000')
  const timeoutMs = Number.isFinite(toRaw) && toRaw > 0 ? toRaw : 30000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${c.key}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch {
      // 中止 → 超时；其余 → 网络失败。均不外泄细节。
      throw new VisionError(0, ctrl.signal.aborted ? 'timeout' : 'network')
    }
    let data: unknown
    try { data = await res.json() } catch {
      if (ctrl.signal.aborted) throw new VisionError(0, 'timeout')
      throw new VisionError(res.status, 'bad_json')
    }
    const d = data as { error?: { message?: string }; choices?: Array<{ message?: { content?: unknown } }> }
    if (!res.ok) {
      // 上游错误：带状态码；上游 message 截断入 detail 便于诊断，绝不外泄我方 key。
      const msg = typeof d?.error?.message === 'string' ? d.error.message.slice(0, 200) : `http_${res.status}`
      throw new VisionError(res.status, msg)
    }
    const text = d?.choices?.[0]?.message?.content
    const out = typeof text === 'string' ? text.trim() : ''
    if (!out) throw new VisionError(502, 'empty_response') // 空回复：fail-closed，绝不罐头兜底
    return out
  } finally {
    clearTimeout(timer) // 无论成功/异常都清掉定时器，避免泄漏 handle
  }
}
