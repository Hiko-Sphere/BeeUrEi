/// 录音导出文件的扩展名 / 文件名（GDPR 数据可携权的「媒体下载通道」：自助数据导出刻意不内联媒体、
/// 注明媒体另有下载通道，即 Recordings 页的下载按钮）。**扩展名必须与实际媒体格式相符**——否则导出的
/// 文件在用户系统里用错误的应用打开、或被当成损坏文件，可携权形同虚设。纯函数、可单测。
///
/// 媒体 MIME 来源：MediaRecorder(web) 多产 `video/webm`；ReplayKit(iOS) 产 `video/quicktime` 或 mp4；
/// 纯音频通话产 `audio/mp4` 等。MIME 常带 codec 参数（如 `video/webm;codecs="vp8, opus"`），须先剥参数再判。

const MIME_EXT: Record<string, string> = {
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/x-matroska': 'mkv',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3', // ← mp3；旧内联逻辑把它误归 m4a（audio/ 兜底），导出的 mp3 带错扩展名
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

/// 由媒体 MIME 推导下载扩展名（不含点）。剥 codec 参数 + 小写归一后精确匹配；未知/缺失时音频归 m4a、
/// 其余（视频/空串/application/octet-stream 等）归 mp4——两者都是最通用容器，播放器多能兜底识别。
export function recordingFileExt(mimeType: string | undefined | null): string {
  const base = (mimeType ?? '').split(';')[0].trim().toLowerCase() // `video/webm;codecs="vp8, opus"` → `video/webm`
  if (MIME_EXT[base]) return MIME_EXT[base]
  if (base.startsWith('audio/')) return 'm4a'
  return 'mp4'
}

/// 完整下载文件名：`beeurei-recording-YYYYMMDD-HHMM.<ext>`（本地时刻，便于用户辨识哪次通话）。
/// recordedAt 非有限（坏记录）→ 省略时刻段，仍给出带正确扩展名的可用文件名（绝不产出 `NaNNaN` 脏名）。
export function recordingFileName(recordedAt: number, mimeType: string | undefined | null): string {
  const ext = recordingFileExt(mimeType)
  if (!Number.isFinite(recordedAt)) return `beeurei-recording.${ext}`
  const d = new Date(recordedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `beeurei-recording-${stamp}.${ext}`
}
