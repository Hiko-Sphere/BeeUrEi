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
    s1.setMedicalInfo({ userId: 'u1', sealed: 'sealed-ct-blob', updatedAt: 42 }) // 紧急医疗信息（加密信封）也须落盘
    const s2 = new JsonFileStore(path)
    expect(s2.findById('u1')?.username).toBe('alice')
    expect(s2.getMedicalInfo('u1')).toMatchObject({ userId: 'u1', sealed: 'sealed-ct-blob', updatedAt: 42 }) // 载盘后仍在
  })

  it('群/单聊免打扰标记落盘并读回（groupMutes/dmMutes 是 Set，须显式序列化，漏一处即重启丢静音）', () => {
    const s1 = new JsonFileStore(path)
    s1.setGroupMuted('g1', 'u1', true)
    s1.setDmMuted('u1', 'u2', true) // 有向：u1 静音了与 u2 的单聊
    const s2 = new JsonFileStore(path)
    expect(s2.isGroupMuted('g1', 'u1')).toBe(true)
    expect(s2.isDmMuted('u1', 'u2')).toBe(true)
    expect(s2.isDmMuted('u2', 'u1')).toBe(false) // 有向不对称，载盘也不能串
    // 取消静音也须落盘（否则重启后"已取消"的又冒出来）。
    s2.setGroupMuted('g1', 'u1', false)
    expect(new JsonFileStore(path).isGroupMuted('g1', 'u1')).toBe(false)
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

  // 回归：常用地点(家/公司)的复合键在**载盘路径**曾内联成空格分隔，而写入/查找用 \x00 分隔——
  // 重启后同一 (ownerId,label) 写的键与查的键对不上。列表读取按 value.ownerId 过滤（与键无关）故幸存，
  // 但**按键操作**受害：重启后 deleteSavedPlace 静默空操作（删 NUL 键、空格键残留→地址删不掉又复活）、
  // upsert 造重复/显示旧地址。修=载盘复用 placeKey 单一真源。
  describe('SavedPlace 复合键重启一致性（回归）', () => {
    const place = (label: string): { ownerId: string; label: string; address: string; updatedAt: number } =>
      ({ ownerId: 'u1', label, address: `${label}-addr`, updatedAt: 1 })

    it('保存地点→新实例载盘后列表读回完整（value 过滤，键无关——旧码此路亦通，作正向守卫）', () => {
      const s1 = new JsonFileStore(path)
      s1.createUser(user('u1', 'alice'))
      s1.upsertSavedPlace(place('home'))
      s1.upsertSavedPlace(place('work'))
      // 载盘：全新实例从同一文件重建（等价服务重启）。
      const s2 = new JsonFileStore(path)
      expect(s2.savedPlacesForUser('u1').map((p) => p.label).sort()).toEqual(['home', 'work'])
      expect(s2.savedPlacesForUser('u1').find((p) => p.label === 'home')?.address).toBe('home-addr')
    })

    it('载盘后 delete/upsert 仍作用于同一条（键一致，无重复/无残留——旧码此路失败）', () => {
      const s1 = new JsonFileStore(path)
      s1.createUser(user('u1', 'alice'))
      s1.upsertSavedPlace(place('home'))
      const s2 = new JsonFileStore(path)
      // 载盘后覆盖：同 (owner,home) 必须覆盖而非新增（修复前键不一致会变两条）。
      s2.upsertSavedPlace({ ...place('home'), address: 'new-home', updatedAt: 2 })
      expect(s2.savedPlacesForUser('u1')).toHaveLength(1)
      expect(s2.savedPlacesForUser('u1')[0].address).toBe('new-home')
      // 载盘后删除必须命中（修复前空格键 → NUL 删除漏删，地址删不掉）。
      s2.deleteSavedPlace('u1', 'home')
      expect(s2.savedPlacesForUser('u1')).toHaveLength(0)
      // 再次载盘确认删除已落盘。
      expect(new JsonFileStore(path).savedPlacesForUser('u1')).toHaveLength(0)
    })
  })
})
