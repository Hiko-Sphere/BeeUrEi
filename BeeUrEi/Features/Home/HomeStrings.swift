import Foundation

/// 主屏（避障）文案中心表——E5 多语言主线第四批（与 FramingStrings/NavStrings 同模式）。
/// 覆盖磁贴/状态条/红绿灯横幅/权限与不支持页的用户可见文案。中文输出与历史完全一致。
/// 开发者叠层（DevOverlay）为内部工具，不在本地化范围。
enum HomeStrings {

    // MARK: 磁贴

    /// 功能被管理员全站关闭时的提示（按钮禁用，VoiceOver 读出此 hint）。
    static func featureOff(_ l: Language) -> String {
        l == .zh ? "该功能暂时关闭" : "This feature is temporarily unavailable"
    }

    // MARK: 主页 Hub（首屏不再自动进入导盲；改为平静的功能中枢）

    /// 顶部状态药丸：就绪/待命（区别于"避障运行中"）。
    static func ready(_ l: Language) -> String { l == .zh ? "就绪" : "Ready" }

    /// 时段问候（含昵称，可空）。
    static func greeting(_ name: String?, hour: Int, _ l: Language) -> String {
        let part: String
        if l == .zh { part = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好" }
        else { part = hour < 6 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening" }
        guard let name, !name.isEmpty else { return part }
        return l == .zh ? "\(part)，\(name)" : "\(part), \(name)"
    }
    static func greetingHint(_ l: Language) -> String {
        l == .zh ? "想做点什么？两指双击屏幕可随时求助。" : "What would you like to do? Two-finger double-tap anytime for help."
    }

    /// 出行 / 看见 / 联系 三个分区标题（中英并列副标见 UI）。
    static func sectionMove(_ l: Language) -> String { l == .zh ? "出行" : "Move" }
    static func sectionSee(_ l: Language) -> String { l == .zh ? "看见" : "See" }
    static func sectionConnect(_ l: Language) -> String { l == .zh ? "联系" : "Connect" }

    /// 导盲/避障入口（首屏不再自动开启；显式进入）。
    static func tileObstacle(_ l: Language) -> String { l == .zh ? "导盲避障" : "Obstacle Guide" }
    static func hintObstacle(_ l: Language) -> String {
        l == .zh ? "进入实时避障：相机识别前方障碍并语音提示，需要带 LiDAR 的设备"
                 : "Enter live obstacle guidance: the camera detects obstacles ahead with spoken alerts (LiDAR device required)"
    }
    static func tileLocShare(_ l: Language) -> String { l == .zh ? "实时位置" : "Live Location" }
    static func hintLocShare(_ l: Language) -> String {
        l == .zh ? "与亲友/协助者互相共享当前位置" : "Share your live location with family and helpers"
    }
    /// 亲友与紧急呼叫（管理亲友、设紧急联系人、呼叫家人）——从设置移到首屏的主要功能。
    /// SOS 磁贴：手动紧急求救的可视入口（自动检测/语音"救命"之外的第三条路——嘈杂环境语音可能识别不了）。
    static func tileSOS(_ l: Language) -> String { l == .zh ? "紧急求救" : "Emergency SOS" }
    static func hintSOS(_ l: Language) -> String {
        l == .zh ? "点按后 30 秒倒计时，可随时取消；倒计时结束通知全部亲友并附你的位置"
                 : "Starts a 30-second cancellable countdown, then alerts all your contacts with your location"
    }

    static func tileFamily(_ l: Language) -> String { l == .zh ? "亲友与紧急" : "Family & SOS" }
    static func hintFamily(_ l: Language) -> String {
        l == .zh ? "管理亲友、设置紧急联系人、直接呼叫家人；摔倒报警也会通知这里的家人"
                 : "Manage family, set emergency contacts and call relatives; fall alerts notify the family set here"
    }
    /// 我的录音（查看与回放通话录音）——从设置移到首屏的主要功能。
    static func tileRecordings(_ l: Language) -> String { l == .zh ? "我的录音" : "My recordings" }
    static func hintRecordings(_ l: Language) -> String {
        l == .zh ? "查看与回放你的通话录音" : "View and replay your call recordings"
    }

    /// 落地一次性朗读：问候 + 求助提醒。
    static func greetingSpeak(_ name: String?, hour: Int, _ l: Language) -> String {
        "\(greeting(name, hour: hour, l))。\(greetingHint(l))"
    }

    // MARK: 导盲模式（独立全屏）控件

    static func exitGuide(_ l: Language) -> String { l == .zh ? "退出避障" : "Exit guide" }
    static func repeatLabel(_ l: Language) -> String { l == .zh ? "重复" : "Repeat" }
    static func guideStartedSpeak(_ l: Language) -> String {
        l == .zh ? "已进入实时避障，正在识别前方障碍。" : "Obstacle guidance is on, detecting what's ahead."
    }
    /// 避障内「快捷操作」入口（与主页一致的看一看/导航/天气/环境/消息/位置/设置）。
    static func quickActionsTitle(_ l: Language) -> String { l == .zh ? "快捷操作" : "Quick actions" }
    static func quickActionsHint(_ l: Language) -> String {
        l == .zh ? "打开看一看、导航、天气、周围、消息、实时位置、设置等快捷操作"
                 : "Open quick actions: look around, navigation, weather, surroundings, messages, live location, settings"
    }
    /// 能力自述（.commands）：盲人无法浏览 UI 发现功能——语音能力必须能被语音发现。按使用频率排序，
    /// 紧急能力放最后压轴强调（列表式播报的记忆点在首尾）。
    /// 语速调节确认（配 SpeechRatePolicy）：改后用**新语速**播这句，让用户当场听到效果。
    static func speechRateChanged(_ adjust: SpeechRateAdjust, _ l: Language) -> String {
        switch adjust {
        case .faster: return l == .zh ? "语速已加快" : "Speaking faster now"
        case .slower: return l == .zh ? "语速已放慢" : "Speaking slower now"
        case .normal: return l == .zh ? "语速已恢复正常" : "Speech rate reset to normal"
        }
    }
    /// 已到语速上/下限（无变化时提示，不做无声调节）。
    static func speechRateAtLimit(_ adjust: SpeechRateAdjust, _ l: Language) -> String {
        adjust == .faster ? (l == .zh ? "已经是最快的语速了" : "Already at the fastest speed")
                          : (l == .zh ? "已经是最慢的语速了" : "Already at the slowest speed")
    }

    /// 详略调节确认（按**结果档位**描述，让用户知道各档含义——尤其"最简"会不报转向，须点明）。
    static func verbosityChanged(_ level: FeedbackVerbosity, _ l: Language) -> String {
        switch level {
        case .quiet:  return l == .zh ? "已切到最简播报，只报危险和障碍" : "Minimal announcements — only hazards and obstacles"
        case .normal: return l == .zh ? "已切到正常播报，报转向和危险" : "Normal announcements — turns and hazards"
        case .full:   return l == .zh ? "已切到详细播报，播报全部信息" : "Detailed announcements — everything"
        }
    }
    static func verbosityAtLimit(_ direction: VerbosityAdjust, _ l: Language) -> String {
        direction == .moreDetail ? (l == .zh ? "已经是最详细的播报了" : "Already at the most detailed level")
                                 : (l == .zh ? "已经是最简的播报了" : "Already at the most minimal level")
    }

    static func voiceCommandsHelp(_ l: Language) -> String {
        l == .zh
            ? "你可以说：开始导盲、带我去某地、看一看、读一下文字、找我的钥匙、我在哪、周围有什么、天气、给某人发消息、打开消息、再说一遍、说慢点、说快点、说简短点、说详细点。需要人帮忙说\u{201C}求助\u{201D}；遇到危险说\u{201C}救命\u{201D}，会倒计时通知你的全部亲友。"
            : "You can say: start guide, take me to a place, look, read this, find my keys, where am I, what's around, weather, send a message, open messages, repeat, speak slower/faster, or ask for less/more detail. Say \u{201C}get help\u{201D} to call someone; say \u{201C}emergency\u{201D} if you're in danger — it counts down and alerts all your contacts."
    }

    static func nothingToRepeat(_ l: Language) -> String {
        l == .zh ? "现在没有需要重复的播报。" : "There's nothing to repeat right now."
    }

    static func helpTitle(_ l: Language) -> String { l == .zh ? "求助" : "Get Help" }
    static func helpSubtitle(_ l: Language) -> String {
        l == .zh ? "呼叫志愿者或亲友帮你看" : "Call a volunteer or family member to see for you"
    }
    static func tileNav(_ l: Language) -> String { l == .zh ? "步行导航" : "Walk Navigate" }
    static func hintNav(_ l: Language) -> String {
        l == .zh ? "输入目的地，语音逐向指路，可原路返回" : "Enter a destination for spoken turn-by-turn guidance and backtracking"
    }
    static func tileLook(_ l: Language) -> String { l == .zh ? "看一看" : "Look Around" }
    static func hintLook(_ l: Language) -> String {
        l == .zh ? "用相机对准物体，语音说出它是什么" : "Point the camera at something and hear what it is"
    }
    static func tileWhereAmI(_ l: Language) -> String { l == .zh ? "我在哪" : "Where Am I" }
    static func hintWhereAmI(_ l: Language) -> String {
        l == .zh ? "播报你当前位置和附近的地点" : "Announce your current location and nearby places"
    }
    static func tileAround(_ l: Language) -> String { l == .zh ? "周围有什么" : "What's Around" }
    static func hintAround(_ l: Language) -> String {
        l == .zh ? "按时钟方位播报四周的地点，如三点钟方向五十米便利店"
                 : "Announce places around you by clock direction, like a store at 3 o'clock, 50 meters"
    }
    static func tileAhead(_ l: Language) -> String { l == .zh ? "前方有什么" : "What's Ahead" }
    static func hintAhead(_ l: Language) -> String {
        l == .zh ? "只播报你面朝方向的地点" : "Announce only the places in the direction you're facing"
    }
    static func tileSettings(_ l: Language) -> String { l == .zh ? "设置" : "Settings" }
    static func tileWeather(_ l: Language) -> String { l == .zh ? "天气" : "Weather" }
    static func hintWeather(_ l: Language) -> String {
        l == .zh ? "播报当地天气与出行建议，如下雨提醒带伞" : "Announce local weather and travel tips, like bringing an umbrella"
    }
    static func envGroup(_ l: Language) -> String { l == .zh ? "环境感知" : "Surroundings" }

    // MARK: 摔倒/撞击警报

    static func fallAlertSpeak(kind: String, _ l: Language) -> String {
        let what = kind == "crash" ? (l == .zh ? "剧烈撞击" : "a severe impact")
                                   : (l == .zh ? "疑似摔倒" : "a possible fall")
        return l == .zh ? "检测到\(what)。30 秒内无操作将自动通知你的亲友。如果你没事，请点击屏幕上的「我没事」按钮。"
                        : "Detected \(what). Your family will be notified in 30 seconds. If you're OK, tap the I'm OK button."
    }
    static func manualSosSpeak(_ l: Language) -> String {
        l == .zh ? "正在发起紧急求助。30 秒后将通知你的亲友并附带位置。如果你没事，请点击「我没事」取消。"
                 : "Starting an emergency SOS. Your family will be notified with your location in 30 seconds. Tap I'm OK to cancel."
    }
    static func fallAlertReminder(_ seconds: Int, _ l: Language) -> String {
        l == .zh ? "还有 \(seconds) 秒将通知亲友。点「我没事」可取消。"
                 : "\(seconds) seconds until your family is notified. Tap I'm OK to cancel."
    }
    static func fallAlertCancelled(_ l: Language) -> String { l == .zh ? "已取消，注意安全。" : "Cancelled. Stay safe." }
    static func fallAlertSent(_ n: Int, _ l: Language) -> String {
        n > 0 ? (l == .zh ? "已通知 \(n) 位亲友。" : "Notified \(n) family member\(n > 1 ? "s" : "").")
              : (l == .zh ? "没有可通知的亲友。请先绑定亲友，或直接呼叫求助。" : "No family to notify. Add family first, or call for help.")
    }
    static func fallAlertFailed(_ l: Language) -> String {
        l == .zh ? "通知发送失败，请直接呼叫求助。" : "Couldn't send the alert. Please call for help directly."
    }
    /// 无网兜底拨号播报（配 EmergencyDialCache）：告警失败转蜂窝语音拨紧急联系人。
    static func dialingFallback(_ name: String, _ l: Language) -> String {
        l == .zh ? "正在为你拨打\(name)的电话，请在弹出的确认里选择呼叫。"
                 : "Calling \(name) now — confirm the call in the prompt."
    }

    static func fallAlertNeedLogin(_ l: Language) -> String {
        l == .zh ? "未登录，无法通知亲友。请直接呼叫求助。" : "Not signed in — can't notify family. Please call for help."
    }
    static func imOK(_ l: Language) -> String { l == .zh ? "我没事" : "I'm OK" }
    static func notifyNow(_ l: Language) -> String { l == .zh ? "立即通知亲友" : "Notify family now" }
    static func fallAlertTitle(_ l: Language) -> String { l == .zh ? "检测到可能的意外" : "Possible accident detected" }
    static func magicTapHint(_ l: Language) -> String {
        l == .zh ? "双指双击可一键求助" : "Two-finger double-tap to call for help"
    }

    // MARK: 语音指令

    static func voiceButton(_ l: Language) -> String { l == .zh ? "语音指令" : "Voice command" }
    static func voiceButtonHint(_ l: Language) -> String {
        l == .zh ? "点击后说出指令，如：我在哪、带我去超市、给妈妈发消息说我到了"
                 : "Tap and speak, like: where am I, take me to the store, message Mom saying I arrived"
    }
    static func voiceNotUnderstood(_ l: Language) -> String {
        l == .zh ? "没听懂。可以说：求助、我在哪、周围有什么、天气、带我去某地、读文字、识别纸币、给某人发消息。"
                 : "Didn't catch that. Try: get help, where am I, what's around, weather, take me to a place, read text, or message someone."
    }
    static func voiceHeardNothing(_ l: Language) -> String {
        l == .zh ? "没有听到声音，请再试一次。" : "I didn't hear anything. Please try again."
    }
    static func voiceMicDenied(_ l: Language) -> String {
        l == .zh ? "需要麦克风和语音识别权限，请到系统设置开启。"
                 : "Microphone and speech recognition access are needed. Enable them in Settings."
    }
    static func voiceNeedLogin(_ l: Language) -> String {
        l == .zh ? "请先登录才能发消息。" : "Sign in first to send messages."
    }
    static func voiceNoContact(_ name: String, _ l: Language) -> String {
        l == .zh ? "没有找到叫\(name)的亲友，已打开消息列表。" : "Couldn't find a contact named \(name). Opening messages."
    }
    static func voiceSent(_ name: String, _ l: Language) -> String {
        l == .zh ? "已发送给\(name)。" : "Sent to \(name)."
    }

    // MARK: 红绿灯横幅（Oko 式第三通道）

    static func trafficRed(_ l: Language) -> String { l == .zh ? "红灯 · 请等待" : "Red light · Wait" }
    static func trafficGreen(_ l: Language) -> String { l == .zh ? "绿灯 · 可通行" : "Green light · You may cross" }
    static func trafficYellow(_ l: Language) -> String { l == .zh ? "黄灯 · 请勿通行" : "Yellow light · Do not cross" }

    // MARK: 状态条 / 相机状态

    static func proximityBlocked(_ l: Language) -> String { l == .zh ? "正前方有障碍" : "Obstacle straight ahead" }
    static func proximityMeters(_ m: Double, _ l: Language) -> String {
        l == .zh ? String(format: "正前方约 %.1f 米", m) : String(format: "About %.1f m straight ahead", m)
    }
    static func proximityClear(_ l: Language) -> String { l == .zh ? "正前方通畅" : "Path ahead is clear" }
    /// 中央 ROI 零有效深度读数（LiDAR 读不到：玻璃/镜面/超近盲区，或超出量程的开阔空间）。
    /// 视觉如实显示"无读数"而非"通畅"，避免对低视力用户也造成假安心（见安全复审）。
    static func proximityNoReading(_ l: Language) -> String { l == .zh ? "正前方无读数" : "No reading ahead" }
    static func clearAheadSpeech(_ l: Language) -> String { l == .zh ? "前方通畅" : "Path clear" }
    static func tapToRepeat(_ l: Language) -> String { l == .zh ? "点按重复播报" : "Tap to repeat the announcement" }
    static func cameraError(_ message: String, _ l: Language) -> String {
        l == .zh ? "相机出错：\(message)" : "Camera error: \(message)"
    }
    static func starting(_ l: Language) -> String { l == .zh ? "正在启动…" : "Starting…" }
    static func callHelper(_ l: Language) -> String { l == .zh ? "呼叫帮手" : "Call a Helper" }

    // MARK: 权限被拒 / 设备不支持

    static func permTitle(_ l: Language) -> String { l == .zh ? "相机权限被关闭" : "Camera access is off" }
    static func permBody(_ l: Language) -> String {
        l == .zh ? "BeeUrEi 需要使用摄像头来识别前方障碍。请前往「设置」开启相机权限。"
                 : "BeeUrEi needs the camera to detect obstacles ahead. Please enable camera access in Settings."
    }
    static func openSettings(_ l: Language) -> String { l == .zh ? "打开设置" : "Open Settings" }
    static func retry(_ l: Language) -> String { l == .zh ? "重试" : "Retry" }
    static func permAnnounce(_ l: Language) -> String {
        l == .zh ? "相机权限被关闭，避障已停止。请到设置开启相机权限，或呼叫帮手。"
                 : "Camera access is off and obstacle detection has stopped. Enable camera access in Settings, or call a helper."
    }
    static func unsupportedTitle(_ l: Language) -> String { l == .zh ? "设备不支持" : "Device not supported" }
    static func unsupportedAnnounce(_ message: String, _ l: Language) -> String {
        l == .zh ? "设备不支持避障。\(message)" : "Obstacle detection isn't available on this device. \(message)"
    }
    static func noLiDARMessage(_ l: Language) -> String {
        l == .zh ? "此设备没有 LiDAR。BeeUrEi 仅支持带 LiDAR 的 iPhone（iPhone 12 Pro 及更新的 Pro 机型）。"
                 : "This device has no LiDAR. BeeUrEi requires a LiDAR iPhone (iPhone 12 Pro or newer Pro models)."
    }
}
