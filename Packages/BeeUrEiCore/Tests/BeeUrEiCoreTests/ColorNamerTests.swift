import XCTest
@testable import BeeUrEiCore

final class ColorNamerTests: XCTestCase {
    let n = ColorNamer()

    func testPrimaries() {
        XCTAssertEqual(n.name(r: 1, g: 0, b: 0), "红色")
        XCTAssertEqual(n.name(r: 0, g: 1, b: 0), "绿色")
        XCTAssertEqual(n.name(r: 0, g: 0, b: 1), "蓝色")
        XCTAssertEqual(n.name(r: 1, g: 1, b: 0), "黄色")
    }

    func testNeutrals() {
        XCTAssertEqual(n.name(r: 1, g: 1, b: 1), "白色")
        XCTAssertEqual(n.name(r: 0, g: 0, b: 0), "黑色")
        XCTAssertEqual(n.name(r: 0.5, g: 0.5, b: 0.5), "灰色")
    }

    func testBrown() {
        // 暗橙 → 棕
        XCTAssertEqual(n.name(r: 0.5, g: 0.3, b: 0.1), "棕色")
    }

    /// 对抗复审 MED：标准浅灰（lightgray/gainsboro）不得被念成"白色"（盲人无法复核的错色）。
    func testLightGrayIsNotWhite() {
        XCTAssertEqual(n.name(r: 0.827, g: 0.827, b: 0.827), "灰色") // lightgray #D3D3D3 (v≈0.83)
        XCTAssertEqual(n.name(r: 0.863, g: 0.863, b: 0.863), "灰色") // gainsboro #DCDCDC (v≈0.86)
        XCTAssertEqual(n.name(r: 0.96, g: 0.96, b: 0.96), "白色")    // whitesmoke #F5F5F5 (v≈0.96) 仍近白
        XCTAssertEqual(n.name(r: 1, g: 1, b: 1), "白色")             // 纯白
    }

    /// 深浅描述（配衣服/比色刚需）：以参考色标定——navy/深红/墨绿→深；天蓝/浅绿→浅；纯色→原名。
    func testTonedDescribe() {
        // 深色（明度低）
        XCTAssertEqual(n.describe(r: 0, g: 0, b: 128/255.0), "深蓝色")            // navy #000080
        XCTAssertEqual(n.describe(r: 139/255.0, g: 0, b: 0), "深红色")            // dark red #8B0000
        XCTAssertEqual(n.describe(r: 0, g: 100/255.0, b: 0), "深绿色")            // dark green #006400
        // 浅色（明亮且不太饱和）
        XCTAssertEqual(n.describe(r: 144/255.0, g: 238/255.0, b: 144/255.0), "浅绿色") // light green #90EE90
        XCTAssertEqual(n.describe(r: 135/255.0, g: 206/255.0, b: 235/255.0, language: .zh).hasPrefix("浅"), true) // sky blue 偏浅
        // 纯色/普通 → 与 name 相同（无深浅前缀）
        XCTAssertEqual(n.describe(r: 1, g: 0, b: 0), "红色")
        XCTAssertEqual(n.describe(r: 0, g: 0, b: 1), "蓝色")
        // 中性色不加深浅前缀
        XCTAssertEqual(n.describe(r: 0, g: 0, b: 0), "黑色")
        XCTAssertEqual(n.describe(r: 0.5, g: 0.5, b: 0.5), "灰色")
        // 英文带空格
        XCTAssertEqual(n.describe(r: 0, g: 0, b: 128/255.0, language: .en), "dark blue")
        XCTAssertEqual(n.describe(r: 1, g: 0, b: 0, language: .en), "red")
    }

    func testToneEnum() {
        XCTAssertEqual(n.tone(r: 0, g: 0, b: 128/255.0), .dark)   // navy
        XCTAssertEqual(n.tone(r: 1, g: 0, b: 0), .normal)         // 纯红
        XCTAssertEqual(n.tone(r: 144/255.0, g: 238/255.0, b: 144/255.0), .light) // 浅绿
        XCTAssertEqual(n.tone(r: 0, g: 0, b: 0), .normal)        // 黑（中性不判深浅）
    }
}

