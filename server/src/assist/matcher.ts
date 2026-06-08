/// 协助者匹配（纯逻辑，可单测）：在候选里挑在线可用的，按优先级排序。
/// 规则：仅在线者入选；紧急时紧急联系人优先；语言匹配加分；负载越低越优。
export interface Candidate {
  userId: string
  online: boolean
  isEmergency: boolean
  load: number // 进行中的通话数（0 最优）
  language?: string
}

export interface MatchRequest {
  emergency: boolean
  preferredLanguage?: string
}

export function rankHelpers(candidates: Candidate[], req: MatchRequest): Candidate[] {
  return candidates
    .filter((c) => c.online)
    .map((c) => ({ c, s: score(c, req) }))
    .sort((a, b) => b.s - a.s || a.c.load - b.c.load)
    .map((x) => x.c)
}

function score(c: Candidate, req: MatchRequest): number {
  let s = 0
  if (req.emergency && c.isEmergency) s += 100
  if (req.preferredLanguage && c.language === req.preferredLanguage) s += 10
  s -= c.load * 5
  return s
}
