import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { decideLowBatteryWarn } from '../src/location/lowBattery'

describe('decideLowBatteryWarn 纯逻辑（两级滞回）', () => {
  const WARN = 15, CLEAR = 25, CRIT = 5
  it('跌到 warnAt 及以下（未到 critical）→ 发 low 一次并置位 1', () => {
    expect(decideLowBatteryWarn(0, 15, WARN, CLEAR, CRIT)).toEqual({ fired: 'low', warnedLevel: 1 })
    expect(decideLowBatteryWarn(0, 8, WARN, CLEAR, CRIT)).toEqual({ fired: 'low', warnedLevel: 1 })
  })
  it('warnAt 以上 → 不提醒', () => {
    expect(decideLowBatteryWarn(0, 16, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 0 })
  })
  it('已发 low 且仍低（未到 critical）→ 不重复（去抖）', () => {
    expect(decideLowBatteryWarn(1, 10, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 1 })
    expect(decideLowBatteryWarn(1, 15, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 1 })
  })
  it('已发 low 后再跌破 criticalAt → 升级发 critical，置位 2', () => {
    expect(decideLowBatteryWarn(1, 5, WARN, CLEAR, CRIT)).toEqual({ fired: 'critical', warnedLevel: 2 })
    expect(decideLowBatteryWarn(1, 3, WARN, CLEAR, CRIT)).toEqual({ fired: 'critical', warnedLevel: 2 })
  })
  it('从高电一次性直接掉到 critical → 只发 critical（不补发 low），置位 2', () => {
    expect(decideLowBatteryWarn(0, 4, WARN, CLEAR, CRIT)).toEqual({ fired: 'critical', warnedLevel: 2 })
  })
  it('已发 critical 且仍极低 → 不重复', () => {
    expect(decideLowBatteryWarn(2, 3, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 2 })
    expect(decideLowBatteryWarn(2, 12, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 2 }) // 回到 low 区间也不再补发 low
  })
  it('滞回带内（warn<b<clear）→ 保持层级、不复位不重报', () => {
    expect(decideLowBatteryWarn(1, 20, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 1 })
    expect(decideLowBatteryWarn(2, 20, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 2 })
  })
  it('回升到 clearAt 及以上 → 整体复位（下次再跌破从 low 起重新提醒）', () => {
    expect(decideLowBatteryWarn(1, 25, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 0 })
    expect(decideLowBatteryWarn(2, 80, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 0 })
  })
  it('缺电量读数 / 非有限 → 状态不变（不猜、不误报也不误复位）', () => {
    expect(decideLowBatteryWarn(0, undefined, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 0 })
    expect(decideLowBatteryWarn(2, undefined, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 2 })
    expect(decideLowBatteryWarn(0, NaN, WARN, CLEAR, CRIT)).toEqual({ fired: null, warnedLevel: 0 })
  })
})

async function setup() {
  const store = new MemoryStore()
  const app = buildApp(store)
  const reg = async (u: string, role: string) => {
    const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    return { id: r.user.id as string, h: { authorization: `Bearer ${r.token}` } }
  }
  const blind = await reg('lbblind', 'blind')
  const family = await reg('lbfamily', 'family')
  const stranger = await reg('lbstranger', 'helper')
  const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: blind.h,
    payload: { username: 'lbfamily', relation: '家人', isEmergency: false } })
  await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: family.h })
  return { app, store, blind, family, stranger }
}
const lowBatt = (store: MemoryStore, uid: string) =>
  store.notificationsForUser(uid).filter((n) => n.kind === 'contact_low_battery')
const critBatt = (store: MemoryStore, uid: string) =>
  store.notificationsForUser(uid).filter((n) => n.kind === 'contact_critical_battery')
const share = (app: Awaited<ReturnType<typeof setup>>['app'], h: Record<string, string>, battery: number) =>
  app.inject({ method: 'POST', url: '/api/locations/update', headers: h, payload: { lat: 31.2, lng: 121.4, battery } })

describe('共享位置低电量预警家人（/api/locations/update）', () => {
  it('电量跌破阈值 → 仅通知已接受亲友（不通知陌生人），只一次', async () => {
    const { app, store, blind, family, stranger } = await setup()
    await share(app, blind.h, 40) // 正常电量：不提醒
    expect(lowBatt(store, family.id)).toHaveLength(0)
    await share(app, blind.h, 12) // 跌破 15 → 提醒
    expect(lowBatt(store, family.id)).toHaveLength(1)
    expect(lowBatt(store, family.id)[0].body).toContain('12%')
    expect(lowBatt(store, stranger.id)).toHaveLength(0) // 非授权联系人绝不收到
    // 继续低电量上报（仍在 low 区间）→ 不重复 low
    await share(app, blind.h, 9)
    expect(lowBatt(store, family.id)).toHaveLength(1)
    // 跌破 critical(5%) → 升级发一条 contact_critical_battery（low 仍只有一条）
    await share(app, blind.h, 5)
    expect(lowBatt(store, family.id)).toHaveLength(1)
    expect(critBatt(store, family.id)).toHaveLength(1)
    expect(critBatt(store, family.id)[0].body).toContain('5%')
    expect(critBatt(store, stranger.id)).toHaveLength(0) // 极低告警同样只给授权亲友
    // 继续极低 → 不重复 critical
    await share(app, blind.h, 3)
    expect(critBatt(store, family.id)).toHaveLength(1)
    await app.close()
  })

  it('从正常电量一次性直接掉到极低 → 只发 critical，不补发 low', async () => {
    const { app, store, blind, family } = await setup()
    await share(app, blind.h, 40) // 正常
    await share(app, blind.h, 4)  // 直接掉到 critical
    expect(critBatt(store, family.id)).toHaveLength(1)
    expect(lowBatt(store, family.id)).toHaveLength(0) // 不补发 low（critical 已涵盖最急）
    await app.close()
  })

  it('回升到 clearAt 后再次跌破 → 再提醒一次（滞回复位）', async () => {
    const { app, store, blind, family } = await setup()
    await share(app, blind.h, 10) // 提醒#1
    expect(lowBatt(store, family.id)).toHaveLength(1)
    await share(app, blind.h, 30) // 回升过 clearAt(25) → 复位
    expect(lowBatt(store, family.id)).toHaveLength(1) // 回升不提醒
    await share(app, blind.h, 13) // 再跌破 → 提醒#2
    expect(lowBatt(store, family.id)).toHaveLength(2)
    await app.close()
  })

  it('停止共享清会话态：充电后重开共享、再跌破仍会提醒', async () => {
    const { app, store, blind, family } = await setup()
    await share(app, blind.h, 10) // 提醒#1
    expect(lowBatt(store, family.id)).toHaveLength(1)
    await app.inject({ method: 'POST', url: '/api/locations/stop', headers: blind.h }) // 停止共享 → 清态
    await share(app, blind.h, 11) // 重开共享、仍低 → 再提醒（若未清态会被陈旧"已提醒"抑制）
    expect(lowBatt(store, family.id)).toHaveLength(2)
    await app.close()
  })

  it('不带电量的上报 → 不提醒、不影响状态', async () => {
    const { app, store, blind, family } = await setup()
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: blind.h, payload: { lat: 31.2, lng: 121.4 } })
    expect(lowBatt(store, family.id)).toHaveLength(0)
    await share(app, blind.h, 8) // 之后带电量跌破 → 正常提醒
    expect(lowBatt(store, family.id)).toHaveLength(1)
    await app.close()
  })
})
