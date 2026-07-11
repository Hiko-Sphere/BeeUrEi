import { describe, it, expect } from 'vitest'
import { TtlDedup } from '../src/location/ttlDedup'

// 按 key 的 TTL 去重（"请求共享位置"nudge 防轰炸）+ 有界（陈旧用户对不无限累积）。
describe('TtlDedup', () => {
  it('首次放行；TTL 内重复被去重；超 TTL 再次放行', () => {
    const d = new TtlDedup(5 * 60_000)
    const K = 'a:b'
    expect(d.tryPass(K, 1_000_000)).toBe(true)          // 首次放行
    expect(d.tryPass(K, 1_000_000 + 60_000)).toBe(false) // 1min 后仍在 5min 窗口 → 去重
    expect(d.tryPass(K, 1_000_000 + 4 * 60_000)).toBe(false) // 4min，仍窗口内
    expect(d.tryPass(K, 1_000_000 + 5 * 60_000)).toBe(true)  // 满 5min → 再放行（并刷新基准）
    expect(d.tryPass(K, 1_000_000 + 5 * 60_000 + 1)).toBe(false) // 刚放行 → 又进窗口
  })

  it('去重时不刷新基准（重复打扰不能靠不停戳来续窗）', () => {
    const d = new TtlDedup(5 * 60_000)
    const K = 'x:y'
    expect(d.tryPass(K, 0)).toBe(true)
    expect(d.tryPass(K, 4 * 60_000)).toBe(false) // 去重，不记录 4min 这次
    // 若去重也刷新基准，则 5min 处距"4min"仅 1min 仍被去重；正确行为是距首次已满 5min → 放行。
    expect(d.tryPass(K, 5 * 60_000)).toBe(true)
  })

  it('不同 key 相互独立', () => {
    const d = new TtlDedup(60_000)
    expect(d.tryPass('a:b', 0)).toBe(true)
    expect(d.tryPass('a:c', 0)).toBe(true)  // 不同目标 → 独立放行
    expect(d.tryPass('b:a', 0)).toBe(true)  // 方向不同 → 独立
    expect(d.tryPass('a:b', 0)).toBe(false) // 同 key 才去重
  })

  it('有界：超 maxEntries 时清理 TTL 外陈旧条目，size 不随累积无限膨胀', () => {
    const ttl = 1_000
    const d = new TtlDedup(ttl, 100) // maxEntries=100
    // t=0 灌 100 个不同对（各放行一次）。
    for (let i = 0; i < 100; i++) expect(d.tryPass(`u:${i}`, 0)).toBe(true)
    expect(d.size).toBe(100)
    // 时间推进到 TTL 之后，再来一个新对触发清理：t=5000 时前 100 个都已 TTL 外 → 被清，只余新的 1 个。
    expect(d.tryPass('u:new', 5_000)).toBe(true)
    expect(d.size).toBe(1) // 陈旧条目已回收，非 101——证明有界，不泄漏
  })

  it('requestersFor：反查 TTL 内请求过某 target 的请求者；过 TTL 不返；clear 后不再返', () => {
    const d = new TtlDedup(5 * 60_000)
    d.tryPass('r1:target', 0)   // r1 请求 target
    d.tryPass('r2:target', 1000) // r2 也请求 target
    d.tryPass('r3:other', 0)     // 请求的是别人
    expect(d.requestersFor('target', 2000).sort()).toEqual(['r1', 'r2']) // 窗口内两个请求者
    expect(d.requestersFor('other', 2000)).toEqual(['r3'])
    // 过 TTL → 不返（陈旧请求不再反馈）。
    expect(d.requestersFor('target', 6 * 60_000)).toEqual([])
    // clear 后该请求者不再返（已反馈，避免重复）。
    d.clear('r1:target')
    expect(d.requestersFor('target', 2000)).toEqual(['r2'])
  })

  it('有界清理不误伤仍在窗口内的条目', () => {
    const ttl = 10_000
    const d = new TtlDedup(ttl, 3) // 极小阈值便于触发
    d.tryPass('a', 0)      // 将过期
    d.tryPass('b', 9_000)  // t=9000，仍新鲜
    d.tryPass('c', 9_000)
    d.tryPass('d', 9_000)  // 此刻 size=4>3 → 清理：a(距今 9000<10000 未过期？) —— a 在 t=9000 时距 0 是 9000<10000 仍窗口内
    // 上一步清理时 now=9000，a 距今 9000 < ttl 10000 → a 不该被清。size 保持 4。
    expect(d.size).toBe(4)
    // 推进到 t=11000，a 已过期；再来 e 触发清理 → a 被清，其余（b/c/d 距 9000=2000<10000）保留 + e。
    d.tryPass('e', 11_000)
    expect(d.size).toBe(4) // b,c,d,e（a 被回收）
  })
})
