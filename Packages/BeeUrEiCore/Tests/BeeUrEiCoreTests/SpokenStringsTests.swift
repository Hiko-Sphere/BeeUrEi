import XCTest
@testable import BeeUrEiCore

/// safeRoundedInt：防 `Int(非有限/巨值 Double)` 陷阱崩溃——App 层距离转 Int 的统一安全阀。
final class SpokenStringsTests: XCTestCase {
    func testSafeRoundedIntNormal() {
        XCTAssertEqual(SpokenStrings.safeRoundedInt(12.4), 12)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(12.6), 13)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(0), 0)
    }

    func testSafeRoundedIntNonFiniteAndNegative() {
        // 关键：Int(NaN/∞) 会陷阱崩溃——必须退化为 0，绝不崩。
        XCTAssertEqual(SpokenStrings.safeRoundedInt(.nan), 0)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(.infinity), 0)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(-.infinity), 0)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(-5), 0) // 夹到非负
    }

    func testSafeRoundedIntHugeFiniteDoesNotOverflow() {
        // 关键：巨值有限 Double（如后端 distanceMeters=1e19 > Int.max）直接 Int() 会溢出崩溃——须夹到上界。
        XCTAssertEqual(SpokenStrings.safeRoundedInt(1e19), 1_000_000)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(Double(Int.max)), 1_000_000) // 恰 Int.max 量级也夹住
        XCTAssertEqual(SpokenStrings.safeRoundedInt(999_999), 999_999)           // 上界内原值
    }

    /// locationDistance：位置尺度距离 <1km 用米、≥1km 用公里（0.1 精度去尾零）；完整单位词；溢出/非有限安全。
    func testLocationDistanceMetersUnderOneKm() {
        XCTAssertEqual(SpokenStrings.locationDistance(50, .zh), "50米")
        XCTAssertEqual(SpokenStrings.locationDistance(50, .en), "50 meters")
        XCTAssertEqual(SpokenStrings.locationDistance(999, .zh), "999米")   // 999m 仍米
        XCTAssertEqual(SpokenStrings.locationDistance(0, .zh), "0米")
    }

    func testLocationDistanceKilometersAtAndAboveOneKm() {
        XCTAssertEqual(SpokenStrings.locationDistance(1000, .zh), "1公里")      // 边界：整公里去尾零
        XCTAssertEqual(SpokenStrings.locationDistance(1000, .en), "1 kilometers")
        XCTAssertEqual(SpokenStrings.locationDistance(1500, .zh), "1.5公里")    // 0.1 精度
        XCTAssertEqual(SpokenStrings.locationDistance(2000, .en), "2 kilometers") // 去尾零 2.0→2
        XCTAssertEqual(SpokenStrings.locationDistance(1050, .zh), "1.1公里")    // 1050→10.5→四舍五入 11→1.1
    }

    func testLocationDistanceNonFiniteAndOverflowSafe() {
        XCTAssertEqual(SpokenStrings.locationDistance(.nan, .zh), "0米")        // 非有限→0米，不崩
        XCTAssertEqual(SpokenStrings.locationDistance(.infinity, .zh), "0米")   // ∞ 非有限→0米（safeRoundedInt 守卫）
        XCTAssertEqual(SpokenStrings.locationDistance(-5, .zh), "0米")          // 负→0
        XCTAssertEqual(SpokenStrings.locationDistance(1e19, .en), "1000 kilometers") // 巨值**有限**→夹 1e6 米=1000 公里
    }

    // MARK: 商品营养后缀（nutrition）——Nutri-Score + NOVA，可听营养质量。

    func testNutritionBothSignals() {
        // 分级（含方向性释义）+ 超加工：以"。"/". "起（可链在过敏原后缀后一次 speak），中/英分隔一致。
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: "a", novaGroup: 4, .zh), "。营养分级A（最好），超加工食品")
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: "a", novaGroup: 4, .en), ". Nutri-Score A (best), ultra-processed")
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: "c", novaGroup: 1, .zh), "。营养分级C（中等），未加工或轻加工")
    }

    func testNutritionSingleSignal() {
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: "b", novaGroup: nil, .zh), "。营养分级B（较好）") // 仅分级
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: nil, novaGroup: 4, .en), ". ultra-processed") // 仅 NOVA
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: nil, novaGroup: 3, .zh), "。加工食品")
    }

    func testNutritionUppercaseGradeNormalized() {
        // OFF 偶返回大写；大小写不敏感，输出统一大写字母。
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: "E", novaGroup: nil, .en), ". Nutri-Score E (worst)")
    }

    func testNutriScoreQualityDirection() {
        // 每个字母都带方向性释义（a 最好 → e 最差）——裸字母对盲人/不熟该分级者无意义。
        XCTAssertEqual(SpokenStrings.nutriScoreQuality("a", .zh), "最好")
        XCTAssertEqual(SpokenStrings.nutriScoreQuality("b", .zh), "较好")
        XCTAssertEqual(SpokenStrings.nutriScoreQuality("c", .zh), "中等")
        XCTAssertEqual(SpokenStrings.nutriScoreQuality("d", .zh), "较差")
        XCTAssertEqual(SpokenStrings.nutriScoreQuality("e", .zh), "最差")
        XCTAssertEqual(SpokenStrings.nutriScoreQuality("A", .en), "best")  // 大小写不敏感
        XCTAssertEqual(SpokenStrings.nutriScoreQuality("e", .en), "worst")
    }

    func testNutritionRejectsBadDataAndReturnsNilWhenEmpty() {
        // 白名单外的档一律丢弃（脏数据不播非法分级/加工组给盲人），全丢→nil（不硬凑）。
        XCTAssertNil(SpokenStrings.nutrition(nutriScore: nil, novaGroup: nil, .zh))
        XCTAssertNil(SpokenStrings.nutrition(nutriScore: "z", novaGroup: nil, .zh))     // 非 a..e
        XCTAssertNil(SpokenStrings.nutrition(nutriScore: "unknown", novaGroup: nil, .en))
        XCTAssertNil(SpokenStrings.nutrition(nutriScore: nil, novaGroup: 0, .zh))       // NOVA 越界（下）
        XCTAssertNil(SpokenStrings.nutrition(nutriScore: nil, novaGroup: 5, .zh))       // NOVA 越界（上）
        // 一好一坏：只保留可信的那个，不因坏数据整体丢弃。
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: "a", novaGroup: 9, .zh), "。营养分级A（最好）") // 坏 NOVA 丢、保留分级
        XCTAssertEqual(SpokenStrings.nutrition(nutriScore: "x", novaGroup: 2, .en), ". processed culinary ingredient") // 坏分级丢、保留 NOVA
    }
}
