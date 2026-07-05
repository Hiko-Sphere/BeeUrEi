import { type Lang } from './theme'

/// 按语言连接名字列表：中文用顿号「、」，英文用逗号「, 」。空列表返回 fallback（默认 '—'）。
/// 此前多处硬编码 join('、')，导致英文界面把名字连成「Alice、Bob」——统一到此，语言正确。
export function joinNames(names: string[], lang: Lang, fallback = '—'): string {
  return names.length ? names.join(lang === 'zh' ? '、' : ', ') : fallback
}
