import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type WebPushSubscription } from '../src/db/store'
import type { PushSender } from '../src/push/apns'
import type { WebPushSender } from '../src/push/webPush'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

class FakePush implements PushSender {
  sent: string[] = []
  async send(): Promise<void> {}
  async sendCallInvite(): Promise<void> {}
  async sendAlert(token: string): Promise<void> { this.sent.push(token) }
}
// 迫使推送投递走 webPushSubscriptionsForUser 同步读路径。
class ConfiguredWebPush implements WebPushSender {
  readonly configured = true
  async send(): Promise<void> {}
}
// 模拟 better-sqlite3 在 SQLITE_BUSY/IOERR 时**同步抛**的那个读——推送投递路径踩到它绝不能 500 主操作/掐断扇出。
class ThrowingSubsStore extends MemoryStore {
  webPushSubscriptionsForUser(_userId: string): WebPushSubscription[] {
    throw new Error('SQLITE_BUSY: database is locked')
  }
}

async function reg(app: ReturnType<typeof buildApp>, username: string, role = 'blind') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', role } })
  return res.json() as { token: string; user: { id: string } }
}
async function bind(app: ReturnType<typeof buildApp>, ownerToken: string, memberToken: string, memberUsername: string) {
  await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(ownerToken), payload: { username: memberUsername, relation: '亲友' } })
  const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(memberToken) })
  const id = (inc.json() as any).links[0].id as string
  await app.inject({ method: 'POST', url: `/api/family/links/${id}/accept`, headers: auth(memberToken) })
}

// 通知扇出/投递路径里的同步 store 读抛错，绝不能 500 已提交的主操作，也不能掐断对其余收件人的推送。
// （SOS 扇出复审揪出该类后，横扫 notifyUser/群消息/来电 等同款路径补齐——本用例守其中两条最关键的。）
describe('通知投递对同步 store 读抛错的故障隔离', () => {
  it('notifyUser：好友请求的推送读抛错不 500 主操作，绑定仍建立', async () => {
    const app = buildApp(new ThrowingSubsStore(), { pushSender: new FakePush(), webPushSender: new ConfiguredWebPush() })
    const owner = await reg(app, 'nowner', 'blind')
    const target = await reg(app, 'ntarget', 'helper') // 无 apnsToken → 直接踩 webPush 订阅读

    // 加好友：主操作是建立 pending 绑定；notifyUser 给 target 发 friend_request 时会同步读 web 订阅→抛。
    const res = await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token),
      payload: { username: 'ntarget', relation: '亲友' } })
    expect(res.statusCode).toBeLessThan(300) // 不因推送读抛错 500

    // 关键：主操作（绑定请求）确实生效——target 能在 incoming 看到它。
    const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(target.token) })
    expect((inc.json() as any).links.length).toBe(1)
    await app.close()
  })

  it('群消息：单成员的推送读抛错不 500、消息只存一次（防发送方重试重复群发）', async () => {
    const push = new FakePush()
    const app = buildApp(new ThrowingSubsStore(), { pushSender: push, webPushSender: new ConfiguredWebPush() })
    const owner = await reg(app, 'growner', 'blind')
    const mem = await reg(app, 'grmem', 'helper')
    await bind(app, owner.token, mem.token, 'grmem')
    const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '出行群', memberIds: [mem.user.id] } })
    const gid = (g.json() as any).group.id as string

    const s1 = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token),
      payload: { groupId: gid, text: '明天九点出发' } })
    expect(s1.statusCode).toBe(201) // web 订阅读抛错不再 500 已存库的群消息

    // 消息只存一次：mem 读群消息恰一条（若曾 500，发送方重试会重复群发）。
    const msgs = await app.inject({ method: 'GET', url: `/api/messages?group=${gid}`, headers: auth(mem.token) })
    expect((msgs.json() as any).messages.filter((m: any) => m.text === '明天九点出发')).toHaveLength(1)
    await app.close()
  })
})
