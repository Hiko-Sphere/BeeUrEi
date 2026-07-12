// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importWithReload } from './lazyReload'

/// 可注入 deps：reload 用 spy、storage 用真 sessionStorage（jsdom 提供，beforeEach 清空）。
const deps = () => ({ reload: vi.fn(), storage: () => sessionStorage })

describe('importWithReload 懒加载 chunk 失效自愈', () => {
  beforeEach(() => sessionStorage.clear())

  it('加载成功：原样返回模块并清标记（下次部署的失效可再次自愈）', async () => {
    sessionStorage.setItem('beeurei:chunk-reload', '1') // 上次自愈留下的标记
    const d = deps()
    const load = importWithReload(() => Promise.resolve({ default: 'mod' }), d)
    await expect(load()).resolves.toEqual({ default: 'mod' })
    expect(d.reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('beeurei:chunk-reload')).toBeNull() // 成功即清
  })

  it('首次失败（部署替换了旧 chunk）：整页刷新一次自愈，promise 挂起（防错误屏在刷新前闪现）', async () => {
    const d = deps()
    const load = importWithReload(() => Promise.reject(new Error('404 chunk')), d)
    const p = load()
    // 等微任务落定：reload 已被调、标记已设。
    await new Promise((r) => setTimeout(r, 0))
    expect(d.reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('beeurei:chunk-reload')).toBe('1')
    // promise 保持挂起（既不 resolve 也不 reject）——刷新会接管页面。
    const settled = await Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 30))])
    expect(settled).toBe('pending')
  })

  it('同会话第二次仍失败（真网络故障）：如实抛出给 ErrorBoundary，不再刷新（绝不无限刷）', async () => {
    sessionStorage.setItem('beeurei:chunk-reload', '1') // 已自愈过一次
    const d = deps()
    const load = importWithReload(() => Promise.reject(new Error('network down')), d)
    await expect(load()).rejects.toThrow('network down')
    expect(d.reload).not.toHaveBeenCalled()
  })
})
