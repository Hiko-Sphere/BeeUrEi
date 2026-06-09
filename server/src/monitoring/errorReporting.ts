/// 错误上报与崩溃监控（D3/F2）。
/// - 始终安装进程级兜底：未捕获异常/未处理拒绝至少落日志，绝不静默崩溃。
/// - 设了 SENTRY_DSN 且安装了 @sentry/node 时，自动接入 Sentry 远程上报（可选依赖，动态加载）。
/// - 启用后服务端 5xx 经 captureException 上报（见 app.ts 的 setErrorHandler）。
/// 指标侧（Prometheus）见 metrics/metrics.ts 与 /metrics 端点。
let sentry: { captureException: (e: unknown) => void } | null = null

export async function initErrorReporting(): Promise<void> {
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
    sentry?.captureException(reason)
  })
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err)
    sentry?.captureException(err)
  })

  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  try {
    const moduleName = ['@sentry', 'node'].join('/') // '@sentry/node'，非静态名避免类型/打包解析
    const Sentry: any = await import(moduleName)
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    })
    sentry = Sentry
    console.log('[monitoring] Sentry 已启用')
  } catch {
    console.warn('[monitoring] 设置了 SENTRY_DSN，但未安装 @sentry/node；执行 `npm i @sentry/node` 后生效。')
  }
}

/// 上报一个异常到 Sentry（未启用则 no-op）。供 Fastify 错误处理调用。
export function captureException(err: unknown): void {
  sentry?.captureException(err)
}
