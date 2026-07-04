import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { decideLowBatteryWarn } from '../src/location/lowBattery'

describe('decideLowBatteryWarn 纯逻辑（滞回）', () => {
  const WARN = 15, CLEAR = 25
  it('跌到阈值及以下 → 提醒一次并置位', () => {
    expect(decideLowBatteryWarn(false, 15, WARN, CLEAR)).toEqual({ warn: true, warned: true })
    expect(decideLowBatteryWarn(false, 8, WARN, CLEAR)).toEqual({ warn: true, warned: true })
  })
  it('阈值以上 → 不提醒', () => {
    expect(decideLowBatteryWarn(false, 16, WARN, CLEAR)).toEqual({ warn: false, warned: false })
  })
  it('已提醒且仍低 → 不重复（去抖）', () => {
    expect(decideLowBatteryWarn(true, 10, WARN, CLEAR)).toEqual({ warn: false, warned: true })
    expect(decideLowBatteryWarn(true, 15, WARN, CLEAR)).toEqual({ warn: false, warned: true })
  })
  it('已提醒但未回到 clearAt（滞回带内 15<b<25）→ 保持已提醒、不复位不重报', () => {
    expect(decideLowBatteryWarn(true, 20, WARN, CLEAR)).toEqual({ warn: false, warned: true })
  })
  it('已提醒且回升到 clearAt 及以上 → 复位（下次再跌破可再提醒）', () => {
    expect(decideLowBatteryWarn(true, 25, WARN, CLEAR)).toEqual({ warn: false, warned: false })
    expect(decideLowBatteryWarn(true, 80, WARN, CLEAR)).toEqual({ warn: false, warned: false })
  })
  it('缺电量读数 / 非有限 → 状态不变（不猜、不误报也不误复位）', () => {
    expect(decideLowBatteryWarn(false, undefined, WARN, CLEAR)).toEqual({ warn: false, warned: false })
    expect(decideLowBatteryWarn(true, undefined, WARN, CLEAR)).toEqual({ warn: false, warned: true })
    expect(decideLowBatteryWarn(false, NaN, WARN, CLEAR)).toEqual({ warn: false, warned: false })
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
    // 继续低电量上报 → 不重复提醒（去抖）
    await share(app, blind.h, 9)
    await share(app, blind.h, 5)
    expect(lowBatt(store, family.id)).toHaveLength(1)
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
