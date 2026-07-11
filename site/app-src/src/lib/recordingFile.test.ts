import { describe, it, expect } from 'vitest'
import { recordingFileExt, recordingFileName } from './recordingFile'

describe('recordingFileExt 由媒体 MIME 推导下载扩展名（导出文件须能被正确的应用打开）', () => {
  it('视频容器：quicktime/webm/mp4/mkv 各得其扩展名', () => {
    expect(recordingFileExt('video/quicktime')).toBe('mov') // iOS ReplayKit
    expect(recordingFileExt('video/webm')).toBe('webm')     // web MediaRecorder
    expect(recordingFileExt('video/mp4')).toBe('mp4')
    expect(recordingFileExt('video/x-matroska')).toBe('mkv')
  })

  it('剥离 codec 参数后再判（MediaRecorder 常带 ;codecs=...）', () => {
    expect(recordingFileExt('video/webm;codecs="vp8, opus"')).toBe('webm')
    expect(recordingFileExt('video/mp4; codecs=avc1.42E01E')).toBe('mp4')
    expect(recordingFileExt('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
  })

  it('大小写/首尾空白归一，不因大小写落到兜底', () => {
    expect(recordingFileExt('VIDEO/WEBM')).toBe('webm')
    expect(recordingFileExt('  audio/mpeg  ')).toBe('mp3')
  })

  it('纯音频各格式：m4a/aac/mp3/webm/ogg/wav 各得其扩展名', () => {
    expect(recordingFileExt('audio/mp4')).toBe('m4a')
    expect(recordingFileExt('audio/x-m4a')).toBe('m4a')
    expect(recordingFileExt('audio/aac')).toBe('aac')
    expect(recordingFileExt('audio/webm')).toBe('webm')
    expect(recordingFileExt('audio/ogg')).toBe('ogg')
    expect(recordingFileExt('audio/wav')).toBe('wav')
    expect(recordingFileExt('audio/x-wav')).toBe('wav')
  })

  it('回归：audio/mpeg 是 mp3 而非旧内联逻辑的 m4a（错扩展名会让 mp3 导出文件被当损坏）', () => {
    expect(recordingFileExt('audio/mpeg')).toBe('mp3')
  })

  it('未知/缺失 MIME 兜底：音频归 m4a、其余归 mp4（都是最通用容器）', () => {
    expect(recordingFileExt('audio/flac')).toBe('m4a')       // 未列出的音频 → 音频兜底
    expect(recordingFileExt('application/octet-stream')).toBe('mp4') // 服务器没给准 MIME
    expect(recordingFileExt('')).toBe('mp4')
    expect(recordingFileExt(undefined)).toBe('mp4')
    expect(recordingFileExt(null)).toBe('mp4')
  })
})

describe('recordingFileName 完整下载文件名', () => {
  // 用本地时刻构造，断言不含时区假设：只校验格式与扩展名。
  const at = new Date(2026, 6, 12, 9, 5).getTime() // 2026-07-12 09:05 本地

  it('格式 beeurei-recording-YYYYMMDD-HHMM.<ext>（本地时刻补零）', () => {
    expect(recordingFileName(at, 'video/webm')).toBe('beeurei-recording-20260712-0905.webm')
  })

  it('扩展名随 MIME 变（复用 recordingFileExt）', () => {
    expect(recordingFileName(at, 'video/quicktime')).toBe('beeurei-recording-20260712-0905.mov')
    expect(recordingFileName(at, 'audio/mpeg')).toBe('beeurei-recording-20260712-0905.mp3')
  })

  it('recordedAt 非有限（坏记录）→ 省时刻段但仍给可用文件名，绝不产出 NaN 脏名', () => {
    expect(recordingFileName(NaN, 'video/webm')).toBe('beeurei-recording.webm')
    expect(recordingFileName(Infinity, 'audio/mp4')).toBe('beeurei-recording.m4a')
  })
})
