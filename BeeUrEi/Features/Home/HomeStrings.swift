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

    // 保存的地点（家/公司）快捷导航播报。
    static func navigatingHome(_ l: Language) -> String { l == .zh ? "正在导航回家" : "Navigating home" }
    static func navigatingWork(_ l: Language) -> String { l == .zh ? "正在导航去公司" : "Navigating to work" }
    static func noHomeSet(_ l: Language) -> String {
        l == .zh ? "你还没有设置家的地址，可以在设置里的常用地点添加" : "You haven't set your home address yet. Add it in Settings under Saved Places."
    }
    static func noWorkSet(_ l: Language) -> String {
        l == .zh ? "你还没有设置公司的地址，可以在设置里的常用地点添加" : "You haven't set your work address yet. Add it in Settings under Saved Places."
    }

    static func voiceCommandsHelp(_ l: Language) -> String {
        l == .zh
            ? "你可以说：开始导盲、带我去某地、坐公交去某地、原路返回、回家、去公司、看一看、读一下文字、读整页、看看保质期、读电话号码、读邮箱、认一下钱、数一叠钱、扫个码、这是几路车、找我的钥匙、最近的厕所在哪、我在哪、周围有什么、前方有什么、有没有人、我朝哪个方向、这是什么颜色、这两件搭不搭、光线怎么样、天气、现在几点、还有多少电、今天几号、给某人发消息、给某人打电话、把位置发给某人、读一下消息、打开消息、打开设置、再说一遍、说慢点、说快点、说简短点、说详细点。需要人帮忙说\u{201C}求助\u{201D}；遇到危险说\u{201C}救命\u{201D}，会倒计时通知你的全部亲友。"
            : "You can say: start guide, take me to a place, take transit to a place, retrace my steps, take me home, go to work, look, read this, read the whole page, check the expiry date, read a phone number, read an email, identify money, count my cash, scan a code, which bus is this, find my keys, where's the nearest restroom, where am I, what's around, what's ahead, who's there, which way am I facing, what color is this, do these two match, how bright is it, weather, what time is it, battery level, what's the date, send a message, call a family member by name, share my location with someone, read my messages, open messages, open settings, repeat, speak slower/faster, or ask for less/more detail. Say \u{201C}get help\u{201D} to reach anyone available; say \u{201C}emergency\u{201D} if you're in danger — it counts down and alerts all your contacts."
    }

    /// 时间/日期播报：值用系统本地化格式（"下午3:25"/"3:25 PM"、"7月4日星期五"），TTS 读得自然。
    static func timeSpeak(_ time: String, _ l: Language) -> String { l == .zh ? "现在\(time)。" : "It's \(time)." }
    static func dateSpeak(_ date: String, _ l: Language) -> String { l == .zh ? "今天\(date)。" : "Today is \(date)." }
    /// 电量播报：百分比 + 充电中；未充电时按档追加建议——**≤10% 危急**("很低，请立即充电"）、≤20% 偏低（"建议充电"）。
    /// 危急档与主动告警 lowBatterySpeak(critical) 同阈值(10%)同调性：盲人**查询**与系统**主动告警**两条路径对同一
    /// 电量给一致的紧迫度——否则在 8% 时主动告警说"即将关机"、一查却只说"偏低"，自相矛盾、淡化真实危险。
    static func batterySpeak(percent: Int, charging: Bool, _ l: Language) -> String {
        let p = min(max(percent, 0), 100)
        if l == .zh {
            if charging { return "电量百分之\(p)，正在充电。" }
            if p <= 10 { return "电量百分之\(p)，电量很低，即将关机，请立即充电——手机没电会同时失去导盲、导航和求助。" }
            return p <= 20 ? "电量百分之\(p)，电量偏低，建议尽快充电。" : "电量百分之\(p)。"
        }
        if charging { return "Battery \(p) percent, charging." }
        if p <= 10 { return "Battery \(p) percent — critically low, about to shut down. Charge now: a dead phone loses obstacle guidance, navigation, and SOS." }
        return p <= 20 ? "Battery \(p) percent — running low, charge soon." : "Battery \(p) percent."
    }
    static func batteryUnknown(_ l: Language) -> String { l == .zh ? "暂时无法读取电量。" : "Battery level unavailable right now." }

    /// 主动低电量告警：点明**手机没电会同时失去导盲、导航和求助**（盲人看不到电量图标，不知严重性）。
    /// critical=10% 档，措辞更急并提示插上充电或备用电源。
    static func lowBatterySpeak(percent: Int, critical: Bool, _ l: Language) -> String {
        let p = min(max(percent, 0), 100)
        if l == .zh {
            return critical
                ? "电量只剩百分之\(p)，即将关机。请立即充电——手机没电会同时失去导盲、导航和紧急求助。"
                : "电量剩百分之\(p)，建议尽快充电，以免失去导盲、导航和求助功能。"
        }
        return critical
            ? "Battery critically low at \(p) percent — about to shut down. Charge now: a dead phone loses obstacle guidance, navigation, and emergency SOS."
            : "Battery at \(p) percent — charge soon so you don't lose obstacle guidance, navigation, and SOS."
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

    /// 取消提示。**VoiceOver 用户教 Magic Tap**（双指在屏幕**任意处**双击，全屏生效、无需先定位按钮）——摔倒/
    /// 撞击后手机常在口袋或手够不到，逐个滑动找「我没事」按钮在 30s 压力下极不可靠；双指双击是 iOS 全局手势，
    /// 落在盖满全屏的警报层上直达 cancel()，是盲人取消误报最快的路径。非 VoiceOver（低视力/明眼）仍指向大按钮。
    /// short=倒计时提醒里的精简版。
    static func fallCancelHint(voiceOver: Bool, short: Bool = false, _ l: Language) -> String {
        switch (voiceOver, l) {
        case (true, .zh):  return short ? "双指双击屏幕可取消。" : "如果你没事，双指在屏幕上双击即可取消。"
        case (true, .en):  return short ? "Two-finger double-tap to cancel." : "If you're OK, two-finger double-tap the screen to cancel."
        case (false, .zh): return short ? "点「我没事」可取消。" : "如果你没事，请点击屏幕上的「我没事」按钮。"
        case (false, .en): return short ? "Tap I'm OK to cancel." : "If you're OK, tap the I'm OK button."
        }
    }
    static func fallAlertSpeak(kind: String, voiceOver: Bool, _ l: Language) -> String {
        let what = kind == "crash" ? (l == .zh ? "剧烈撞击" : "a severe impact")
                                   : (l == .zh ? "疑似摔倒" : "a possible fall")
        let hint = fallCancelHint(voiceOver: voiceOver, l)
        return l == .zh ? "检测到\(what)。30 秒内无操作将自动通知你的亲友。\(hint)"
                        : "Detected \(what). Your family will be notified in 30 seconds. \(hint)"
    }
    static func manualSosSpeak(voiceOver: Bool, _ l: Language) -> String {
        let hint = fallCancelHint(voiceOver: voiceOver, l)
        return l == .zh ? "正在发起紧急求助。30 秒后将通知你的亲友并附带位置。\(hint)"
                        : "Starting an emergency SOS. Your family will be notified with your location in 30 seconds. \(hint)"
    }
    static func fallAlertReminder(_ seconds: Int, voiceOver: Bool, _ l: Language) -> String {
        let hint = fallCancelHint(voiceOver: voiceOver, short: true, l)
        return l == .zh ? "还有 \(seconds) 秒将通知亲友。\(hint)"
                        : "\(seconds) seconds until your family is notified. \(hint)"
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
    /// 告警**已发出后**的"报平安"按钮与播报：广播解除，让刚收到告警而担心的亲友安心。
    static func allClearButton(_ l: Language) -> String { l == .zh ? "报平安（我没事了）" : "I'm OK — send all-clear" }
    static func allClearSpeak(_ l: Language) -> String {
        l == .zh ? "已向亲友报平安，解除刚才的求助。" : "All-clear sent to your family — the alert is resolved."
    }
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
        l == .zh ? "没有找到叫\(name)的联系人或群，已打开消息列表。" : "Couldn't find a contact or group named \(name). Opening messages."
    }
    static func voiceSent(_ name: String, _ l: Language) -> String {
        l == .zh ? "已发送给\(name)。" : "Sent to \(name)."
    }
    static func voiceLocationSent(_ name: String, _ l: Language) -> String {
        l == .zh ? "已把你的位置发给\(name)。" : "Your location was sent to \(name)."
    }

    /// 语音发消息的收件人（联系人或群）。
    struct VoiceRecipient: Equatable { let id: String; let name: String; let isGroup: Bool }

    /// 语音"给X发消息"的收件人解析：在**联系人 + 群**里按口语名唯一匹配（大小写/子串不敏感）。
    /// 恰好一个匹配才返回；**精确整名优先**（说"妈妈"时即便有"妈妈的朋友"也直取"妈妈"），否则 0/多个歧义返回 nil。
    /// contacts/groups 传 (id, 显示名) 列表。同时命中一个联系人和一个群且都非精确 → 歧义 nil（交 UI 让用户选）。
    static func resolveVoiceRecipient(name spoken: String,
                                      contacts: [(id: String, name: String)],
                                      groups: [(id: String, name: String)]) -> VoiceRecipient? {
        let q = spoken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return nil }
        var hits: [VoiceRecipient] = []
        for c in contacts where c.name.localizedCaseInsensitiveContains(q) { hits.append(VoiceRecipient(id: c.id, name: c.name, isGroup: false)) }
        for g in groups where g.name.localizedCaseInsensitiveContains(q) { hits.append(VoiceRecipient(id: g.id, name: g.name, isGroup: true)) }
        let exact = hits.filter { $0.name.caseInsensitiveCompare(q) == .orderedSame }
        if exact.count == 1 { return exact[0] }
        return hits.count == 1 ? hits[0] : nil
    }

    static func voiceReadFailed(_ l: Language) -> String { l == .zh ? "读取消息失败，请稍后再试。" : "Couldn't read messages. Try again later." }

    /// 语音"读消息"的一条会话输入（单聊或群聊：对端/群名 + 最新一条 + 未读数）。isGroup 标记群聊，播报时点明"群"。
    struct UnreadConversation { let name: String; let kind: String; let text: String; let unread: Int; var isGroup: Bool = false }

    /// 非文本消息的可读占位（与服务端推送预览同口径）；文本原样、截断防超长；Apple 地图链接文本视作位置。
    static func messageReadoutPreview(kind: String, text: String, _ l: Language) -> String {
        switch kind {
        case "audio": return l == .zh ? "语音消息" : "a voice message"
        case "image": return l == .zh ? "一张图片" : "a photo"
        case "video": return l == .zh ? "一段视频" : "a video"
        case "location": return l == .zh ? "一个位置" : "a location"
        default:
            if text.contains("https://maps.apple.com/?ll=") { return l == .zh ? "一个位置" : "a location" }
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.count > 60 ? String(t.prefix(60)) + "…" : t
        }
    }

    /// 语音"读消息"汇报：只读**有未读**会话（单聊+群聊）的最新一条（隐私+简短，不逐条翻历史），至多 cap 个，超出提示"等"。
    /// 无未读→"没有未读消息"。群聊点名"群「X」"以与联系人区分。让盲人不进聊天界面、一句话即可听到谁发了什么（对标 Siri）。
    static func unreadReadout(_ items: [UnreadConversation], cap: Int = 5, _ l: Language) -> String {
        let withUnread = items.filter { $0.unread > 0 }
        guard !withUnread.isEmpty else { return l == .zh ? "没有未读消息。" : "No unread messages." }
        let shown = withUnread.prefix(max(1, cap))
        let parts = shown.map { c -> String in
            let preview = messageReadoutPreview(kind: c.kind, text: c.text, l)
            let name = c.isGroup ? (l == .zh ? "群「\(c.name)」" : "group “\(c.name)”") : c.name
            let more = c.unread > 1 ? (l == .zh ? "（等 \(c.unread) 条）" : " (\(c.unread) unread)") : ""
            return l == .zh ? "\(name)：\(preview)\(more)" : "\(name): \(preview)\(more)"
        }
        let head = l == .zh ? "你有 \(withUnread.count) 个会话有未读消息。" : "\(withUnread.count) conversation\(withUnread.count > 1 ? "s" : "") with unread messages. "
        let body = parts.joined(separator: l == .zh ? "；" : "; ")
        let tail = withUnread.count > shown.count ? (l == .zh ? "；等" : "; and more") : ""
        return head + body + tail
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
