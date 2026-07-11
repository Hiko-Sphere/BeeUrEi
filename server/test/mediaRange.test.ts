import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 视频消息媒体下载支持 HTTP Range（206 断点/拖动）——与录制回看端点共用 streamWithRange。
// 让 <video>/原生播放器可拖动定位、按需取片段，而非整文件下载；无 Range 头时走整文件 200（web fetch→blob 即此）。
describe('GET /api/media/:id — HTTP Range 支持', () => {
  async function seedMedia() {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'rangeu', password: 'secret123', role: 'blind' } })).json()
    const token = reg.token as string
    // 10 字节已知内容，便于逐字节断言片段正确。
    const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const up = await a.inject({ method: 'POST', url: '/api/media', headers: { authorization: `Bearer ${token}`, 'content-type': 'video/mp4' }, payload: bytes })
    expect(up.statusCode).toBe(201)
    return { a, token, id: up.json().media.id as string, bytes }
  }
  const auth = (t: string) => ({ authorization: `Bearer ${t}` })

  it('无 Range → 200 整文件 + Accept-Ranges: bytes（web fetch→blob 路径不变）', async () => {
    const { a, token, id, bytes } = await seedMedia()
    const r = await a.inject({ method: 'GET', url: `/api/media/${id}`, headers: auth(token) })
    expect(r.statusCode).toBe(200)
    expect(r.headers['accept-ranges']).toBe('bytes')            // 宣告可断点续传/拖动
    expect(r.headers['content-length']).toBe('10')
    expect(Buffer.from(r.rawPayload)).toEqual(bytes)            // 整文件
    await a.close()
  })

  it('Range: bytes=0-3 → 206 + Content-Range + 恰前 4 字节', async () => {
    const { a, token, id, bytes } = await seedMedia()
    const r = await a.inject({ method: 'GET', url: `/api/media/${id}`, headers: { ...auth(token), range: 'bytes=0-3' } })
    expect(r.statusCode).toBe(206)
    expect(r.headers['content-range']).toBe('bytes 0-3/10')
    expect(r.headers['content-length']).toBe('4')
    expect(Buffer.from(r.rawPayload)).toEqual(bytes.subarray(0, 4)) // [0,1,2,3]
    await a.close()
  })

  it('Range: bytes=4- （到文件尾）→ 206 恰后 6 字节', async () => {
    const { a, token, id, bytes } = await seedMedia()
    const r = await a.inject({ method: 'GET', url: `/api/media/${id}`, headers: { ...auth(token), range: 'bytes=4-' } })
    expect(r.statusCode).toBe(206)
    expect(r.headers['content-range']).toBe('bytes 4-9/10')
    expect(Buffer.from(r.rawPayload)).toEqual(bytes.subarray(4)) // [4..9]
    await a.close()
  })

  it('后缀 Range: bytes=-3 （最后 3 字节，MP4 播放器读片尾 moov 常用）→ 206 末 3 字节', async () => {
    const { a, token, id, bytes } = await seedMedia()
    const r = await a.inject({ method: 'GET', url: `/api/media/${id}`, headers: { ...auth(token), range: 'bytes=-3' } })
    expect(r.statusCode).toBe(206)
    expect(r.headers['content-range']).toBe('bytes 7-9/10')     // 不是 bytes 7-3（后缀区间 end=size-1 的回归护栏）
    expect(Buffer.from(r.rawPayload)).toEqual(bytes.subarray(7)) // [7,8,9]
    await a.close()
  })

  it('不可满足的 Range（start≥size）→ 416 + Content-Range: bytes */size', async () => {
    const { a, token, id } = await seedMedia()
    const r = await a.inject({ method: 'GET', url: `/api/media/${id}`, headers: { ...auth(token), range: 'bytes=20-30' } })
    expect(r.statusCode).toBe(416)
    expect(r.headers['content-range']).toBe('bytes */10')
    await a.close()
  })

  it('越界 end 夹到 size-1（bytes=8-99）→ 206 到文件尾', async () => {
    const { a, token, id, bytes } = await seedMedia()
    const r = await a.inject({ method: 'GET', url: `/api/media/${id}`, headers: { ...auth(token), range: 'bytes=8-99' } })
    expect(r.statusCode).toBe(206)
    expect(r.headers['content-range']).toBe('bytes 8-9/10')
    expect(Buffer.from(r.rawPayload)).toEqual(bytes.subarray(8)) // [8,9]
    await a.close()
  })
})
