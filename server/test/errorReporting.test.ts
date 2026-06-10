import { describe, it, expect, afterEach } from 'vitest'
import { initErrorReporting, captureException } from '../src/monitoring/errorReporting'

/// D3/F2 错误上报单测。不连真实 Sentry：仅覆盖「未配置 DSN → 安装进程级兜底并返回」
/// 与「captureException 未启用时 no-op、绝不抛」这两条核心保证。
describe('errorReporting（D3/F2 崩溃/错误监控）', () => {
  afterEach(() => {
    delete process.env.SENTRY_DSN
  })

  it('captureException 未启用 Sentry 时为 no-op（不抛）', () => {
    expect(() => captureException(new Error('boom'))).not.toThrow()
    expect(() => captureException('string reason')).not.toThrow()
  })

  it('initErrorReporting 无 DSN：安装未捕获异常/拒绝兜底并返回（不启用 Sentry）', async () => {
    delete process.env.SENTRY_DSN
    await expect(initErrorReporting()).resolves.toBeUndefined()
    // 兜底已安装：进程级 handler 存在（不直接断言匿名 handler，验证不抛即可）。
    expect(process.listenerCount('unhandledRejection')).toBeGreaterThan(0)
    expect(process.listenerCount('uncaughtException')).toBeGreaterThan(0)
  })
})
