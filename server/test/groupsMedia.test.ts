import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { PushSender } from '../src/push/apns'
import { mediaFileExists } from '../src/media/storage'

// 媒体文件落到临时目录，避免污染仓库 data/。
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'beeurei-media-'))

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

describe('群聊', () => {
  it('建群要求成员是群主好友；群消息互发、未读、按人已读、推送全链路', async () => {
    const push = new FakePush()
    const app = buildApp(new MemoryStore(), { pushSender: push })
    const owner = await reg(app, 'gowner', 'blind')
    const mem = await reg(app, 'gmem', 'helper', 'en')
    const stranger = await reg(app, 'gstr', 'helper')
    await bind(app, owner.token, mem.token, 'gmem')

    // 含陌生人建群 → 403；只含好友 → 201。
    const bad = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '出行群', memberIds: [mem.user.id, stranger.user.id] } })
    expect(bad.statusCode).toBe(403)
    const ok = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '出行群', memberIds: [mem.user.id] } })
    expect(ok.statusCode).toBe(201)
    const gid = (ok.json() as any).group.id as string
    expect((ok.json() as any).group.memberIds).toEqual([owner.user.id, mem.user.id])

    // 非成员不能发群消息、不能读。
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(mem.token), payload: { token: 'a'.repeat(64) } })
    const noSend = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(stranger.token),
      payload: { groupId: gid, text: '我能进来吗' } })
    expect(noSend.statusCode).toBe(403)
    const noRead = await app.inject({ method: 'GET', url: `/api/messages?group=${gid}`, headers: auth(stranger.token) })
    expect(noRead.statusCode).toBe(403)

    // 群主发消息 → 成员收到推送（英文、带群名）、群列表未读 1。
    const s1 = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token),
      payload: { groupId: gid, text: '明天九点出发' } })
    expect(s1.statusCode).toBe(201)
    expect(push.sent.at(-1)?.title).toContain('出行群')
    expect(push.sent.at(-1)?.title).toContain('gowner')
    expect(push.sent.at(-1)?.extra?.groupId).toBe(gid)

    const lists = await app.inject({ method: 'GET', url: '/api/groups', headers: auth(mem.token) })
    const g = (lists.json() as any).groups[0]
    expect(g.unread).toBe(1)
    expect(g.last.text).toBe('明天九点出发')
    expect(g.members).toHaveLength(2)

    // 成员读消息并标已读 → 未读归零；自己发消息不计未读。
    const msgs = await app.inject({ method: 'GET', url: `/api/messages?group=${gid}`, headers: auth(mem.token) })
    expect((msgs.json() as any).messages).toHaveLength(1)
    await app.inject({ method: 'POST', url: '/api/messages/read', headers: auth(mem.token), payload: { groupId: gid } })
    const after = await app.inject({ method: 'GET', url: '/api/groups', headers: auth(mem.token) })
    expect((after.json() as any).groups[0].unread).toBe(0)
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(mem.token),
      payload: { groupId: gid, text: '收到' } })
    const mine = await app.inject({ method: 'GET', url: '/api/groups', headers: auth(mem.token) })
    expect((mine.json() as any).groups[0].unread).toBe(0) // 自己发的不算未读
  })

  it('成员管理：群主加人/踢人，成员退群，旁人无权；解散级联删消息', async () => {
    const app = buildApp(new MemoryStore())
    const owner = await reg(app, 'mowner', 'blind')
    const m1 = await reg(app, 'mmem1', 'helper')
    const m2 = await reg(app, 'mmem2', 'family')
    await bind(app, owner.token, m1.token, 'mmem1')
    await bind(app, owner.token, m2.token, 'mmem2')

    const created = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '小群', memberIds: [m1.user.id] } })
    const gid = (created.json() as any).group.id as string

    // 非群主不能加人；群主加 m2 成功；重复加 400。
    const notOwner = await app.inject({ method: 'POST', url: `/api/groups/${gid}/members`,
      headers: auth(m1.token), payload: { userId: m2.user.id } })
    expect(notOwner.statusCode).toBe(403)
    const add = await app.inject({ method: 'POST', url: `/api/groups/${gid}/members`,
      headers: auth(owner.token), payload: { userId: m2.user.id } })
    expect(add.statusCode).toBe(200)
    const dup = await app.inject({ method: 'POST', url: `/api/groups/${gid}/members`,
      headers: auth(owner.token), payload: { userId: m2.user.id } })
    expect(dup.statusCode).toBe(400)

    // m1 不能踢 m2；m2 可自己退群；群主可踢 m1；群主不能"退群"（须解散）。
    const kickByPeer = await app.inject({ method: 'DELETE', url: `/api/groups/${gid}/members/${m2.user.id}`, headers: auth(m1.token) })
    expect(kickByPeer.statusCode).toBe(403)
    const leave = await app.inject({ method: 'DELETE', url: `/api/groups/${gid}/members/${m2.user.id}`, headers: auth(m2.token) })
    expect(leave.statusCode).toBe(200)
    const kick = await app.inject({ method: 'DELETE', url: `/api/groups/${gid}/members/${m1.user.id}`, headers: auth(owner.token) })
    expect(kick.statusCode).toBe(200)
    const ownerLeave = await app.inject({ method: 'DELETE', url: `/api/groups/${gid}/members/${owner.user.id}`, headers: auth(owner.token) })
    expect(ownerLeave.statusCode).toBe(400)

    // 退群后 m1 看不到群、不能再发言。
    const m1Groups = await app.inject({ method: 'GET', url: '/api/groups', headers: auth(m1.token) })
    expect((m1Groups.json() as any).groups).toHaveLength(0)
    const m1Send = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(m1.token),
      payload: { groupId: gid, text: '还在吗' } })
    expect(m1Send.statusCode).toBe(403)

    // 解散：非群主 403，群主 200，群与消息消失。
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token),
      payload: { groupId: gid, text: '散了吧' } })
    const dissolveByPeer = await app.inject({ method: 'DELETE', url: `/api/groups/${gid}`, headers: auth(m1.token) })
    expect(dissolveByPeer.statusCode).toBe(403)
    const dissolve = await app.inject({ method: 'DELETE', url: `/api/groups/${gid}`, headers: auth(owner.token) })
    expect(dissolve.statusCode).toBe(200)
    const gone = await app.inject({ method: 'GET', url: `/api/messages?group=${gid}`, headers: auth(owner.token) })
    expect(gone.statusCode).toBe(404)
  })

  it('群消息表情回应：成员可回应，旁人不可', async () => {
    const app = buildApp(new MemoryStore())
    const owner = await reg(app, 'rowner', 'blind')
    const mem = await reg(app, 'rmem', 'helper')
    const out = await reg(app, 'rout', 'helper')
    await bind(app, owner.token, mem.token, 'rmem')
    const created = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '回应群', memberIds: [mem.user.id] } })
    const gid = (created.json() as any).group.id as string
    const sent = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token),
      payload: { groupId: gid, text: '今晚吃饺子' } })
    const mid = (sent.json() as any).message.id as string

    const react = await app.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`,
      headers: auth(mem.token), payload: { emoji: '❤️' } })
    expect(react.statusCode).toBe(200)
    expect((react.json() as any).message.reaction).toBe('❤️')
    const outsider = await app.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`,
      headers: auth(out.token), payload: { emoji: '😡' } })
    expect(outsider.statusCode).toBe(403)
  })
})

