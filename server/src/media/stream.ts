import type { FastifyRequest, FastifyReply } from 'fastify'
import { createReadStream, statSync } from 'node:fs'

/// 带 HTTP Range（206 断点/拖动）支持的媒体文件流式响应——供录制回看与视频消息**共用同一份**实现，
/// 避免两处各写一份漂移（此前仅录制端点支持 Range、视频消息端点是整文件流、无法在 <video>/原生播放器里
/// 拖动定位，且不宣告 Accept-Ranges）。授权已由各调用端在此之前完成，此函数只负责"给定路径 + mime 的
/// 流式响应"。private, no-store：私密媒体不落浏览器磁盘缓存（同录制口径）。
///
/// Range 解析覆盖：单区间 `bytes=start-end` / 前缀 `bytes=start-`（到文件尾）/ 后缀 `bytes=-N`（最后 N 字节，
/// MOV/MP4 播放器读片尾 moov 原子常用）；越界 end 夹到 size-1；不可满足（start>end 或 start≥size）→ 416；
/// 无/畸形 Range 或双空 `bytes=-` → 整文件 200（无 Range 时的常规下载路径，web fetch→blob 即走此）。
export function streamWithRange(req: FastifyRequest, reply: FastifyReply, path: string, mime: string): FastifyReply {
  const size = statSync(path).size
  reply.header('Accept-Ranges', 'bytes')
  reply.header('Content-Type', mime)
  reply.header('Cache-Control', 'private, no-store')
  const range = req.headers.range
  if (typeof range === 'string') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!m || (m[1] === '' && m[2] === '')) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send()
    }
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1])
    // 后缀区间 bytes=-N（最后 N 字节）：start=size-N、end 必须是 size-1，而非 N——
    // 否则如 bytes=-500 在 10000 字节文件上得 start=9500/end=500，被下方 start>end 误判 416。
    // 这类后缀请求合法且 MOV/MP4 播放器常用（读片尾 moov 原子）。
    let end = (m[2] === '' || m[1] === '') ? size - 1 : Number(m[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) start = 0
    if (end >= size) end = size - 1
    if (start > end || start >= size) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send()
    }
    reply.code(206)
    reply.header('Content-Range', `bytes ${start}-${end}/${size}`)
    reply.header('Content-Length', String(end - start + 1))
    return reply.send(createReadStream(path, { start, end }))
  }
  reply.header('Content-Length', String(size))
  return reply.send(createReadStream(path))
}
