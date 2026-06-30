// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, APIError } from './api'

describe('rawFetch 请求超时（防网络挂死导致 UI 无限转圈）', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('30s 无响应 → AbortController 中止并抛 network 错误', async () => {
    vi.useFakeTimers()
    // 模拟网络挂死：fetch 永不 resolve，但遵守 abort 信号（真实 fetch 行为）。
    vi.stubGlobal('fetch', (_url: string, opts: { signal: AbortSignal }) =>
      new Promise((_res, rej) => { opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))) }))
    const p = api.appConfig().then(() => null).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(30_000) // 推进到 30s 超时点
    const err = await p
    expect(err).toBeInstanceOf(APIError)
    expect((err as APIError).code).toBe('network') // 超时按网络错误处理
  })
})
