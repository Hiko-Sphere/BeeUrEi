import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { visionConfigured, visionDescribe, VisionError } from '../src/vision/visionClient'

// 1×1 合法 base64（fetch 被 stub，内容不重要，只需通过 base64 字符集与大小校验）。
const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQ=='

function setConfig() {
  process.env.VISION_API_KEY = 'testkey'
  process.env.VISION_API_BASE = 'https://vision.example.com/v1'
  process.env.VISION_MODEL = 'test-vlm'
}
function clearConfig() {
  delete process.env.VISION_API_KEY
  delete process.env.VISION_API_BASE
  delete process.env.VISION_MODEL
  delete process.env.VISION_MAX_TOKENS
}
async function token(app: ReturnType<typeof buildApp>, username = 'visionuser') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return r.json().token as string
}

describe('visionClient（AI 视觉描述，provider 无关 / OpenAI 兼容）', () => {
  afterEach(() => { vi.unstubAllGlobals(); clearConfig() })

  it('三项 env 未配齐 → visionConfigured=false；describe 抛 503 not_configured', async () => {
    clearConfig()
    expect(visionConfigured()).toBe(false)
    process.env.VISION_API_KEY = 'k' // 只配 1/3 仍算未配置
    expect(visionConfigured()).toBe(false)
    await expect(visionDescribe({ imageDataUrl: 'data:image/jpeg;base64,x', lang: 'zh' }))
      .rejects.toMatchObject({ name: 'VisionError', status: 503 })
  })

  it('配齐后：请求为 OpenAI 兼容 /chat/completions，带系统提示 + 图像 data URL，返回模型文本', async () => {
    setConfig()
    expect(visionConfigured()).toBe(true)
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '  前方有一扇玻璃门，右侧有台阶。  ' } }] }) }))
    vi.stubGlobal('fetch', f)
    const out = await visionDescribe({ imageDataUrl: 'data:image/jpeg;base64,ABC', question: '前面能走吗', lang: 'zh' })
    expect(out).toBe('前方有一扇玻璃门，右侧有台阶。') // 去除首尾空白
    // 校验请求形态
    const [url, opts] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }]
    expect(url).toBe('https://vision.example.com/v1/chat/completions')
    expect(opts.method).toBe('POST')
    expect(opts.headers.authorization).toBe('Bearer testkey')
    const body = JSON.parse(opts.body)
    expect(body.model).toBe('test-vlm')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content[0]).toMatchObject({ type: 'text', text: '前面能走吗' })
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,ABC')
    expect(body.temperature).toBeLessThanOrEqual(0.3) // 低温偏客观
  })

  it('空回复 → 抛 VisionError（fail-closed，绝不返回罐头兜底文案）', async () => {
    setConfig()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '   ' } }] }) })))
    await expect(visionDescribe({ imageDataUrl: 'data:image/jpeg;base64,x', lang: 'en' }))
      .rejects.toMatchObject({ name: 'VisionError', status: 502, detail: 'empty_response' })
  })

  it('上游 4xx → 抛 VisionError 带状态码，不外泄密钥', async () => {
    setConfig()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) })))
    await expect(visionDescribe({ imageDataUrl: 'data:image/jpeg;base64,x', lang: 'zh' }))
      .rejects.toMatchObject({ name: 'VisionError', status: 429 })
  })
})

describe('POST /api/vision/describe（路由）', () => {
  afterEach(() => { vi.unstubAllGlobals(); clearConfig() })

  it('未配置 VISION_* → 503 ai_not_configured', async () => {
    clearConfig()
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: 'ai_not_configured' })
    await app.close()
  })

  it('未登录 → 401', async () => {
    setConfig()
    const app = buildApp(new MemoryStore())
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('管理员关停 aiDescribe → 403 feature_disabled（服务端强制，客户端绕不过）', async () => {
    setConfig()
    const store = new MemoryStore()
    store.setAppConfig({ features: { aiDescribe: false } })
    const app = buildApp(store)
    const t = await token(app)
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'feature_disabled', feature: 'aiDescribe' })
    await app.close()
  })

  it('非法输入 → 400（坏 mime / 缺图 / 非 base64）', async () => {
    setConfig()
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const auth = { authorization: `Bearer ${t}` }
    for (const payload of [
      { image: TINY_JPEG_B64, mime: 'image/gif' },   // mime 不在白名单
      { mime: 'image/jpeg' },                          // 缺 image
      { image: '这不是base64!!', mime: 'image/jpeg' }, // 非法 base64 字符
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: auth, payload })
      expect(res.statusCode).toBe(400)
    }
    await app.close()
  })

  it('图片过大 → 413 image_too_large', async () => {
    setConfig()
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    // 6MB 解码 → ~8MB base64（在 8MB bodyLimit 内但超 5MB 图片上限）。'A' 是合法 base64 字符。
    const big = 'A'.repeat(Math.ceil(6 * 1024 * 1024 * 4 / 3))
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: big, mime: 'image/jpeg' } })
    expect(res.statusCode).toBe(413)
    await app.close()
  })

  it('happy path（stub 视觉上游）→ 200 返回 { text }', async () => {
    setConfig()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A door ahead, steps on the right.' } }] }) })))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: TINY_JPEG_B64, mime: 'image/jpeg', question: 'what is ahead', lang: 'en' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ text: 'A door ahead, steps on the right.' })
    await app.close()
  })

  it('上游失败 → 502 ai_error（不外泄上游细节）', async () => {
    setConfig()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) })))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ error: 'ai_error' })
    expect(JSON.stringify(res.json())).not.toContain('boom') // 不外泄上游细节
    await app.close()
  })
})
