import Foundation

/// 实时位置共享的"服务端已停"核对（纯逻辑，可单测）。
///
/// 盲人开启位置共享后常把手机放进口袋（后台续传）。若服务端因**有效期到期(TTL)**或**管理员下线**而停掉共享，
/// 本地 `sharing` 仍为 true、界面仍显示"共享至 X"（其实已成过去）——盲人看不到屏幕，会**误以为家人还看得到
/// 自己的实时位置**。这是危险的"假安心"：真出事时家人其实早已看不到位置。故须在轮询联系人拿到服务端真相时，
/// 把本地状态**降下**并**语音告知**盲人"共享已结束"，让其按需重新开启。
///
/// established 门防启动竞态：刚点"开始共享"、第一帧定位还没上报成功时，服务端尚不知我在共享（isSharing=false），
/// 若不加此门会立刻误报"已到期"。只有**至少成功上报过一次**（服务端确认过）之后，服务端说 false 才是真的停了。
public enum LiveShareReconciler {
    /// 是否应"本地降下共享 + 语音告知已结束"。
    /// - Parameters:
    ///   - localSharing: 本地是否自认为在共享。
    ///   - established: 是否已至少成功上报过一次（服务端确认过我在共享）。
    ///   - serverSharing: 服务端真相（isSharing：记录存在且未到期）。
    public static func serverStoppedShare(localSharing: Bool, established: Bool, serverSharing: Bool) -> Bool {
        localSharing && established && !serverSharing
    }
}
