import XCTest
@testable import BeeUrEiCore

/// 位置共享"服务端已停"核对：只有本地在共享、已确认建立、且服务端说没在共享时，才判定该告知盲人已结束。
final class LiveShareReconcilerTests: XCTestCase {
    func testGenuineExpiryWhileEstablished() {
        // 已成功共享过，服务端因 TTL/管理员下线 → 应降下并告知（否则盲人假安心）。
        XCTAssertTrue(LiveShareReconciler.serverStoppedShare(localSharing: true, established: true, serverSharing: false))
    }

    func testStartupRaceNotYetEstablished() {
        // 刚点开始、第一帧还没上报成功，服务端尚不知我在共享 → 不能误报"已到期"。
        XCTAssertFalse(LiveShareReconciler.serverStoppedShare(localSharing: true, established: false, serverSharing: false))
    }

    func testStillSharingNoAnnounce() {
        // 服务端确认仍在共享 → 无需告知。
        XCTAssertFalse(LiveShareReconciler.serverStoppedShare(localSharing: true, established: true, serverSharing: true))
    }

    func testNotSharingLocallyNoAnnounce() {
        // 本地本就没在共享（用户自己停了/从未开）→ 服务端 false 是意料之中，不告知。
        XCTAssertFalse(LiveShareReconciler.serverStoppedShare(localSharing: false, established: true, serverSharing: false))
        XCTAssertFalse(LiveShareReconciler.serverStoppedShare(localSharing: false, established: false, serverSharing: false))
        XCTAssertFalse(LiveShareReconciler.serverStoppedShare(localSharing: false, established: false, serverSharing: true))
    }
}
