import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { signAccessToken, signMediaToken, signWsToken, verifyAccessToken, verifyMediaToken, verifyWsToken } from '../src/auth/tokens'

// 令牌作用域隔离（防混淆提权）：媒体播放令牌(scope='media')与完整 access token 用同一 SECRET 签发，
// 但严格窄权。媒体令牌绝不能被当作 access token 接受——否则嵌在 <video src> URL 里的令牌一旦泄漏即等于
// 泄漏整账号 60s 全权访问（见对抗复审 token-confusion）。
describe('令牌作用域隔离（防混淆提权）', () => {
  it('单元：媒体令牌不得过 verifyAccessToken；access token 不得过 verifyMediaToken（双向隔离）', () => {
    const media = signMediaToken({ sub: 'u1', role: 'blind', rec: 'r1', tv: 0 })
    expect(verifyAccessToken(media)).toBeNull()            // 修复点：带 scope=media 一律拒（此前被当 access 接受）
    expect(verifyMediaToken(media, 'r1')?.sub).toBe('u1')  // 仍能正常经媒体校验消费（不影响播放）

    const access = signAccessToken({ sub: 'u1', role: 'blind', tv: 0 })
    expect(verifyAccessToken(access)?.sub).toBe('u1')      // access token 正常通过
    expect(verifyMediaToken(access, 'r1')).toBeNull()      // 反向已安全：无 scope → 拒
  })

  it('集成：拿媒体令牌塞进 Authorization: Bearer 打鉴权端点 → 401（不给整账号访问）；真 access token → 200', async () => {
    const app = buildApp(new MemoryStore())
    const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'tkuser', password: 'secret123', role: 'blind' } })).json()
    const uid = reg.user.id as string
    // 为该用户签一枚媒体令牌（等同 /api/recordings/:id/media-token 会下发、并嵌进播放 URL 的那种）。
    const media = signMediaToken({ sub: uid, role: 'blind', rec: 'anyrec', tv: 0 })

    // 媒体令牌当 Bearer 打一个 requireAuth 端点 → 必须 401（修前会被当完整 access token、返回 200 泄漏私信收件箱）。
    const withMedia = await app.inject({ method: 'GET', url: '/api/notifications', headers: { authorization: `Bearer ${media}` } })
    expect(withMedia.statusCode).toBe(401)
    // 真 access token 照常 200（证明修复不误伤正常鉴权）。
    const withAccess = await app.inject({ method: 'GET', url: '/api/notifications', headers: { authorization: `Bearer ${reg.token}` } })
    expect(withAccess.statusCode).toBe(200)
    await app.close()
  })

  it('单元：信令令牌(scope=ws)不得过 verifyAccessToken；access token 不得过 verifyWsToken（双向隔离）', () => {
    const ws = signWsToken({ sub: 'u1', role: 'blind', tv: 0 })
    expect(verifyAccessToken(ws)).toBeNull()      // scope=ws 不能当完整 access token（WS URL 泄漏进日志也无害）
    expect(verifyWsToken(ws)?.sub).toBe('u1')     // 仍能正常经 WS 握手校验
    const access = signAccessToken({ sub: 'u1', role: 'blind', tv: 0 })
    expect(verifyWsToken(access)).toBeNull()       // access token 无 scope → WS 校验拒
  })

  it('集成：信令令牌当 Bearer 打鉴权端点 → 401（不给整账号访问）', async () => {
    const app = buildApp(new MemoryStore())
    const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'wsu', password: 'secret123', role: 'blind' } })).json()
    const ws = signWsToken({ sub: reg.user.id, role: 'blind', tv: 0 })
    expect((await app.inject({ method: 'GET', url: '/api/notifications', headers: { authorization: `Bearer ${ws}` } })).statusCode).toBe(401)
    await app.close()
  })
})
