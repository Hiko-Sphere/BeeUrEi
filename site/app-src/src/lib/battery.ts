/// 联系人位置卡的电量徽标（纯逻辑，可单测）。Find My/Life360 惯例：亲友看到"快没电"可在盲人失联前主动联系
/// ——电量耗尽 = 同时失去其导盲、导航与求助能力。**两级**（与服务端两级预警一致，见 lowBattery.ts）：
/// - danger：≤20% 标红提醒；
/// - critical：≤10% **即将关机**，协助者盯多个联系人时据此优先处置最危急的（客户端加 ⚠️ 前缀，读屏亦可闻）。
/// null/undefined/非法值 → null（老客户端不上报电量：不显示、不猜，绝不显示假电量）。
export function batteryBadge(battery: number | null | undefined, lang: 'zh' | 'en'): { text: string; danger: boolean; critical: boolean } | null {
  if (battery == null || !Number.isFinite(battery) || battery < 0 || battery > 100) return null
  const pct = Math.round(battery)
  return { text: lang === 'zh' ? `电量 ${pct}%` : `Battery ${pct}%`, danger: pct <= 20, critical: pct <= 10 }
}
