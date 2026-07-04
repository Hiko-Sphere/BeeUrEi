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
  sent: { token: string; title: string; body: string; extra?: Record<string, string>; threadId?: string; badge?: number }[] = []
  async send(): Promise<void> {}
  async sendCallInvite(): Promise<void> {}
  async sendAlert(token: string, title: string, body: string, extra?: Record<string, string>, threadId?: string, badge?: number): Promise<void> {
    this.sent.push({ token, title, body, extra, threadId, badge })
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

  it('新成员入群后未读从入群时刻算起（入群前历史不计未读）', async () => {
    const app = buildApp(new MemoryStore())
    const owner = await reg(app, 'gjo', 'blind')
    const m1 = await reg(app, 'gjm1', 'helper')
    const late = await reg(app, 'gjlate', 'helper')
    await bind(app, owner.token, m1.token, 'gjm1')
    await bind(app, owner.token, late.token, 'gjlate')
    const grp = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token), payload: { name: '晚到群', memberIds: [m1.user.id] } })
    const gid = (grp.json() as any).group.id
    for (const t of ['a', 'b', 'c']) await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token), payload: { groupId: gid, kind: 'text', text: t } })
    // late 入群（晚于那 3 条消息）
    expect((await app.inject({ method: 'POST', url: `/api/groups/${gid}/members`, headers: auth(owner.token), payload: { userId: late.user.id } })).statusCode).toBe(200)
    const find = (r: any) => (r.json() as any).groups.find((x: any) => x.group.id === gid).unread
    // late：入群前 3 条不计 → 未读 0；m1：建群起就在、未读该 3 条 → 未读 3（互不影响）
    expect(find(await app.inject({ method: 'GET', url: '/api/groups', headers: auth(late.token) }))).toBe(0)
    expect(find(await app.inject({ method: 'GET', url: '/api/groups', headers: auth(m1.token) }))).toBe(3)
    await app.close()
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

  it('群成员退群后，其历史视频对仍在群里的其他成员保持可见（不再 403）', async () => {
    const app = buildApp(new MemoryStore())
    const owner = await reg(app, 'gmo', 'blind')
    const a = await reg(app, 'gma', 'helper') // 视频发送者
    const b = await reg(app, 'gmb', 'helper') // 仍在群里的另一成员（与 a 非好友）
    await bind(app, owner.token, a.token, 'gma') // 建群要求成员是群主好友；a、b 彼此并非好友
    await bind(app, owner.token, b.token, 'gmb')
    const grp = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '出行', memberIds: [a.user.id, b.user.id] } })
    const gid = (grp.json() as any).group.id as string
    const bytes = Buffer.from('grp-video-bytes-xyz')
    const up = await app.inject({ method: 'POST', url: '/api/media', headers: { ...auth(a.token), 'content-type': 'video/mp4' }, payload: bytes })
    const mediaId = (up.json() as any).media.id as string
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, kind: 'video', text: mediaId } })
    // 基线：b（同群、非 a 好友）可下载 —— 走 sharesGroup
    expect((await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(b.token) })).statusCode).toBe(200)
    // a 退群（自我移除）
    expect((await app.inject({ method: 'DELETE', url: `/api/groups/${gid}/members/${a.user.id}`, headers: auth(a.token) })).statusCode).toBe(200)
    // 修复点：a 退群后 sharesGroup(b,a) 失效，但视频仍在群历史里 → b 应仍可下载（旧逻辑 403）
    expect((await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(b.token) })).statusCode).toBe(200)
    // 既非群成员又非好友的陌生人仍 403
    const stranger = await reg(app, 'gms', 'helper')
    expect((await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(stranger.token) })).statusCode).toBe(403)
    await app.close()
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

  it('被撤回的群消息不计入未读（驱动 App 图标角标/标签标题）', async () => {
    const app = buildApp(new MemoryStore())
    const a = await reg(app, 'unrc', 'blind')
    const b = await reg(app, 'unrd', 'helper')
    await bind(app, a.token, b.token, 'unrd')
    const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(a.token), payload: { name: 'G', memberIds: [b.user.id] } })
    const gid = (g.json() as any).group.id as string
    // a 发两条群消息 → b 群未读=2。
    const m1 = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, text: '第一条' } })
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, text: '第二条' } })
    expect(((await app.inject({ method: 'GET', url: '/api/unread', headers: auth(b.token) })).json() as any).messages).toBe(2)
    // a 撤回第一条 → b 群未读应降为 1（撤回消息 kind=recalled，不计未读）。
    const mid = (m1.json() as any).message.id as string
    const recall = await app.inject({ method: 'POST', url: `/api/messages/${mid}/recall`, headers: auth(a.token) })
    expect(recall.statusCode).toBe(200)
    expect(((await app.inject({ method: 'GET', url: '/api/unread', headers: auth(b.token) })).json() as any).messages).toBe(1)
  })

  it('被撤回的单聊消息不计入未读（与群口径一致，修复 direct/group 不对称）', async () => {
    const app = buildApp(new MemoryStore())
    const a = await reg(app, 'unre', 'blind')
    const b = await reg(app, 'unrf', 'helper')
    await bind(app, a.token, b.token, 'unrf')
    const d1 = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, text: '第一条' } })
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, text: '第二条' } })
    expect(((await app.inject({ method: 'GET', url: '/api/unread', headers: auth(b.token) })).json() as any).messages).toBe(2)
    // a 撤回第一条单聊 → b 单聊未读应降为 1（此前 unreadCount 未排除 recalled，会错误地仍计 2）。
    const did = (d1.json() as any).message.id as string
    expect((await app.inject({ method: 'POST', url: `/api/messages/${did}/recall`, headers: auth(a.token) })).statusCode).toBe(200)
    expect(((await app.inject({ method: 'GET', url: '/api/unread', headers: auth(b.token) })).json() as any).messages).toBe(1)
  })

  it('单聊推送携带 thread-id（按发送者分组）与 badge（收件人未读总数，递增）', async () => {
    const push = new FakePush()
    const app = buildApp(new MemoryStore(), { pushSender: push })
    const a = await reg(app, 'bdga', 'blind')
    const b = await reg(app, 'bdgb', 'helper')
    await bind(app, a.token, b.token, 'bdgb')
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(b.token), payload: { token: 'c'.repeat(64) } })
    // bind 给 b 写了 friend_request 通知（未读）——标已读隔离，让 badge 只反映聊天未读递增。
    await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: auth(b.token) })

    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, text: '第一条' } })
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, text: '第二条' } })
    expect(push.sent).toHaveLength(2)
    expect(push.sent[0].threadId).toBe(`dm:${a.user.id}`)
    expect(push.sent[0].badge).toBe(1) // 第一条后 b 未读=1
    expect(push.sent[1].badge).toBe(2) // 第二条后递增到 2
  })

  it('群成员变更通知：被加入/被踢/群解散都通知受影响成员（收件箱 + 推送）；退群/群主不通知自己', async () => {
    const push = new FakePush()
    const app = buildApp(new MemoryStore(), { pushSender: push })
    const owner = await reg(app, 'gowner', 'family')
    const m1 = await reg(app, 'gm1', 'blind')
    const m2 = await reg(app, 'gm2', 'blind')
    await bind(app, owner.token, m1.token, 'gm1')
    await bind(app, owner.token, m2.token, 'gm2')
    // m1 注册 APNs token，验证群通知除收件箱外也走推送。
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(m1.token), payload: { token: 'd'.repeat(64) } })

    // 建群含 m1 → m1 收到 group_added
    const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '家人群', memberIds: [m1.user.id] } })
    const gid = (g.json() as any).group.id
    const m1Notifs = () => app.inject({ method: 'GET', url: '/api/notifications', headers: auth(m1.token) }).then((r) => (r.json() as any).notifications)
    let n1 = await m1Notifs()
    const added = n1.find((n: any) => n.kind === 'group_added')
    expect(added).toBeTruthy()
    expect(added.body).toContain('家人群')
    expect(added.body).toContain('gowner')
    expect(added.data.groupId).toBe(gid)
    // 群主自己不收 group_added（建群者）
    const ownerNotifs = (await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(owner.token) })).json() as any
    expect(ownerNotifs.notifications.filter((n: any) => n.kind === 'group_added')).toHaveLength(0)

    // 加 m2 → m2 收到 group_added
    await app.inject({ method: 'POST', url: `/api/groups/${gid}/members`, headers: auth(owner.token), payload: { userId: m2.user.id } })
    const m2Notifs = (await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(m2.token) })).json() as any
    expect(m2Notifs.notifications.filter((n: any) => n.kind === 'group_added')).toHaveLength(1)

    // 群主踢 m2 → m2 收到 group_removed
    await app.inject({ method: 'DELETE', url: `/api/groups/${gid}/members/${m2.user.id}`, headers: auth(owner.token) })
    const m2After = (await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(m2.token) })).json() as any
    expect(m2After.notifications.filter((n: any) => n.kind === 'group_removed')).toHaveLength(1)

    // m1 自愿退群 → 不通知自己
    await app.inject({ method: 'DELETE', url: `/api/groups/${gid}/members/${m1.user.id}`, headers: auth(m1.token) })
    n1 = await m1Notifs()
    expect(n1.filter((n: any) => n.kind === 'group_removed')).toHaveLength(0)

    // 群解散：重建含 m1 的群，群主解散 → m1 收到 group_dissolved
    const g2 = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token),
      payload: { name: '临时群', memberIds: [m1.user.id] } })
    const gid2 = (g2.json() as any).group.id
    await app.inject({ method: 'DELETE', url: `/api/groups/${gid2}`, headers: auth(owner.token) })
    n1 = await m1Notifs()
    const dissolved = n1.find((n: any) => n.kind === 'group_dissolved')
    expect(dissolved).toBeTruthy()
    expect(dissolved.body).toContain('临时群')
    // 推送也走了（sendAlert 记录了群相关标题）
    expect(push.sent.some((s) => s.title.includes('群'))).toBe(true)
  })
})

