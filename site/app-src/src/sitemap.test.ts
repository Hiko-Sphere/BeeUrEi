import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/// sitemap.xml 漂移守卫：官网是**无构建静态站**，新增/删除页面若忘了同步 sitemap，搜索引擎就收录不全或指向死链。
/// 校验：① sitemap 列出的页面**恰好**等于实际存在的可索引页面（不多不少、不指死链）；② lastmod 均为合法且非未来的日期。
const publicDir = fileURLToPath(new URL('../../public/', import.meta.url))
const sitemapPath = fileURLToPath(new URL('../../public/sitemap.xml', import.meta.url))
const BASE = 'https://beeurei.hikosphere.com'

// 可索引营销页 = 根 index.html + public 下含 index.html 的子目录（排除 assets/.well-known 等非页面目录）。
function actualPages(): string[] {
  const pages: string[] = []
  if (existsSync(`${publicDir}index.html`)) pages.push('/')
  for (const e of readdirSync(publicDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'assets' || e.name === '.well-known') continue
    if (existsSync(`${publicDir}${e.name}/index.html`)) pages.push(`/${e.name}/`)
  }
  return pages.sort()
}

function sitemapEntries(): { path: string; lastmod: string }[] {
  const xml = readFileSync(sitemapPath, 'utf8')
  const out: { path: string; lastmod: string }[] = []
  const re = /<url>([\s\S]*?)<\/url>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(m[1])?.[1] ?? ''
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(m[1])?.[1] ?? ''
    out.push({ path: loc.replace(BASE, ''), lastmod })
  }
  return out
}

describe('sitemap.xml 漂移守卫', () => {
  it('列出的页面恰好 = 实际可索引页面（新增/删页忘同步即红；不指死链）', () => {
    const listed = sitemapEntries().map((e) => e.path).sort()
    expect(listed).toEqual(actualPages())
    // 双保险：每个 loc 对应的 index.html 确实存在。
    for (const p of listed) {
      const file = p === '/' ? `${publicDir}index.html` : `${publicDir}${p.slice(1)}index.html`
      expect(existsSync(file), `sitemap 指向不存在的页面：${p}`).toBe(true)
    }
  })

  it('lastmod 均为合法 YYYY-MM-DD 且非未来（防手滑填错/填未来日期）', () => {
    const entries = sitemapEntries()
    expect(entries.length).toBeGreaterThan(0)
    for (const { path, lastmod } of entries) {
      expect(lastmod, `${path} lastmod 须 YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const t = Date.parse(lastmod)
      expect(Number.isFinite(t), `${path} lastmod 须合法日期`).toBe(true)
      expect(t, `${path} lastmod 不应在未来`).toBeLessThanOrEqual(Date.now())
    }
  })

  it('首页存在且 priority=1.0（搜索引擎首选入口）', () => {
    const xml = readFileSync(sitemapPath, 'utf8')
    expect(sitemapEntries().some((e) => e.path === '/')).toBe(true)
    expect(/<loc>https:\/\/beeurei\.hikosphere\.com\/<\/loc>[\s\S]*?<priority>1\.0<\/priority>/.test(xml)).toBe(true)
  })
})
