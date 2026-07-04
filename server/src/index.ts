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
  }
  sweep() // 启动即清一次
  const sweepTimer = setInterval(sweep, 60 * 60 * 1000)
  sweepTimer.unref?.() // 不阻止进程退出

  // 紧急升级重呼：告警发出满阈值（ESCALATE_AFTER_MS，默认 5 分钟）仍无任何亲友确认(ack)、未报平安 → 再推一次
  // 更急的告警，兜住"全体亲友都漏看首呼"（睡着/静音）的最坏情形。每 60s 检查一次（升级至多一次）。
  const escalateAfterMs = (() => { const v = Number(process.env.ESCALATE_AFTER_MS); return Number.isFinite(v) && v >= 60_000 ? v : 5 * 60_000 })()
  const escalateTimer = setInterval(() => {
    try { const n = escalateUnackedEmergencies(store, pushSender, webPushSender, Date.now(), escalateAfterMs); if (n) console.log(`[emergency] 升级重呼无人响应的求助 ${n} 条`) }
    catch (e) { console.warn('[emergency] 升级重呼失败:', (e as Error).message) }
  }, 60_000)
  escalateTimer.unref?.()

  // 有界优雅关闭：SIGTERM/SIGINT 先排空在途请求，超时兜底强退（防通话长连接让 close() 永挂）。
  installGracefulShutdown(app, { timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000) })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
