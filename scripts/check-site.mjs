// 官网静态质量门禁（零依赖 Node 脚本，CI 与本地皆可跑）：把 2026-07-04 人工审计过的站点不变量固化——
// 锚点必须命中、图片必有 alt、每页恰一个 <h1> 且 <html> 带 lang、站内链接不指向不存在的路径、
// sitemap 与实际页面互相一致。任何一条破坏即 exit 1（挡在合并前）。
// 注：这是对**本仓受控静态页**的定向正则检查，不是通用 HTML 解析器——页面结构简单可控，够用且零依赖。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'public')
const errors = []

/// 收集 site/public 下全部 HTML（跳过 app 构建产物目录，如有）。
function htmlFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'app' && name !== 'assets') out.push(...htmlFiles(p)) }
    else if (name.endsWith('.html')) out.push(p)
  }
  return out
}

const files = htmlFiles(ROOT)
if (files.length === 0) { console.error('check-site: 未找到任何 HTML'); process.exit(1) }

for (const file of files) {
  const rel = file.slice(ROOT.length)
  const html = readFileSync(file, 'utf8')

  // <html> 必须带 lang（读屏发音正确性的根）。
  if (!/<html[^>]*\slang=/.test(html)) errors.push(`${rel}: <html> 缺 lang 属性`)

  // 恰好一个 <h1（页面大纲的根，读屏导航依赖）。
  const h1s = (html.match(/<h1[\s>]/g) ?? []).length
  if (h1s !== 1) errors.push(`${rel}: 应恰有 1 个 <h1>，实为 ${h1s}`)

  // 每个 <img> 必须带非空 alt（装饰图应 alt=""——空串合法，缺失不合法）。
  for (const img of html.match(/<img[^>]*>/g) ?? []) {
    if (!/\salt=/.test(img)) errors.push(`${rel}: <img> 缺 alt：${img.slice(0, 80)}`)
  }

  // 页内锚点 href="#x" 必须有对应 id="x"（裸 "#" 视为坏链）。
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  for (const [, anchor] of html.matchAll(/href="#([^"]*)"/g)) {
    if (anchor === '') errors.push(`${rel}: 裸 href="#"（无目标锚点）`)
    else if (!ids.has(anchor)) errors.push(`${rel}: 锚点 #${anchor} 无对应 id`)
  }

  // 站内绝对路径链接必须能落到真实文件（/x → /x 文件或 /x/index.html；含 ?/# 的先剥）。
  for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) {
    const path = href.split(/[?#]/)[0]
    if (path.startsWith('/app')) continue // 协助端 SPA 由 nginx 回落 app/index.html，不在静态目录内检查
    const direct = join(ROOT, path)
    const asIndex = join(ROOT, path, 'index.html')
    if (!existsSync(direct) && !existsSync(asIndex)) errors.push(`${rel}: 站内链接 ${href} 无对应文件`)
  }
}

// sitemap ↔ 页面互查：sitemap 里列的路径必须存在；反向，每个页面目录都应进 sitemap（防新页忘登记）。
const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8')
const locs = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1])
for (const loc of locs) {
  if (!existsSync(join(ROOT, loc, 'index.html')) && !existsSync(join(ROOT, loc))) {
    errors.push(`sitemap.xml: ${loc} 无对应页面`)
  }
}
for (const file of files) {
  const rel = file.slice(ROOT.length)
  const urlPath = rel === '/index.html' ? '/' : rel.replace(/index\.html$/, '')
  if (!locs.includes(urlPath)) errors.push(`sitemap.xml: 缺少页面 ${urlPath}（新页面忘登记？）`)
}

// robots.txt 必须声明 sitemap（搜索引擎发现入口）。
if (!/Sitemap:\s*\S+sitemap\.xml/.test(readFileSync(join(ROOT, 'robots.txt'), 'utf8'))) {
  errors.push('robots.txt: 缺 Sitemap 声明')
}

if (errors.length) {
  console.error(`check-site: ${errors.length} 个问题：`)
  for (const e of errors) console.error('  ✗ ' + e)
  process.exit(1)
}
console.log(`check-site: ${files.length} 个页面全部通过（lang/h1/alt/锚点/站内链接/sitemap/robots）`)
