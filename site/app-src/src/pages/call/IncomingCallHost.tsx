import { useEffect, useRef } from 'react'
import { api } from '../../lib/api'
import { useCall } from './CallController'

const POLL_MS = 3000

// 全局来电轮询：发现针对本人的待接来电（定向亲友呼叫），弹出来电铃；来电消失（被取消/超时/他人接听）即收起。
// 与 iOS 的应用内来电铃对齐——前台不依赖推送，靠轮询会合。
export function IncomingCallHost() {
  const { active, presentRing, dismissRingIfGone } = useCall()
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (!alive) return
      try {
        const { calls } = await api.incomingCalls()
        if (!alive) return
        const ids = new Set(calls.map((c) => c.callId))
        dismissRingIfGone(ids)
        // 通话中不弹新来电铃（避免打断）。
        if (!activeRef.current && calls.length > 0) {
          // 优先弹**紧急**来电（若多路并发，紧急求助先响）；紧急标志透传给来电铃突出显示。
          const c = calls.find((x) => x.emergency) ?? calls[0]
          presentRing({ callId: c.callId, fromName: c.fromName, fromAvatar: c.fromAvatar, emergency: c.emergency ?? false })
        }
      } catch { /* 网络抖动忽略 */ }
    }
    void tick()
    const id = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [presentRing, dismissRingIfGone])

  return null
}
