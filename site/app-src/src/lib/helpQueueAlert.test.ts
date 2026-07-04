import { describe, it, expect } from 'vitest'
import { pickNewHelpRequests } from './helpQueueAlert'
import type { HelpRequest } from './api'

const req = (callId: string, fromName = '盲人用户'): HelpRequest => ({ callId, fromName, waitedSeconds: 5 })

describe('pickNewHelpRequests（求助队列新到挑选）', () => {
  it('首轮全部为新；已提示过的不重复；集合更新为当前队列', () => {
    const r1 = pickNewHelpRequests([req('a'), req('b')], new Set())
    expect(r1.fresh.map((r) => r.callId)).toEqual(['a', 'b'])       // 打开页面时已有排队者也要提示（他们正在等）
    expect([...r1.nextAlerted].sort()).toEqual(['a', 'b'])
    const r2 = pickNewHelpRequests([req('a'), req('b'), req('c')], r1.nextAlerted)
    expect(r2.fresh.map((r) => r.callId)).toEqual(['c'])            // 只提示新来的 c
  })

  it('离队 id 被剪掉（集合有界）；同 id 再回队会再次提示（确实又在等）', () => {
    const r1 = pickNewHelpRequests([req('a')], new Set())
    const r2 = pickNewHelpRequests([], r1.nextAlerted)              // a 被认领/过期离队
    expect(r2.fresh).toEqual([])
    expect(r2.nextAlerted.size).toBe(0)                             // 集合随队列清空
    const r3 = pickNewHelpRequests([req('a')], r2.nextAlerted)      // a 再次排队
    expect(r3.fresh.map((r) => r.callId)).toEqual(['a'])            // 重新提示
  })

  it('空队列/无变化不出新', () => {
    expect(pickNewHelpRequests([], new Set()).fresh).toEqual([])
    const seen = new Set(['a'])
    expect(pickNewHelpRequests([req('a')], seen).fresh).toEqual([])
  })
})
