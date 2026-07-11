import { useEffect, useState } from 'react'
import { remainingText, liveRemainingSecFromDue } from '../lib/safetyCheckin'

/// 安全报到实时倒计时（每秒从 dueAt 重算递减）。此前 SafetyCheckInCard 只显服务端快照 remainingSec、卡片开着
/// 不动——半小时后仍显"还有约 60 分钟"，dead-man's switch 的剩余时间必须真实递减，否则误导用户以为还有大把时间。
/// 独立小组件：仅此处每秒重渲染，不牵动父卡片与 DailySchedule/History 子组件。分钟粒度文案 → aria-live 每分钟才
/// 变一次内容、读屏不吵。卸载清 interval，防泄漏。
export function CheckinCountdown({ dueAt, lang }: { dueAt: number; lang: 'zh' | 'en' }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <p className="text-lg font-semibold text-honey" aria-live="polite">
      {remainingText(liveRemainingSecFromDue(dueAt, nowMs), lang)}
    </p>
  )
}
