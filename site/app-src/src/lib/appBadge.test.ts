// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { updateAppBadge } from './appBadge'

const navAny = navigator as unknown as { setAppBadge?: unknown; clearAppBadge?: unknown }

afterEach(() => { delete navAny.setAppBadge; delete navAny.clearAppBadge })

describe('updateAppBadge（PWA 图标角标 Badging API）', () => {
  it('total>0 → setAppBadge(total)；total<=0 → clearAppBadge', () => {
    const set = vi.fn().mockResolvedValue(undefined)
    const clear = vi.fn().mockResolvedValue(undefined)
    navAny.setAppBadge = set; navAny.clearAppBadge = clear

    updateAppBadge(5)
    expect(set).toHaveBeenCalledWith(5)
    expect(clear).not.toHaveBeenCalled()

    updateAppBadge(0)
    expect(clear).toHaveBeenCalledTimes(1)
    updateAppBadge(-1)
    expect(clear).toHaveBeenCalledTimes(2)
  })

  it('浏览器不支持 Badging API（无 setAppBadge）→ 静默不崩', () => {
    expect(() => updateAppBadge(3)).not.toThrow()
    expect(() => updateAppBadge(0)).not.toThrow()
  })

  it('API 拒绝（reject）→ 吞掉，不冒泡', () => {
    navAny.setAppBadge = vi.fn().mockRejectedValue(new Error('denied'))
    expect(() => updateAppBadge(2)).not.toThrow()
  })
})
