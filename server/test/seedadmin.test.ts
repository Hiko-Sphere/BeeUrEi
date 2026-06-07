import { describe, it, expect, afterEach } from 'vitest'
import { MemoryStore } from '../src/db/store'
import { seedAdmin } from '../src/bootstrap/seedAdmin'

describe('seedAdmin', () => {
  afterEach(() => {
    delete process.env.ADMIN_USERNAME
    delete process.env.ADMIN_PASSWORD
  })

  it('creates an admin from env when absent, idempotently', () => {
    const store = new MemoryStore()
    process.env.ADMIN_USERNAME = 'root'
    process.env.ADMIN_PASSWORD = 'rootpass1'
    seedAdmin(store)
    seedAdmin(store)
    const admins = store.allUsers().filter((u) => u.role === 'admin')
    expect(admins.length).toBe(1)
    expect(admins[0].username).toBe('root')
  })

  it('does nothing without env', () => {
    const store = new MemoryStore()
    seedAdmin(store)
    expect(store.allUsers().length).toBe(0)
  })
})