// 配色和谐度（盲人配衣服的决策需求）——2026-07 补。
extension ColorNamerTests {
    func testHarmonyNeutralGoesWithAnything() {
        // 黑/白/灰 + 任意鲜艳色 → 百搭。
        XCTAssertEqual(n.harmony(r1: 0, g1: 0, b1: 0, r2: 1, g2: 0, b2: 0), .neutral)       // 黑+红
        XCTAssertEqual(n.harmony(r1: 1, g1: 1, b1: 1, r2: 0, g2: 0, b2: 1), .neutral)       // 白+蓝
        XCTAssertEqual(n.harmony(r1: 0.5, g1: 0.5, b1: 0.5, r2: 0, g2: 1, b2: 0), .neutral) // 灰+绿
    }

    func testHarmonySimilarSameFamily() {
        // 蓝 + 青（邻近色相 ~40°? cyan~180 blue~220 差40——应 similar 或临界）。用更近的：纯蓝 + 深蓝。
        XCTAssertEqual(n.harmony(r1: 0, g1: 0, b1: 1, r2: 0, g2: 0, b2: 0.6), .similar) // 蓝+深蓝同系
    }

    func testHarmonyContrastComplementary() {
        // 红(h0) + 青(h180) 近互补 → 撞色。
        XCTAssertEqual(n.harmony(r1: 1, g1: 0, b1: 0, r2: 0, g2: 1, b2: 1), .contrast)
        // 蓝(h240) + 黄(h60) 差180 → 撞色。
        XCTAssertEqual(n.harmony(r1: 0, g1: 0, b1: 1, r2: 1, g2: 1, b2: 0), .contrast)
    }

    func testHarmonyCautionOnlyWhenBothVivid() {
        // 两个鲜艳、中间尴尬角度（红 h0 + 绿 h120，差120）→ 需谨慎。
        XCTAssertEqual(n.harmony(r1: 1, g1: 0, b1: 0, r2: 0, g2: 1, b2: 0), .caution)
        // 同样色相角度但柔和（低饱和粉红 + 浅绿）→ 降级为协调（柔色包容）。
        XCTAssertEqual(n.harmony(r1: 1, g1: 0.7, b1: 0.7, r2: 0.7, g2: 1, b2: 0.7), .similar)
    }

    func testBeigeNotOrange() {
        // 米色/米黄（低饱和暖色亮色）→ 米色，不再误报"橙色"。
        XCTAssertEqual(n.name(r: 0.96, g: 0.89, b: 0.76), "米色")   // 典型米色 #F5E3C3 ish
        XCTAssertEqual(n.name(r: 0.76, g: 0.69, b: 0.57), "米色")   // 卡其/tan
        XCTAssertEqual(n.name(r: 0.96, g: 0.89, b: 0.76, language: .en), "beige")
        // 分界守卫：鲜艳暖色（高饱和）仍是橙，不被米色抢。
        XCTAssertEqual(n.name(r: 1, g: 0.6, b: 0.1), "橙色")        // s=0.9 饱和橙
        // 米色不加深浅前缀（本身已是浅暖色）。
        XCTAssertEqual(n.describe(r: 0.96, g: 0.89, b: 0.76), "米色")
    }

    func testBeigeIsNeutralInHarmony() {
        // 米色 + 任意鲜艳色 → 百搭（时尚中米色是暖中性）。
        XCTAssertEqual(n.harmony(r1: 0.96, g1: 0.89, b1: 0.76, r2: 0, g2: 0, b2: 1), .neutral) // 米色+蓝
        XCTAssertEqual(n.harmony(r1: 0.96, g1: 0.89, b1: 0.76, r2: 1, g2: 0, b2: 0), .neutral) // 米色+红
    }

    func testHarmonyStringsBilingual() {
        XCTAssertEqual(SpokenStrings.colorHarmony(.neutral, .zh), "有中性色，比较百搭")
        XCTAssertTrue(SpokenStrings.colorHarmony(.caution, .en).contains("ask someone"))
        XCTAssertTrue(SpokenStrings.colorHarmony(.contrast, .zh).contains("撞色"))
    }
}