describe('拉黑绕过防护：不能借群把互拉黑者拉进来骚扰（回归）', () => {
  // 背景：拉黑只加拉黑记录、**不解除底层绑定**（areLinked 仍 true）。单聊发送/表情回应已额外查 isBlockedBetween，
  // 建群/加人此前只查 areLinked → 被拉黑者可把拉黑自己的人拉进新群、借群消息骚扰，绕过 1:1 黑名单。
  const block = (app: ReturnType<typeof buildApp>, blockerToken: string, blockedUserId: string) =>
    app.inject({ method: 'POST', url: '/api/blocks', headers: auth(blockerToken), payload: { userId: blockedUserId } })

  it('建群：任一方向互拉黑 → 不能把对方作为初始成员（403 blocked，双向都挡）', async () => {
    const app = buildApp(new MemoryStore())
    const a = await reg(app, 'blkA'); const b = await reg(app, 'blkB')
    await bind(app, a.token, b.token, 'blkB') // 先成为好友
    await block(app, b.token, a.user.id)       // B 拉黑 A
    // A（被拉黑者）想把 B 拉进新群 → 挡
    const byA = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(a.token), payload: { name: '骚扰群', memberIds: [b.user.id] } })
    expect(byA.statusCode).toBe(403)
    expect(byA.json().error).toBe('blocked')
    // B（拉黑者）想把 A 拉进新群 → 同样挡（isBlockedBetween 双向）
    const byB = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(b.token), payload: { name: '群', memberIds: [a.user.id] } })
    expect(byB.statusCode).toBe(403)
    expect(byB.json().error).toBe('blocked')
    await app.close()
  })

  it('加人：群主不能把与自己互拉黑者加进已有群（403 blocked）', async () => {
    const app = buildApp(new MemoryStore())
    const owner = await reg(app, 'blkOwner'); const p = await reg(app, 'blkP'); const q = await reg(app, 'blkQ')
    await bind(app, owner.token, p.token, 'blkP')
    await bind(app, owner.token, q.token, 'blkQ')
    // 群主先与 Q 建群（正常），再拉黑 P
    const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token), payload: { name: '家人群', memberIds: [q.user.id] } })
    const gid = g.json().group.id as string
    await block(app, owner.token, p.user.id) // 群主拉黑 P
    const add = await app.inject({ method: 'POST', url: `/api/groups/${gid}/members`, headers: auth(owner.token), payload: { userId: p.user.id } })
    expect(add.statusCode).toBe(403)
    expect(add.json().error).toBe('blocked')
    await app.close()
  })

  it('未拉黑仍可正常建群/加人（不误伤）', async () => {
    const app = buildApp(new MemoryStore())
    const owner = await reg(app, 'okOwner'); const m = await reg(app, 'okM')
    await bind(app, owner.token, m.token, 'okM')
    const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token), payload: { name: '正常群', memberIds: [m.user.id] } })
    expect(g.statusCode).toBe(201)
    await app.close()
  })
})
