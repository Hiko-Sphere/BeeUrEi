import { describe, it, expect } from 'vitest'
import { resolveGlobalBanner } from './globalBanner'
import type { AppConfig } from './api'

const base: AppConfig = { features: {}, registrationEnabled: true, recording: { enabled: false, requireConsent: true } }

describe('resolveGlobalBanner（全站维护/公告横幅字段契约）', () => {
  it('维护 active → 显示（danger），message 可空由调用方补默认', () => {
    expect(resolveGlobalBanner({ ...base, maintenance: { active: true, message: '升级中，30 分钟后恢复' } }))
      .toEqual({ kind: 'maintenance', message: '升级中，30 分钟后恢复', tone: 'danger' })
    // 维护 active 但 message 空 → 仍显示（message 空串，调用方补本地化默认）。
    expect(resolveGlobalBanner({ ...base, maintenance: { active: true, message: '' } }))
      .toEqual({ kind: 'maintenance', message: '', tone: 'danger' })
  })

  it('公告 active + message → 显示；level=warning→warning 否则 info', () => {
    expect(resolveGlobalBanner({ ...base, announcement: { active: true, message: '新增安全报到功能', level: 'info' } }))
      .toEqual({ kind: 'announcement', message: '新增安全报到功能', tone: 'info' })
    expect(resolveGlobalBanner({ ...base, announcement: { active: true, message: '今晚系统抖动，正在排查', level: 'warning' } }))
      .toEqual({ kind: 'announcement', message: '今晚系统抖动，正在排查', tone: 'warning' })
    // 缺 level → info 兜底。
    expect(resolveGlobalBanner({ ...base, announcement: { active: true, message: 'X' } })?.tone).toBe('info')
  })

  it('维护优先于公告（都开时只显示维护）', () => {
    const b = resolveGlobalBanner({ ...base,
      maintenance: { active: true, message: '维护中' },
      announcement: { active: true, message: '公告', level: 'info' } })
    expect(b?.kind).toBe('maintenance')
  })

  it('不显示的情形：均未 active / 公告 active 但 message 空 / 无 config', () => {
    expect(resolveGlobalBanner({ ...base, maintenance: { active: false, message: '维护中' } })).toBeNull()
    expect(resolveGlobalBanner({ ...base, announcement: { active: false, message: '公告', level: 'info' } })).toBeNull()
    expect(resolveGlobalBanner({ ...base, announcement: { active: true, message: '   ', level: 'info' } })).toBeNull() // 纯空白 message 不显示
    expect(resolveGlobalBanner(null)).toBeNull()
    expect(resolveGlobalBanner(undefined)).toBeNull()
    expect(resolveGlobalBanner(base)).toBeNull() // 无 announcement/maintenance 字段
  })

  it('回归护栏：绝不读旧的 enabled/text 字段（服务端从不下发这两个名）', () => {
    // 若代码回退去读 enabled/text，下面这个"服务端真实形状"就不会显示 → 断言会失败。
    const serverShape = { ...base, maintenance: { active: true, message: '真实字段' } } as AppConfig
    expect(resolveGlobalBanner(serverShape)?.message).toBe('真实字段')
    // 反向：只有旧字段名（enabled/text）而无 active/message 时，绝不显示（模拟误契约）。
    const wrong = { ...base, maintenance: { enabled: true, message: 'x' } as unknown as AppConfig['maintenance'] }
    expect(resolveGlobalBanner(wrong)).toBeNull()
  })
})
