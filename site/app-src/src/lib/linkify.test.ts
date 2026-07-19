import { describe, it, expect } from 'vitest'
import { linkifyParts } from './linkify'

describe('linkifyParts（聊天 URL 自动识别，XSS 安全）', () => {
  it('无 URL → 整段纯文本', () => {
    expect(linkifyParts('你好，今天天气不错')).toEqual([{ text: '你好，今天天气不错' }])
  })

  it('识别 http/https URL，前后文本分段保留', () => {
    expect(linkifyParts('看这个 https://example.com/x 挺好')).toEqual([
      { text: '看这个 ' }, { url: 'https://example.com/x' }, { text: ' 挺好' },
    ])
  })

  it('剥离 URL 尾部句子标点（句号/逗号/右括号）作普通文本', () => {
    expect(linkifyParts('见 https://a.com/p.')).toEqual([{ text: '见 ' }, { url: 'https://a.com/p' }, { text: '.' }])
    expect(linkifyParts('(https://a.com)')).toEqual([{ text: '(' }, { url: 'https://a.com' }, { text: ')' }])
  })

  it('URL 内配对括号保留（维基消歧义/带括号路径不被截断成残链）', () => {
    // 尾部右括号有配对左括号 → 是 URL 一部分，保留。
    expect(linkifyParts('见 https://zh.wikipedia.org/wiki/北京_(消歧义)')).toEqual([
      { text: '见 ' }, { url: 'https://zh.wikipedia.org/wiki/北京_(消歧义)' },
    ])
    // 配对括号 URL + 句末句号 → 保留 URL 的 `)`、只把句号作文本。
    expect(linkifyParts('https://en.wikipedia.org/wiki/Foo_(bar).')).toEqual([
      { url: 'https://en.wikipedia.org/wiki/Foo_(bar)' }, { text: '.' },
    ])
    // 无配对左括号的尾部 `)` 仍作句子标点剥离（回归："(见 https://a.com)"）。
    expect(linkifyParts('(https://a.com)')).toEqual([{ text: '(' }, { url: 'https://a.com' }, { text: ')' }])
  })

  it('多个 URL 都识别', () => {
    const parts = linkifyParts('a https://x.com b http://y.com c')
    expect(parts.filter((p) => 'url' in p)).toEqual([{ url: 'https://x.com' }, { url: 'http://y.com' }])
  })

  it('**不**把 javascript:/data: 等危险 scheme 当链接（只认 http/https）', () => {
    expect(linkifyParts('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }])
    expect(linkifyParts('data:text/html,<script>')).toEqual([{ text: 'data:text/html,<script>' }])
    // 裸域名（无协议）也不当链接，避免误判。
    expect(linkifyParts('访问 example.com 看看')).toEqual([{ text: '访问 example.com 看看' }])
  })

  it('URL 内不含引号/尖括号/空白（正则字符集排除，防 href 越界）', () => {
    const parts = linkifyParts('https://a.com/x"onmouseover=1 后文')
    expect(parts.find((p) => 'url' in p)).toEqual({ url: 'https://a.com/x' }) // 到引号即止，注入串留作文本
  })
})
