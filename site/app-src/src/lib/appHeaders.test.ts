import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/// 配置-需求一致性回归：/app 网页端的浏览器功能权限与资源来源由 nginx 响应头 site/snippets/app-headers.conf
/// 的 Permissions-Policy / CSP 治理（非 app 代码）。这些头**收紧一格就会静默掐断一个功能**——geolocation 曾被误设
/// geolocation=()（空白名单=禁用）致定位完全无法取权限。此测试锁定"app 真正需要的授权"，任何一处被移除即失败，
/// 防同类回归（见 memory web-permissions-policy）。
const conf = readFileSync(fileURLToPath(new URL('../../../snippets/app-headers.conf', import.meta.url)), 'utf8')
// 只取真正的 add_header 指令行，跳过注释（注释里也提到 Permissions-Policy 等字样）。
const line = (directive: string) => conf.split('\n').find((l) => !l.trim().startsWith('#') && l.includes('add_header') && l.includes(directive)) ?? ''
const permissionsPolicy = line('Permissions-Policy')
const csp = line('Content-Security-Policy')

const API = 'beeurei-api.hikosphere.com'
const TILE = 'tile.openstreetmap.org'

describe('app-headers.conf 授权覆盖 /app 的真实需求（配置漂移回归防护）', () => {
  it('Permissions-Policy 放行 geolocation=(self)（位置共享给亲友 + 聊天发送位置）', () => {
    // 反面锁死曾发生的 bug：绝不能是 geolocation=()（对所有源含本站禁用）。
    expect(permissionsPolicy).toMatch(/geolocation=\(self\)/)
    expect(permissionsPolicy).not.toMatch(/geolocation=\(\)/)
  })

  it('Permissions-Policy 放行 microphone=(self)（WebRTC 通话发本端语音）', () => {
    expect(permissionsPolicy).toMatch(/microphone=\(self\)/)
  })

  it('相机不放行（helper getUserMedia video:false，不用摄像头）——收紧无碍，若日后发视频需改 camera=(self)', () => {
    expect(permissionsPolicy).toMatch(/camera=\(\)/)
  })

  it('CSP connect-src 覆盖 API 的 https + wss（fetch + WebSocket 信令）', () => {
    expect(csp).toMatch(new RegExp(`connect-src[^;]*https://${API.replace(/\./g, '\\.')}`))
    expect(csp).toMatch(new RegExp(`connect-src[^;]*wss://${API.replace(/\./g, '\\.')}`))
  })

  it('CSP img-src 覆盖 OSM 瓦片主机（否则地图空白）——与 tileLayer 用的 {s}.tile.openstreetmap.org 对齐', () => {
    const imgSrc = /img-src[^;]*/.exec(csp)?.[0] ?? ''
    // tileLayer 用 https://{s}.tile.openstreetmap.org/... → {s}=a/b/c 子域，匹配 CSP 的 *.tile.openstreetmap.org。
    expect(imgSrc).toContain(TILE)
  })

  it('CSP media-src 覆盖 API 源（播放录制/聊天媒体）', () => {
    expect(csp).toMatch(new RegExp(`media-src[^;]*https://${API.replace(/\./g, '\\.')}`))
  })

  it('script-src 仅 self（无内联/外链脚本，杜绝 XSS 注入面）', () => {
    const scriptSrc = /script-src[^;]*/.exec(csp)?.[0] ?? ''
    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).not.toContain('unsafe-inline')
    expect(scriptSrc).not.toContain('unsafe-eval')
  })
})
