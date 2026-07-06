import { buildApp, makeDefaultStore } from './app'
import { seedAdmin } from './bootstrap/seedAdmin'
import { makeMailer } from './mail/mailer'
import { makePushSender } from './push/apns'
import { makeWebPushSender } from './push/webPush'
import { initErrorReporting } from './monitoring/errorReporting'
import { sweepExpiredRecordings } from './recording/retention'
import { sweepStaleVerifications } from './kyc/retention'
import { sweepOrphanMedia } from './media/orphanSweep'
import { sweepOldNotifications } from './notifications/retention'
import { runAutoBackup } from './backup/autoBackup'
import { escalateUnackedEmergencies } from './emergency/escalation'
import { fireExpiredSafetyTimers, remindDueSoonSafetyTimers } from './safety/checkin'
import { ensureKycDir } from './kyc/storage'
import { installGracefulShutdown } from './shutdown'

// 从 .env 读取密钥/配置（AMAP_API_KEY / ADMIN_* / JWT_SECRET / SMTP_* / SENTRY_DSN / METRICS_TOKEN）。Node 21+ 内置。
try {
  process.loadEnvFile()
} catch {
  /* 没有 .env 也能跑（用默认值） */
}

async function main(): Promise<void> {
  await initErrorReporting() // 崩溃监控/Sentry（D3/F2）——可选，未配置则仅装进程兜底

  const store = makeDefaultStore()
  seedAdmin(store) // 若设置了 ADMIN_USERNAME/ADMIN_PASSWORD 则引导管理员

  const mailer = await makeMailer() // 配了 SMTP_* 则真实发信，否则控制台打码（D1）
  // APNs 410（token 失效）时回收该 token，避免反复空投死 token + 被 Apple 限流。
  const pushSender = makePushSender((token) => store.clearPushToken(token)) // 配了 APNS_* 则真实 VoIP 推送，否则无后台来电（A1）
  const webPushSender = makeWebPushSender((endpoint) => store.deleteWebPushSubscription(endpoint)) // 配了 VAPID_* 则浏览器推送；410 回收死订阅
  const app = buildApp(store, { mailer, pushSender, webPushSender })
  const port = Number(process.env.PORT ?? 8787)

  ensureKycDir() // 实名认证证件密文目录（KYC_DIR，0700）启动即就绪

  const addr = await app.listen({ port, host: '0.0.0.0' })
  console.log(`BeeUrEi server listening on ${addr}`)

  // 留存清理：后台每小时清一次——过期录制(连同媒体文件) + KYC 停滞/已过宽限的证件（真实数据最小化）。
  const sweep = () => {
    try { const n = sweepExpiredRecordings(store, Date.now()); if (n) console.log(`[recordings] 清理过期录制 ${n} 条`) }
    catch (e) { console.warn('[recordings] 清理失败:', (e as Error).message) }
    try { const k = sweepStaleVerifications(store, Date.now()); if (k) console.log(`[kyc] 清理停滞/过宽限证件 ${k} 条`) }
    catch (e) { console.warn('[kyc] 清理失败:', (e as Error).message) }
    // 孤儿媒体（上传后从未关联到视频消息/录制，超 7 天）：清磁盘文件+元数据，防上传不发的慢 DoS / 解散群残留累积。
    try { const o = sweepOrphanMedia(store, Date.now()); if (o) console.log(`[media] 清理孤儿媒体 ${o} 条`) }
    catch (e) { console.warn('[media] 清理失败:', (e as Error).message) }
    try { const x = sweepOldNotifications(store, Date.now()); if (x) console.log(`[notifications] 清理过期通知 ${x} 条`) }
    catch (e) { console.warn('[notifications] 清理失败:', (e as Error).message) }
    // 安全报到历史（仅终态 completed/canceled/fired/expired，active 永不清）：留存 90 天（SAFETY_TIMER_RETENTION_DAYS 可调，≥1）。
    try {
      const d = Number(process.env.SAFETY_TIMER_RETENTION_DAYS)
      const days = Number.isFinite(d) && d >= 1 ? d : 90
      const s = store.deleteSafetyTimersOlderThan(Date.now() - days * 86_400_000)
      if (s) console.log(`[safety] 清理过期报到历史 ${s} 条`)
    } catch (e) { console.warn('[safety] 清理失败:', (e as Error).message) }
    try { const r = store.deleteExpiredRefreshTokens(Date.now()); if (r) console.log(`[auth] 清理过期 refresh token ${r} 条`) }
    catch (e) { console.warn('[auth] 清理失败:', (e as Error).message) }
    // 每日自动备份 + 轮换（按天去重，一天只落一份；BACKUP_KEEP_DAYS=0 显式关闭）。
    try {
      const b = runAutoBackup(store, Date.now())
      if (b.created) console.log('[backup] 每日自动备份已落盘')
      if (b.purged) console.log(`[backup] 轮换清理旧备份 ${b.purged} 份`)
    } catch (e) { console.warn('[backup] 自动备份失败:', (e as Error).message) }
    // 紧急事件日志保留 180 天（duty-of-care 记录比通知(90d)略长；EMERGENCY_RETENTION_DAYS 可调，≥1）。
    try {
      const d = Number(process.env.EMERGENCY_RETENTION_DAYS)
      const days = Number.isFinite(d) && d >= 1 ? d : 180
      const ee = store.deleteEmergencyEventsOlderThan(Date.now() - days * 86_400_000)
      if (ee) console.log(`[emergency] 清理过期紧急事件日志 ${ee} 条`)
    } catch (e) { console.warn('[emergency] 清理失败:', (e as Error).message) }
    // 通话记录保留 365 天（PII 数据最小化——通话历史此前无上限、永久累积；一年符合手机通话记录惯例，
    // CALL_RECORD_RETENTION_DAYS 可调，≥1）。删的是历史记录，不影响任何进行中的通话或未接来电角标（早已看过）。
    try {
      const d = Number(process.env.CALL_RECORD_RETENTION_DAYS)
      const days = Number.isFinite(d) && d >= 1 ? d : 365
      const cr = store.deleteCallRecordsOlderThan(Date.now() - days * 86_400_000)
      if (cr) console.log(`[calls] 清理过期通话记录 ${cr} 条`)
    } catch (e) { console.warn('[calls] 清理失败:', (e as Error).message) }
  }
  sweep() // 启动即清一次
  const sweepTimer = setInterval(sweep, 60 * 60 * 1000)
  sweepTimer.unref?.() // 不阻止进程退出

  // 紧急升级重呼：告警发出满阈值（ESCALATE_AFTER_MS，默认 5 分钟）仍无任何亲友确认(ack)、未报平安 → 再推一次
  // 更急的告警，兜住"全体亲友都漏看首呼"（睡着/静音）的最坏情形。每 60s 检查一次（升级至多一次）。
  const escalateAfterMs = (() => { const v = Number(process.env.ESCALATE_AFTER_MS); return Number.isFinite(v) && v >= 60_000 ? v : 5 * 60_000 })()
  // 安全报到到期宽限：到期时若服务端宕机、恢复后已超此窗则不迟发告警（免陈旧误报风暴）。默认 60 分钟（≥60s）。
  const safetyStaleGraceMs = (() => { const v = Number(process.env.SAFETY_TIMER_STALE_GRACE_MS); return Number.isFinite(v) && v >= 60_000 ? v : 60 * 60_000 })()
  // 到期前提前提醒本人的提前量：默认 10 分钟（防遗忘误报）。设 0 或非法值即禁用提醒（仍照常到期告警）。
  const safetyRemindLeadMs = (() => { const v = Number(process.env.SAFETY_TIMER_REMIND_LEAD_MS); return Number.isFinite(v) && v >= 0 ? v : 10 * 60_000 })()
  const escalateTimer = setInterval(() => {
    try { const n = escalateUnackedEmergencies(store, pushSender, webPushSender, Date.now(), escalateAfterMs); if (n) { app.metrics.inc('emergency_escalations_total', n); console.log(`[emergency] 升级重呼无人响应的求助 ${n} 条`) } }
    catch (e) { console.warn('[emergency] 升级重呼失败:', (e as Error).message) }
    // 到期前提醒本人（善意提示，防遗忘误报；只给本人、不惊动亲友）——须在到期告警**之前**跑，同一 tick 里
    // 已到期的走告警、快到期的走提醒，两窗口不相交（<dueAt vs ≥dueAt）。
    try { const r = remindDueSoonSafetyTimers(store, pushSender, webPushSender, Date.now(), safetyRemindLeadMs); if (r) { app.metrics.inc('safety_checkin_reminders_total', r); console.log(`[safety] 到期前提醒本人 ${r} 条`) } }
    catch (e) { console.warn('[safety] 报到提醒失败:', (e as Error).message) }
    // 安全报到到期未确认平安 → 自动告警亲友（与升级重呼同 60s tick，共用 push 通道）。
    // 传 app.liveLocations：若本人在共享位置，取最后已知位置兜底附给亲友（家人才知去哪找人，与 SOS 同款）。
    try { const f = fireExpiredSafetyTimers(store, pushSender, webPushSender, Date.now(), safetyStaleGraceMs, app.liveLocations); if (f) { app.metrics.inc('safety_checkin_fires_total', f); console.log(`[safety] 到期未报到自动告警 ${f} 条`) } }
    catch (e) { console.warn('[safety] 报到告警失败:', (e as Error).message) }
  }, 60_000)
  escalateTimer.unref?.()

  // 有界优雅关闭：SIGTERM/SIGINT 先排空在途请求，超时兜底强退（防通话长连接让 close() 永挂）。
  installGracefulShutdown(app, { timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000) })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
