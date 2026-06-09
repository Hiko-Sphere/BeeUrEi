import { buildApp, makeDefaultStore } from './app'
import { seedAdmin } from './bootstrap/seedAdmin'
import { makeMailer } from './mail/mailer'
import { makePushSender } from './push/apns'
import { initErrorReporting } from './monitoring/errorReporting'

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
  const pushSender = makePushSender() // 配了 APNS_* 则真实 VoIP 推送，否则无后台来电（A1）
  const app = buildApp(store, { mailer, pushSender })
  const port = Number(process.env.PORT ?? 8787)

  const addr = await app.listen({ port, host: '0.0.0.0' })
  console.log(`BeeUrEi server listening on ${addr}`)

  // 优雅关闭：收到 SIGTERM/SIGINT 时先关闭 server（完成在途请求）再退出。
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1))
    })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
