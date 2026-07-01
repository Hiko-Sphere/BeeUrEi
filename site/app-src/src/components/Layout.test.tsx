import { describe, it, expect } from 'vitest'
import { activeNavLabel } from './Layout'

// 路由切换朗读的最长前缀匹配（'/' 仅精确、子路由归属父项、未知回退）。
const nav = [
  { to: '/', label: '主页' },
  { to: '/calls', label: '通话' },
  { to: '/chat', label: '消息' },
  { to: '/admin', label: '管理' },
]

describe('activeNavLabel 路由→页名（aria-live 朗读）', () => {
  it("'/' 仅精确匹配，不被任何子路由借用", () => {
    expect(activeNavLabel('/', nav, 'BeeUrEi')).toBe('主页')
    // 子路由不得回落到 '/'（否则每页都播报"主页"）。
    expect(activeNavLabel('/calls', nav, 'BeeUrEi')).toBe('通话')
  })

  it('精确导航路由', () => {
    expect(activeNavLabel('/chat', nav, 'BeeUrEi')).toBe('消息')
  })

  it('子路由归属其父导航项（/chat/:id→消息、/admin/reports→管理）', () => {
    expect(activeNavLabel('/chat/u123', nav, 'BeeUrEi')).toBe('消息')
    expect(activeNavLabel('/admin/reports', nav, 'BeeUrEi')).toBe('管理')
  })

  it('前缀相似但非路径段边界的不误匹配（/chatroom≠/chat）', () => {
    // startsWith('/chat/') 要求斜杠边界，故 '/chatroom' 不该命中 /chat。
    expect(activeNavLabel('/chatroom', nav, 'BeeUrEi')).toBe('BeeUrEi')
  })

  it('未知路由回退到 fallback', () => {
    expect(activeNavLabel('/nope', nav, 'BeeUrEi')).toBe('BeeUrEi')
  })
})
