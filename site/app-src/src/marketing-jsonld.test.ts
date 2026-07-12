import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/// 官网结构化数据（JSON-LD）守卫：marketing 主页是无构建静态 HTML，无测试易漂移。
/// 校验 schema.org 图谱可解析、MobileApplication 含**真实**的无障碍元数据 + 功能清单——
/// 这些是可被辅助技术感知的检索信号，对盲人产品尤其该有；改坏（漏字段/JSON 语法错）立即变红。
const htmlPath = fileURLToPath(new URL('../../public/index.html', import.meta.url))
const assetsDir = fileURLToPath(new URL('../../public/assets/', import.meta.url))

function graph(): Record<string, unknown>[] {
  const html = readFileSync(htmlPath, 'utf8')
  const m = /<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html)
  expect(m, 'JSON-LD <script> block present').toBeTruthy()
  const data = JSON.parse(m![1]) as { '@graph': Record<string, unknown>[] } // 语法错即抛→红
  expect(Array.isArray(data['@graph'])).toBe(true)
  return data['@graph']
}

describe('官网 JSON-LD 结构化数据', () => {
  it('图谱含 Organization / WebSite / MobileApplication / FAQPage 四类节点', () => {
    const types = graph().map((n) => n['@type'])
    for (const t of ['Organization', 'WebSite', 'MobileApplication', 'FAQPage']) {
      expect(types).toContain(t)
    }
  })

  it('MobileApplication 声明真实的无障碍元数据（audioDescription 等）+ 无闪烁危害', () => {
    const app = graph().find((n) => n['@type'] === 'MobileApplication')!
    const feats = app.accessibilityFeature as string[]
    // 与站点自述一致：VoiceOver 优先(structuralNavigation)/文字随系统(resizeText)/主题(highContrastDisplay)/
    // 场景语音描述(audioDescription，App 核心)——都是页面上如实描述的能力，非虚标。
    expect(feats).toEqual(expect.arrayContaining(['structuralNavigation', 'resizeText', 'highContrastDisplay', 'audioDescription']))
    expect(app.accessibilityHazard).toBe('noFlashingHazard') // 无闪烁+尊重 reduced-motion
    expect(app.accessibilityControl).toContain('fullTouchControl')
    // 仅声明可核实的控制方式（不虚标 Switch Control 等未验证项）。
    expect(app.accessibilityControl).not.toContain('fullSwitchControl')
  })

  it('featureList 非空且 screenshot 指向真实存在的资源', () => {
    const app = graph().find((n) => n['@type'] === 'MobileApplication')!
    expect((app.featureList as string[]).length).toBeGreaterThanOrEqual(6)
    const shot = String(app.screenshot)
    expect(shot).toMatch(/\/assets\/og\.png$/)
    expect(existsSync(assetsDir + 'og.png'), 'screenshot 资源须真实存在（不能指向 404）').toBe(true)
  })
})
