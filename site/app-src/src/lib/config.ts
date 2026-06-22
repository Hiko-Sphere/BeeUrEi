// API 源解析：本地开发用相对路径（Vite 代理到本地后端）；生产跨源调用 beeurei-api。
// 可经 localStorage 覆盖，便于联调。
const PROD_API = 'https://beeurei-api.hikosphere.com'

function resolveBase(): string {
  try {
    const o = localStorage.getItem('beeurei.web.apiBase')
    if (o) return o
  } catch { /* ignore */ }
  const h = location.hostname
  if (h === 'localhost' || h === '127.0.0.1') return '' // 走 Vite 代理（同源相对路径）
  return PROD_API
}

export const API_BASE = resolveBase()

export function apiURL(path: string): string {
  return (API_BASE || '') + path
}

export function wsURL(path: string): string {
  if (!API_BASE) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}${path}`
  }
  return API_BASE.replace(/^http/, 'ws') + path
}
