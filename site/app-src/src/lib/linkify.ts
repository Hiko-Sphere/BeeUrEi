/// 把纯文本切成"文本 + http(s) 链接"分段，供聊天气泡把 URL 渲染成可点链接（其余仍是纯文本、由 React 转义，绝不 XSS）。
/// **只认 http/https**（正则限定协议）——绝不把 javascript:/data: 等危险 scheme 变成链接；URL 内不含空白/引号/尖括号
/// （正则字符集排除），无法破坏 href。渲染层再加 rel="noopener noreferrer" 防标签劫持。返回顺序分段数组。
export type LinkPart = { text: string } | { url: string }

// http(s):// 起头、直到空白或引号/尖括号（防越界）。全局 + 大小写不敏感。
const URL_RE = /https?:\/\/[^\s<>"']+/gi

export function linkifyParts(text: string): LinkPart[] {
  const parts: LinkPart[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    // 去掉 URL 尾部常见的句子标点（. , ; : ! ? 右括号）——通常是句子标点而非 URL 的一部分，作为普通文本另分一段。
    let url = m[0]
    let trailing = ''
    while (url.length > 0) {
      const ch = url[url.length - 1]
      if ('.,;:!?'.includes(ch)) { trailing = ch + trailing; url = url.slice(0, -1); continue }
      // 尾部右括号：仅当 URL 内**无配对左括号**时才当句子标点剥离（"(见 https://a.com)"）；有左括号说明 `)` 是
      // URL 的组成部分（维基消歧义 https://zh.wikipedia.org/wiki/北京_(消歧义)、许多 CMS 带括号路径），保留——
      // 否则链接被截成打不开的残链，家人分享的维基/带括号链接点了 404。
      if (ch === ')' && !url.slice(0, -1).includes('(')) { trailing = ch + trailing; url = url.slice(0, -1); continue }
      break
    }
    if (start > last) parts.push({ text: text.slice(last, start) })
    if (url.length > 0) parts.push({ url })
    if (trailing) parts.push({ text: trailing })
    last = start + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  // 全空/无 URL 时也回一段文本，调用方可统一 map。
  return parts.length > 0 ? parts : [{ text }]
}
