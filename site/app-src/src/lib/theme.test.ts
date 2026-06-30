// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getTheme, setTheme, applyTheme, getLang, appTitle } from './theme'

const T = 'beeurei.web.theme', L = 'beeurei.web.lang'
const stubScheme = (dark: boolean) => vi.stubGlobal('matchMedia', () => ({ matches: dark }))

describe('theme/lang 持久化与解析', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.className = ''; stubScheme(false) })
  afterEach(() => vi.unstubAllGlobals())

  it('getTheme：非法/缺失值回退 auto；合法值原样返回', () => {
    expect(getTheme()).toBe('auto')               // 缺失
    localStorage.setItem(T, 'bogus')
    expect(getTheme()).toBe('auto')               // 非法值
    localStorage.setItem(T, 'dark')
    expect(getTheme()).toBe('dark')
  })

  it('applyTheme：dark/light 直接定；auto 跟随系统 prefers-color-scheme', () => {
    const html = document.documentElement
    setTheme('dark'); applyTheme()
    expect(html.classList.contains('dark')).toBe(true)
    setTheme('light'); applyTheme()
    expect(html.classList.contains('dark')).toBe(false)
    localStorage.setItem(T, 'auto'); stubScheme(true); applyTheme()
    expect(html.classList.contains('dark')).toBe(true)    // auto + 系统深色
    stubScheme(false); applyTheme()
    expect(html.classList.contains('dark')).toBe(false)   // auto + 系统浅色
  })

  it('getLang：合法存储优先；否则按 navigator.language 前缀', () => {
    localStorage.setItem(L, 'en'); expect(getLang()).toBe('en')
    localStorage.removeItem(L)
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
    expect(getLang()).toBe('zh')
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true })
    expect(getLang()).toBe('en')                  // 非 zh 前缀 → en
  })

  it('appTitle 双语', () => {
    expect(appTitle('zh')).toContain('协助者')
    expect(appTitle('en')).toBe('BeeUrEi Helper')
  })
})
