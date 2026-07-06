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
    while (url.length > 0 && /[.,;:!?)]$/.test(url[url.length - 1])) { trailing = url[url.length - 1] + trailing; url = url.slice(0, -1) }
    if (start > last) parts.push({ text: text.slice(last, start) })
    if (url.length > 0) parts.push({ url })
    if (trailing) parts.push({ text: trailing })
    last = start + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  // 全空/无 URL 时也回一段文本，调用方可统一 map。
  return parts.length > 0 ? parts : [{ text }]
}
