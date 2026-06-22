import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { totpAt } from '../src/auth/totp'

function app() { return buildApp(new MemoryStore()) }
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function reg(a: ReturnType<typeof buildApp>, username: string) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return r.json() as { token: string; refreshToken: string }
}

// 完整开启 2FA，返回 secret 与恢复码。
async function enable2FA(a: ReturnType<typeof buildApp>, token: string) {
  const setup = await a.inject({ method: 'POST', url: '/api/account/2fa/setup', headers: auth(token) })
  expect(setup.statusCode).toBe(200)
  const { secret, otpauthUri } = setup.json() as { secret: string; otpauthUri: string }
  expect(secret.length).toBeGreaterThan(10)
  expect(otpauthUri).toContain('otpauth://totp/')
  const code = totpAt(secret, Date.now())
  const en = await a.inject({ method: 'POST', url: '/api/account/2fa/enable', headers: auth(token), payload: { code } })
  expect(en.statusCode).toBe(200)
  const { recoveryCodes } = en.json() as { recoveryCodes: string[] }
  expect(recoveryCodes).toHaveLength(10)
  return { secret, recoveryCodes }
}

describe('2FA (TOTP)', () => {
  it('enables 2FA, then login requires a valid TOTP code', async () => {
    const a = app()
    const { token } = await reg(a, 'tfa1')
    const { secret } = await enable2FA(a, token)

    // /api/me 反映已开启
    const me = await a.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect((me.json() as any).user.twoFactorEnabled).toBe(true)

    // 无验证码登录 → two_factor_required
    const noCode = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tfa1', password: 'secret123' } })
    expect(noCode.statusCode).toBe(401)
    expect((noCode.json() as any).error).toBe('two_factor_required')

    // 错误验证码 → invalid_2fa
    const wrong = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tfa1', password: 'secret123', totpCode: '000000' } })
    expect(wrong.statusCode).toBe(401)
    expect((wrong.json() as any).error).toBe('invalid_2fa')

    // 正确验证码 → 登录成功（用下一时间步的码，避免与「启用」所用码同一步被单次防重放拦下）
    const freshCode = totpAt(secret, Date.now() + 30_000)
    const ok = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tfa1', password: 'secret123', totpCode: freshCode } })
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as any).token).toBeTruthy()

    // 单次使用防重放：同一个 TOTP 码不可再次登录
    const replay = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tfa1', password: 'secret123', totpCode: freshCode } })
    expect(replay.statusCode).toBe(401)
    expect((replay.json() as any).error).toBe('invalid_2fa')
    await a.close()
  })

  it('accepts a one-time recovery code in place of TOTP, and consumes it', async () => {
    const a = app()
    const { token } = await reg(a, 'tfa2')
    const { recoveryCodes } = await enable2FA(a, token)
    const rc = recoveryCodes[0]

    // 用恢复码登录成功
    const ok = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tfa2', password: 'secret123', totpCode: rc } })
    expect(ok.statusCode).toBe(200)

    // 同一恢复码二次使用失败（一次性）
    const again = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tfa2', password: 'secret123', totpCode: rc } })
    expect(again.statusCode).toBe(401)
    expect((again.json() as any).error).toBe('invalid_2fa')

    // 剩余恢复码数 -1
    const status = await a.inject({ method: 'GET', url: '/api/account/2fa', headers: auth(token) })
    expect((status.json() as any).recoveryCodesRemaining).toBe(9)
    await a.close()
  })

  it('disable requires a valid factor, then login no longer needs a code', async () => {
    const a = app()
    const { token } = await reg(a, 'tfa3')
    const { secret } = await enable2FA(a, token)

    // 错误码无法关闭
    const bad = await a.inject({ method: 'POST', url: '/api/account/2fa/disable', headers: auth(token), payload: { code: '000000' } })
    expect(bad.statusCode).toBe(400)

    // 正确码关闭（用下一时间步的码，避开与「启用」同一步的单次防重放）
    const off = await a.inject({ method: 'POST', url: '/api/account/2fa/disable', headers: auth(token), payload: { code: totpAt(secret, Date.now() + 30_000) } })
    expect(off.statusCode).toBe(200)

    // 关闭后登录无需验证码
    const ok = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tfa3', password: 'secret123' } })
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as any).user.twoFactorEnabled).toBe(false)
    await a.close()
  })

  it('enable with wrong code is rejected; secret never leaks via /api/me', async () => {
    const a = app()
    const { token } = await reg(a, 'tfa4')
    await a.inject({ method: 'POST', url: '/api/account/2fa/setup', headers: auth(token) })
    const bad = await a.inject({ method: 'POST', url: '/api/account/2fa/enable', headers: auth(token), payload: { code: '123456' } })
    expect(bad.statusCode).toBe(400)
    const me = await a.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    const body = me.json() as any
    expect(body.user.twoFactorEnabled).toBe(false)
    expect(JSON.stringify(body)).not.toContain('totpSecret')
    await a.close()
  })
})
