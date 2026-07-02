import Foundation

/// 通话屏文案中心表——E5 多语言主线第六批（盲人侧 + 协助者侧 + 来电屏）。
/// 通话状态全部经 A11y.announce 主动朗读，必须随语言；中文输出与历史完全一致。
enum CallStrings {

    // MARK: 通用按钮 / 防呆弹窗

    static func cancel(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }
    static func hangup(_ l: Language) -> String { l == .zh ? "挂断" : "End Call" }
    static func continueCall(_ l: Language) -> String { l == .zh ? "继续通话" : "Keep Talking" }
    static func hangupConfirmTitle(_ l: Language) -> String { l == .zh ? "确认挂断通话？" : "End the call?" }
    static func mute(_ l: Language) -> String { l == .zh ? "静音" : "Mute" }
    static func unmute(_ l: Language) -> String { l == .zh ? "取消静音" : "Unmute" }
    static func muteConfirmTitle(_ l: Language) -> String { l == .zh ? "确认静音？" : "Mute yourself?" }
    static func micDeniedBanner(_ l: Language) -> String {
        l == .zh ? "麦克风被关闭，对方听不到你——请到系统设置允许麦克风" : "Mic is off — they can't hear you. Allow mic in Settings."
    }
    static func micDeniedAnnounce(_ l: Language) -> String {
        l == .zh ? "麦克风未开启，对方将听不到你的声音。请到系统设置允许麦克风权限。"
                 : "Microphone is off, so they won't hear you. Please allow microphone access in Settings."
    }
    static func muteConfirmMessage(_ l: Language) -> String {
        l == .zh ? "静音后对方将暂时听不到你的声音。" : "While muted, the other person can't hear you."
    }
    static func hangupHint(_ l: Language) -> String {
        l == .zh ? "挂断需再次确认，避免误触" : "Ending the call asks for confirmation to prevent accidental taps"
    }

    // MARK: 通话内实时文字（RTT——嘈杂环境/听障场景的并行文字通道）

    static func textButton(_ l: Language) -> String { l == .zh ? "文字" : "Text" }
    static func textButtonUnread(_ n: Int, _ l: Language) -> String { l == .zh ? "文字（\(n) 条新消息）" : "Text (\(n) new)" }
    static func textSheetTitle(_ l: Language) -> String { l == .zh ? "通话文字" : "In-call text" }
    static func textPlaceholder(_ l: Language) -> String { l == .zh ? "输入文字…" : "Type a message…" }
    static func textSend(_ l: Language) -> String { l == .zh ? "发送" : "Send" }
    static func textEmptyHint(_ l: Language) -> String {
        l == .zh ? "文字会立刻送达对方并被读出，适合嘈杂环境或不便说话时。"
                 : "Text reaches them instantly and can be read aloud — great for noisy places or when speaking is hard."
    }
    static func textMine(_ l: Language) -> String { l == .zh ? "我" : "Me" }
    static func textPeer(_ l: Language) -> String { l == .zh ? "对方" : "Them" }
    /// 收到对端文字时的播报（盲人侧走 TTS 双通道，必须把内容念出来）。
    static func incomingCallText(_ text: String, _ l: Language) -> String {
        l == .zh ? "对方发来文字：\(text)" : "Text from them: \(text)"
    }
    /// 服务端拒绝回执 → 可行动的话（绝不把原始码念给盲人）。
    static func callTextRejected(_ reason: String, _ l: Language) -> String {
        switch reason {
        case "content_blocked": return l == .zh ? "文字包含违禁内容，未发送。" : "Message contains blocked content — not sent."
        case "rate_limited": return l == .zh ? "发送太快了，请稍等片刻再发。" : "Sending too fast — wait a moment and retry."
        default: return l == .zh ? "文字无效，未发送。" : "Invalid message — not sent."
        }
    }
    static func textNotSent(_ l: Language) -> String { l == .zh ? "未发送" : "Not sent" }

    // MARK: 举报 / 信任与安全

