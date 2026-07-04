import { useEffect, useRef } from 'react'
import { api } from '../../lib/api'
import { pickNewHelpRequests, playHelpChime } from '../../lib/helpQueueAlert'
import { pollWhileVisible } from '../../lib/poll'
import { useI18n } from '../../lib/i18n'
import { useToast } from '../../components/ui'
import { useCall } from './CallController'

const POLL_MS = 12_000
const LS_AVAIL = 'beeurei.web.available' // 与 Layout 的待命开关同一持久键（本地读，免跨组件状态穿线）

/// 求助队列声音提示（Be My Eyes 式）：**待命中**且不在通话时，队列出现新求助 → 两声短鸣 + toast 指引去通话页。
/// 此前队列只有 Home 统计与通话页列表——待命志愿者停在别的页面毫无察觉，盲人在队列里干等到超时。
/// 刻意不弹模态、不碰认领逻辑（认领仍在通话页，含 youWon 竞争裁决）：纯感知层，出声引路而已。
export function HelpQueueAlertHost() {
  const { active } = useCall()
  const { t } = useI18n()
  const toast = useToast()
  const alertedRef = useRef<Set<string>>(new Set())
  const genRef = useRef(0) // 代际号：只应用**最新**一次 tick 的结果，丢弃慢响应的陈旧快照（复审#2）
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const tick = async () => {
      if (activeRef.current) return // 通话中不打扰（也避免给正在协助的人再响铃）
      let avail = false
      try { avail = localStorage.getItem(LS_AVAIL) === '1' } catch { /* ignore */ }
      if (!avail) return // 未待命：不拉队列也不出声（明确表示不接单的人不被打扰）
      const gen = ++genRef.current
      try {
        const { requests } = await api.helpQueue()
        // 陈旧响应丢弃：若期间有更新的 tick 已发起，本次（可能是 30s 前的空快照）绝不能覆盖已提示集合，
        // 否则会把刚提示过的求助从集合抹掉、下轮对同一求助重复响铃+toast（复审#2）。
        if (gen !== genRef.current) return
        const { fresh, nextAlerted } = pickNewHelpRequests(requests, alertedRef.current)
        alertedRef.current = nextAlerted
        if (fresh.length > 0) {
          playHelpChime()
          const first = fresh[0]
          toast(fresh.length === 1
            ? t(`新的求助：${first.fromName}${first.topic ? `（${first.topic}）` : ''}——请到通话页接听`,
                `New help request from ${first.fromName}${first.topic ? ` (${first.topic})` : ''} — open Calls to claim`)
            : t(`有 ${fresh.length} 条新的求助等待接听——请到通话页查看`,
                `${fresh.length} new help requests waiting — open Calls`))
        }
      } catch { /* 网络抖动忽略，下轮再试 */ }
    }
    void tick() // 挂载即查一次：打开页面时已有排队者立刻提示（他们正在等）
    return pollWhileVisible(() => { void tick() }, POLL_MS)
  }, [t, toast])

  return null
}
