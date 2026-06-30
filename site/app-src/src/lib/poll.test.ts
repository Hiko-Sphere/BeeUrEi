// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { pollWhileVisible } from './poll'

afterEach(() => { vi.useRealTimers() })

// jsdom 的 document.hidden 是只读 getter——用 defineProperty 覆盖以模拟前后台切换。
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

describe('pollWhileVisible（可见性感知轮询）', () => {
  it('可见时按间隔轮询；隐藏时跳过 tick（省流量/电量/服务端负载）', () => {
    vi.useFakeTimers(); setHidden(false)
    const fn = vi.fn()
    const stop = pollWhileVisible(fn, 1000)
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(3)   // 可见 → 1000/2000/3000 三次
    setHidden(true)
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(3)   // 隐藏 → tick 被跳过，不再增加
    stop()
  })

  it('从隐藏切回可见 → 立即补刷一次（消除隐藏期间的数据陈旧）', () => {
    vi.useFakeTimers(); setHidden(true)
    const fn = vi.fn()
    const stop = pollWhileVisible(fn, 1000)
    vi.advanceTimersByTime(2000)
    expect(fn).toHaveBeenCalledTimes(0)   // 一直隐藏 → 不轮询
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(1)   // 切回前台立即补刷
    stop()
  })

  it('cleanup 清定时器 + 摘 visibilitychange 监听（之后绝不再触发，防泄漏）', () => {
    vi.useFakeTimers(); setHidden(false)
    const fn = vi.fn()
    const stop = pollWhileVisible(fn, 1000)
    stop()
    vi.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(0)   // 定时器已清
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(0)   // 监听已摘
  })
})
