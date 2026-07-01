import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonFileStore } from '../src/db/store'

const path = join(tmpdir(), `beeurei-jsonstore-test-${process.pid}.json`)
const user = (id: string, username: string) => ({
  id, username, passwordHash: 'h', displayName: username, role: 'blind' as const, status: 'active' as const, createdAt: 1,
})

afterEach(() => { for (const p of [path, `${path}.tmp`]) if (existsSync(p)) rmSync(p) })

describe('JsonFileStore 持久化 + 原子写', () => {
  it('mutation 后落盘，新实例从同一文件读回（round-trip）', () => {
    const s1 = new JsonFileStore(path)
    s1.createUser(user('u1', 'alice'))
    const s2 = new JsonFileStore(path)
    expect(s2.findById('u1')?.username).toBe('alice')
  })

  it('原子写：主文件始终是完整合法 JSON，rename 后不残留 .tmp', () => {
    const s = new JsonFileStore(path)
    s.createUser(user('u2', 'bob'))
    // 主文件完整可解析（原子 rename 保证绝不半写损坏）——直写在写入中途崩溃会留半写文件、下次启动静默丢数据。
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow()
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  it('损坏文件（半写残留）不崩，从空开始——原子写正是为避免走到这一步', () => {
    // 直接写入损坏内容模拟旧直写实现被中断的后果，构造函数应吞掉并从空启动（不抛）。
    writeFileSync(path, '{ "users": [ {"id":"u3"')
    const s = new JsonFileStore(path)
    expect(s.allUsers()).toEqual([])
  })
})
