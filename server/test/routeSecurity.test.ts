import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

/// 路由级安全一致性守卫：收集全路由表（buildApp 的 onRoute 观察钩子），断言两条不变量——
/// ① 不在公开白名单里的端点**必有**鉴权 preHandler（新端点忘挂 requireAuth 即红，防"裸奔端点"上线）；
/// ② 白名单里无鉴权的**变更类**端点必有更严的端点级限流（全局 300 之外的收紧——它们是暴力面）。
/// 白名单是**逐条带理由**的清单：加公开端点必须来这里写明为什么可以公开（审计留痕）。
/// 本轮建网时人工核过四个疑点：/metrics 生产有 METRICS_TOKEN 门（处理器内常量时间比较）、
/// 录音 media 走处理器内 media-token（<video> 无法带 Bearer）、/ws 协议内首帧鉴权、
/// logout 凭 refresh token 本身即授权（高熵，全局限流覆盖）。
const PUBLIC_ALLOWLIST = new Set([
  // —— 探针/静态（GET/HEAD，无副作用）——
  'GET /health', 'HEAD /health',                    // 容器健康检查
  'GET /api/ready', 'HEAD /api/ready',              // 就绪探针
  'GET /api/version', 'HEAD /api/version',          // 部署验证（版本+commit）
  'GET /metrics', 'HEAD /metrics',                  // Prometheus；METRICS_TOKEN 门在处理器内
  'GET /.well-known/apple-app-site-association', 'HEAD /.well-known/apple-app-site-association', // Apple 要求公开
  'GET /admin', 'HEAD /admin', 'GET /admin/*', 'HEAD /admin/*', // 管理面板静态外壳；数据全走 /api/admin/**（鉴权）
  'GET /legal', 'HEAD /legal', 'GET /legal/', 'HEAD /legal/',   // 公开法律页
  'GET /ws', 'HEAD /ws',                            // WebSocket 升级；协议内首帧鉴权
  'GET /api/recordings/:id/media', 'HEAD /api/recordings/:id/media', // 处理器内 media-token 鉴权
  // —— 认证入口（POST，天然无鉴权；须端点级限流，见断言②）——
  'POST /api/auth/login', 'POST /api/auth/register', 'POST /api/auth/refresh',
  'POST /api/auth/forgot-password', 'POST /api/auth/reset-password',
  'POST /api/auth/apple',
  'POST /api/auth/email/request-code', 'POST /api/auth/email/verify-code',
  'POST /api/auth/passkey/login/options', 'POST /api/auth/passkey/login/verify',
  'POST /api/push/web-rotate',                      // SW 后台轮换：凭旧订阅 endpoint+keys 证明所有权
  'POST /api/auth/logout',                          // 撤销 refresh token：凭 token 本身即授权（高熵）；全局限流覆盖
])
// 白名单里允许**不带端点级限流**的变更类端点（逐条理由）：
const NO_ROUTE_RATELIMIT_OK = new Set([
  'POST /api/auth/logout', // 幂等撤销；高熵 token 无枚举价值；全局 300/min 兜底
])

type Row = { key: string; hasAuth: boolean; hasRateLimit: boolean }
let rows: Row[] = []
let app: ReturnType<typeof buildApp>

beforeAll(async () => {
  app = buildApp(new MemoryStore(), {
    onRoute: (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method]
      for (const m of methods) {
        rows.push({
          key: `${m} ${r.url}`,
          hasAuth: !!r.preHandler,
          hasRateLimit: !!(r.config as { rateLimit?: unknown } | undefined)?.rateLimit,
        })
      }
    },
  })
  await app.ready()
})
afterAll(async () => { await app.close(); rows = [] })

describe('路由安全一致性守卫', () => {
  it('① 白名单之外的每个端点都有鉴权 preHandler（新端点忘挂 requireAuth 即红）', () => {
    const naked = rows.filter((r) => !r.hasAuth && !PUBLIC_ALLOWLIST.has(r.key)).map((r) => r.key)
    expect(naked, `裸奔端点（挂 requireAuth，或写明理由加入白名单）：\n${naked.join('\n')}`).toEqual([])
  })

  it('② 白名单中无鉴权的变更类端点（POST/PUT/PATCH/DELETE）都有端点级限流（暴力面收紧）', () => {
    const mutating = rows.filter((r) =>
      !r.hasAuth && PUBLIC_ALLOWLIST.has(r.key) && !/^(GET|HEAD) /.test(r.key) && !NO_ROUTE_RATELIMIT_OK.has(r.key))
    const unlimited = mutating.filter((r) => !r.hasRateLimit).map((r) => r.key)
    expect(unlimited, `无端点级限流的公开变更端点：\n${unlimited.join('\n')}`).toEqual([])
  })

  it('③ 白名单零腐化：每一条都对应真实存在的路由（删端点须同步删白名单）', () => {
    const keys = new Set(rows.map((r) => r.key))
    const stale = [...PUBLIC_ALLOWLIST].filter((k) => !keys.has(k))
    expect(stale, `白名单中已不存在的路由：\n${stale.join('\n')}`).toEqual([])
  })

  it('④ 白名单里的端点确实没挂 preHandler（挂上了就该从白名单移除——清单如实反映现状）', () => {
    const nowAuthed = rows.filter((r) => r.hasAuth && PUBLIC_ALLOWLIST.has(r.key)).map((r) => r.key)
    expect(nowAuthed).toEqual([])
  })
})
