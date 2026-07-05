import XCTest
import CoreGraphics
@testable import BeeUrEi

/// F1 第三批：识别屏 ViewModel 模式状态机单测（无相机帧路径——文档/教学/寻找模式的进入退出与互斥）。
/// 注：HomeViewModel 的无头单测被音频引擎 init 期图连接阻塞（CoreAudio RPC abort），
/// 已记入 BACKLOG F1 残留；本组覆盖可无头构造的 FramingAssistViewModel。
@MainActor
final class FramingAssistStateTests: XCTestCase {

    private var lang: Language { FeatureSettings().language }

    func testInitialGuidanceIsStarting() {
        let vm = FramingAssistViewModel()
        XCTAssertEqual(vm.guidanceText, FramingStrings.starting(lang))
        XCTAssertEqual(vm.findPhase, .idle)
    }

    func testDocumentModeToggleAnnouncesEnterAndExit() {
        let vm = FramingAssistViewModel()
        vm.toggleDocumentMode()
        XCTAssertEqual(vm.guidanceText, FramingStrings.docGuidance(lang))
        vm.toggleDocumentMode() // 无已读页：普通退出
        XCTAssertEqual(vm.guidanceText, FramingStrings.docExited(lang))
        XCTAssertNil(vm.copyableResult)
    }

    func testTeachingFlowTransitions() {
        let vm = FramingAssistViewModel()
        vm.startTeaching()
        XCTAssertEqual(vm.findPhase, .teaching)
        XCTAssertEqual(vm.guidanceText, FramingStrings.teachGuidance(lang))
        vm.stopFindFlow()
        XCTAssertEqual(vm.findPhase, .idle)
        XCTAssertEqual(vm.guidanceText, FramingStrings.stopped(lang))
    }

    func testTeachingCancelsDocumentMode() {
        let vm = FramingAssistViewModel()
        vm.toggleDocumentMode()
        vm.startTeaching() // 教学接管帧流：必须退出文档模式，两者互斥
        XCTAssertEqual(vm.findPhase, .teaching)
        // 再开文档模式应从头开始（不残留教学态）
        vm.stopFindFlow()
        vm.toggleDocumentMode()
        XCTAssertEqual(vm.guidanceText, FramingStrings.docGuidance(lang))
    }

    func testFindingUnknownItemStaysIdle() {
        let vm = FramingAssistViewModel()
        vm.startFinding("不存在的物品-\(UUID().uuidString)")
        XCTAssertEqual(vm.findPhase, .idle) // 无学习记录：不进入寻找态
    }

    func testCategoryFindEntersFindingWithLocalizedName() {
        let vm = FramingAssistViewModel()
        vm.startCategoryFind(label: "chair")
        XCTAssertEqual(vm.findPhase, .finding)
        XCTAssertEqual(vm.guidanceText, FramingStrings.findingGuidance(vm.categoryName("chair"), lang))
        vm.stopFindFlow()
        XCTAssertEqual(vm.findPhase, .idle)
    }

    func testSaveTaughtItemWithEmptyNameAborts() {
        let vm = FramingAssistViewModel()
        vm.startTeaching()
        vm.saveTaughtItem(named: "   ") // 没拍特征 + 空名：直接收尾回 idle
        XCTAssertEqual(vm.findPhase, .idle)
    }

    func testFindableCategoriesResolveLocalizedNames() {
        let vm = FramingAssistViewModel()
        for label in FramingAssistViewModel.findableCategories {
            XCTAssertFalse(vm.categoryName(label).isEmpty)
            XCTAssertNotEqual(vm.categoryName(label), LabelCatalog(language: lang).unknownName,
                              "类别 \(label) 不在标签目录里——会变成'障碍物/obstacle'")
        }
    }

    /// OCR 阅读顺序：Vision 不保证按阅读顺序返回观测，须经核心 ReadingOrder 重排（读文字/读整页共用），
    /// 否则盲人听到错乱文本。验 从上到下、行内左→右、坏观测剔除、bbox 左下原点翻 y 正确。
    func testOCRReadingOrderReordersAndGroups() {
        // Vision bbox 左下原点：maxY 大者在上。
        let top = (text: "First", box: CGRect(x: 0.1, y: 0.80, width: 0.5, height: 0.08))    // maxY≈0.88 顶
        let bottom = (text: "Second", box: CGRect(x: 0.1, y: 0.20, width: 0.5, height: 0.08)) // maxY≈0.28 底
        // 传入顺序颠倒（底在前），仍先读顶行。
        XCTAssertEqual(FramingAssistViewModel.orderedOCRText(from: [bottom, top]), "First\nSecond")
        // 同一视觉行的左右两块并成一行、按 x 左→右（右块先传仍左先）。
        let left = (text: "Left", box: CGRect(x: 0.05, y: 0.50, width: 0.2, height: 0.08))
        let right = (text: "Right", box: CGRect(x: 0.60, y: 0.50, width: 0.2, height: 0.08))
        XCTAssertEqual(FramingAssistViewModel.orderedOCRLines(from: [right, left]), ["Left Right"])
        // 坏观测（空白文本 / 非有限坐标）剔除，不崩不入行。
        let bad = (text: "  ", box: CGRect(x: .nan, y: 0.5, width: 0.2, height: 0.08))
        XCTAssertEqual(FramingAssistViewModel.orderedOCRText(from: [bad, top]), "First")
    }
}
