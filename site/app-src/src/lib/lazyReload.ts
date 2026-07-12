/// 懒加载 chunk 失效自愈：部署会整体替换哈希命名的 chunk——旧标签页（还开着旧 index.html）首次点开
/// 懒加载页（位置/路线）时，旧哈希 chunk 已不存在 → import() 404 → 整页错误屏，直到用户手动刷新。
/// （10 分钟一次的"新版本提示"只能缩小、不能消除这个窗口。）
///
/// 策略：首次失败 → 自动整页刷新一次（新 index.html 引用新 chunk，问题即消）；同一会话内第二次仍失败
/// （sessionStorage 标记）→ 如实抛给 ErrorBoundary——那是真网络故障，绝不无限刷新打转。
/// 成功加载即清标记（下次部署的失效可再次自愈）。deps 可注入（reload/storage），便于单测。
const KEY = 'beeurei:chunk-reload'

export function importWithReload<T>(
  fn: () => Promise<T>,
  deps: { reload: () => void; storage: () => Storage } = { reload: () => location.reload(), storage: () => sessionStorage },
): () => Promise<T> {
  return async () => {
    try {
      const m = await fn()
      try { deps.storage().removeItem(KEY) } catch { /* 隐私模式等：无标记可清 */ }
      return m
    } catch (err) {
      let first = false
      try {
        const s = deps.storage()
        first = s.getItem(KEY) !== '1'
        if (first) s.setItem(KEY, '1')
      } catch { /* storage 不可用：视作已试过，直接抛（宁可错误屏，绝不可能无限刷） */ }
      if (first) {
        deps.reload()
        return new Promise<never>(() => {}) // 重载接管页面；挂起防错误屏在刷新前闪现
      }
      throw err // 同会话第二次仍失败：真网络故障 → ErrorBoundary 兜底
    }
  }
}
