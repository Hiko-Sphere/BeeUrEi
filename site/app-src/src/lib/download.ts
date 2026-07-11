/// 触发浏览器把一个 Blob "另存为"文件（数据导出 / 录音下载等）。全站下载走这一处，杜绝各调用点各写一遍
/// 又踩同一个坑。
///
/// **延迟 revoke 是关键**：`a.click()` 后**同步** `URL.revokeObjectURL(url)` 是跨浏览器已知下载 footgun——
/// - Firefox / 某些 Safari 在 click 返回后才**异步**开始读取 blob，同步撤销 → 读到已失效 URL；
/// - 用户开了"下载前询问保存位置"时，浏览器要等其在"另存为"对话框确认后（可能数秒）才读 blob，URL 早被撤销。
/// 二者都导致下载**空文件/失败**。故延后释放（对标 FileSaver），给足下载真正开始 / 对话框确认的时间；blob 已在
/// 内存，仅这次下载短暂多占，到点即释放不泄漏。不随组件卸载清除（click 已发出，卸载后仍需释放这段内存；revoke
/// 无副作用、不触 React）。
export const OBJECT_URL_REVOKE_DELAY_MS = 60_000

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS)
}
