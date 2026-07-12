import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeShutdownHandler } from '../src/shutdown'

/// 有界优雅关闭：干净关闭 exit(0)、close 永挂时超时强退 exit(1)、close 报错 exit(1)、二次信号忽略。
describe('makeShutdownHandler（有界优雅关闭）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('close 及时完成 → exit(0)，且不再触发超时强退', async () => {
    const exit = vi.fn()
    const app = { close: vi.fn().mockResolvedValue(undefined) }
    const handler = makeShutdownHandler(app, { timeoutMs: 10_000, exit, log: () => {} })
    handler()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(app.close).toHaveBeenCalledTimes(1)
    // 即便时间快进过超时，也不应再 exit（timer 已清）。
    vi.advanceTimersByTime(20_000)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('close 永挂（通话长连接）→ 超时后强制 exit(1)', () => {
    const exit = vi.fn()
    const app = { close: vi.fn().mockReturnValue(new Promise<void>(() => {})) } // 永不 resolve
    const handler = makeShutdownHandler(app, { timeoutMs: 10_000, exit, log: () => {} })
    handler()
    expect(exit).not.toHaveBeenCalled() // 未到超时不退
    vi.advanceTimersByTime(10_000)
    expect(exit).toHaveBeenCalledWith(1) // 超时强退
  })

  it('close 抛错 → exit(1)', async () => {
    const exit = vi.fn()
    const app = { close: vi.fn().mockRejectedValue(new Error('boom')) }
    const handler = makeShutdownHandler(app, { timeoutMs: 10_000, exit, log: () => {} })
    handler()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
  })

  it('二次信号忽略：只 close 一次（防重复关闭）', async () => {
    const exit = vi.fn()
    const app = { close: vi.fn().mockResolvedValue(undefined) }
    const handler = makeShutdownHandler(app, { timeoutMs: 10_000, exit, log: () => {} })
    handler()
    handler() // 再次信号
    handler()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(app.close).toHaveBeenCalledTimes(1)
  })

  it('beforeClose 在 app.close() **之前**调用一次（置 shuttingDown 标志），且仅首个信号触发', async () => {
    const app = { close: vi.fn().mockResolvedValue(undefined) }
    const beforeClose = vi.fn()
    const handler = makeShutdownHandler(app, { timeoutMs: 10_000, exit: () => {}, log: () => {}, beforeClose })
    handler()
    handler() // 二次信号
    expect(beforeClose).toHaveBeenCalledTimes(1) // 仅首个信号
    // beforeClose 先于 close（invocationCallOrder 全局单调递增）。
    expect(beforeClose.mock.invocationCallOrder[0]).toBeLessThan(app.close.mock.invocationCallOrder[0])
  })

  it('beforeClose 抛错不阻断关闭（置标志失败仍要正常排空退出）', async () => {
    const exit = vi.fn()
    const app = { close: vi.fn().mockResolvedValue(undefined) }
    const handler = makeShutdownHandler(app, { timeoutMs: 10_000, exit, log: () => {}, beforeClose: () => { throw new Error('boom') } })
    expect(() => handler()).not.toThrow()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(app.close).toHaveBeenCalledTimes(1)
  })
})
