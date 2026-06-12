import Foundation

/// 主屏（避障）文案中心表——E5 多语言主线第四批（与 FramingStrings/NavStrings 同模式）。
/// 覆盖磁贴/状态条/红绿灯横幅/权限与不支持页的用户可见文案。中文输出与历史完全一致。
/// 开发者叠层（DevOverlay）为内部工具，不在本地化范围。
enum HomeStrings {

    // MARK: 磁贴

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
