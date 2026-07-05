// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComplianceBanner } from './CallScreen'

// 合规告知横幅（被监看/被录制）：role="alert" 让读屏在横幅**出现时主动朗读**——盲人有权即时知道自己
// 正被录制/监看（隐私/知情同意），而非纯视觉、非导航到该横幅不可知。
describe('ComplianceBanner', () => {
  it('渲染 role="alert"（出现即读屏主动播报）+ 原样透传内容', () => {
    render(<ComplianceBanner tone="honey"><span>管理员正在监看本次通话</span></ComplianceBanner>)
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('管理员正在监看本次通话')
  })

  it('danger 底色用于"对方正在录制"，同样 role="alert"', () => {
    render(<ComplianceBanner tone="danger"><span>对方正在录制本次通话</span></ComplianceBanner>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('对方正在录制本次通话')
    expect(alert.className).toContain('bg-danger/20')
  })
})
