/// 极简 Prometheus 指标（零依赖，纯逻辑可单测）。覆盖 D3「监控告警」的后端侧：
/// HTTP 响应计数（按状态码族）+ 进程运行时长 + 业务量计数 + 抓取时计算的存量 gauge。
/// 暴露在 GET /metrics（Prometheus text exposition format 0.0.4）。
///
/// 进程崩溃/告警（Sentry 等）属外部服务，见 index.ts 的 initErrorReporting 钩子。
export class Metrics {
  private readonly startMs: number
  private reqTotal = 0
  private reqByClass = new Map<number, number>() // 2/3/4/5 → 计数
  private counters = new Map<string, number>() // 业务计数：help_requests_total / help_claims_total / calls_registered_total ...

  constructor(nowMs: number) {
    this.startMs = nowMs
  }

  /// 记录一次 HTTP 响应（onResponse 钩子调用）。
  observeResponse(statusCode: number): void {
    this.reqTotal++
    const cls = Math.floor(statusCode / 100)
    this.reqByClass.set(cls, (this.reqByClass.get(cls) ?? 0) + 1)
  }

  /// 业务计数自增（在对应路由里调用，如 inc('help_requests_total')）。
  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by)
  }

  /// 渲染为 Prometheus 文本格式。gauges 为抓取时计算的存量（如在线用户、用户总数）。
  render(opts: { nowMs: number; gauges?: Record<string, number> }): string {
    const lines: string[] = []
    const uptime = Math.max(0, Math.floor((opts.nowMs - this.startMs) / 1000))

    lines.push('# HELP beeurei_uptime_seconds Process uptime in seconds.')
    lines.push('# TYPE beeurei_uptime_seconds gauge')
    lines.push(`beeurei_uptime_seconds ${uptime}`)

    lines.push('# HELP beeurei_http_requests_total Total HTTP responses by status class.')
    lines.push('# TYPE beeurei_http_requests_total counter')
    for (const cls of [2, 3, 4, 5]) {
      lines.push(`beeurei_http_requests_total{class="${cls}xx"} ${this.reqByClass.get(cls) ?? 0}`)
    }

    for (const [name, val] of this.counters) {
      lines.push(`# HELP beeurei_${name} Cumulative count of ${name.replace(/_total$/, '')}.`)
      lines.push(`# TYPE beeurei_${name} counter`)
      lines.push(`beeurei_${name} ${val}`)
    }

    for (const [name, val] of Object.entries(opts.gauges ?? {})) {
      lines.push(`# TYPE beeurei_${name} gauge`)
      lines.push(`beeurei_${name} ${val}`)
    }

    return lines.join('\n') + '\n'
  }
}
