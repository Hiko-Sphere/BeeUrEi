/// 可见性感知轮询：标签页隐藏时跳过 tick（省流量/电量/服务端负载），重新可见时立刻补一次刷新。
/// 用法同 setInterval，但返回 cleanup（清定时器 + 摘 visibilitychange 监听）。
/// 适用于纯读刷新（会话/消息/通知/通话列表）；不要用于在线心跳（隐藏=不可用，语义不同）。
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const id = setInterval(() => { if (!document.hidden) fn() }, ms)
  const onVis = () => { if (!document.hidden) fn() } // 切回前台立即刷新，消除隐藏期间的数据陈旧
  document.addEventListener('visibilitychange', onVis)
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
}
