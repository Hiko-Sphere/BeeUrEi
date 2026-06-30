// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './ui'

describe('Modal 无障碍与关闭语义', () => {
  it('暴露 role=dialog + aria-modal + 可朗读名', () => {
    render(<Modal onClose={() => {}} label="群信息"><p>内容</p></Modal>)
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName('群信息')
    expect(dlg).toHaveTextContent('内容')
  })

  it('按 Esc 关闭', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} label="x"><p>c</p></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点遮罩关闭、点面板内不关闭', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} label="x"><p>面板内容</p></Modal>)
    fireEvent.click(screen.getByText('面板内容')) // 面板内 → stopPropagation，不关闭
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog').parentElement!) // 遮罩 → 关闭
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('卸载后移除 keydown 监听（Esc 不再触发）', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Modal onClose={onClose} label="x"><p>c</p></Modal>)
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('开弹窗焦点移入面板；关弹窗恢复到打开前的元素', () => {
    document.body.innerHTML = '<button id="trigger">打开</button>'
    const trigger = document.getElementById('trigger') as HTMLButtonElement
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    const { unmount } = render(<Modal onClose={() => {}} label="设置"><p>内容</p></Modal>)
    expect(document.activeElement).toBe(screen.getByRole('dialog')) // 焦点入面板
    unmount()
    expect(document.activeElement).toBe(trigger) // 焦点还给触发按钮
  })
})
