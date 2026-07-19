/// 紧急医疗信息**陈旧**判定与两侧文案。用药/过敏/慢性病会随时间变化——已停的药、新增的过敏若没更新，
/// 无论是本人还是施救者据数年前的信息判断都会误导(假安心)。距上次更新 ≥ 约 1 年(365 天)即视为陈旧。
///
/// 两条公开文案共用同一阈值与月数口径(`staleMonths`)，但受众不同：
///  - `medicalStalenessCaution`  → **施救者**侧(ContactMedicalInfo)：提醒"施救前再与本人/家属确认"。
///  - `medicalStalenessSelfReminder` → **本人**侧(Account MedicalInfoCard)：提醒"复核更新自己的信息"，
///    与 iOS `MedicalInfoStrings.stalenessWarning` 同口径同措辞。
///
/// 纯逻辑、now 可注入、可单测；updatedAtMs/nowMs 均为**毫秒**(服务端 Date.now() 口径)；
/// 未达阈值 / 非有限 → null。月数 = max(12, floor(days/30))，不显示 <12 个月。

const DAY_MS = 86_400_000
const STALE_DAYS = 365

/// 陈旧年龄短语：达阈值返回本地化「N 个月」/「N 年」，否则 null。两侧文案的唯一真相来源。
/// **≥2 年（≥730 天）改用「年」**——"约 36 个月/121 个月"靠听极难换算，"约 3 年/10 年"一听即知有多旧
/// （施救者/本人都受益；responder 侧尤甚，急救中要快速判断）；1~2 年仍用月（13~24 个月够直观）。
/// 与 iOS `MedicalInfoStrings.stalenessWarning` 同口径（≥730 天→年、否则 max(12, floor(days/30)) 月）。
function staleAge(updatedAtMs: number, nowMs: number, lang: 'zh' | 'en'): string | null {
  const days = (nowMs - updatedAtMs) / DAY_MS
  if (!Number.isFinite(days) || days < STALE_DAYS) return null
  if (days >= 730) {
    const years = Math.floor(days / 365)
    return lang === 'zh' ? `${years} 年` : `${years} year${years === 1 ? '' : 's'}`
  }
  const months = Math.max(12, Math.floor(days / 30))
  return lang === 'zh' ? `${months} 个月` : `${months} month${months === 1 ? '' : 's'}`
}

/// 施救者侧：陈旧 → 醒目、可行动的核对提醒；否则 null。
export function medicalStalenessCaution(updatedAtMs: number, nowMs: number, lang: 'zh' | 'en'): string | null {
  const age = staleAge(updatedAtMs, nowMs, lang)
  if (age == null) return null
  return lang === 'zh'
    ? `⚠️ 这份医疗信息约 ${age}前更新，用药或过敏可能已变——施救前请尽量与本人或家属再确认。`
    : `⚠️ This medical info was updated about ${age} ago — meds or allergies may have changed. Confirm with them or family before acting if you can.`
}

/// 本人侧：陈旧 → 提醒复核更新自己的医疗信息；否则 null。与 iOS 填写者侧同措辞。
export function medicalStalenessSelfReminder(updatedAtMs: number, nowMs: number, lang: 'zh' | 'en'): string | null {
  const age = staleAge(updatedAtMs, nowMs, lang)
  if (age == null) return null
  return lang === 'zh'
    ? `医疗信息已约 ${age}没更新了——用药或病史可能已变，建议复核一下，免得施救者拿到过时信息。`
    : `Your medical info hasn't been updated in about ${age} — meds or conditions may have changed. Please review it so responders don't act on outdated info.`
}
