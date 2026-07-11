// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/api', () => ({
  api: { savedPlaces: vi.fn(), upsertPlace: vi.fn(), deletePlace: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { SavedPlaces } from './SavedPlaces'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('SavedPlaces 常用地点（地理围栏）管理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.savedPlaces).mockResolvedValue({ places: [
      { ownerId: 'me', label: '家', address: '北京市朝阳区幸福路1号', lat: 39.9, lng: 116.4, updatedAt: 1 },
      { ownerId: 'me', label: '公司', address: '一个查不到的地址', lat: null, lng: null, updatedAt: 2 }, // 无坐标：围栏未生效
    ] })
    mock(api.upsertPlace).mockResolvedValue({ place: { ownerId: 'me', label: '医院', address: '协和医院', lat: 39.9, lng: 116.4, updatedAt: 3 } })
    mock(api.deletePlace).mockResolvedValue({ ok: true })
  })

  it('列出已保存地点；有坐标者给"在地图上核对"外链、无坐标者如实标注"未能定位…暂无到达提醒"', async () => {
    render(<SavedPlaces />)
    expect(await screen.findByText('家')).toBeInTheDocument()
    expect(screen.getByText('北京市朝阳区幸福路1号')).toBeInTheDocument()
    expect(screen.getByText('公司')).toBeInTheDocument()
    // 有坐标的"家"给核对外链，href 含其坐标（让用户亲眼确认地理编码落对地方）。
    const verify = screen.getByRole('link', { name: '在地图上核对 家 的位置是否正确' })
    expect(verify).toHaveAttribute('href', expect.stringContaining('39.9,116.4'))
    expect(verify).toHaveAttribute('target', '_blank')
    // 无坐标的"公司"：无核对链接、如实标注无到达提醒（不谎称围栏生效）。
    expect(screen.getByText('未能定位此地址，暂无到达提醒')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /在地图上核对 公司/ })).toBeNull()
  })

  it('填名称+地址→保存调 upsertPlace(label,address) 并重载列表', async () => {
    render(<SavedPlaces />)
    await screen.findByText('家')
    fireEvent.change(screen.getByLabelText('地点名称'), { target: { value: '医院' } })
    fireEvent.change(screen.getByLabelText('地址'), { target: { value: '协和医院' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(api.upsertPlace).toHaveBeenCalledWith('医院', '协和医院'))
    await waitFor(() => expect(api.savedPlaces).toHaveBeenCalledTimes(2)) // 挂载 + 保存后重载
  })

  it('删除→确认后调 deletePlace(label)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SavedPlaces />)
    await screen.findByText('家')
    fireEvent.click(screen.getByRole('button', { name: '删除常用地点 家' }))
    await waitFor(() => expect(api.deletePlace).toHaveBeenCalledWith('家'))
  })

  it('删除确认取消→绝不调用 deletePlace（防误删围栏，家人靠它知你何时到）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SavedPlaces />)
    await screen.findByText('家')
    fireEvent.click(screen.getByRole('button', { name: '删除常用地点 家' }))
    await Promise.resolve()
    expect(api.deletePlace).not.toHaveBeenCalled()
  })
})
