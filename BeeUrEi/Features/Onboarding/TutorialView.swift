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
    let lang: Language // 教程文案与朗读嗓音语言（E5）
    var index = 0

    init() {
        let lang = FeatureSettings().language
        self.lang = lang
        switch lang {
        case .zh:
            steps = [
                TutorialStep(icon: "figure.walk", title: "实时避障",
                             body: "打开后，BeeUrEi 会用摄像头和激光雷达感知前方。遇到障碍、台阶或落差，会自动语音提醒你方向和距离。"),
                TutorialStep(icon: "person.fill.questionmark", title: "一键求助",
                             body: "需要人帮忙时，点首屏的‘呼叫帮手’。可以联系你的亲友或志愿者，和他们语音交流。"),
                TutorialStep(icon: "hand.point.up.left.fill", title: "按住才发画面",
                             body: "求助时你的摄像头画面默认不发送。只有你按住‘显示画面’按钮，对方才能看到，保护你的隐私。"),
                TutorialStep(icon: "mic.fill", title: "开口就能用",
                             body: "点首屏的麦克风按钮说话：\u{2018}带我去超市\u{2019}\u{2018}读一下\u{2019}\u{2018}找我的钥匙\u{2019}\u{2018}我在哪\u{2019}\u{2018}给妈妈打电话\u{2019}都可以。不知道说什么，就问\u{2018}你会什么\u{2019}；嫌快嫌慢就说\u{2018}说慢点\u{2019}\u{2018}说快点\u{2019}。"),
                TutorialStep(icon: "sos.circle.fill", title: "紧急求救",
                             body: "遇到危险，说\u{2018}救命\u{2019}或点\u{2018}紧急求救\u{2019}磁贴：30 秒倒计时后自动通知全部亲友并附你的位置，随时可取消。摔倒时 App 也会自动检测并发起同样的倒计时。"),
                TutorialStep(icon: "slider.horizontal.3", title: "按习惯调整",
                             body: "在‘设置’里可以调节语速、开启简短播报、单独开关避障和导航。"),
                TutorialStep(icon: "exclamationmark.shield.fill", title: "安全须知",
                             body: "BeeUrEi 是辅助工具，不能替代盲杖或导盲犬。请继续用你习惯的出行方式，并谨慎判断。"),
            ]
        case .en:
            steps = [
                TutorialStep(icon: "figure.walk", title: "Obstacle detection",
                             body: "BeeUrEi senses what's ahead with the camera and LiDAR. It announces obstacles, steps and drop-offs with direction and distance."),
                TutorialStep(icon: "person.fill.questionmark", title: "One-tap help",
                             body: "When you need a person, tap \"Get Help\" on the home screen to talk with your family or a volunteer."),
                TutorialStep(icon: "hand.point.up.left.fill", title: "Camera off by default",
                             body: "During a call, your camera is not shared until you press \"Show My Camera\" — your privacy stays in your hands."),
                TutorialStep(icon: "mic.fill", title: "Just speak",
                             body: "Tap the mic on the home screen and talk: \u{201C}take me to the store\u{201D}, \u{201C}read this\u{201D}, \u{201C}find my keys\u{201D}, \u{201C}where am I\u{201D}, \u{201C}call my daughter\u{201D}. Not sure? Ask \u{201C}what can you do\u{201D}. Too fast or slow? Say \u{201C}speak slower\u{201D} or \u{201C}speak faster\u{201D}."),
                TutorialStep(icon: "sos.circle.fill", title: "Emergency SOS",
                             body: "In danger, say \u{201C}emergency\u{201D} or tap the Emergency SOS tile: after a 30-second cancellable countdown it alerts all your contacts with your location. Falls are detected automatically and start the same countdown."),
                TutorialStep(icon: "slider.horizontal.3", title: "Make it yours",
                             body: "In Settings you can adjust the speech rate, switch to concise announcements, and toggle detection and navigation separately."),
                TutorialStep(icon: "exclamationmark.shield.fill", title: "Safety notice",
                             body: "BeeUrEi is an aid — it does not replace a white cane or guide dog. Keep your usual travel habits and judge carefully."),
            ]
        }
    }

    var current: TutorialStep { steps[index] }
    var isLast: Bool { index >= steps.count - 1 }
    var spokenText: String { "\(current.title)。\(current.body)" }

    /// proactiveVoiceOver=false 时（首次出现）不主动 post——让 VoiceOver 焦点朗读描述元素的 label，
    /// 避免与焦点朗读重复念两遍（见审查）。翻页时焦点在按钮上，需 proactive=true 主动播报。
    func announceCurrent(proactiveVoiceOver: Bool = true) {
        if UIAccessibility.isVoiceOverRunning {
            if proactiveVoiceOver {
                UIAccessibility.post(notification: .announcement, argument: spokenText)
            }
        } else {
            // 经全局语音总线（语音冲突审计：此前为独立合成器，会与避障/其他播报同时出声）。
            SpeechHub.shared.speak(spokenText, channel: .query, voiceCode: lang.voiceCode)
        }
    }

    func next() {
        guard !isLast else { return }
        index += 1
        announceCurrent()
    }

    func stop() { SpeechHub.shared.stopChannel(.query) }
}

/// 盲人友好的首次上手引导：大字 + 语音朗读 + VoiceOver 合并朗读。
struct TutorialView: View {
    @State private var model = TutorialModel()
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            // 仅把"描述"(图标+标题+正文)合并为一个可读元素；按钮保持各自独立、可聚焦、可激活，
            // 否则 .combine 会吞掉按钮的激活动作，VoiceOver 用户无法跳过/翻页/退出，卡在首屏（见审查）。
            VStack(spacing: 24) {
                Image(systemName: model.current.icon)
                    .font(.system(size: 72)).foregroundStyle(.tint)
                Text(model.current.title)
                    .font(.largeTitle).bold().multilineTextAlignment(.center)
                Text(model.current.body)
                    .font(.title3).multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(model.spokenText)
            Spacer()
            Text(model.lang == .zh ? "第 \(model.index + 1) / \(model.steps.count) 步"
                                   : "Step \(model.index + 1) of \(model.steps.count)")
                .font(.footnote).foregroundStyle(.secondary)
                // 让盲人也能获知进度（见无障碍审计）
                .accessibilityLabel(model.lang == .zh ? "第 \(model.index + 1) 步，共 \(model.steps.count) 步"
                                                      : "Step \(model.index + 1) of \(model.steps.count)")
            HStack {
                Button(model.lang == .zh ? "跳过" : "Skip") { model.stop(); onFinish() }
                    .buttonStyle(.bordered)
                Spacer()
                Button(model.isLast ? (model.lang == .zh ? "开始使用" : "Get Started")
                                    : (model.lang == .zh ? "下一步" : "Next")) {
                    if model.isLast { model.stop(); onFinish() } else { model.next() }
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
            }
            .padding(.horizontal)
        }
        .padding()
        // 首次出现：VoiceOver 让焦点朗读描述 label（不主动 post，避免重复）；非 VoiceOver 用语音读出。
        .task { model.announceCurrent(proactiveVoiceOver: false) }
    }
}

#Preview {
    TutorialView {}
}
