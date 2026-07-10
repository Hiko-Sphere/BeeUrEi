import type { Store } from '../db/store'
import type { PushSender } from '../push/apns'
import type { WebPushSender } from '../push/webPush'
import { escalateUnackedEmergencies } from '../emergency/escalation'
import { fireExpiredSafetyTimers, remindDueSoonSafetyTimers, startDueDailyCheckins, type LastKnownLocationSource } from './checkin'

/// 后台安全引擎单次 tick（index.ts 每 60s 调一次）：升级重呼 / 到期前提醒 / 到期未报到告警(dead-man's-switch) / 每日定时报到。
export interface SafetyTickDeps {
  store: Store
  push: PushSender
  webPush: WebPushSender
  live?: LastKnownLocationSource
  metrics: { inc(name: string, by?: number): void }
  escalateAfterMs: number
  staleGraceMs: number
  remindLeadMs: number
}

/// 跑一次安全 tick。每步**独立** try/catch——一步失败绝不拖垮其余（尤其到期告警这条 dead-man's-switch 必须照跑）；
/// 失败即 inc safety_tick_errors_total，让运维能对"安全引擎在报错"设 Prometheus 告警，而非只在日志里一闪。
/// 抽成纯函数（从 index.ts setInterval 里提出来）便于单测编排本身：4 步都跑、一步抛不阻断其余、计数正确。
export function runSafetyTick(deps: SafetyTickDeps, now: number): void {
  const { store, push, webPush, live, metrics } = deps
  const step = (fnName: string, run: () => number, onCount: (n: number) => void): void => {
    try {
      const n = run()
      if (n) onCount(n)
    } catch (e) {
      metrics.inc('safety_tick_errors_total') // 安全引擎报错的可观测信号（区别于"本轮无事可做"=计数为 0）
      console.warn(`[safety-tick] ${fnName} 失败:`, (e as Error).message)
    }
  }
  // 升级重呼：告警满阈值仍无人 ack/报平安 → 再推一次（抓漏看首呼的人）。
  step('escalate', () => escalateUnackedEmergencies(store, push, webPush, now, deps.escalateAfterMs),
    (n) => { metrics.inc('emergency_escalations_total', n); console.log(`[emergency] 升级重呼无人响应的求助 ${n} 条`) })
  // 到期前提醒本人（善意，防遗忘误报；只给本人）——须在到期告警**之前**跑，两窗口不相交（<dueAt vs ≥dueAt）。
  step('remind', () => remindDueSoonSafetyTimers(store, push, webPush, now, deps.remindLeadMs),
    (r) => { metrics.inc('safety_checkin_reminders_total', r); console.log(`[safety] 到期前提醒本人 ${r} 条`) })
  // 到期未确认平安 → 自动告警亲友（dead-man's-switch）。传 live：本人在共享则取最后已知位置兜底附给亲友。
  step('fire', () => fireExpiredSafetyTimers(store, push, webPush, now, deps.staleGraceMs, live, metrics),
    (f) => { metrics.inc('safety_checkin_fires_total', f); console.log(`[safety] 到期未报到自动告警 ${f} 条`) })
  // 每日定时报到：到点自动为配置了的用户开启一次报到（超时未报平安走上面的告警链）。
  step('daily', () => startDueDailyCheckins(store, push, webPush, now),
    (s) => { metrics.inc('safety_daily_checkin_starts_total', s); console.log(`[safety] 每日定时报到自动开启 ${s} 条`) })
}
