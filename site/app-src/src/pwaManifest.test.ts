// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 静态 PWA manifest 校验：坏字段/死链快捷方式会让"安装到主屏"退化或长按图标落 404，本测在构建前挡住。
describe('PWA manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))

  it('具备可安装 PWA 的必需字段（standalone/scope/start_url + 512 图标含 maskable）', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.display).toBe('standalone')
    expect(manifest.scope).toBe('/app/')
    expect(manifest.start_url).toBe('/app/')
    expect(manifest.icons.some((i: { sizes?: string }) => i.sizes === '512x512')).toBe(true)
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true) // 安卓自适应图标不被裁
  })

  it('快捷方式全部指向真实存在的 /app 路由（长按图标直达来电/告警/消息，不落死链）', () => {
    // 与 App.tsx 已登录路由一致（basename=/app）。死链会让快捷方式落 404/重定向，等于没用。
    const validPaths = new Set(['/app/', '/app/calls', '/app/chat', '/app/family', '/app/locations',
      '/app/routes', '/app/recordings', '/app/notifications', '/app/account'])
    expect(Array.isArray(manifest.shortcuts)).toBe(true)
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(2)
    for (const s of manifest.shortcuts) {
      expect(s.name, 'shortcut 须有可读 name').toBeTruthy()
      expect(s.short_name, 'shortcut 须有 short_name').toBeTruthy()
      expect(validPaths.has(s.url), `shortcut 死链：${s.url}`).toBe(true)
    }
    // 最时效敏感的两条（来电、紧急告警）必须在列。
    const urls = manifest.shortcuts.map((s: { url: string }) => s.url)
    expect(urls).toContain('/app/calls')
    expect(urls).toContain('/app/notifications')
  })
})
