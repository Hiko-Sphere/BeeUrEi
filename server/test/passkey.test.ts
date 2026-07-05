import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { ChallengeStore } from '../src/routes/passkey'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function reg(app: ReturnType<typeof buildApp>, username = 'pk1') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return (r.json() as any).token as string
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
