// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar, Spinner } from './ui'

// 网页端首个组件渲染测试（jsdom + @testing-library/react）：验证组件测试基建可用，
// 并锁定到处复用的 Avatar 渲染逻辑（首字母提取 / 有图渲染 img / 空名兜底）。
describe('Avatar', () => {
  it('无 src：渲染姓名首字母（大写）', () => {
    render(<Avatar name="alice" />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('空名兜底为 "?"', () => {
    render(<Avatar name="" />)
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('emoji/增补平面字开头：按码点取整字（不截出半个代理对）', () => {
    render(<Avatar name="🎉派对" />)
    expect(screen.getByText('🎉')).toBeInTheDocument() // 完整 emoji，非半个代理对乱码
    render(<Avatar name="𠮷野家" />)                    // U+20BB7（增补平面）
    expect(screen.getByText('𠮷')).toBeInTheDocument()
  })

  it('有 src：渲染 <img>，不渲染首字母', () => {
    const { container } = render(<Avatar name="bob" src="data:image/png;base64,AAAA" />)
    expect(container.querySelector('img')).not.toBeNull()
    expect(screen.queryByText('B')).toBeNull()
  })
})

describe('Spinner 无障碍', () => {
  it('暴露 role=status 并带可朗读名称（读屏听得到"加载中"）', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toHaveAccessibleName('加载中') // 默认 ctx 为 zh
  })
})
