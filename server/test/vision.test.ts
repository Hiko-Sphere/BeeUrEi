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
  delete process.env.VISION_DAILY_MAX
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

  it('上游挂起 → 超时中止，抛 VisionError timeout（不无限等待，占住连接/限流槽/阻塞用户）', async () => {
    setConfig()
    process.env.VISION_TIMEOUT_MS = '20' // 20ms 超时
    // fetch 永不解析，仅在收到 abort signal 后 reject（模拟真实 fetch 的中止语义）。
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    await expect(visionDescribe({ imageDataUrl: 'data:image/jpeg;base64,x', lang: 'zh' }))
      .rejects.toMatchObject({ name: 'VisionError', detail: 'timeout' })
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

  it('5.5MB 图（在 8MB bodyLimit 内、超 5MB 图上限）→ 413 image_too_large（走 handler 检查而非 bodyLimit）', async () => {
    setConfig()
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    // 5.5MB 解码 → ~7.3MB base64（< 8MB bodyLimit，能到达 handler），触发 MAX_IMAGE_BYTES(5MB) 检查。
    const b64 = 'A'.repeat(Math.ceil(5.5 * 1024 * 1024 * 4 / 3))
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: b64, mime: 'image/jpeg' } })
    expect(res.statusCode).toBe(413)
    expect(res.json()).toMatchObject({ error: 'image_too_large' }) // 我方检查，非 Fastify bodyLimit 的通用 413
    await app.close()
  })

  it('每日配额：达当日上限 → 429 ai_daily_quota_exceeded，且不再打上游', async () => {
    setConfig()
    process.env.VISION_DAILY_MAX = '2' // 低配额便于测
    const upstream = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }))
    vi.stubGlobal('fetch', upstream)
    const store = new MemoryStore()
    const app = buildApp(store)
    const t = await token(app)
    const call = () => app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect((await call()).statusCode).toBe(200) // 1
    expect((await call()).statusCode).toBe(200) // 2 → 达上限
    const third = await call()                   // 3 → 超配额
    expect(third.statusCode).toBe(429)
    expect(third.json()).toMatchObject({ error: 'ai_daily_quota_exceeded' })
    expect(upstream).toHaveBeenCalledTimes(2) // 超配额那次绝不打上游（省付费额度）
    await app.close()
  })

  it('每日配额：失败调用不烧用户额度（只有成功才计入）', async () => {
    setConfig()
    process.env.VISION_DAILY_MAX = '1'
    // 上游先失败一次（不应计入配额），再成功一次（计入），第三次才被 429。
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1
      if (n === 1) return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
    }))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const call = () => app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect((await call()).statusCode).toBe(502) // 失败：不计入配额
    expect((await call()).statusCode).toBe(200) // 成功：计入 → 达上限 1
    expect((await call()).statusCode).toBe(429) // 超配额
    await app.close()
  })

  it('每日配额按用户隔离：一个用户超额不影响另一用户', async () => {
    setConfig()
    process.env.VISION_DAILY_MAX = '1'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })))
    const app = buildApp(new MemoryStore())
    const a = await token(app, 'visionA')
    const b = await token(app, 'visionB')
    const call = (t: string) => app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect((await call(a)).statusCode).toBe(200)
    expect((await call(a)).statusCode).toBe(429) // A 超额
    expect((await call(b)).statusCode).toBe(200) // B 不受影响
    await app.close()
  })

  it('metrics 值守：成功→vision_describe_total、超配额→vision_quota_exceeded_total（进 /metrics 供 Prometheus）', async () => {
    setConfig()
    process.env.VISION_DAILY_MAX = '1' // 便于触发配额
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })))
    const app = buildApp(new MemoryStore())
    const t = await token(app, 'vmetrics')
    const call = () => app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` }, payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect((await call()).statusCode).toBe(200) // 成功 → describe_total 1（配额用满 1）
    expect((await call()).statusCode).toBe(429) // 超配额 → quota_exceeded 1（不打上游）
    const m = (await app.inject({ method: 'GET', url: '/metrics' })).payload
    expect(m).toContain('vision_describe_total 1')
    expect(m).toContain('vision_quota_exceeded_total 1')
    await app.close()
  })

  it('metrics 值守：上游失败 → vision_errors_total（provider 故障可告警）', async () => {
    setConfig()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) })))
    const app = buildApp(new MemoryStore())
    const t = await token(app, 'vmetrics2')
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` }, payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect(res.statusCode).toBe(502)
    const m = (await app.inject({ method: 'GET', url: '/metrics' })).payload
    expect(m).toContain('vision_errors_total 1')
    await app.close()
  })

  it('客户端带 data: 前缀发来 → 剥离后正常处理（200）', async () => {
    setConfig()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: { body: string }) => {
      // 确认剥离前缀后送上游的 data URL 只有一个 data: 前缀（未双重拼接）。
      const body = JSON.parse(opts.body)
      const url = body.messages[1].content[1].image_url.url as string
      expect(url).toBe(`data:image/jpeg;base64,${TINY_JPEG_B64}`)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
    }))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${t}` },
      payload: { image: `data:image/jpeg;base64,${TINY_JPEG_B64}`, mime: 'image/jpeg' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ text: 'ok' })
    await app.close()
  })
})
