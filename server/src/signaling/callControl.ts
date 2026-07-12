/// HTTP（管理员路由）→ WebSocket（信令层）的桥：让管理员的 REST 操作能向通话房间推送指令。
/// 信令插件（routes/ws.ts）在注册时填入真实实现（闭包捕获 sockets + hub）；未连接信令时为安全空操作。
export class CallControlBridge {
  /// 强制结束某通话：向房间所有在线端推 end，返回收到指令的端数。由 ws 层实现。
  endCall: (callId: string, byAdminId: string) => number = () => 0
  /// 立即切断某用户的所有在线信令 socket：封禁/强制下线/改密(severSessions)时调用，使会话撤销不仅作用于
  /// REST 与后续重连，也即时踢掉其**已打开**的 /ws（否则被封用户能在既有 socket 上继续通话至 access token 到期）。
  /// 返回被关闭的 socket 数。由 ws 层填实现；未接信令时安全空操作。
  disconnectUser: (userId: string) => number = () => 0
  /// 进程正在优雅关闭（部署重启）。置真后，信令层 socket 关闭**不再向对端广播 peer-left**——WebRTC 媒体是
  /// P2P/TURN、不经信令 WS，部署把所有 WS 一起关时，若照常发 peer-left 会让本可续流的通话（尤其紧急通话）
  /// 被对端结束。配合 web 端"媒体已连时 WS 断开不掐断"（webrtc.ts），进行中的通话得以熬过部署。
  shuttingDown = false
}
