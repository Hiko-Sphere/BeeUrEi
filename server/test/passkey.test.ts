import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type Store } from '../src/db/store'
import { ChallengeStore } from '../src/routes/passkey'
import { notifyAccountSecurity } from '../src/notifications/notify'
import { NoopPushSender } from '../src/push/apns'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const secKinds = (store: Store, uid: string) => store.notificationsForUser(uid).filter((n) => n.kind.startsWith('security_')).map((n) => n.kind)

async function reg(app: ReturnType<typeof buildApp>, username = 'pk1') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return (r.json() as any).token as string
}
async function regFull(app: ReturnType<typeof buildApp>, username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return (r.json() as any) as { token: string; user: { id: string } }
}

// 真正的验签需真实认证器（设备）；这里覆盖端点接线与错误路径（options/鉴权/挑战过期/未知凭据）。
describe('Passkey（WebAuthn）端点', () => {
  it('register/options 需鉴权；授权后返回带 challenge 的 options', async () => {
    const app = buildApp(new MemoryStore())
    const noauth = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/options' })
    expect(noauth.statusCode).toBe(401)
    const token = await reg(app)
    const res = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/options', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    const body = res.json() as any
    expect(body.challenge).toBeTruthy()
    expect(body.rp?.id).toBeTruthy()
    expect(body.user?.name).toBe('pk1')
  })

  it('register/verify：没有在先的挑战 → 400', async () => {
    const app = buildApp(new MemoryStore())
    const token = await reg(app, 'pk2')
    const res = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/verify', headers: auth(token),
      payload: { response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } } })
    expect(res.statusCode).toBe(400)
  })

  it('login/options 返回 flowId+options；无效 flowId → 400；未知凭据 → 401', async () => {
    const app = buildApp(new MemoryStore())
    const opt = await app.inject({ method: 'POST', url: '/api/auth/passkey/login/options' })
    expect(opt.statusCode).toBe(200)
    const { flowId, options } = opt.json() as any
    expect(flowId).toBeTruthy()
    expect(options.challenge).toBeTruthy()

    const badFlow = await app.inject({ method: 'POST', url: '/api/auth/passkey/login/verify',
      payload: { flowId: 'nope', response: { id: 'abc' } } })
    expect(badFlow.statusCode).toBe(400)

    const unknown = await app.inject({ method: 'POST', url: '/api/auth/passkey/login/verify',
      payload: { flowId, response: { id: 'unknown-credential-id' } } })
    expect(unknown.statusCode).toBe(401)
  })

  it('删除本人 passkey → security_passkey_removed；删不存在 id 不误报', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const { token, user } = await regFull(app, 'pkdel')
    // 真实注册需认证器验签；这里直接注入一把 passkey，专测「删除→预警本人」接线。
    store.createPasskey({ id: 'pk-id-1', userId: user.id, credentialId: 'cred1', publicKey: 'x', counter: 0, createdAt: Date.now() })
    // 删不存在的 id：不误报（existed=false）。
    const noop = await app.inject({ method: 'DELETE', url: '/api/auth/passkey/does-not-exist', headers: auth(token) })
    expect(noop.statusCode).toBe(204)
    expect(secKinds(store, user.id)).toEqual([])
    // 删本人真实存在的：预警一条。
    const del = await app.inject({ method: 'DELETE', url: '/api/auth/passkey/pk-id-1', headers: auth(token) })
    expect(del.statusCode).toBe(204)
    expect(secKinds(store, user.id)).toEqual(['security_passkey_removed'])
  })

  it('别人不能借删除接口给你记一条 passkey_removed（删他人 id 无副作用）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const victim = await regFull(app, 'pkvictim')
    const attacker = await regFull(app, 'pkatk')
    store.createPasskey({ id: 'victim-pk', userId: victim.user.id, credentialId: 'vc', publicKey: 'x', counter: 0, createdAt: Date.now() })
    // 攻击者用自己的 token 删受害者的 passkey id：deletePasskey 带 userId 归属过滤 → 删不到 → 不预警任何人。
    const del = await app.inject({ method: 'DELETE', url: '/api/auth/passkey/victim-pk', headers: auth(attacker.token) })
    expect(del.statusCode).toBe(204)
    expect(secKinds(store, victim.user.id)).toEqual([]) // 受害者的 passkey 仍在、未被预警
    expect(secKinds(store, attacker.user.id)).toEqual([]) // 攻击者没这把 passkey，existed=false
    expect(store.passkeysForUser(victim.user.id).length).toBe(1) // 未被删
  })

  it('notifyAccountSecurity(passkey_added) 写入 security_passkey_added（含"免密登录"提示）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const { user } = await regFull(app, 'pkadd')
    const u = store.findById(user.id)!
    notifyAccountSecurity(store, new NoopPushSender(), u, 'passkey_added')
    const n = store.notificationsForUser(user.id).find((x) => x.kind === 'security_passkey_added')!
    expect(n).toBeTruthy()
    expect(n.title).toBe('已新增通行密钥')
    expect(n.body).toContain('免密登录')
  })

  it('list 默认空且需鉴权；/api/me hasPasskey=false', async () => {
    const app = buildApp(new MemoryStore())
    const noauth = await app.inject({ method: 'GET', url: '/api/auth/passkey/list' })
    expect(noauth.statusCode).toBe(401)
    const token = await reg(app, 'pk3')
    const res = await app.inject({ method: 'GET', url: '/api/auth/passkey/list', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect((res.json() as any).passkeys).toEqual([])
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect((me.json() as any).user.hasPasskey).toBe(false)
  })

  it('register/verify 端级限流：连打超 10/min 被 429（防被盗令牌狂加 passkey 刷本人安全推送）', async () => {
    const app = buildApp(new MemoryStore())
    const token = await reg(app, 'pkrate')
    // 无挑战/dummy body：前 10 次走到处理器被拒(4xx)，第 11 次起 onRequest 限流 429（早于验签）。全局 300 远松，改前不 429。
    let limited = false
    for (let i = 0; i < 13; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/verify', headers: auth(token), payload: { response: {} } })
      if (res.statusCode === 429) { limited = true; break }
    }
    expect(limited).toBe(true)
  })
})

// 挑战表内存有界：未消费的挑战（请求 options 却不 verify，尤其未认证的 login/options 可被刷）超阈值时机会式清过期项，
// 防内存无界增长（同 CodeRegistry 惯例）。
describe('ChallengeStore 机会式清理', () => {
  it('超阈值时清掉已过期挑战、保留未过期；take 一次性', () => {
    const cs = new ChallengeStore(2) // 小阈值便于测
    cs.set('a', 'ca', -1)            // 已过期（ttl 负）
    cs.set('b', 'cb', -1)            // 已过期
    expect(cs.size).toBe(2)          // 未超阈值(2) → 不清
    cs.set('c', 'cc', 60_000)        // size=3 > 2 → 触发清理：a、b 过期删除，c 保留
    expect(cs.size).toBe(1)
    expect(cs.take('a')).toBeUndefined() // 已被清
    expect(cs.take('c')).toBe('cc')      // 有效挑战仍可取
    expect(cs.take('c')).toBeUndefined() // 一次性：取过即删
  })

  it('过期挑战即便未触发清理，take 也拒绝（一次性 + 时效双保险）', () => {
    const cs = new ChallengeStore()
    cs.set('x', 'cx', -1)            // 已过期
    expect(cs.take('x')).toBeUndefined() // 过期不返回（且已删除）
    expect(cs.size).toBe(0)
  })
})
