import XCTest
@testable import BeeUrEiCore

/// GPS 航迹方向可信过滤：course 有效 ∧ 精度可信才返回归一化度数；否则 nil（不上报乱指方向误导监护家人）。
final class CourseFilterTests: XCTestCase {

    func testValidCourseWithGoodAccuracyPassesThrough() {
        // course 有效、精度良好（≤60°）→ 原样归一返回。
        XCTAssertEqual(CourseFilter.trustworthyCourse(courseDegrees: 90, accuracyDegrees: 10), 90)
        XCTAssertEqual(CourseFilter.trustworthyCourse(courseDegrees: 0, accuracyDegrees: 0), 0)
        XCTAssertEqual(CourseFilter.trustworthyCourse(courseDegrees: 359, accuracyDegrees: 45), 359)
        XCTAssertEqual(CourseFilter.trustworthyCourse(courseDegrees: 200, accuracyDegrees: 60), 200) // 恰在阈值上
    }

    func testInvalidCourseRejected() {
        // CLLocation.course 用 -1 表示无效（静止/无法确定）→ nil。
        XCTAssertNil(CourseFilter.trustworthyCourse(courseDegrees: -1, accuracyDegrees: 5))
        // 非有限（坏读数）→ nil，绝不 Int(非有限) 或乱指。
        XCTAssertNil(CourseFilter.trustworthyCourse(courseDegrees: .nan, accuracyDegrees: 5))
        XCTAssertNil(CourseFilter.trustworthyCourse(courseDegrees: .infinity, accuracyDegrees: 5))
    }

    func testUntrustworthyAccuracyRejected() {
        // 关键改进：course 虽"有效"(≥0)，但 courseAccuracy 太大/无效→不可信，剔除（旧代码只看 course≥0 会误发）。
        XCTAssertNil(CourseFilter.trustworthyCourse(courseDegrees: 90, accuracyDegrees: 61))   // 越过阈值
        XCTAssertNil(CourseFilter.trustworthyCourse(courseDegrees: 90, accuracyDegrees: 120))  // 近静止噪声
        XCTAssertNil(CourseFilter.trustworthyCourse(courseDegrees: 90, accuracyDegrees: -1))   // courseAccuracy<0=无效(iOS 13.4+)
        XCTAssertNil(CourseFilter.trustworthyCourse(courseDegrees: 90, accuracyDegrees: .nan)) // 非有限精度
    }

    func testNilAccuracyFallsBackToCourseOnly() {
        // 来源不带精度信息（accuracyDegrees=nil）→ 退化为仅按 course≥0 判定（不改旧行为、不误伤无精度设备）。
        XCTAssertEqual(CourseFilter.trustworthyCourse(courseDegrees: 135, accuracyDegrees: nil), 135)
        XCTAssertNil(CourseFilter.trustworthyCourse(courseDegrees: -1, accuracyDegrees: nil))
    }

    func testNormalizesOutOfRangeCourse() {
        // 归一到 [0,360)：360→0、720→0。
        XCTAssertEqual(CourseFilter.trustworthyCourse(courseDegrees: 360, accuracyDegrees: 10), 0)
        XCTAssertEqual(CourseFilter.trustworthyCourse(courseDegrees: 725, accuracyDegrees: 10), 5)
    }
}
