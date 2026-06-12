import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { PushSender } from '../src/push/apns'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

class FakePush implements PushSender {
  sent: { token: string; title: string; body: string; extra?: Record<string, string> }[] = []
  async send(): Promise<void> {}
  async sendCallInvite(): Promise<void> {}
  async sendAlert(token: string, title: string, body: string, extra?: Record<string, string>): Promise<void> {
    this.sent.push({ token, title, body, extra })
  }
}

async function reg(app: ReturnType<typeof buildApp>, username: string, role = 'blind', language?: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register',
    payload: { username, password: 'secret123', role, language } })
  return res.json() as { token: string; user: { id: string } }
}

/// 建立 accepted 绑定：owner 发起 → member 接受。
async function bind(app: ReturnType<typeof buildApp>, ownerToken: string, memberToken: string, memberUsername: string) {
  await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(ownerToken),
    payload: { username: memberUsername, relation: '亲友' } })
  const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(memberToken) })
  const id = (inc.json() as any).links[0].id as string
  await app.inject({ method: 'POST', url: `/api/family/links/${id}/accept`, headers: auth(memberToken) })
}

describe('摔倒/车祸紧急警报', () => {
  it('通知所有 accepted 绑定亲友（按收件人语言），pending 不通知', async () => {
    const push = new FakePush()
    const app = buildApp(new MemoryStore(), { pushSender: push })
    const blind = await reg(app, 'blind1', 'blind')
    const fam = await reg(app, 'fam1', 'helper', 'en')
    const stranger = await reg(app, 'stranger', 'helper')
    await bind(app, blind.token, fam.token, 'fam1')
    // 绑定第二人但不接受（pending）。
    await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token),
      payload: { username: 'stranger', relation: '亲友' } })
    // 双方注册 APNs token。
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(fam.token), payload: { token: 'a'.repeat(64) } })
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(stranger.token), payload: { token: 'b'.repeat(64) } })

    const res = await app.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth(blind.token),
      payload: { kind: 'fall', lat: 39.9, lon: 116.4 } })
    expect(res.statusCode).toBe(200)
    expect((res.json() as any).notified).toBe(1) // 仅 accepted 的 fam1
    expect(push.sent).toHaveLength(1)
    
    expect(push.sent[0].title).toContain('blind1') // 收件人英文 → 英文文案
    expect(push.sent[0].title).toContain('Emergency')
    expect(push.sent[0].extra?.lat).toBe('39.9')
    expect(push.sent[0].extra?.kind).toBe('fall')
  })

  it('非法 kind 拒绝', async () => {
    const app = buildApp(new MemoryStore())
    const blind = await reg(app, 'blind2', 'blind')
    const res = await app.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth(blind.token),
      payload: { kind: 'oops' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('聊天（绑定好友互发）', () => {
  it('未绑定不能发（403）；绑定后互发、会话列表、未读、已读回执全链路', async () => {
    const push = new FakePush()
    const app = buildApp(new MemoryStore(), { pushSender: push })
    const a = await reg(app, 'alice', 'blind')
    const b = await reg(app, 'bob', 'helper', 'en')

    const early = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, text: '你好' } })
    expect(early.statusCode).toBe(403) // 未绑定

    await bind(app, a.token, b.token, 'bob')
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(b.token), payload: { token: 'c'.repeat(64) } })

    const s1 = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, text: '你好，今天能陪我去医院吗' } })
    expect(s1.statusCode).toBe(201)
    expect(push.sent.at(-1)?.title).toContain('alice') // 新消息推送（英文收件人）
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(b.token),
      payload: { toId: a.user.id, text: '好的，十点来接你' } })

    // bob 的会话列表：与 alice 的对话、未读 1。
    const convs = await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(b.token) })
    const list = (convs.json() as any).conversations
    expect(list).toHaveLength(1)
    expect(list[0].peer.username).toBe('alice')
    expect(list[0].unread).toBe(1)

    // bob 读取消息（时间正序两条）→ 标已读 → 未读归零，alice 能看到已读回执。
    const msgs = await app.inject({ method: 'GET', url: `/api/messages?with=${a.user.id}`, headers: auth(b.token) })
    expect((msgs.json() as any).messages).toHaveLength(2)
    await app.inject({ method: 'POST', url: '/api/messages/read', headers: auth(b.token),
      payload: { fromId: a.user.id } })
    const convs2 = await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(b.token) })
    expect((convs2.json() as any).conversations[0].unread).toBe(0)
    const fromA = await app.inject({ method: 'GET', url: `/api/messages?with=${b.user.id}`, headers: auth(a.token) })
    const mine = (fromA.json() as any).messages.find((m: any) => m.fromId === a.user.id)
    expect(mine.readAt).toBeTruthy() // 已读回执
  })

  it('语音条：合法 data URL 接受，非音频拒绝；拉黑后不能发', async () => {
    const app = buildApp(new MemoryStore())
    const a = await reg(app, 'ann3', 'blind')
    const b = await reg(app, 'bob3', 'helper')
    await bind(app, a.token, b.token, 'bob3')

    const audio = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'audio', text: 'data:audio/m4a;base64,AAAA' } })
    expect(audio.statusCode).toBe(201)
    const bad = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'audio', text: 'data:image/png;base64,AAAA' } })
    expect(bad.statusCode).toBe(400)

    // b 拉黑 a → a 不能再发。
    await app.inject({ method: 'POST', url: '/api/blocks', headers: auth(b.token), payload: { userId: a.user.id } })
    const blocked = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, text: 'hello?' } })
    expect(blocked.statusCode).toBe(403)
  })

  it('位置消息：合法坐标接受、越界/非 JSON 拒绝；会话预览为占位文案', async () => {
    const push = new FakePush()
    const app = buildApp(new MemoryStore(), { pushSender: push })
    const a = await reg(app, 'loca', 'blind')
    const b = await reg(app, 'locb', 'helper', 'en')
    await bind(app, a.token, b.token, 'locb')
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(b.token), payload: { token: 'd'.repeat(64) } })

    const ok = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'location', text: JSON.stringify({ lat: 31.23, lng: 121.47, name: '上海市黄浦区' }) } })
    expect(ok.statusCode).toBe(201)
    expect((ok.json() as any).message.kind).toBe('location')
    expect(push.sent.at(-1)?.body).toBe('[Location]') // 英文收件人推送预览

    const outOfRange = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'location', text: JSON.stringify({ lat: 200, lng: 0 }) } })
    expect(outOfRange.statusCode).toBe(400)

    const notJson = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'location', text: 'not-json' } })
    expect(notJson.statusCode).toBe(400)
  })

  it('图片消息、撤回（仅本人 2 分钟内）、表情回应全链路', async () => {
    const app = buildApp(new MemoryStore())
    const a = await reg(app, 'pica', 'blind')
    const b = await reg(app, 'picb', 'helper')
    await bind(app, a.token, b.token, 'picb')

    // 图片：合法 data URL 接受；非图片 400。
    const img = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'image', text: 'data:image/jpeg;base64,AAAA' } })
    expect(img.statusCode).toBe(201)
    const badImg = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'image', text: 'data:audio/m4a;base64,AAAA' } })
    expect(badImg.statusCode).toBe(400)

    const sent = (img.json() as any).message
    // 对方（b）给图片点赞回应（最新覆盖）。
    const react = await app.inject({ method: 'POST', url: `/api/messages/${sent.id}/reaction`,
      headers: auth(b.token), payload: { emoji: '👍' } })
    expect(react.statusCode).toBe(200)
    expect((react.json() as any).message.reaction).toBe('👍')
    // 旁人不能回应。
    const c = await reg(app, 'picc', 'helper')
    const outsider = await app.inject({ method: 'POST', url: `/api/messages/${sent.id}/reaction`,
      headers: auth(c.token), payload: { emoji: '😡' } })
    expect(outsider.statusCode).toBe(403)

    // 撤回：对方不能撤、本人可撤 → 双方看到 recalled 占位、回应清空。
    const notYours = await app.inject({ method: 'POST', url: `/api/messages/${sent.id}/recall`, headers: auth(b.token) })
    expect(notYours.statusCode).toBe(403)
    const recall = await app.inject({ method: 'POST', url: `/api/messages/${sent.id}/recall`, headers: auth(a.token) })
    expect(recall.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: `/api/messages?with=${a.user.id}`, headers: auth(b.token) })
    const m = (list.json() as any).messages.find((x: any) => x.id === sent.id)
    expect(m.kind).toBe('recalled')
    expect(m.text).toBe('')
    expect(m.reaction ?? null).toBeNull()
  })
})
