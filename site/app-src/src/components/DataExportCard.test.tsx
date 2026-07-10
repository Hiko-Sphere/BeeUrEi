// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/api', () => ({ fetchAccountExportBlob: vi.fn(), APIError: class extends Error { status = 0 } }))
import { fetchAccountExportBlob, APIError } from '../lib/api'
import { DataExportCard } from './DataExportCard'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('DataExportCard 数据导出（GDPR 可携权）', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('点「下载我的数据」→ 取 Blob、以 beeurei-my-data.json 触发下载、revoke', async () => {
    mock(fetchAccountExportBlob).mockResolvedValue(new Blob([JSON.stringify({ profile: {} })], { type: 'application/json' }))
    const createURL = vi.fn(() => 'blob:dl'); const revokeURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: createURL, revokeObjectURL: revokeURL }))
    const names: string[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
    try {
      render(<DataExportCard />)
      fireEvent.click(screen.getByRole('button', { name: '下载我的数据' }))
      await waitFor(() => expect(fetchAccountExportBlob).toHaveBeenCalled())
      await waitFor(() => expect(names).toEqual(['beeurei-my-data.json']))
      expect(revokeURL).toHaveBeenCalledWith('blob:dl') // 用后即 revoke，不泄漏
    } finally { clickSpy.mockRestore(); vi.unstubAllGlobals() }
  })

  it('限流 429 → 明确提示"每小时最多 3 次"，不触发下载', async () => {
    const err = new APIError('rate_limited', 429); (err as { status: number }).status = 429
    mock(fetchAccountExportBlob).mockRejectedValue(err)
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    render(<DataExportCard />)
    fireEvent.click(screen.getByRole('button', { name: '下载我的数据' }))
    await waitFor(() => expect(fetchAccountExportBlob).toHaveBeenCalled())
    expect(clickSpy).not.toHaveBeenCalled() // 失败不下载
    clickSpy.mockRestore()
  })
})
