import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

// 媒体落盘到临时目录。
beforeAll(() => { process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'beeurei-webm-')) })

const auth = (t: string) => ({ authorization: `Bearer ${t}` })
function admin(): User {
  return { id: 'adm', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
}
async function reg(app: ReturnType<typeof buildApp>, username: string) {
  const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })).json()
  return { token: r.token as string, id: r.user.id as string }
}

/// 回归：网页端 MediaRecorder 录制为 webm（Chrome），服务端必须接受并能回放——
/// 此前 /api/media 只收 mp4/quicktime，致网页录制上传 415、无法保存（用户反馈"录制无法使用"）。
describe('网页端 webm 通话录制（修复 415 上传被拒）', () => {
  it('webm（带 codecs 参数）上传成功 → 建录制 → 流式回放返回 video/webm', async () => {
    const store = new MemoryStore()
    store.createUser(admin())
    const app = buildApp(store)
    const at = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string
    await app.inject({ method: 'PUT', url: '/api/recordings/config', headers: auth(at), payload: { enabled: true, requireConsent: true, retentionDays: 7 } })

    const owner = await reg(app, 'webhelper')   // 网页协助者（录制方）
    const peer = await reg(app, 'blinduser')
    store.createLink({ id: randomUUID(), ownerId: peer.id, memberId: owner.id, relation: 'helper', isEmergency: false, status: 'accepted', createdAt: Date.now() })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(owner.token), payload: { callId: 'callW', targetUserIds: [peer.id] } })
    await app.inject({ method: 'POST', url: '/api/recordings/consent', headers: auth(peer.token), payload: { callId: 'callW', granted: true } })

    // 上传 webm（content-type 带 codecs 参数，模拟浏览器真实输出）。
    const bytes = Buffer.from('FAKE-WEBM-BYTES-0123456789-abcdefghijklmnopqrstuvwxyz')
    const up = await app.inject({ method: 'POST', url: '/api/media', headers: { ...auth(owner.token), 'content-type': 'video/webm;codecs=vp9,opus' }, payload: bytes })
    expect(up.statusCode).toBe(201)
    const mediaId = up.json().media.id as string
    expect(up.json().media.mime).toBe('video/webm') // codecs 参数被剥离后存储

    // 建录制。
    const create = await app.inject({ method: 'POST', url: '/api/recordings', headers: auth(owner.token), payload: { callId: 'callW', reason: 'call', mediaId, durationSec: 42 } })
    expect(create.statusCode).toBe(201)
    const recId = create.json().recording.id as string

    // 取播放令牌 + 流式回放，确认 content-type 为 webm（浏览器 <video> 可播）。
    const tok = await app.inject({ method: 'GET', url: `/api/recordings/${recId}/play-token`, headers: auth(owner.token) })
    expect(tok.statusCode).toBe(200)
    const token = tok.json().token as string
    const media = await app.inject({ method: 'GET', url: `/api/recordings/${recId}/media?t=${encodeURIComponent(token)}` })
    expect([200, 206]).toContain(media.statusCode)
    expect(media.headers['content-type']).toContain('video/webm')

    await app.close()
  })

  it('纯音频 webm（audio/webm）也被接受', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const u = await reg(app, 'audiouser')
    const up = await app.inject({ method: 'POST', url: '/api/media', headers: { ...auth(u.token), 'content-type': 'audio/webm;codecs=opus' }, payload: Buffer.from('FAKE-AUDIO-WEBM-0123456789') })
    expect(up.statusCode).toBe(201)
    expect(up.json().media.mime).toBe('audio/webm')
    await app.close()
  })
})
