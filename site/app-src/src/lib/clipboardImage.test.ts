// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { imageFileFromClipboard } from './clipboardImage'

const fileItem = (type: string, f: File | null = new File(['x'], 'x', { type })) =>
  ({ kind: 'file', type, getAsFile: () => f }) as unknown as DataTransferItem
const textItem = () => ({ kind: 'string', type: 'text/plain', getAsFile: () => null }) as unknown as DataTransferItem

describe('imageFileFromClipboard（粘贴发图的图片提取）', () => {
  it('图片文件项 → 返回该文件；纯文本/非图文件/空 → null（粘贴文字绝不被拦截）', () => {
    expect(imageFileFromClipboard([fileItem('image/png')])?.type).toBe('image/png')
    expect(imageFileFromClipboard([textItem()])).toBeNull()
    expect(imageFileFromClipboard([fileItem('application/pdf')])).toBeNull()
    expect(imageFileFromClipboard([])).toBeNull()
    expect(imageFileFromClipboard(null)).toBeNull()
    expect(imageFileFromClipboard(undefined)).toBeNull()
  })

  it('混合项（文本+图片）→ 取图片；getAsFile 为 null 的坏项跳过', () => {
    const img = new File(['x'], 'shot.png', { type: 'image/png' })
    expect(imageFileFromClipboard([textItem(), fileItem('image/png', img)])).toBe(img)
    expect(imageFileFromClipboard([fileItem('image/png', null), textItem()])).toBeNull() // 坏项不炸、老实返回 null
  })
})