describe('视频消息（服务器磁盘媒体存储）', () => {
  it('上传/下载权限与视频消息全链路；撤回删除媒体文件', async () => {
    const app = buildApp(new MemoryStore())
    const a = await reg(app, 'vida', 'blind')
    const b = await reg(app, 'vidb', 'helper')
    const stranger = await reg(app, 'vidc', 'helper')
    await bind(app, a.token, b.token, 'vidb')

    // 上传：非视频 mime 415；合法 mp4 201。
    const badMime = await app.inject({ method: 'POST', url: '/api/media', headers: { ...auth(a.token), 'content-type': 'application/pdf' },
      payload: JSON.stringify({ nope: true }) })
    expect(badMime.statusCode).toBe(415)
    const bytes = Buffer.from('fake-mp4-bytes-0123456789')
    const up = await app.inject({ method: 'POST', url: '/api/media',
      headers: { ...auth(a.token), 'content-type': 'video/mp4' }, payload: bytes })
    expect(up.statusCode).toBe(201)
    const mediaId = (up.json() as any).media.id as string
    expect((up.json() as any).media.size).toBe(bytes.length)
    expect(mediaFileExists(mediaId)).toBe(true)

    // 下载：本人与绑定好友可取（内容一致），陌生人 403。
    const dlOwner = await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(a.token) })
    expect(dlOwner.statusCode).toBe(200)
    expect(dlOwner.headers['content-type']).toBe('video/mp4')
    expect(dlOwner.rawPayload.equals(bytes)).toBe(true)
    const dlFriend = await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(b.token) })
    expect(dlFriend.statusCode).toBe(200)
    const dlStranger = await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(stranger.token) })
    expect(dlStranger.statusCode).toBe(403)

    // 视频消息：text=mediaId；伪 id 或他人 id 拒绝。
    const fake = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'video', text: 'no-such-media' } })
    expect(fake.statusCode).toBe(400)
    const notMine = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(b.token),
      payload: { toId: a.user.id, kind: 'video', text: mediaId } })
    expect(notMine.statusCode).toBe(400) // media 属于 a，b 不能用
    const sent = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token),
      payload: { toId: b.user.id, kind: 'video', text: mediaId } })
    expect(sent.statusCode).toBe(201)
    const mid = (sent.json() as any).message.id as string

    // 撤回 → 消息变占位，媒体文件与元数据删除，下载 404。
    const recall = await app.inject({ method: 'POST', url: `/api/messages/${mid}/recall`, headers: auth(a.token) })
    expect(recall.statusCode).toBe(200)
    expect(mediaFileExists(mediaId)).toBe(false)
    const dlGone = await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(a.token) })
    expect(dlGone.statusCode).toBe(404)
  })

  it('群里发视频：同群成员可下载媒体；toId 与 groupId 不能同时传', async () => {
    const app = buildApp(new MemoryStore())
    const owner = await reg(app, 'gvowner', 'blind')
    const mem = await reg(app, 'gvmem', 'helper')
    await bind(app, owner.token, mem.token, 'gvmem')
    const created = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '视频群', memberIds: [mem.user.id] } })
    const gid = (created.json() as any).group.id as string

    const up = await app.inject({ method: 'POST', url: '/api/media',
      headers: { ...auth(owner.token), 'content-type': 'video/quicktime' }, payload: Buffer.from('mov-bytes') })
    const mediaId = (up.json() as any).media.id as string

    const both = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token),
      payload: { toId: mem.user.id, groupId: gid, kind: 'video', text: mediaId } })
    expect(both.statusCode).toBe(400) // 目标必须二选一

    const sent = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token),
      payload: { groupId: gid, kind: 'video', text: mediaId } })
    expect(sent.statusCode).toBe(201)
    expect((sent.json() as any).message.groupId).toBe(gid)

    const dl = await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(mem.token) })
    expect(dl.statusCode).toBe(200) // 同群成员可下载
  })
})

