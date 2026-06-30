// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveBase } from './config'

// API 源解析是全局关键路径：解析错 → 所有请求打到错误源、整个应用静默不可用。
// 锁定四个分支（含我加的非浏览器守卫，防它在后续重构里被删掉再次抛错）。
const KEY = 'beeurei.web.apiBase'
const PROD = 'https://beeurei-api.hikosphere.com'

describe('resolveBase API 源解析', () => {
  beforeEach(() => localStorage.removeItem(KEY))
  afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem(KEY) })

  it('localStorage 覆盖优先（联调用）', () => {
    localStorage.setItem(KEY, 'https://staging.example.com')
    expect(resolveBase()).toBe('https://staging.example.com')
  })

  it('localhost / 127.0.0.1 → 空串（走 Vite 同源代理）', () => {
    vi.stubGlobal('location', { hostname: 'localhost' })
    expect(resolveBase()).toBe('')
    vi.stubGlobal('location', { hostname: '127.0.0.1' })
    expect(resolveBase()).toBe('')
  })

  it('生产域名 → 生产 API 源', () => {
    vi.stubGlobal('location', { hostname: 'beeurei.hikosphere.com' })
    expect(resolveBase()).toBe(PROD)
  })

  it('非浏览器上下文（location 未定义）→ 回退生产源且不抛错', () => {
    vi.stubGlobal('location', undefined)
    expect(() => resolveBase()).not.toThrow()
    expect(resolveBase()).toBe(PROD)
  })
})
