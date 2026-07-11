/// 判断可滚动容器当前是否"贴着底部附近"。
/// 用途：新内容到达时，仅当用户本就在底部才自动滚到底；上翻看历史/回读则不打断
/// （聊天线程 Chat 与通话内实时文字 RTT 共用同一判据，避免两处各写一份漂移）。
/// 纯函数、注入布局度量即可单测——jsdom 无真实布局（scrollHeight/scrollTop/clientHeight 均 0），
/// 故判定必须与 DOM 解耦成此形态才可测。threshold 为"距底多少像素内算贴底"。
export function isNearBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 120,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}
