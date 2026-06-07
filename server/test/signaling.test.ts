import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function nextMessage(ws: WebSocket, predicate: (m: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (predicate(msg)) resolve(msg)
    })
  })
}

function open(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.on('open', () => resolve()))
}

describe('WebRTC signaling relay', () => {
  it('relays offer and video-gate between two peers in the same call', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const reg = async (u: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123' } })).json().token
    const tCaller = await reg('caller')
    const tHelper = await reg('helper')

    const base = `ws://127.0.0.1:${port}/ws`
    const ws1 = new WebSocket(`${base}?token=${tCaller}`)
    const ws2 = new WebSocket(`${base}?token=${tHelper}`)
    await Promise.all([open(ws1), open(ws2)])

    const joined1 = nextMessage(ws1, (m) => m.type === 'joined')
    const joined2 = nextMessage(ws2, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'blind' }))
    ws2.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'helper' }))
    await Promise.all([joined1, joined2])

    // helper should receive caller's offer
    const offerAtHelper = nextMessage(ws2, (m) => m.type === 'offer')
    ws1.send(JSON.stringify({ type: 'offer', sdp: 'SDP_X' }))
    const offer = await offerAtHelper
    expect(offer.sdp).toBe('SDP_X')

    // caller should receive helper's video-gate notification
    const gateAtCaller = nextMessage(ws1, (m) => m.type === 'video-gate')
    ws2.send(JSON.stringify({ type: 'video-gate', on: true }))
    const gate = await gateAtCaller
    expect(gate.on).toBe(true)

    ws1.close()
    ws2.close()
    await app.close()
  })

  it('rejects connection without a valid token', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=bogus`)
    const closed = await new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    expect(closed).toBe(4001)
    await app.close()
  })
})
