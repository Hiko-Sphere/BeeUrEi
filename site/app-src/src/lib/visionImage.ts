/// 送 AI 描述前把图片**降采样**——与 iOS VisionImageEncoding 同口径（长边 ≤1024、JPEG 0.85、绝不放大）。
/// 为何：聊天图片可达 50MB，而 /api/vision/describe 上限 5MB；此前 web 直接发原图，大图被 413「太大」拒、
/// 无法描述——而 iOS 早已降采样、正常描述（跨端不一致）。1024px@0.85 约 200–400KB，远小于 5MB 且够清晰供识别/OCR。

export const MAX_LONG_SIDE = 1024
export const JPEG_QUALITY = 0.85

export type VisionMime = 'image/jpeg' | 'image/png' | 'image/webp'

/// 等比缩放到长边 ≤ maxLongSide：**绝不放大**（小图原样）；非有限/≤0 → 原样取整兜底。纯逻辑可单测（同 iOS fittedSize）。
export function fittedSize(width: number, height: number, maxLongSide = MAX_LONG_SIDE): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: Math.max(1, Math.round(width) || 1), height: Math.max(1, Math.round(height) || 1) }
  }
  const longSide = Math.max(width, height)
  if (longSide <= maxLongSide) return { width: Math.round(width), height: Math.round(height) } // 未超上限：不放大
  const scale = maxLongSide / longSide
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/// 把 data URL 图片降采样成 JPEG data URL（供 visionDescribe）。加载/画布失败 → **回退原图**（best-effort，
/// 绝不因降采样失败而完全无法描述；小图照常，大图回退仍可能 413 但优于直接不可用）。
export async function downscaleForVision(dataUrl: string, maxLongSide = MAX_LONG_SIDE, quality = JPEG_QUALITY): Promise<{ dataUrl: string; mime: VisionMime }> {
  const fallbackMime = ((/^data:(image\/(?:jpeg|png|webp));base64,/.exec(dataUrl)?.[1]) ?? 'image/jpeg') as VisionMime
  try {
    if (typeof document === 'undefined') return { dataUrl, mime: fallbackMime } // 非浏览器环境（SSR/测试）：原样
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('image_load_failed'))
      img.src = dataUrl
    })
    const { width, height } = fittedSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxLongSide)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { dataUrl, mime: fallbackMime }
    ctx.drawImage(img, 0, 0, width, height)
    return { dataUrl: canvas.toDataURL('image/jpeg', quality), mime: 'image/jpeg' }
  } catch {
    return { dataUrl, mime: fallbackMime }
  }
}
