import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

// admin 总览暴露「通话连接失败」计数（把 /api/assist/call-failure 上报呈现在运维实际看的面板，无需 Prometheus）。
function seed() {
  const store = new MemoryStore()
  const admin: User = { id: 'a1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
  store.createUser(admin)
  return buildApp(store)
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

describe('admin 总览 callConnect（通话连接失败可观测）', () => {
  it('上报的 relay_unreachable/generic 反映到 overview.callConnect；初始全 0', async () => {
    const app = seed()
    const adminTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string
    const helperTok = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'helper1', password: 'secret123', role: 'helper' } })).json().token as string

    const ov0 = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(adminTok) })).json()
    expect(ov0.callConnect).toEqual({ relayUnreachable: 0, generic: 0, signaling: 0 })

    // 客户端上报两条 relay 不可达 + 一条 generic。
    await app.inject({ method: 'POST', url: '/api/assist/call-failure', headers: auth(helperTok), payload: { reason: 'relay_unreachable' } })
    await app.inject({ method: 'POST', url: '/api/assist/call-failure', headers: auth(helperTok), payload: { reason: 'relay_unreachable' } })
    await app.inject({ method: 'POST', url: '/api/assist/call-failure', headers: auth(helperTok), payload: { reason: 'generic' } })

    const ov1 = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(adminTok) })).json()
    expect(ov1.callConnect).toEqual({ relayUnreachable: 2, generic: 1, signaling: 0 })
    await app.close()
  })
})
