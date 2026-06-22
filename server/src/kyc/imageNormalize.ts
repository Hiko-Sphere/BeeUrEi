/// KYC 证件图片归一化（纯 Node，无原生依赖）。
///
/// 安全目标：手机拍摄的证件照常携带 GPS/EXIF（家庭住址级 PII）。落库前必须剥离。
/// 做法——magic-byte 嗅探 + 解析图片结构、丢弃携带 PII 的元数据段，保留像素与色彩信息：
///   · JPEG：丢弃 APP1(EXIF/XMP/GPS)、APP13(Photoshop/IPTC)、COM 注释；保留 JFIF/ICC/Adobe 等渲染必需段。
///   · PNG：仅保留关键块与色彩辅助块，丢弃 eXIf/tEXt/zTXt/iTXt/tIME 等文本/元数据块。
/// 解析失败（结构非法/伪装多格式文件）即抛错——既剥元数据，也作为输入校验拒绝畸形/多语言文件。
/// 客户端（iOS/Web）另会在上传前重编码为 JPEG（canvas/AVFoundation 天然丢 EXIF），此处为服务端纵深防御。
/// 仅接受 JPEG / PNG；HEIC/WebP 等返回 null，路由据此 415（客户端统一上传 JPEG）。

export type ImageKind = 'jpeg' | 'png'

/// 按 magic byte 嗅探真实类型（不信任 Content-Type）。
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'png'
  }
  return null
}

// JPEG 中需丢弃（携带 PII）的标记：APP1=EXIF/XMP/GPS，APP13=Photoshop/IPTC，FE=COM 注释。
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe])

function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG (SOI missing)')
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])] // SOI
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error('JPEG corrupt: expected marker')
    // 跳过填充 FF
    let marker = buf[i + 1]
    while (marker === 0xff && i + 1 < buf.length) {
      i++
      marker = buf[i + 1]
    }
    if (marker === undefined) throw new Error('JPEG corrupt: truncated marker')
    // SOS(DA)：其后是熵编码扫描数据，直到文件尾（含内部 RSTn）。原样保留剩余全部。
    if (marker === 0xda) {
      out.push(buf.subarray(i))
      return Buffer.concat(out)
    }
    // 无长度的独立标记：RSTn(D0-D7)、TEM(01)。理论上不应出现在此处，保守保留。
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2))
      i += 2
      continue
    }
    // 带长度标记：FF marker len(2, 含自身) data...
    const len = buf.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > buf.length) throw new Error('JPEG corrupt: bad segment length')
    const segEnd = i + 2 + len
    if (!JPEG_DROP.has(marker)) {
      out.push(buf.subarray(i, segEnd)) // 保留（JFIF/ICC/Adobe/DQT/DHT/SOF…）
    }
    i = segEnd
  }
  throw new Error('JPEG corrupt: no SOS scan found')
}

// PNG 中保留的块（关键块 + 色彩/渲染辅助块）；其余（eXIf/tEXt/zTXt/iTXt/tIME…）一律丢弃。
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', // 关键块
  'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'hIST', // 渲染/色彩辅助
])

function stripPng(buf: Buffer): Buffer {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG (signature)')
  const out: Buffer[] = [SIG]
  let i = 8
  let sawIHDR = false
  let sawIDAT = false
  let sawIEND = false
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.toString('ascii', i + 4, i + 8)
    const chunkEnd = i + 12 + len // length(4) + type(4) + data(len) + crc(4)
    if (len > buf.length || chunkEnd > buf.length) throw new Error('PNG corrupt: bad chunk length')
    if (type === 'IHDR') sawIHDR = true
    if (type === 'IDAT') sawIDAT = true
    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, chunkEnd))
    if (type === 'IEND') {
      sawIEND = true
      break
    }
    i = chunkEnd
  }
  if (!sawIHDR || !sawIDAT || !sawIEND) throw new Error('PNG corrupt: missing required chunks')
  return Buffer.concat(out)
}

/// 嗅探 + 剥离元数据。返回归一化后的字节与规范 mime。不可识别/畸形即抛错。
export function normalizeImage(buf: Buffer): { buf: Buffer; mime: string } {
  const kind = sniffImage(buf)
  if (kind === 'jpeg') return { buf: stripJpeg(buf), mime: 'image/jpeg' }
  if (kind === 'png') return { buf: stripPng(buf), mime: 'image/png' }
  throw new Error('unsupported image format (only JPEG and PNG accepted)')
}
