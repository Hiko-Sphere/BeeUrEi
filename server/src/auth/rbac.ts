import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken, type TokenPayload } from './tokens'
import type { Role, Store } from '../db/store'

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload
  }
}

// 鉴权需要读账号当前状态(封禁/tokenVersion)，故注入 store。buildApp 启动时调用 setAuthStore 一次。
let authStore: Store | null = null
export function setAuthStore(store: Store): void {
  authStore = store
}

/// 从 Authorization: Bearer <token> 解析当前用户（仅验签，不校验账号状态）。
export function authUser(req: FastifyRequest): TokenPayload | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return verifyAccessToken(header.slice('Bearer '.length))
}

/// 实名认证门禁豁免端点：未通过 KYC 的用户仍可访问这些（提交认证本身 / 紧急 / 自身状态 / 退出留存所需）。
/// 集中一处便于审计——少列一个=软锁死用户，多列一个=放行不该放行的功能，故按"提交+紧急+账户基本"最小集精确列出。
/// 路径用 Fastify 注册时的 route pattern（req.routeOptions.url，与 app.ts /metrics 判定同法）。
const VERIFY_EXEMPT_ROUTES = new Set<string>([
  '/api/me', // 读自身状态（含 verified）——门禁屏据此判断
  '/api/app-config', // 客户端渲染前置（功能开关/维护/公告）
  '/api/account/verification', // 提交 / 查询 / 撤回实名认证
  '/api/account/verification/:id/doc/:kind', // 逐张上传证件
  '/api/account/language', // 切换界面语言（门禁屏也需本地化）
  '/api/account/legal-consent', // 注册后补同意
  '/api/account', // DELETE 注销账户——未认证也允许离开
  '/api/emergency/trigger', // 紧急（摔倒/手动）——安全兜底，永不门控
  '/api/emergency/alert',
  '/api/push/register', // 注册推送 token——紧急推送 + 收"已通过"通知所需
  '/api/push/apns-register',
  '/api/notifications', // 收件箱——看"实名已通过/未通过"通知
  '/api/notifications/:id/read',
  '/api/notifications/read-all',
])

/// 该角色是否受实名门禁约束。admin/developer 永不门控——否则没人能审核 KYC=死锁。
function isGateableRole(role: Role): boolean {
  return role === 'blind' || role === 'helper' || role === 'family'
}

/// 当前请求是否应被实名门禁拦截（供 requireAuth 与 WebSocket 接入共用，保证服务端权威、无客户端绕过）。
export function blockedByVerificationGate(role: Role, identityVerified: boolean | undefined, routeUrl: string | undefined): boolean {
  if (!isGateableRole(role)) return false
  if (identityVerified === true) return false
  return !VERIFY_EXEMPT_ROUTES.has(routeUrl ?? '')
}

/// preHandler 工厂：要求登录，可选限定角色（RBAC）。
/// 除验签外，还**实时校验账号状态**：封禁(disabled)或被改密/封禁递增过 tokenVersion 的旧 access token
/// 立即失效，把"封禁/改密对在线令牌的生效延迟"从 access token 的 1h TTL 降为 0（见审查 #1/#2）。
/// 并施加**实名认证门禁**：可门控角色未通过 KYC 时，除豁免端点外一律 403 verification_required（服务端权威）。
export function requireAuth(roles?: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = authUser(req)
    if (!token) {
      reply.code(401).send({ error: 'unauthorized' })
      return reply
    }
    // 加载账号当前状态：不存在/已封禁 → 拒绝（封禁立即生效，不等 1h TTL）。
    const current = authStore?.findById(token.sub)
    if (!current || current.status !== 'active') {
      reply.code(401).send({ error: 'unauthorized' })
      return reply
    }
    // tokenVersion 不匹配（改密/封禁后递增过）→ 旧 access token 立即失效。
    if ((current.tokenVersion ?? 0) !== (token.tv ?? 0)) {
      reply.code(401).send({ error: 'token_revoked' })
      return reply
    }
    // 会话级撤销：该 access token 所属会话已被「按设备登出」删除（其 refresh token 已不存在）→ 立即失效，
    // 把"远程登出某设备对在线 access token 的生效延迟"从 1h TTL 降为 0。无 sid 的旧 token 跳过（向后兼容）。
    if (token.sid && authStore && !authStore.hasActiveSession(token.sub, token.sid, Date.now())) {
      reply.code(401).send({ error: 'session_revoked' })
      return reply
    }
    if (roles && !roles.includes(current.role)) {
      reply.code(403).send({ error: 'forbidden' })
      return reply
    }
    // 实名认证门禁（仅当管理员开启 requireVerification 时生效）：未通过 KYC 的可门控角色，
    // 除豁免端点外一律 403（服务端权威，防客户端绕过）。开关默认关，作为安全攸关 App 的即时兜底。
    if (authStore?.getAppConfig().requireVerification && blockedByVerificationGate(current.role, current.identityVerified, req.routeOptions?.url)) {
      reply.code(403).send({ error: 'verification_required' })
      return reply
    }
    // 用库中最新的 role（防止改角色后旧 token 沿用旧角色）。
    req.user = { sub: token.sub, role: current.role, tv: current.tokenVersion ?? 0, sid: token.sid }
  }
}
