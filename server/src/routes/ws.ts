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
// obs-offer/obs-answer/obs-ice：管理员旁观的独立媒体握手（带 to 定向），与 1:1 主通道隔离，不影响现网通话。
const RELAY_TYPES = new Set(['offer', 'answer', 'ice', 'video-gate', 'end', 'control', 'record-request', 'record-consent', 'record-state', 'obs-offer', 'obs-answer', 'obs-ice'])

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
          const caps = Array.isArray(msg.caps) ? (msg.caps as unknown[]).filter((c): c is string => typeof c === 'string') : []
          const meRec = store.findById(auth.sub)

          // —— 管理员旁观（合规监管，会通知通话双方）——
          // 须为已验证管理员；房间须有进行中通话；房间内尚无其他旁观管理员；
          // 且所有现有参与者都声明支持 adminObserver（旧版 App 不会被第三方扰乱——能力门控，保护现网）。
          if (msg.role === 'admin' && msg.observe === true) {
            if (!meRec || meRec.role !== 'admin') { socket.close(4003, 'not_admin'); return }
            const existing = hub.peersInCall(callId)
            if (existing.length === 0) { socket.close(4003, 'call_not_active'); return }
            if (existing.some((p) => p.role === 'admin')) { socket.close(4003, 'observer_exists'); return }
            if (!existing.every((p) => (p.caps ?? []).includes('adminObserver'))) { socket.close(4003, 'call_not_observable'); return }
            if (joined) { const { peers: oldPeers } = hub.leave(clientId); for (const p of oldPeers) relay(p.clientId, { type: 'peer-left', userId: auth.sub }) }
            joined = { clientId, userId: auth.sub, role: 'admin', callId, joinedAt: now, caps }
            const peers = hub.join(joined)
            socket.send(JSON.stringify({
              type: 'joined', observer: true,
              peers: peers.map((p) => { const pu = store.findById(p.userId); return { userId: p.userId, role: p.role, userName: pu?.displayName, userAvatar: pu?.avatar ?? null } }),
            }))
            // 通知双方"管理员已加入/监看"（参与方据此显示不可关闭的告知横幅 + 语音）。
            for (const p of peers) relay(p.clientId, { type: 'peer-joined', userId: auth.sub, role: 'admin', userName: meRec?.displayName, userAvatar: meRec?.avatar ?? null })
            return
          }

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
          // 1:1 房间最多两名**参与者**：满员拒绝第三方（旁观管理员不计入此上限）。
          if (hub.peersInCall(callId).filter((p) => p.role !== 'admin').length >= 2) {
            socket.close(4003, 'call_full')
            return
          }
          // 普通参与者分支：绝不信任客户端自报的特权角色。'admin' 只能经上面 DB 校验过的旁观分支获得；
          // 否则恶意参与者自报 role:'admin' 可向对端伪造"管理员正在监看"告知、并污染管理员实时总览的 hasAdminObserver（见复审 SEC-A）。
          const claimedRole = msg.role === 'blind' || msg.role === 'helper' ? msg.role : 'unknown'
          joined = { clientId, userId: auth.sub, role: claimedRole, callId, joinedAt: now, caps }
          const peers = hub.join(joined)
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
          let targets = hub.peersInCall(joined.callId, clientId)
          if (typeof msg.to === 'string') {
            targets = targets.filter((p) => p.userId === msg.to) // 定向（obs-* 旁观媒体握手）
          } else if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice') {
            targets = targets.filter((p) => p.role !== 'admin') // 1:1 主媒体不发给旁观管理员（管理员的画面/声音走 obs-*）
          }
          for (const p of targets) relay(p.clientId, { ...msg, from: auth.sub })
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
