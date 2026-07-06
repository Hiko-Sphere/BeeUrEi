/// 从剪贴板 items 里取出图片文件（粘贴发图用）：只认 kind=file 且 image/* 的项，其余（纯文本/HTML/非图文件）
/// 一律返回 null——粘贴文字走默认输入行为，绝不被拦截。多图只取第一张（与文件选择器单选口径一致）。
export function imageFileFromClipboard(items: DataTransferItemList | readonly DataTransferItem[] | null | undefined): File | null {
  if (!items) return null
  for (const item of Array.from(items as ArrayLike<DataTransferItem>)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) return f
    }
  }
  return null
}
