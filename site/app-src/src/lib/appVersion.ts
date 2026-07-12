/// 新版本检测（纯函数 + Layout 轮询）：协助者常整天开着标签页（依赖 5–15s 轮询收求助/告警），
/// SW 是 network-first（刷新即取新码），但**不刷新**就一直跑旧包——修复/安全补丁部署后旧标签页可能跑一周旧码。
/// 检测方式零版本簿记：部署产物的 index.html 引用**内容哈希**命名的主包（/app/assets/index-XXXX.js），
/// 周期拉取 index.html（no-store）并与当前运行中的主包路径比对——不同即有新版本，提示"点击刷新"。
/// 比对的是真实部署产物本身（而非另行维护的版本号），不存在漂移/忘更新问题。

/// 从 index.html 文本提取主包资源路径（如 "assets/index-CZz7gmV_.js"）。找不到（结构变了/异常响应）返回 null——
/// 调用方对 null 一律**不提示**（宁可漏提示，绝不对着错误解析乱喊"有新版本"）。
export function extractMainScript(html: string): string | null {
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)
  return m ? m[0] : null
}

/// 当前运行页面的主包资源路径（与 extractMainScript 同形），从 DOM 的 script 标签取；找不到返回 null。
export function currentMainScript(doc: Document): string | null {
  const scripts = doc.querySelectorAll('script[src]')
  for (const s of scripts) {
    const src = s.getAttribute('src') ?? ''
    const m = src.match(/assets\/index-[A-Za-z0-9_-]+\.js/)
    if (m) return m[0]
  }
  return null
}

/// 是否有新版本：两端都解析成功且不一致才算（任一为 null → false，见上）。
export function updateAvailable(deployedHtml: string, doc: Document): boolean {
  const deployed = extractMainScript(deployedHtml)
  const running = currentMainScript(doc)
  return deployed !== null && running !== null && deployed !== running
}