    static func reportDialogTitle(_ l: Language) -> String { l == .zh ? "举报对方" : "Report this person" }
    static func reportReasons(_ l: Language) -> [String] {
        l == .zh ? ["不当行为", "言语骚扰", "诈骗或可疑", "其他"]
                 : ["Inappropriate behavior", "Verbal harassment", "Scam or suspicious", "Other"]
    }
    static func reportDialogMessage(_ l: Language) -> String {
        l == .zh ? "举报会发送给管理员审核，请仅在确有问题时使用。"
                 : "Reports go to an admin for review. Please use only for real problems."
    }
    static func addFriendShort(_ l: Language) -> String { l == .zh ? "加为亲友" : "Add friend" }
    static func blockShort(_ l: Language) -> String { l == .zh ? "拉黑" : "Block" }
    static func reportShort(_ l: Language) -> String { l == .zh ? "举报" : "Report" }
    static func addFriendLong(_ l: Language) -> String { l == .zh ? "加为亲友/协助者" : "Add as friend/helper" }
    static func blockLong(_ l: Language) -> String { l == .zh ? "拉黑对方" : "Block this person" }
    static func reportLong(_ l: Language) -> String { l == .zh ? "举报对方" : "Report this person" }

    // MARK: 状态播报（经 A11y.announce 朗读）

    static func announceVideo(sending: Bool, _ l: Language) -> String {
        switch l {
        case .zh: return sending ? "已开始把画面显示给对方" : "已停止显示画面"
        case .en: return sending ? "Now showing your camera to them" : "Stopped showing your camera"
        }
    }
    static func announceMuted(_ muted: Bool, _ l: Language) -> String {
        switch l {
        case .zh: return muted ? "已静音，对方听不到你" : "已取消静音"
        case .en: return muted ? "Muted — they can't hear you" : "Unmuted"
        }
    }
    static func announceCamera(front: Bool, _ l: Language) -> String {
        switch l {
        case .zh: return front ? "已切换到前置摄像头，对方将看到你的脸" : "已切换到后置摄像头，对方看到你面前的情况"
        case .en: return front ? "Switched to the front camera — they'll see your face"
                               : "Switched to the rear camera — they'll see what's in front of you"
        }
    }
    static func announceRemoteTorch(on: Bool, _ l: Language) -> String {
        switch l {
        case .zh: return on ? "协助者帮你打开了手电筒" : "协助者关闭了手电筒"
        case .en: return on ? "Your helper turned on the flashlight" : "Your helper turned off the flashlight"
        }
    }

    // MARK: 协助者控件

    static func remoteTorch(on: Bool, _ l: Language) -> String {
        switch l {
        case .zh: return on ? "关闭对方手电筒" : "打开对方手电筒"
        case .en: return on ? "Turn off their flashlight" : "Turn on their flashlight"
        }
    }
    static func zoomA11y(_ zoom: Int, _ l: Language) -> String {
        l == .zh ? "变焦，当前 \(zoom) 倍，双击切换" : "Zoom, currently \(zoom)x, double-tap to cycle"
    }

    // MARK: 盲人侧画面门控 / A4 回退

