import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken, type TokenPayload } from './tokens'

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload
  }
}

/// 从 Authorization: Bearer <token> 解析当前用户。
export function authUser(req: FastifyRequest): TokenPayload | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return verifyAccessToken(header.slice('Bearer '.length))
}

/// preHandler 工厂：要求登录，可选限定角色（RBAC）。
export function requireAuth(roles?: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = authUser(req)
    if (!user) {
      reply.code(401).send({ error: 'unauthorized' })
      return reply
    }
    if (roles && !roles.includes(user.role as Role)) {
      reply.code(403).send({ error: 'forbidden' })
      return reply
    }
    req.user = user
  }
}

import type { Role } from '../db/store'
