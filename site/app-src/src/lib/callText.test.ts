import { describe, it, expect } from 'vitest'
import { validCallText, callTextRejectText, CALL_TEXT_MAX } from './webrtc'

const t = (zh: string) => zh

describe('validCallText 通话内文字客户端校验（与服务端 ws.ts 同口径）', () => {
  it('正常文本 trim 后放行', () => {
    expect(validCallText('  前面路口左转  ')).toBe('前面路口左转')
  })
  it('空/纯空白 → null（不发送）', () => {
    expect(validCallText('')).toBeNull()
    expect(validCallText('   ')).toBeNull()
  })
  it('长度上限 500：临界放行、超限拒绝（与服务端一致，免得发出才被拒）', () => {
    expect(validCallText('x'.repeat(CALL_TEXT_MAX))).toHaveLength(500)
    expect(validCallText('x'.repeat(CALL_TEXT_MAX + 1))).toBeNull()
  })
})

describe('callTextRejectText 服务端拒绝回执→用户文案（不念原始码）', () => {
  it('content_blocked / rate_limited / 未知码 各有可行动中文文案', () => {
    expect(callTextRejectText('content_blocked', t)).toContain('违禁')
    expect(callTextRejectText('rate_limited', t)).toContain('太快')
    expect(callTextRejectText('invalid_text', t)).toContain('无效')
    expect(callTextRejectText('whatever_new_code', t)).not.toContain('whatever')
  })
})
