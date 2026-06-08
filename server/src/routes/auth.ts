import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Role, type User, publicUser } from '../db/store'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { signAccessToken, generateRefreshToken, hashToken, refreshTtlMs } from '../auth/tokens'

/// 签发 access + refresh 一对（refresh 仅存哈希）。
function issueTokens(store: Store, user: User): { token: string; refreshToken: string } {
  const token = signAccessToken({ sub: user.id, role: user.role })
  const refreshToken = generateRefreshToken()
  store.createRefreshToken({ tokenHash: hashToken(refreshToken), userId: user.id, expiresAt: Date.now() + refreshTtlMs })
  return { token, refreshToken }
}

const refreshSchema = z.object({ refreshToken: z.string().min(1) })

const registerSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(6).max(128),
  displayName: z.string().min(1).max(64).optional(),
  // 自助注册仅限这些角色；admin/developer 由后台分配。
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(), // 协助者/亲友语言，用于匹配排序（见审查 #10）
})

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
})

export function registerAuthRoutes(app: FastifyInstance, store: Store): void {
  app.post('/api/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    }
    const { username, password, displayName, role, language } = parsed.data
    if (store.findByUsername(username)) {
      return reply.code(409).send({ error: 'username_taken' })
    }
    const user: User = {
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      displayName: displayName ?? username,
      role: (role ?? 'blind') as Role,
      status: 'active',
      createdAt: Date.now(),
      language,
    }
    store.createUser(user)
    const tokens = issueTokens(store, user)
    return reply.code(201).send({ ...tokens, user: publicUser(user) })
  })

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' })
    }
    const user = store.findByUsername(parsed.data.username)
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    if (user.status === 'disabled') {
      return reply.code(403).send({ error: 'account_disabled' })
    }
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: publicUser(user) })
  })

  // 用 refresh token 换新的一对 token（轮换：旧 refresh 立即作废）。
  app.post('/api/auth/refresh', async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const hash = hashToken(parsed.data.refreshToken)
    const rt = store.findRefreshToken(hash)
    if (!rt || rt.expiresAt < Date.now()) {
      if (rt) store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    const user = store.findById(rt.userId)
    if (!user || user.status === 'disabled') {
      store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    store.deleteRefreshToken(hash) // 轮换
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: publicUser(user) })
  })

  // 登出：撤销该 refresh token。
  app.post('/api/auth/logout', async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    store.deleteRefreshToken(hashToken(parsed.data.refreshToken))
    return reply.code(204).send()
  })
}
