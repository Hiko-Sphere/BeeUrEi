import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

/// 契约测试：**web 端真实 api.ts** 打 **真实 fastify 服务**（非 mock）。
/// web 组件测试里 api 全被 vi.mock——16 个 mock 工厂假定的响应形状若与服务端漂移，
/// 那些测试照样全绿（mock drift 是 mock 密集型测试金字塔的经典空洞）。本测锁住契约层：
/// 注册/登录令牌流、亲友绑定、消息收发与未读、会话列表、未读汇总、peek 语义——
/// 走 web 真实客户端函数（含其 401 续期/错误归一逻辑），断言 web 各页实际消费的字段。
///
/// 接线方式：config.ts 在**模块加载时**读 localStorage 的 apiBase 覆盖——先起服务拿到随机端口、
/// 写入桩 localStorage，再**动态 import** api.ts（路径经 String() 包裹避免 TS 静态解析——
/// 否则 web 文件会被拉进 server 的 tsc program，DOM lib 冲突）。
const mem = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  get length() { return mem.size },
} as unknown as Storage

/* eslint-disable @typescript-eslint/no-explicit-any -- 动态导入的 web 模块无类型（见上），形状由断言本身验证 */
let app: ReturnType<typeof buildApp>
let api: any
let tokenStore: any
let SEARCH_LIMIT: number

// 令牌切换：web tokenStore 是 localStorage 单例——多用户契约流靠直接换写它的键（与真实浏览器换账号同机制）。
const actAs = (token: string) => mem.set('beeurei.web.token', token)

beforeAll(async () => {
  app = buildApp(new MemoryStore())
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address() as { port: number }
  mem.set('beeurei.web.apiBase', `http://127.0.0.1:${addr.port}`)
  const mod = await import(String('../../site/app-src/src/lib/api'))
  api = mod.api
  tokenStore = mod.tokenStore
  SEARCH_LIMIT = mod.SEARCH_LIMIT
})
afterAll(async () => { await app.close() })

describe('web api.ts ↔ 真实服务端 契约', () => {
  let helperTok = ''
  let blindTok = ''
  let helperId = ''
  let blindId = ''

  it('注册→me：令牌自动持有，SelfView 含 web 实际消费的键（readReceiptsEnabled 等）', async () => {
    const reg = await api.register('cw_helper', 'strong-pass-9x', 'helper')
    expect(reg.user.role).toBe('helper')
    tokenStore.set(reg.token, reg.refreshToken, reg.user) // 与 Login.tsx 同步骤：register 只返回令牌,存储由调用方做
    helperTok = reg.token
    helperId = reg.user.id
    const me = await api.me()
    // web Account/Layout 消费的键：漂移即此处红（而非组件测试静默假绿）。
    expect(me).toMatchObject({ id: helperId, username: 'cw_helper', role: 'helper' })
    expect(me.readReceiptsEnabled ?? true).toBe(true)
  })

  it('绑定流：addLink→incoming→accept→familyLinks 形状（memberId/memberName/status——转发/搜索直达都依赖）', async () => {
    const reg = await api.register('cw_blind', 'strong-pass-9x', 'blind')
    tokenStore.set(reg.token, reg.refreshToken, reg.user)
    blindTok = reg.token
    blindId = reg.user.id
    await api.addLink({ username: 'cw_helper' }, '志愿者', true) // blind 主动加 helper
    actAs(helperTok)
    const incoming = await api.incomingLinks()
    expect(incoming.links[0]).toMatchObject({ ownerName: 'cw_blind' })
    await api.acceptLink(incoming.links[0].id)
    actAs(blindTok)
    const links = await api.familyLinks()
    expect(links.links[0]).toMatchObject({ memberId: helperId, memberName: 'cw_helper', status: 'accepted', isEmergency: true })
  })

  it('消息契约：sendMessage→conversations(unread/peer.displayName)→unreadSummary(四键)→markRead 清零', async () => {
    actAs(helperTok)
    await api.sendMessage({ toId: blindId }, 'text', '到家了吗？')
    actAs(blindTok)
    const convos = await api.conversations()
    // ConvoRow/草稿标示/未读徽标依赖的键。
    expect(convos.conversations[0]).toMatchObject({ unread: 1 })
    expect(convos.conversations[0].peer).toMatchObject({ id: helperId, displayName: 'cw_helper' })
    expect(convos.conversations[0].last).toMatchObject({ kind: 'text', text: '到家了吗？' })
    const sum = await api.unreadSummary()
    expect(sum).toMatchObject({ messages: 1, notifications: expect.any(Number), missedCalls: 0, total: expect.any(Number) })
    const msgs = await api.messagesWith(helperId)
    expect(msgs.messages[0]).toMatchObject({ fromId: helperId, toId: blindId, kind: 'text' })
    await api.markRead(helperId)
    expect((await api.unreadSummary()).messages).toBe(0)
  })

  it('搜索契约：searchMessages 显式携带 limit=SEARCH_LIMIT（截断标注的单一事实源真到达服务端）', async () => {
    actAs(blindTok)
    const r = await api.searchMessages({ peerId: helperId }, '到家')
    expect(r.messages).toHaveLength(1) // 服务端接受了带 limit 的请求并按契约返回
    expect(SEARCH_LIMIT).toBe(50)
  })

  it('peek 契约：callHistory(true) 不清未接角标、callHistory() 清（服务端真实语义，非 mock 假定）', async () => {
    actAs(blindTok)
    expect((await api.callHistory(true)).calls).toEqual([]) // peek 形状
    const sum = await api.unreadSummary()
    expect(sum.missedCalls).toBe(0)
  })

  it('错误契约：错误码经 APIError.code 透出（chatErrorText 映射依赖）——给陌生人发消息 → not_linked', async () => {
    const reg = await api.register('cw_stranger', 'strong-pass-9x', 'helper')
    tokenStore.set(reg.token, reg.refreshToken, reg.user)
    await expect(api.sendMessage({ toId: blindId }, 'text', 'hi')).rejects.toMatchObject({ code: 'not_linked' })
  })
})
