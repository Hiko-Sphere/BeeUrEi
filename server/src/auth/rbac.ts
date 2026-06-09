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

/// preHandler 工厂：要求登录，可选限定角色（RBAC）。
/// 除验签外，还**实时校验账号状态**：封禁(disabled)或被改密/封禁递增过 tokenVersion 的旧 access token
/// 立即失效，把"封禁/改密对在线令牌的生效延迟"从 access token 的 1h TTL 降为 0（见审查 #1/#2）。
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
    if (roles && !roles.includes(current.role)) {
      reply.code(403).send({ error: 'forbidden' })
      return reply
    }
    // 用库中最新的 role（防止改角色后旧 token 沿用旧角色）。
    req.user = { sub: token.sub, role: current.role, tv: current.tokenVersion ?? 0 }
  }
}
