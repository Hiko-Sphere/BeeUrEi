import type { AppConfig } from './api'

/// 全站横幅解析（维护 / 公告）——纯逻辑，可单测。字段名须与**服务端契约**一致：announcement/maintenance 用
/// `active` + `message`（服务端 store 的 Announcement/MaintenanceMode 即此，iOS 亦读 active/message）。
/// 此前 Layout 误读 `enabled`/`text`（运行时恒 undefined）→ 维护/公告横幅**从不显示**：admin 发的维护通知/公告，
/// 协助端完全看不到（维护时只会撞上无解释的 503，公告白发）。`as Promise<AppConfig>` 的类型断言掩盖了这个契约错配、
/// TS 编译期发现不了，故抽成纯函数并单测锁住字段名。
///
/// 语义与 iOS GlobalBanner 对齐：维护优先于公告；维护 active 即显示（message 可空，调用方补本地化默认文案）；
/// 公告须 active 且 message 非空才显示；公告 level=warning→更醒目样式（danger 底），否则 info（honey 底）。
export type GlobalBanner = {
  kind: 'maintenance' | 'announcement'
  message: string      // 原始文案（维护可为空串→调用方补本地化默认）
  tone: 'danger' | 'warning' | 'info'
}

export function resolveGlobalBanner(config: AppConfig | null | undefined): GlobalBanner | null {
  const m = config?.maintenance
  if (m?.active) return { kind: 'maintenance', message: (m.message ?? '').trim(), tone: 'danger' }
  const a = config?.announcement
  const msg = (a?.message ?? '').trim()
  if (a?.active && msg) return { kind: 'announcement', message: msg, tone: a.level === 'warning' ? 'warning' : 'info' }
  return null
}