    static func fallbackTitle(_ l: Language) -> String { l == .zh ? "改为向志愿者求助" : "Ask a Volunteer Instead" }
    static func fallbackSubtitle(_ l: Language) -> String {
        l == .zh ? "亲友暂时没接，让在线志愿者帮你" : "Family didn't answer — let an online volunteer help"
    }
    static func retryHelpTitle(_ l: Language) -> String { l == .zh ? "重新求助" : "Ask Again" }
    static func retryHelpSubtitle(_ l: Language) -> String {
        l == .zh ? "暂时没有志愿者，再向大家求助一次" : "No volunteer yet — broadcast your request again"
    }
    static func videoStatus(sending: Bool, front: Bool, _ l: Language) -> String {
        switch l {
        case .zh:
            guard sending else { return "画面未发送（隐私保护）" }
            return front ? "正在显示前置摄像头（你的面部）给对方" : "正在显示后置摄像头（你面前的情况）给对方"
        case .en:
            guard sending else { return "Camera not shared (privacy)" }
            return front ? "Showing the front camera (your face) to them"
                         : "Showing the rear camera (what's in front of you) to them"
        }
    }
    static func showVideo(_ l: Language) -> String { l == .zh ? "显示画面给对方" : "Show My Camera" }
    static func stopVideo(_ l: Language) -> String { l == .zh ? "停止显示画面" : "Stop Showing Camera" }
    static func showVideoHint(_ l: Language) -> String {
        l == .zh ? "开启后会把你的摄像头画面发送给协助者；可在下方选择后置(看你面前)或前置(看你的脸)"
                 : "Sends your camera to the helper; choose rear (what's ahead) or front (your face) below"
    }
    static func cameraPicker(_ l: Language) -> String { l == .zh ? "摄像头" : "Camera" }
    static func cameraRear(_ l: Language) -> String { l == .zh ? "后置（看前方）" : "Rear (ahead)" }
    static func cameraFront(_ l: Language) -> String { l == .zh ? "前置（看面部）" : "Front (face)" }
    static func cameraPickerA11y(_ l: Language) -> String {
        l == .zh ? "选择摄像头：后置看你面前的情况，前置让对方看到你的脸"
                 : "Choose camera: rear shows what's in front of you, front shows your face"
    }

    // MARK: 通话状态（ViewModel）

    static func connecting(_ l: Language) -> String { l == .zh ? "正在连接…" : "Connecting…" }
    static func defaultWaiting(_ l: Language) -> String { l == .zh ? "正在接通，请稍候…" : "Connecting, please wait…" }
    static func loginToCall(_ l: Language) -> String {
        l == .zh ? "请先在「设置 → 账号」登录后再呼叫" : "Sign in first in Settings → Account before calling"
    }
    static func mediaFailedHint(_ l: Language) -> String {
        l == .zh ? "媒体连接失败。请确保两台手机连同一个 WiFi；跨网络需开启 TURN（见手册 A3）。"
                 : "Media connection failed. Make sure both phones share one Wi-Fi; cross-network calls need TURN (manual A3)."
    }
    static func mediaFailedStatus(_ l: Language) -> String {
        l == .zh ? "媒体连接失败：请两台手机连同一 WiFi；跨网络需开启 TURN"
                 : "Media failed: use the same Wi-Fi on both phones; cross-network needs TURN"
    }
    static func reconnecting(_ l: Language) -> String { l == .zh ? "连接中断，正在尝试恢复…" : "Connection lost, recovering…" }
    static func establishingMedia(_ l: Language) -> String { l == .zh ? "正在建立媒体连接…" : "Setting up the media link…" }
    static func showingPeerVideo(_ l: Language) -> String { l == .zh ? "正在显示对方画面" : "Showing their camera" }
    static func waitingPeerVideo(_ l: Language) -> String {
        l == .zh ? "已连通。等待对方点「显示画面给对方」…" : "Connected. Waiting for them to share their camera…"
    }
    static func signalingClosed(_ l: Language) -> String {
        l == .zh ? "连接已断开，请重新呼叫" : "Connection closed — please call again"
    }
    static func declined(_ l: Language) -> String { l == .zh ? "对方已拒绝" : "They declined" }
    static func declinedSpeak(_ l: Language) -> String {
        l == .zh ? "对方拒绝接听，通话已结束" : "They declined the call. Call ended."
    }
    static func unanswered(_ l: Language) -> String { l == .zh ? "暂时无人接听" : "No answer yet" }
    static func unansweredAnnounce(_ l: Language) -> String {
        l == .zh ? "暂时无人接听。可以挂断，或改为向志愿者求助。"
                 : "No answer yet. You can hang up, or ask a volunteer instead."
    }
    static func peerVideoOn(_ l: Language) -> String { l == .zh ? "已连接 · 对方已开启画面" : "Connected · they're sharing video" }
    static func peerHungUp(_ l: Language) -> String { l == .zh ? "对方已挂断" : "They hung up" }
    static func connectedWith(_ name: String?, _ l: Language) -> String {
        if let name, !name.isEmpty { return l == .zh ? "已连接 · 与\(name)" : "Connected · with \(name)" }
        return l == .zh ? "已连接" : "Connected"
    }
    static func addRequestSent(_ l: Language) -> String {
        l == .zh ? "已发送添加请求，待对方确认" : "Request sent — waiting for their confirmation"
    }
    static func alreadyLinked(_ l: Language) -> String { l == .zh ? "你们已是亲友/协助者" : "You're already linked" }
    static func blockedRelation(_ l: Language) -> String { l == .zh ? "无法添加：存在拉黑关系" : "Can't add: one of you blocked the other" }
    static func addFailed(_ l: Language) -> String { l == .zh ? "添加失败" : "Couldn't add" }
    static func addFailedRetry(_ l: Language) -> String { l == .zh ? "添加失败，请重试" : "Couldn't add, please retry" }
    static func blockedOk(_ l: Language) -> String {
        l == .zh ? "已拉黑对方，今后将互不匹配/呼叫" : "Blocked — you won't be matched or called again"
    }
    static func blockFailed(_ l: Language) -> String { l == .zh ? "拉黑失败，请重试" : "Couldn't block, please retry" }
    static func cantReport(_ l: Language) -> String { l == .zh ? "暂时无法举报" : "Can't report right now" }
    static func reported(_ l: Language) -> String { l == .zh ? "已举报，感谢反馈" : "Reported — thank you" }
    static func reportFailed(_ l: Language) -> String { l == .zh ? "举报失败，请稍后再试" : "Report failed, try again later" }