describe('会话内消息搜索', () => {
  it('单聊：按关键词搜文本、不区分大小写、时间倒序；非文本/非本会话不命中；越权 403', async () => {
    const app = buildApp(new MemoryStore())
    const a = await reg(app, 'srcha', 'blind')
    const b = await reg(app, 'srchb', 'helper')
    const c = await reg(app, 'srchc', 'helper')
    await bind(app, a.token, b.token, 'srchb')

    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, text: '明天去医院复查' } })
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(b.token), payload: { toId: a.user.id, text: 'Hospital at 9am' } })
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, text: '记得带身份证' } })
    // 图片消息含 "hospital" 也不应被文本搜索命中（仅 kind=text 可搜）。
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'image', text: 'data:image/jpeg;base64,AAAA' } })

    const r = await app.inject({ method: 'GET', url: `/api/messages/search?with=${b.user.id}&q=hospital`, headers: auth(a.token) })
    expect(r.statusCode).toBe(200)
    const msgs = (r.json() as any).messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('Hospital at 9am') // 大小写不敏感命中

    const zh = await app.inject({ method: 'GET', url: `/api/messages/search?with=${b.user.id}&q=${encodeURIComponent('复查')}`, headers: auth(a.token) })
    expect((zh.json() as any).messages).toHaveLength(1)

    // 空查询 → 空结果（不报错）。
    const empty = await app.inject({ method: 'GET', url: `/api/messages/search?with=${b.user.id}&q=`, headers: auth(a.token) })
    expect(empty.statusCode).toBe(200)
    expect((empty.json() as any).messages).toHaveLength(0)

    // 非绑定第三方搜该会话 → 403（不泄漏内容）。
    const forbidden = await app.inject({ method: 'GET', url: `/api/messages/search?with=${b.user.id}&q=hospital`, headers: auth(c.token) })
    expect(forbidden.statusCode).toBe(403)
  })

  it('群聊：成员可搜群内文本消息；非成员 403；LIKE 通配符按字面匹配', async () => {
    const app = buildApp(new MemoryStore())
    const owner = await reg(app, 'gsrcho', 'blind')
    const mem = await reg(app, 'gsrchm', 'helper')
    const out = await reg(app, 'gsrchx', 'helper')
    await bind(app, owner.token, mem.token, 'gsrchm')
    const created = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token), payload: { name: '搜群', memberIds: [mem.user.id] } })
    const gid = (created.json() as any).group.id as string
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token), payload: { groupId: gid, text: '周六聚餐 100%' } })
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(mem.token), payload: { groupId: gid, text: '好的' } })

    const r = await app.inject({ method: 'GET', url: `/api/messages/search?group=${gid}&q=${encodeURIComponent('聚餐')}`, headers: auth(mem.token) })
    expect((r.json() as any).messages).toHaveLength(1)
    // '%' 作字面量搜（不当通配符全匹配）。
    const pct = await app.inject({ method: 'GET', url: `/api/messages/search?group=${gid}&q=${encodeURIComponent('100%')}`, headers: auth(owner.token) })
    expect((pct.json() as any).messages).toHaveLength(1)
    // 非成员越权 403。
    const forbidden = await app.inject({ method: 'GET', url: `/api/messages/search?group=${gid}&q=${encodeURIComponent('聚餐')}`, headers: auth(out.token) })
    expect(forbidden.statusCode).toBe(403)
  })
})

