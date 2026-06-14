/// HTTP（管理员路由）→ WebSocket（信令层）的桥：让管理员的 REST 操作能向通话房间推送指令。
/// 信令插件（routes/ws.ts）在注册时填入真实实现（闭包捕获 sockets + hub）；未连接信令时为安全空操作。
export class CallControlBridge {
  /// 强制结束某通话：向房间所有在线端推 end，返回收到指令的端数。由 ws 层实现。
  endCall: (callId: string, byAdminId: string) => number = () => 0
}
