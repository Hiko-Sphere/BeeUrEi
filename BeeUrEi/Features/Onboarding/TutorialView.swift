import SwiftUI
import UIKit
import AVFoundation

/// 是否看过使用教程（首启展示一次，可在设置重看）。
struct TutorialStore {
    private let key = "tutorial.seen"
    var seen: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        nonmutating set { UserDefaults.standard.set(newValue, forKey: key) }
    }
}

struct TutorialStep: Identifiable {
    let id = UUID()
    let icon: String
    let title: String
    let body: String
}

@MainActor
@Observable
final class TutorialModel {
    let steps: [TutorialStep]
    var index = 0
    @ObservationIgnored private let synth = AVSpeechSynthesizer()

    init() {
        steps = [
            TutorialStep(icon: "figure.walk", title: "实时避障",
                         body: "打开后，BeeUrEi 会用摄像头和激光雷达感知前方。遇到障碍、台阶或落差，会自动语音提醒你方向和距离。"),
            TutorialStep(icon: "person.fill.questionmark", title: "一键求助",
                         body: "需要人帮忙时，点首屏的‘呼叫帮手’。可以联系你的亲友或志愿者，和他们语音交流。"),
            TutorialStep(icon: "hand.point.up.left.fill", title: "按住才发画面",
                         body: "求助时你的摄像头画面默认不发送。只有你按住‘显示画面’按钮，对方才能看到，保护你的隐私。"),
            TutorialStep(icon: "slider.horizontal.3", title: "按习惯调整",
                         body: "在‘设置’里可以调节语速、开启简短播报、单独开关避障和导航。"),
            TutorialStep(icon: "exclamationmark.shield.fill", title: "安全须知",
                         body: "BeeUrEi 是辅助工具，不能替代盲杖或导盲犬。请继续用你习惯的出行方式，并谨慎判断。"),
        ]
    }

    var current: TutorialStep { steps[index] }
    var isLast: Bool { index >= steps.count - 1 }
    var spokenText: String { "\(current.title)。\(current.body)" }

    func announceCurrent() {
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: spokenText)
        } else {
            let u = AVSpeechUtterance(string: spokenText)
            u.voice = AVSpeechSynthesisVoice(language: "zh-CN")
            u.rate = AVSpeechUtteranceMinimumSpeechRate
                + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * FeatureSettings().speechRate
            synth.stopSpeaking(at: .immediate)
            synth.speak(u)
        }
    }

    func next() {
        guard !isLast else { return }
        index += 1
        announceCurrent()
    }

    func stop() { synth.stopSpeaking(at: .immediate) }
}

/// 盲人友好的首次上手引导：大字 + 语音朗读 + VoiceOver 合并朗读。
struct TutorialView: View {
    @State private var model = TutorialModel()
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: model.current.icon)
                .font(.system(size: 72)).foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text(model.current.title)
                .font(.largeTitle).bold().multilineTextAlignment(.center)
            Text(model.current.body)
                .font(.title3).multilineTextAlignment(.center)
                .padding(.horizontal)
            Spacer()
            Text("第 \(model.index + 1) / \(model.steps.count) 步")
                .font(.footnote).foregroundStyle(.secondary)
                .accessibilityHidden(true)
            HStack {
                Button("跳过") { model.stop(); onFinish() }
                    .buttonStyle(.bordered)
                Spacer()
                Button(model.isLast ? "开始使用" : "下一步") {
                    if model.isLast { model.stop(); onFinish() } else { model.next() }
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
            }
            .padding(.horizontal)
        }
        .padding()
        // VoiceOver：当前步骤合并为一个可读元素。
        .accessibilityElement(children: .combine)
        .accessibilityLabel(model.spokenText)
        .task { model.announceCurrent() }
    }
}

#Preview {
    TutorialView {}
}
