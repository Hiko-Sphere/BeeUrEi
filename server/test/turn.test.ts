import { describe, it, expect } from 'vitest'
import { turnCredentials, buildIceServers } from '../src/assist/turnCredentials'
import { createHmac } from 'node:crypto'

describe('turn credentials', () => {
  it('username is expiry timestamp and credential is HMAC-SHA1(base64)', () => {
    const now = 1_700_000_000_000
    const { username, credential } = turnCredentials('s3cret', 3600, now)
    expect(username).toBe(String(Math.floor(now / 1000) + 3600))
    const expected = createHmac('sha1', 's3cret').update(username).digest('base64')
    expect(credential).toBe(expected)
  })

  it('different ttl → different expiry username', () => {
    const now = 1_700_000_000_000
    expect(turnCredentials('s', 100, now).username).not.toBe(turnCredentials('s', 200, now).username)
  })

  it('buildIceServers includes TURN only when secret + turn urls present', () => {
    const stun = ['stun:stun.l.google.com:19302']
    const onlyStun = buildIceServers({ stun, turn: [], ttlSeconds: 3600, nowMs: 0 })
    expect(onlyStun).toHaveLength(1)
    expect(onlyStun[0].username).toBeUndefined()

    const withTurn = buildIceServers({ stun, turn: ['turn:turn.example.com:3478'], secret: 'x', ttlSeconds: 3600, nowMs: 0 })
    expect(withTurn).toHaveLength(2)
    expect(withTurn[1].username).toBeTruthy()
    expect(withTurn[1].credential).toBeTruthy()
  })

  it('no TURN without secret even if urls given', () => {
    const servers = buildIceServers({ stun: ['stun:x'], turn: ['turn:y'], ttlSeconds: 3600, nowMs: 0 })
    expect(servers).toHaveLength(1)
  })
})
