import { describe, it, expect } from 'vitest'
import { SignalingHub, type Member } from '../src/signaling/hub'

function m(clientId: string, userId: string, callId: string, role = 'blind'): Member {
  return { clientId, userId, role, callId }
}

describe('SignalingHub', () => {
  it('join returns existing peers in the same call', () => {
    const hub = new SignalingHub()
    expect(hub.join(m('c1', 'u1', 'call'))).toEqual([])
    const peers = hub.join(m('c2', 'u2', 'call'))
    expect(peers.map((p) => p.clientId)).toEqual(['c1'])
  })

  it('peersInCall excludes self and isolates calls', () => {
    const hub = new SignalingHub()
    hub.join(m('c1', 'u1', 'A'))
    hub.join(m('c2', 'u2', 'A'))
    hub.join(m('c3', 'u3', 'B'))
    expect(hub.peersInCall('A', 'c1').map((p) => p.clientId)).toEqual(['c2'])
    expect(hub.peersInCall('B').map((p) => p.clientId)).toEqual(['c3'])
  })

  it('leave removes member and returns remaining peers', () => {
    const hub = new SignalingHub()
    hub.join(m('c1', 'u1', 'A'))
    hub.join(m('c2', 'u2', 'A'))
    const { member, peers } = hub.leave('c1')
    expect(member?.clientId).toBe('c1')
    expect(peers.map((p) => p.clientId)).toEqual(['c2'])
    expect(hub.size).toBe(1)
  })

  it('tracks online users', () => {
    const hub = new SignalingHub()
    hub.join(m('c1', 'u1', 'A'))
    expect(hub.isOnline('u1')).toBe(true)
    expect(hub.isOnline('u2')).toBe(false)
    hub.leave('c1')
    expect(hub.isOnline('u1')).toBe(false)
  })
})
