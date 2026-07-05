/// 共享位置期间"手机快没电"预警家人的判定（纯逻辑，可单测）。
///
/// 盲人独自出行时手机=导航+SOS+求助的唯一工具，没电即失联且失去自救手段。对标 Life360/Find My 的
/// "X 的手机电量低"提醒，并**分两级**（多数专业跟踪/医疗警报产品的做法）：
/// - **低电(low)**：跌破 warnAt(默认15%)——提醒家人在其失联前主动联系；
/// - **极低(critical)**：再跌破 criticalAt(默认5%)——手机很快关机、即将彻底失联，措辞更急，抓住漏看第一次的人。
/// 每级每个耗电周期至多提醒一次；一次性从高电直接掉到极低，只发 critical（最紧急，不再补发 low）。
///
/// **滞回**（criticalAt < warnAt < clearAt）防在阈值附近抖动反复提醒：一旦提醒，须电量回升到 clearAt
/// （充上电/缓过来）才整体复位；复位后再次跌破才会再提醒。缺电量读数（undefined/非有限）不改变状态（不猜）。
export interface LowBatteryDecision {
  fired: 'low' | 'critical' | null // 本次应发的预警层级（null=不发）
  warnedLevel: number              // 更新后的"已提醒层级"：0=无 / 1=低电 / 2=极低（写回会话态）
}

export function decideLowBatteryWarn(
  prevLevel: number, battery: number | undefined,
  warnAtPct: number, clearAtPct: number, criticalAtPct: number,
): LowBatteryDecision {
  // 无电量读数：状态不变（有些客户端不报电量，绝不因缺读数误报或误复位）。
  if (battery == null || !Number.isFinite(battery)) return { fired: null, warnedLevel: prevLevel }
  // 回升到 clearAt 及以上：整体复位（下次再跌破可从 low 起重新提醒）。
  if (battery >= clearAtPct) return { fired: null, warnedLevel: 0 }
  // 极低且尚未发过 critical → 发 critical（最紧急，直接跳到第 2 级，哪怕之前没发过 low）。
  if (battery <= criticalAtPct && prevLevel < 2) return { fired: 'critical', warnedLevel: 2 }
  // 低电且尚未发过任何级 → 发 low。
  if (battery <= warnAtPct && prevLevel < 1) return { fired: 'low', warnedLevel: 1 }
  // 否则：已发过对应级 / 或处于滞回带内 → 保持已提醒层级、不重复。
  return { fired: null, warnedLevel: prevLevel }
}
