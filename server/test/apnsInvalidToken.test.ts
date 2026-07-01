import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { ApnsPushSender, ApnsError, shouldInvalidateToken } from '../src/push/apns'
import { MemoryStore, type User } from '../src/db/store'

// 生成一个 P-256 私钥仅为满足构造函数（测试覆盖 post、不真正签名或发网络）。
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

// 可控 post 结果的子类：模拟 APNs 返回不同状态，验证 token 回收逻辑（真实 http2 无法在测试触发）。
class FakeApns extends ApnsPushSender {
  constructor(private result: 'ok' | number, onInvalid: (t: string) => void) {
    super(privateKey, 'kid', 'team', 'com.x.voip', 'host', 'com.x', onInvalid)
  }
  protected async post(): Promise<void> {
    if (this.result === 'ok') return
    throw new ApnsError(this.result, `APNs ${this.result}`)
  }
}

describe('shouldInvalidateToken：仅 410 回收', () => {
  it('410 → true；其余（0/2xx/4xx/429/5xx）→ false', () => {
    expect(shouldInvalidateToken(410)).toBe(true)
    for (const s of [0, 200, 400, 403, 404, 429, 500, 503]) expect(shouldInvalidateToken(s)).toBe(false)
  })
})

describe('ApnsPushSender：410 回收 token，其它状态一律保留', () => {
  it('sendAlert 收到 410 → 回调该 apnsToken', async () => {
    const seen: string[] = []
    await new FakeApns(410, (t) => seen.push(t)).sendAlert('DEADTOKEN', 'a', 'b')
    expect(seen).toEqual(['DEADTOKEN'])
  })
  it('sendCallInvite 收到 410 → 回调该 voipToken', async () => {
    const seen: string[] = []
    await new FakeApns(410, (t) => seen.push(t)).sendCallInvite('DEADVOIP', 'c1', 'name', 'caller')
    expect(seen).toEqual(['DEADVOIP'])
  })
  it('暂时性/配置类失败（500/429/400/超时0）绝不回收——避免误删有效 token 使用户静默失联', async () => {
    for (const s of [500, 429, 400, 0]) {
      const seen: string[] = []
      await new FakeApns(s, (t) => seen.push(t)).sendAlert('KEEP', 'a', 'b')
      expect(seen, `status ${s} 不应清 token`).toEqual([])
    }
  })
  it('成功（200）不回收', async () => {
    const seen: string[] = []
    await new FakeApns('ok', (t) => seen.push(t)).sendAlert('KEEP', 'a', 'b')
    expect(seen).toEqual([])
  })
})

describe('MemoryStore.clearPushToken', () => {
  const mkUser = (id: string, over: Partial<User>): User => ({
    id, username: id, passwordHash: 'h', displayName: id, role: 'blind', status: 'active', createdAt: 1, ...over,
  })
  it('清除匹配的 apns/voip token，不误伤他人、不误伤同用户的另一 token', () => {
    const s = new MemoryStore()
    s.createUser(mkUser('u1', { apnsToken: 'A', voipToken: 'V' }))
    s.createUser(mkUser('u2', { apnsToken: 'OTHER' }))
    s.clearPushToken('A')
    expect(s.findById('u1')?.apnsToken).toBeUndefined()
    expect(s.findById('u1')?.voipToken).toBe('V') // 不同 token 不受影响
    expect(s.findById('u2')?.apnsToken).toBe('OTHER') // 他人不受影响
    s.clearPushToken('V')
    expect(s.findById('u1')?.voipToken).toBeUndefined()
  })
})
