import XCTest
import AVFoundation
@testable import BeeUrEi

/// 混合播报分声线（音高档案）：盲人不必解析句子就知道这句是环境描述/导航指令/来电。
/// 档案错的后果：三通道同声（回到"全都一个声"的辨析负荷）或音高越界（AVSpeech 静默夹取变声怪异）。
final class ChannelVoiceProfileTests: XCTestCase {

    func testChannelsAreDistinctAndOrdered() {
        let nav = ChannelVoiceProfile.pitchMultiplier(for: .navigation)
        let query = ChannelVoiceProfile.pitchMultiplier(for: .query)
        let call = ChannelVoiceProfile.pitchMultiplier(for: .call)
        // 三通道两两可分；导航沉稳偏低 < 环境基准 < 来电醒目偏高。
        XCTAssertLessThan(nav, query)
        XCTAssertLessThan(query, call)
        XCTAssertEqual(query, 1.0)  // 环境/识别是基准声（最常听，不做变调）
    }

    func testPitchWithinAVSpeechValidRange() {
        // AVSpeechUtterance.pitchMultiplier 合法域 0.5–2.0；越界会被静默夹取。
        // 同时收紧到 0.8–1.3：差异要"可辨不怪异"——过度变调对每天听几小时的用户是折磨。
        for ch in SpeechChannel.allCases {
            let p = ChannelVoiceProfile.pitchMultiplier(for: ch)
            XCTAssertGreaterThanOrEqual(p, 0.8, "\(ch) 音高过低")
            XCTAssertLessThanOrEqual(p, 1.3, "\(ch) 音高过高")
        }
    }

    func testUtteranceFactoryAppliesProfile() {
        // 发声工厂真把档案写进 utterance（接线层——中子档案即全通道同声）。
        for ch in SpeechChannel.allCases {
            let u = SpeechHub.makeUtterance("测试", rate: 0.5, voice: "zh-CN", channel: ch)
            XCTAssertEqual(u.pitchMultiplier, ChannelVoiceProfile.pitchMultiplier(for: ch),
                           "\(ch) 通道音高未按档案设置")
        }
        // 语速逻辑不受影响（rate 0.5 → min+0.5*(max-min)）。
        let u = SpeechHub.makeUtterance("x", rate: 0.5, voice: "zh-CN", channel: .query)
        let expected = AVSpeechUtteranceMinimumSpeechRate
            + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * 0.5
        XCTAssertEqual(u.rate, expected, accuracy: 0.001)
    }
}