    // MARK: 来电屏

    static func answer(_ l: Language) -> String { l == .zh ? "接听" : "Answer" }
    static func decline(_ l: Language) -> String { l == .zh ? "拒绝" : "Decline" }
    static func answeredElsewhere(_ l: Language) -> String { l == .zh ? "已被其他亲友接听" : "Answered by another family member" }
    static func incomingAnnounce(_ name: String, _ l: Language) -> String {
        l == .zh ? "\(name) 来电" : "Incoming call from \(name)"
    }
    static func missedCall(_ name: String, _ l: Language) -> String {
        l == .zh ? "未接来电：\(name)" : "Missed call from \(name)"
    }

    // MARK: 来电屏副标题 / 录制同意

    static func incomingCallSubtitle(_ l: Language) -> String { l == .zh ? "BeeUrEi 视频通话…" : "BeeUrEi video call…" }
    static func incomingRingAnnounce(_ name: String, _ l: Language) -> String {
        l == .zh ? "\(name) 来电，双击接听或拒绝" : "Incoming call from \(name). Double-tap to answer or decline."
    }
    static func recordTitle(_ l: Language) -> String { l == .zh ? "录制本次通话？" : "Record this call?" }
    static func recordExplain(_ l: Language) -> String {
        l == .zh ? "为留证或回看，本次通话可被录制。录制需双方同意；录制内容加密保存、到期自动删除，不作他用。"
                 : "This call may be recorded for evidence or replay. Recording needs both sides' consent; it's encrypted, auto-deleted on expiry, and used for nothing else."
    }
    static func recordAgree(_ l: Language) -> String { l == .zh ? "同意录制" : "Allow recording" }
    static func recordDecline(_ l: Language) -> String { l == .zh ? "不录制" : "Don't record" }
    // 录制控制（通话内）
    static func recordStart(_ l: Language) -> String { l == .zh ? "录制" : "Record" }
    static func recordStop(_ l: Language) -> String { l == .zh ? "停止录制" : "Stop recording" }
    static func recordingNow(_ l: Language) -> String { l == .zh ? "录制中" : "Recording" }
    static func recordRequesting(_ l: Language) -> String { l == .zh ? "正在请求对方同意录制…" : "Asking the other side to allow recording…" }
    static func recordStartedAnnounce(_ l: Language) -> String { l == .zh ? "已开始录制本次通话" : "Recording started" }
    static func recordStoppedAnnounce(_ l: Language) -> String { l == .zh ? "已停止录制并保存" : "Recording stopped and saved" }
    static func recordPeerStarted(_ l: Language) -> String { l == .zh ? "对方已开始录制本次通话" : "The other side started recording this call" }
    static func recordPeerStopped(_ l: Language) -> String { l == .zh ? "对方已停止录制" : "The other side stopped recording" }
    static func recordPeerAsking(_ l: Language) -> String { l == .zh ? "对方请求录制本次通话，请选择是否同意" : "The other side asks to record this call — please choose" }
    static func recordDeclinedByPeer(_ l: Language) -> String { l == .zh ? "对方不同意录制" : "The other side declined recording" }
    static func recordUnavailable(_ l: Language) -> String { l == .zh ? "本设备暂不支持通话录制" : "Call recording isn't available on this device" }
    static func recordDisabled(_ l: Language) -> String { l == .zh ? "录制功能未开启" : "Recording is turned off" }
    static func recordSaveFailed(_ l: Language) -> String { l == .zh ? "录制保存失败" : "Couldn't save the recording" }
    // 管理员旁观（合规监管，会通知双方）
    static func adminObservingBanner(_ l: Language) -> String { l == .zh ? "管理员正在监看本次通话" : "An admin is monitoring this call" }
    static func adminObservingAnnounce(_ l: Language) -> String { l == .zh ? "管理员已加入并正在监看本次通话" : "An admin has joined and is monitoring this call" }
    static func adminLeftAnnounce(_ l: Language) -> String { l == .zh ? "管理员已结束监看" : "The admin stopped monitoring" }
    static func observerConnecting(_ l: Language) -> String { l == .zh ? "正在接入监看…" : "Connecting to monitor…" }
    static func observerWatching(_ l: Language) -> String { l == .zh ? "正在监看通话" : "Monitoring the call" }
    static func observerTitle(_ l: Language) -> String { l == .zh ? "监看通话" : "Monitor call" }
    static func observerSpeak(_ l: Language) -> String { l == .zh ? "开麦说话" : "Speak" }
    static func observerStopSpeak(_ l: Language) -> String { l == .zh ? "关麦（仅听）" : "Stop speaking" }
    static func observerLeave(_ l: Language) -> String { l == .zh ? "结束监看" : "Stop monitoring" }
    static func observerForceEnd(_ l: Language) -> String { l == .zh ? "强制结束通话" : "Force-end call" }
    static func observerNoVideo(_ l: Language) -> String { l == .zh ? "（未共享画面）" : "(no video shared)" }
    // 举报弹层 + 附录制证据
    static func reportTapHint(_ l: Language) -> String { l == .zh ? "点按以此理由提交举报" : "Tap to submit a report with this reason" }
    static func attachRecordingEvidence(_ l: Language) -> String { l == .zh ? "附上本次通话录制作为证据" : "Attach this call's recording as evidence" }
    static func attachRecordingEvidenceHint(_ l: Language) -> String { l == .zh ? "仅在本次通话已录制时可用；录制将提供给管理员审核。" : "Available only if this call was recorded; the recording will be shared with moderators for review." }

    // MARK: 信号强弱（通话中网络状态条；来自 WebRTC 实测往返时延）

    static func signalLabel(_ quality: CallQuality, _ l: Language) -> String {
        switch quality {
        case .good: return l == .zh ? "信号强" : "Strong signal"
        case .fair: return l == .zh ? "信号中" : "Fair signal"
        case .weak: return l == .zh ? "信号弱" : "Weak signal"
        case .unknown: return l == .zh ? "信号检测中" : "Checking signal"
        }
    }
}