describe('未读汇总 /api/unread', () => {
  it('汇总单聊 + 群聊 + 铃铛通知；读后归零；自己发的不计入', async () => {
    const app = buildApp(new MemoryStore())
    const a = await reg(app, 'unra', 'blind')
    const b = await reg(app, 'unrb', 'helper')
    await bind(app, a.token, b.token, 'unrb')

    // a 给 b 发两条单聊 → b 单聊未读=2。
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, text: '在吗' } })
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, text: '帮我看下' } })
    // 群聊：a 建群拉 b，a 发一条 → b 群未读=1。
    const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(a.token), payload: { name: 'G', memberIds: [b.user.id] } })
    const gid = (g.json() as any).group.id as string
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, text: '群里说一句' } })

    const u1 = await app.inject({ method: 'GET', url: '/api/unread', headers: auth(b.token) })
    expect(u1.statusCode).toBe(200)
    const body = u1.json() as { messages: number; notifications: number; total: number }
    expect(body.messages).toBe(3) // 2 单聊 + 1 群聊
    expect(body.total).toBe(body.messages + body.notifications)

    // b 读完单聊后，messages 应只剩群未读 1。
    await app.inject({ method: 'POST', url: '/api/messages/read', headers: auth(b.token), payload: { fromId: a.user.id } })
    const u2 = await app.inject({ method: 'GET', url: '/api/unread', headers: auth(b.token) })
    expect((u2.json() as any).messages).toBe(1)

    // 自己发的不计入自己的未读。
    const ua = await app.inject({ method: 'GET', url: '/api/unread', headers: auth(a.token) })
    expect((ua.json() as any).messages).toBe(0)
  })
})
