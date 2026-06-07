import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Role, type User, publicUser } from '../db/store'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { signAccessToken } from '../auth/tokens'

const registerSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(6).max(128),
  displayName: z.string().min(1).max(64).optional(),
  // 自助注册仅限这些角色；admin/developer 由后台分配。
  role: z.enum(['blind', 'helper', 'family']).optional(),
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
    const { username, password, displayName, role } = parsed.data
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
    }
    store.createUser(user)
    const token = signAccessToken({ sub: user.id, role: user.role })
    return reply.code(201).send({ token, user: publicUser(user) })
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
    const token = signAccessToken({ sub: user.id, role: user.role })
    return reply.send({ token, user: publicUser(user) })
  })
}
