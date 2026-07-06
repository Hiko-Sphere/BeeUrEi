import { describe, it, expect } from 'vitest'
import { shareTtlSec, SHARE_DURATIONS } from './locationShare'

describe('shareTtlSec（定时共享 → 上报 ttlSec）', () => {
  const now = 1_000_000
  it('无截止（deadline<=0）→ undefined（用服务端默认、不自动停）', () => {
    expect(shareTtlSec(0, now)).toBeUndefined()
    expect(shareTtlSec(-1, now)).toBeUndefined()
  })
  it('普通剩余取秒（向上取整），落在 [60,3600]', () => {
    expect(shareTtlSec(now + 900_000, now)).toBe(900)    // 15 分钟
    expect(shareTtlSec(now + 100_500, now)).toBe(101)    // 向上取整
  })
  it('剩余 > 1 小时封顶 3600（服务端上限；客户端本地定时器负责真正停）', () => {
    expect(shareTtlSec(now + 8 * 3600_000, now)).toBe(3600)
  })
  it('剩余 < 60s（临近截止）夹到 60（服务端下限）', () => {
    expect(shareTtlSec(now + 5_000, now)).toBe(60)
    expect(shareTtlSec(now - 1000, now)).toBe(60) // 已过点（定时器应已触发停止）也不产出非法 ttl
  })
})

describe('SHARE_DURATIONS 选项', () => {
  it('含"直到我停止"(sec=0) 与至少一个有界时长；双语非空', () => {
    expect(SHARE_DURATIONS.some((o) => o.sec === 0)).toBe(true)
    expect(SHARE_DURATIONS.some((o) => o.sec > 0)).toBe(true)
    for (const o of SHARE_DURATIONS) { expect(o.zh).toBeTruthy(); expect(o.en).toBeTruthy() }
  })
})
