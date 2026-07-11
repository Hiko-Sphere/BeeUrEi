import { describe, it, expect } from 'vitest'
import { sniffImage, normalizeImage } from '../src/kyc/imageNormalize'

// 真实字节构造（无 mock）：手工拼最小合法 JPEG/PNG + 携 PII 的元数据段，验证嗅探与剥离。
const B = (...bytes: number[]) => Buffer.from(bytes)
/// JPEG 段：FF marker len(2, =data+2) data
function jseg(marker: number, data: Buffer): Buffer {
  const len = Buffer.alloc(2); len.writeUInt16BE(data.length + 2, 0)
  return Buffer.concat([B(0xff, marker), len, data])
}
const SOI = B(0xff, 0xd8)
const SOS_TAIL = Buffer.concat([B(0xff, 0xda, 0x00, 0x02), B(0x11, 0x22, 0x33), B(0xff, 0xd9)]) // SOS + 扫描 + EOI
/// PNG 块：len(4) type(4) data crc(4，此处剥离逻辑不校验 CRC，用零占位）
function pchunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)])
}
const PNG_SIG = B(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

describe('sniffImage 按 magic byte 嗅探真实类型（不信任 Content-Type）', () => {
  it('JPEG(FF D8 FF)→jpeg；PNG 8 字节签名→png', () => {
    expect(sniffImage(B(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(sniffImage(PNG_SIG)).toBe('png')
  })
  it('非 JPEG/PNG（WebP/GIF/HEIC/纯文本）→ null（路由据此 415）', () => {
    expect(sniffImage(Buffer.from('RIFF????WEBPVP8 '))).toBeNull()           // WebP
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull()                     // GIF
    expect(sniffImage(B(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70))).toBeNull() // HEIC ftyp
    expect(sniffImage(Buffer.from('hello not an image'))).toBeNull()
  })
  it('过短缓冲（不足以判定）→ null，不越界读', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull()
    expect(sniffImage(B(0xff, 0xd8))).toBeNull()   // 仅 2 字节，JPEG 需 3
    expect(sniffImage(B(0x89, 0x50))).toBeNull()   // PNG 需 8
  })
})

describe('normalizeImage JPEG：剥 EXIF/GPS(APP1)/IPTC(APP13)/COM，保留 JFIF 与像素', () => {
  const jpeg = Buffer.concat([
    SOI,
    jseg(0xe0, Buffer.from('JFIF\x00KEEP_JFIF')),      // APP0：保留（渲染必需）
    jseg(0xe1, Buffer.from('Exif\x00\x00GPS_SECRET')), // APP1 EXIF/GPS：**须剥**（家庭住址级 PII）
    jseg(0xed, Buffer.from('IPTC_SECRET')),            // APP13：**须剥**
    jseg(0xfe, Buffer.from('COMMENT_SECRET')),         // COM 注释：**须剥**
    jseg(0xdb, B(0x00, 0x01, 0x02)),                   // DQT：保留
    SOS_TAIL,
  ])
  it('PII 段全部剥除、渲染段与扫描保留、输出仍是合法 JPEG', () => {
    const { buf, mime } = normalizeImage(jpeg)
    expect(mime).toBe('image/jpeg')
    expect(buf.includes(Buffer.from('GPS_SECRET'))).toBe(false)     // EXIF/GPS 剥净
    expect(buf.includes(Buffer.from('IPTC_SECRET'))).toBe(false)    // IPTC 剥净
    expect(buf.includes(Buffer.from('COMMENT_SECRET'))).toBe(false) // COM 剥净
    expect(buf.includes(Buffer.from('KEEP_JFIF'))).toBe(true)       // JFIF 保留
    expect(buf.includes(B(0x11, 0x22, 0x33))).toBe(true)            // 扫描像素保留
    expect(sniffImage(buf)).toBe('jpeg')                            // 输出可再被识别
    expect(buf.subarray(0, 2).equals(SOI)).toBe(true)               // 仍以 SOI 起
  })
  it('畸形 JPEG（SOI 后非 FF 标记 / 段长越界）→ 抛错（兼作输入校验拒绝伪装文件）', () => {
    expect(() => normalizeImage(Buffer.concat([SOI, B(0x00, 0x01)]))).toThrow()               // SOI 后应是 FF
    expect(() => normalizeImage(Buffer.concat([SOI, B(0xff, 0xe1, 0x7f, 0xff, 0x00)]))).toThrow() // 段长越界
    expect(() => normalizeImage(Buffer.concat([SOI, jseg(0xe0, B(0x00))]))).toThrow()          // 无 SOS 扫描
  })
})

describe('normalizeImage PNG：剥 tEXt/eXIf 等文本元数据，保留关键块与色彩块', () => {
  const png = Buffer.concat([
    PNG_SIG,
    pchunk('IHDR', Buffer.alloc(13)),
    pchunk('sRGB', B(0x00)),                              // 色彩辅助：保留
    pchunk('tEXt', Buffer.from('Comment\x00HOME_ADDRESS')), // 文本块：**须剥**
    pchunk('eXIf', Buffer.from('GPS_SECRET')),           // eXIf：**须剥**
    pchunk('IDAT', B(0xaa, 0xbb)),
    pchunk('IEND', Buffer.alloc(0)),
  ])
  it('文本/EXIF 块剥除、关键块与色彩块保留、输出仍是合法 PNG', () => {
    const { buf, mime } = normalizeImage(png)
    expect(mime).toBe('image/png')
    expect(buf.includes(Buffer.from('HOME_ADDRESS'))).toBe(false) // tEXt 剥净
    expect(buf.includes(Buffer.from('GPS_SECRET'))).toBe(false)   // eXIf 剥净
    expect(buf.includes(Buffer.from('sRGB'))).toBe(true)          // 色彩块保留
    expect(buf.includes(Buffer.from('IDAT'))).toBe(true)          // 像素数据保留
    expect(buf.includes(Buffer.from('IEND'))).toBe(true)
    expect(sniffImage(buf)).toBe('png')
  })
  it('缺关键块（无 IEND）→ 抛错', () => {
    const noEnd = Buffer.concat([PNG_SIG, pchunk('IHDR', Buffer.alloc(13)), pchunk('IDAT', B(0x01))])
    expect(() => normalizeImage(noEnd)).toThrow()
  })
})

describe('normalizeImage 非图片输入 → 抛错（fail-closed，绝不当图片存）', () => {
  it('纯文本/空/HEIC → unsupported', () => {
    expect(() => normalizeImage(Buffer.from('not an image'))).toThrow(/unsupported/)
    expect(() => normalizeImage(Buffer.alloc(0))).toThrow(/unsupported/)
  })
})
