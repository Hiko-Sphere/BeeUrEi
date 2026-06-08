import { buildApp, makeDefaultStore } from './app'
import { seedAdmin } from './bootstrap/seedAdmin'

// 从 .env 读取密钥/配置（AMAP_API_KEY / ADMIN_* / JWT_SECRET）。Node 21+ 内置。
try {
  process.loadEnvFile()
} catch {
  /* 没有 .env 也能跑（用默认值） */
}

const store = makeDefaultStore()
seedAdmin(store) // 若设置了 ADMIN_USERNAME/ADMIN_PASSWORD 则引导管理员

const app = buildApp(store)
const port = Number(process.env.PORT ?? 8787)

app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`BeeUrEi server listening on ${addr}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

// 优雅关闭：收到 SIGTERM/SIGINT 时先关闭 server（完成在途请求）再退出。
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
}
