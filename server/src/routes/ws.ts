import type { FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { randomUUID } from 'node:crypto'
import { verifyAccessToken } from '../auth/tokens'
import { SignalingHub, type Member } from '../signaling/hub'
import { type Store } from '../db/store'
import { type PendingCallRegistry } from '../assist/pendingCalls'
import { type OpenHelpRegistry } from '../assist/openHelp'
import { type CallControlBridge } from '../signaling/callControl'

// record-request/consent/state：通话录制的知情同意握手（发起→对端同意→双方录制指示），点对点转发。
const RELAY_TYPES = new Set(['offer', 'answer', 'ice', 'video-gate', 'end', 'control', 'record-request', 'record-consent', 'record-state'])

/// WebRTC 信令：/ws?token=<JWT>。客户端先发 {type:'join', callId, role}，
/// 之后 offer/answer/ice/video-gate/end 会被转发给同房间的另一端。
/// video-gate {on} 用于视障侧通知协助者"画面已开/关"（见 BACKEND_PLAN §5）。
export function registerSignaling(app: FastifyInstance, hub: SignalingHub, store: Store, pendingCalls: PendingCallRegistry, openHelp: OpenHelpRegistry, callControl?: CallControlBridge): void {
  app.register(fastifyWebsocket)
  app.register(async (f) => {
    // clientId → socket（转发用）。adapter 层，故用 any 规避 ws 类型摩擦。
    const sockets = new Map<string, { send: (s: string) => void; readyState: number }>()

    // 管理员 REST → 推送到通话房间：强制结束。向房间各端发 end（注明 by:admin），返回端数。
    if (callControl) {
      callControl.endCall = (callId, byAdminId) => {
        let n = 0
        for (const p of hub.peersInCall(callId)) {
          const s = sockets.get(p.clientId)
          if (s && s.readyState === 1) { s.send(JSON.stringify({ type: 'end', by: 'admin', adminId: byAdminId })); n++ }
        }
        return n
      }
    }

    f.get('/ws', { websocket: true }, (socket: any, req) => {
      const token = (req.query as { token?: string }).token
      const auth = token ? verifyAccessToken(token) : null
      if (!auth) {
        socket.close(4001, 'unauthorized')
        return
      }
      const clientId = randomUUID()
      sockets.set(clientId, socket)
      let joined: Member | null = null

      const relay = (toClientId: string, obj: unknown) => {
        const s = sockets.get(toClientId)
        if (s && s.readyState === 1) s.send(JSON.stringify(obj))
      }

      socket.on('message', (raw: Buffer) => {
        let msg: { type?: string; callId?: string; role?: string; [k: string]: unknown }
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }

        if (msg.type === 'join') {
          // 必须带非空 callId：否则空串会让所有"漏带 callId"的连接落进同一全局房间互相串话（见审查 #8）。
          const callId = typeof msg.callId === 'string' ? msg.callId.trim() : ''
          if (!callId) {
            socket.close(4002, 'invalid_call')
            return
          }
          // 参与权校验：只有该 callId 登记表里的发起者/目标本人才能加入，否则任意登录用户知道 callId
          // 即可抢先占位、窃听信令、劫持 WebRTC 会话（见审查 #8）。
          // 两条来源：① 定向亲友呼叫(pendingCalls) ② 公开求助队列(openHelp，认领后含志愿者)。
          // 传 now 让两表都先清过期；若同一 callId 在两表同时有效则视为冲突一律拒绝（防影子覆盖，见审查 #1/#7）。
          const now = Date.now()
          const pcParticipants = pendingCalls.participants(callId, now)
          const ohParticipants = openHelp.participants(callId, now)
          if (pcParticipants && ohParticipants) {
            socket.close(4003, 'call_conflict') // 跨表去重后理论不应发生，作为纵深防御
            return
          }
          const participants = pcParticipants ?? ohParticipants
          if (!participants || !participants.includes(auth.sub)) {
            socket.close(4003, 'not_a_participant')
            return
          }
          // 同一连接重复 join 不同房间：先离开旧房间并通知旧对端，避免旧房间状态泄漏（见审查 #9）。
          if (joined) {
            const { peers: oldPeers } = hub.leave(clientId)
            for (const p of oldPeers) relay(p.clientId, { type: 'peer-left', userId: auth.sub })
          }
          // 1:1 房间最多两端：满员则拒绝第三方接入，防止窃听/劫持信令（见审查 #8）。
          if (hub.peersInCall(callId).length >= 2) {
            socket.close(4003, 'call_full')
            return
          }
          joined = { clientId, userId: auth.sub, role: msg.role ?? 'unknown', callId, joinedAt: now }
          const peers = hub.join(joined)
          const meRec = store.findById(auth.sub)
          socket.send(JSON.stringify({
            type: 'joined',
            peers: peers.map((p) => {
              const pu = store.findById(p.userId)
              return { userId: p.userId, role: p.role, userName: pu?.displayName, userAvatar: pu?.avatar ?? null }
            }),
          }))
          for (const p of peers) relay(p.clientId, { type: 'peer-joined', userId: auth.sub, role: joined.role, userName: meRec?.displayName, userAvatar: meRec?.avatar ?? null })
          return
        }

        if (!joined) return

        if (msg.type && RELAY_TYPES.has(msg.type)) {
          for (const p of hub.peersInCall(joined.callId, clientId)) {
            relay(p.clientId, { ...msg, from: auth.sub })
          }
        }
      })

      socket.on('close', () => {
        sockets.delete(clientId)
        if (joined) {
          const { peers } = hub.leave(clientId)
          for (const p of peers) relay(p.clientId, { type: 'peer-left', userId: auth.sub })
        }
      })
    })
  })
}
