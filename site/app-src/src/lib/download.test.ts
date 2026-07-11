// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveBlob, OBJECT_URL_REVOKE_DELAY_MS } from './download'

describe('saveBlob 触发下载 + 延迟释放 objectURL', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('建 URL、a.download=文件名、click 触发下载；objectURL **延迟** revoke（不同步——避免"另存为"对话框/异步下载读到已失效 URL 致空文件）', () => {
    const createURL = vi.fn(() => 'blob:x')
    const revokeURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: createURL, revokeObjectURL: revokeURL }))
    let clickedName = ''
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clickedName = this.download })
    vi.useFakeTimers()

    saveBlob(new Blob(['{"data":1}'], { type: 'application/json' }), 'beeurei-my-data.json')

    expect(createURL).toHaveBeenCalledTimes(1)
    expect(clickedName).toBe('beeurei-my-data.json') // a.download 文件名生效
    expect(document.querySelector('a')).toBeNull()   // 锚点点击后即移除，不留 DOM 残留
    expect(revokeURL).not.toHaveBeenCalled()         // **回归护栏**：绝不同步 revoke（否则下载可能读到已失效 URL）

    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS)
    expect(revokeURL).toHaveBeenCalledWith('blob:x') // 延迟到点后才释放，不泄漏
    clickSpy.mockRestore()
  })

  it('延迟未到点前 URL 一直有效（对话框/慢下载期间不被撤销）', () => {
    const revokeURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: vi.fn(() => 'blob:y'), revokeObjectURL: revokeURL }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.useFakeTimers()

    saveBlob(new Blob(['x']), 'f.bin')
    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS - 1) // 差 1ms 到点
    expect(revokeURL).not.toHaveBeenCalled()               // 仍有效
    vi.advanceTimersByTime(1)
    expect(revokeURL).toHaveBeenCalledWith('blob:y')       // 到点释放
    clickSpy.mockRestore()
  })
})
