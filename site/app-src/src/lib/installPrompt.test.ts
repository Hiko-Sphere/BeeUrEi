// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { installAvailable, promptInstall, onInstallAvailable } from './installPrompt'

/// 派发一个可控的 beforeinstallprompt 假事件（含 prompt/userChoice——jsdom 无原生实现）。
function fireBip(outcome: 'accepted' | 'dismissed') {
  const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }>
  }
  ev.prompt = vi.fn().mockResolvedValue(undefined)
  ev.userChoice = Promise.resolve({ outcome })
  window.dispatchEvent(ev)
  return ev
}

describe('installPrompt PWA 安装捕获（模块级监听随首包挂载）', () => {
  it('事件到达前不可安装；到达后可安装且拦截默认（preventDefault）、通知订阅者', () => {
    expect(installAvailable()).toBe(false) // 初始（无事件）：诚实不可安装——Safari/Firefox 永远停在这
    const cb = vi.fn()
    const off = onInstallAvailable(cb)
    const ev = fireBip('accepted')
    expect(ev.defaultPrevented).toBe(true) // 拦下浏览器默认迷你信息栏，由我们的卡呈现
    expect(installAvailable()).toBe(true)
    expect(cb).toHaveBeenCalled()
    off()
  })

  it('promptInstall：调原生 prompt 并如实返回用户选择；用完即清（二次调用 unavailable，防重复 prompt 抛错）', async () => {
    fireBip('accepted')
    await expect(promptInstall()).resolves.toBe('accepted')
    expect(installAvailable()).toBe(false)                 // prompt() 只能调一次：已清暂存
    await expect(promptInstall()).resolves.toBe('unavailable')
    // 拒绝也如实返回（调用方据此收起卡片，绝不留假按钮）。
    fireBip('dismissed')
    await expect(promptInstall()).resolves.toBe('dismissed')
  })

  it('appinstalled（含经浏览器菜单安装）→ 清暂存并通知（安装卡随之消失）', () => {
    fireBip('accepted')
    expect(installAvailable()).toBe(true)
    const cb = vi.fn()
    onInstallAvailable(cb)
    window.dispatchEvent(new Event('appinstalled'))
    expect(installAvailable()).toBe(false)
    expect(cb).toHaveBeenCalled()
  })
})
