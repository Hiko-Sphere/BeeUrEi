// 主题（浅/深/跟随系统）与界面语言，持久化到 localStorage。
export type Theme = 'light' | 'dark' | 'auto'
export type Lang = 'zh' | 'en'

const LS_THEME = 'beeurei.web.theme'
const LS_LANG = 'beeurei.web.lang'

export function getTheme(): Theme {
  const v = localStorage.getItem(LS_THEME)
  return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto'
}
export function setTheme(t: Theme) {
  localStorage.setItem(LS_THEME, t)
  applyTheme()
}
export function applyTheme() {
  const t = getTheme()
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function getLang(): Lang {
  const v = localStorage.getItem(LS_LANG)
  if (v === 'zh' || v === 'en') return v
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
export function setLang(l: Lang) {
  localStorage.setItem(LS_LANG, l)
  document.documentElement.lang = l === 'zh' ? 'zh-Hans' : 'en'
  // 浏览器标签标题随语言（此前静态双语）。setLang 在启动(main.tsx)与切换(Layout)都会调用，两处一并覆盖。
  document.title = l === 'zh' ? 'BeeUrEi 协助者' : 'BeeUrEi Helper'
}
