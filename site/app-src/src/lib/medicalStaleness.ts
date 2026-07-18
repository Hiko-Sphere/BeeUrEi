/// 施救者侧医疗信息**陈旧警示**：遇险者的紧急医疗信息距上次更新超过约 1 年时，提示施救者
/// "别盲信旧数据、施救前再确认"。用药/过敏/慢性病会随时间变化——已停的药、新增的过敏若没更新，
/// 施救者据数年前的信息行动会误判(假安心)。ContactMedicalInfo 此前只以灰色小字显示"更新于 X"，
/// 不足以让危急中的施救者警觉数据可能过时，故据阈值给出醒目可行动的警示。
///
/// 与 iOS `MedicalInfoStrings.stalenessWarning`(填写者侧，同 365 天阈值 / max(12,floor(days/30)) 口径)
/// 对称，但文案面向**施救者**(提醒核对)而非本人(提醒复核)。纯逻辑、now 可注入、可单测；
/// updatedAtMs/nowMs 均为**毫秒**(服务端 Date.now() 口径)；未达阈值 / 非有限 → null。

const DAY_MS = 86_400_000
const STALE_DAYS = 365

export function medicalStalenessCaution(updatedAtMs: number, nowMs: number, lang: 'zh' | 'en'): string | null {
  const days = (nowMs - updatedAtMs) / DAY_MS
  if (!Number.isFinite(days) || days < STALE_DAYS) return null
  const months = Math.max(12, Math.floor(days / 30))
  return lang === 'zh'
    ? `⚠️ 这份医疗信息约 ${months} 个月前更新，用药或过敏可能已变——施救前请尽量与本人或家属再确认。`
    : `⚠️ This medical info was updated about ${months} months ago — meds or allergies may have changed. Confirm with them or family before acting if you can.`
}
