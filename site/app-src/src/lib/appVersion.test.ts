// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { extractMainScript, currentMainScript, updateAvailable } from './appVersion'

const htmlWith = (asset: string) => `<!doctype html><html><head><script type="module" crossorigin src="/app/${asset}"></script></head><body></body></html>`

function docWithScript(src: string | null): Document {
  const doc = document.implementation.createHTMLDocument('t')
  if (src) {
    const s = doc.createElement('script')
    s.setAttribute('src', src)
    doc.head.appendChild(s)
  }
  return doc
}

describe('appVersion 新版本检测（比对部署产物哈希，零版本簿记）', () => {
  it('extractMainScript：从 index.html 提取内容哈希主包路径；无匹配 → null', () => {
    expect(extractMainScript(htmlWith('assets/index-CZz7gmV_.js'))).toBe('assets/index-CZz7gmV_.js')
    expect(extractMainScript('<html>nothing here</html>')).toBeNull()          // 结构异常：不误报
    expect(extractMainScript('')).toBeNull()
  })

  it('currentMainScript：从 DOM script 标签取当前运行主包；无 script → null', () => {
    expect(currentMainScript(docWithScript('/app/assets/index-AAA1.js'))).toBe('assets/index-AAA1.js')
    expect(currentMainScript(docWithScript('/other.js'))).toBeNull()
    expect(currentMainScript(docWithScript(null))).toBeNull()
  })

  it('updateAvailable：两端解析成功且不同 → true；相同 → false；任一 null → false（绝不误报）', () => {
    const doc = docWithScript('/app/assets/index-AAA1.js')
    expect(updateAvailable(htmlWith('assets/index-BBB2.js'), doc)).toBe(true)   // 部署了新包
    expect(updateAvailable(htmlWith('assets/index-AAA1.js'), doc)).toBe(false)  // 同版本
    expect(updateAvailable('<html>bad</html>', doc)).toBe(false)                // 拉到异常响应：不提示
    expect(updateAvailable(htmlWith('assets/index-BBB2.js'), docWithScript(null))).toBe(false) // 本地解析不出：不提示
  })
})
