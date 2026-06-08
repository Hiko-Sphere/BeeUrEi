import XCTest
@testable import BeeUrEiCore

final class DirectionSmootherTests: XCTestCase {
    func testSteadyStaysSteady() {
        let s = DirectionSmoother(alpha: 0.3)
        _ = s.update(angleDegrees: 10, distanceMeters: 2)
        let r = s.update(angleDegrees: 10, distanceMeters: 2)
        XCTAssertEqual(r.angle, 10, accuracy: 0.5)
        XCTAssertEqual(r.distance!, 2, accuracy: 0.01)
    }

    func testJitterIsDampened() {
        let s = DirectionSmoother(alpha: 0.2)
        // 围绕 0° 来回抖 ±20°，平滑后应明显靠近 0。
        var last = 0.0
        for i in 0..<30 { last = s.update(angleDegrees: (i % 2 == 0) ? 20 : -20, distanceMeters: nil).angle }
        XCTAssertLessThan(abs(last), 8)
    }

    func testWrapAround() {
        let s = DirectionSmoother(alpha: 0.5)
        _ = s.update(angleDegrees: 170, distanceMeters: nil)
        let r = s.update(angleDegrees: -170, distanceMeters: nil) // 跨 ±180
        // 170 与 -170 的圆形中点应在 ±180 附近，而非 0。
        XCTAssertGreaterThan(abs(r.angle), 170)
    }
}

final class AnnouncementPolicyTests: XCTestCase {
    func testNewTargetAnnouncesWhenIdle() {
        let p = AnnouncementPolicy()
        XCTAssertEqual(p.decide(targetKey: "a", urgency: 1, isSpeaking: false, now: 0),
                       AnnouncementDecision(announce: true, interrupt: false))
    }

    func testSameTargetSilentWhileSpeaking() {
        let p = AnnouncementPolicy()
        _ = p.decide(targetKey: "a", urgency: 1, isSpeaking: false, now: 0)
        XCTAssertEqual(p.decide(targetKey: "a", urgency: 1, isSpeaking: true, now: 1), .silent)
    }

    func testSameTargetRefreshesAfterInterval() {
        let p = AnnouncementPolicy(refreshInterval: 6)
        _ = p.decide(targetKey: "a", urgency: 1, isSpeaking: false, now: 0)
        XCTAssertEqual(p.decide(targetKey: "a", urgency: 1, isSpeaking: false, now: 3).announce, false)
        XCTAssertEqual(p.decide(targetKey: "a", urgency: 1, isSpeaking: false, now: 7).announce, true)
    }

    func testMoreUrgentNewTargetInterrupts() {
        let p = AnnouncementPolicy(urgencyMargin: 1.3)
        _ = p.decide(targetKey: "a", urgency: 1, isSpeaking: false, now: 0)
        let d = p.decide(targetKey: "b", urgency: 2, isSpeaking: true, now: 1)
        XCTAssertTrue(d.announce); XCTAssertTrue(d.interrupt)
    }

    func testLessUrgentNewTargetWaits() {
        let p = AnnouncementPolicy(urgencyMargin: 1.3)
        _ = p.decide(targetKey: "a", urgency: 2, isSpeaking: false, now: 0)
        XCTAssertEqual(p.decide(targetKey: "c", urgency: 1.2, isSpeaking: true, now: 1), .silent)
    }
}

final class ClockAngleAndConciseTests: XCTestCase {
    func testClockFromAngle() {
        XCTAssertEqual(ClockDirection(angleDegrees: 0).hour, 12)
        XCTAssertEqual(ClockDirection(angleDegrees: 34).hour, 1)
        XCTAssertEqual(ClockDirection(angleDegrees: -34).hour, 11)
        XCTAssertEqual(ClockDirection(angleDegrees: .nan).hour, 12)
    }

    func testCoarsePhrase() {
        XCTAssertEqual(ClockDirection(angleDegrees: 0).coarsePhrase, "正前方")
        XCTAssertEqual(ClockDirection(angleDegrees: 34).coarsePhrase, "右前方")
        XCTAssertEqual(ClockDirection(angleDegrees: -34).coarsePhrase, "左前方")
    }

    func testConciseAnnounce() {
        let composer = SpeechComposer()
        let o = Obstacle(label: "行人", clock: ClockDirection(angleDegrees: 0), distanceMeters: 1.0, confidence: 0.9)
        XCTAssertEqual(composer.conciseAnnounce(o), "正前方 行人 1米")
        XCTAssertEqual(composer.conciseMeters(0.4), "很近")
        XCTAssertEqual(composer.conciseMeters(0.7), "半米")
    }
}
