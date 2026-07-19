/// 英文名词按数量取单/复数（中文无复数，仅英文侧调用）。默认 +s；不规则/特殊复数传 pluralForm。
/// 用途：把 "1 contacts" / "1 points" / "1 days" 这类语病改成正确单复数——盲人/家人看到的
/// 应急就绪、路线、暂停时长等计数文案须语法正确（"行业内最顶尖"）。n 取绝对值判定（-1 也算单数）。
export function plural(n: number, singular: string, pluralForm?: string): string {
  return Math.abs(n) === 1 ? singular : (pluralForm ?? `${singular}s`)
}

/// 英文动词第三人称单复数（"1 has" / "N have"）：主语计数为 1 用单数动词。
export function verbHaveHas(n: number): 'has' | 'have' {
  return Math.abs(n) === 1 ? 'has' : 'have'
}
