import type { FastifyInstance } from 'fastify'

/// 有界优雅关闭：收到 SIGTERM/SIGINT 时先 app.close()（排空在途请求），但**必须有超时兜底**——
/// 本服务有长连接（通话 /ws 信令），这些 WS 不会自行关闭，app.close() 可能永远挂起，导致进程
/// 一直不退、编排器等到自己的超时后 SIGKILL（反而不优雅、丢失日志刷写/清理）。超时到即强制退出，
/// 保证无论如何都在有界时间内干净退出。二次信号忽略，防重复 close。
export interface ShutdownOptions {
  timeoutMs?: number
  exit?: (code: number) => void
  log?: (msg: string) => void
}

/// 生成一个关闭处理器（与 process 信号解耦，便于单测）。
export function makeShutdownHandler(app: Pick<FastifyInstance, 'close'>, opts: ShutdownOptions = {}): () => void {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const exit = opts.exit ?? ((code: number) => process.exit(code))
  const log = opts.log ?? ((m: string) => console.log(m))
  let shuttingDown = false
  return () => {
    if (shuttingDown) return // 二次信号：已在关闭中，忽略（避免重复 app.close()）
    shuttingDown = true
    log('[shutdown] draining connections…')
    // 强制退出兜底：长连接可能让 close() 永挂 → 超时后强退（非 0，标示未干净排空）。
    const timer = setTimeout(() => { log('[shutdown] drain timeout, forcing exit'); exit(1) }, timeoutMs)
    timer.unref?.() // 不因这个定时器本身阻止进程退出
    app.close()
      .then(() => { clearTimeout(timer); log('[shutdown] closed cleanly'); exit(0) })
      .catch((e: unknown) => { clearTimeout(timer); log(`[shutdown] close error: ${(e as Error)?.message ?? e}`); exit(1) })
  }
}

/// 注册到 SIGTERM/SIGINT。返回处理器（便于测试/手动触发）。
export function installGracefulShutdown(app: Pick<FastifyInstance, 'close'>, opts: ShutdownOptions & { signals?: NodeJS.Signals[] } = {}): () => void {
  const handler = makeShutdownHandler(app, opts)
  for (const sig of opts.signals ?? (['SIGTERM', 'SIGINT'] as NodeJS.Signals[])) process.on(sig, handler)
  return handler
}
