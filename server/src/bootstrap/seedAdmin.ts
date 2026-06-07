import { randomUUID } from 'node:crypto'
import { type Store } from '../db/store'
import { hashPassword } from '../auth/passwords'

/// 用环境变量 ADMIN_USERNAME / ADMIN_PASSWORD 引导一个管理员账号（若尚不存在）。
/// admin/developer 不可自助注册，靠此或后台分配。
export function seedAdmin(store: Store): void {
  const username = process.env.ADMIN_USERNAME
  const password = process.env.ADMIN_PASSWORD
  if (!username || !password) return
  if (store.findByUsername(username)) return
  store.createUser({
    id: randomUUID(),
    username,
    passwordHash: hashPassword(password),
    displayName: username,
    role: 'admin',
    status: 'active',
    createdAt: Date.now(),
  })
}
