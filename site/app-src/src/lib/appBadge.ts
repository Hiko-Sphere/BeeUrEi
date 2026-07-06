/// PWA 应用图标角标（Badging API）：安装为 PWA 后，未读总数（未接来电 + 消息 + 通知）直接显示在
/// Dock / 任务栏 / 主屏图标上——协助者不开 App 也能一眼看到"有 N 条待处理"，像原生 App。
/// Chromium PWA 支持；Firefox/Safari 无该 API → 优雅跳过。total<=0 清除角标。
/// best-effort：API 抛错（权限/非 PWA 环境）绝不影响页面。
export function updateAppBadge(total: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  try {
    if (total > 0) void nav.setAppBadge?.(total)?.catch(() => { /* best-effort */ })
    else void nav.clearAppBadge?.()?.catch(() => { /* best-effort */ })
  } catch { /* 不支持/同步抛错：忽略 */ }
}
