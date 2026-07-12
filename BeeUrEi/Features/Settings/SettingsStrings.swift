import Foundation

/// 设置页文案中心表——E5 多语言主线第七批。中文输出与历史完全一致。
/// 完整安全须知（DisclaimerText.full）为法律文本，翻译需单独校对，暂保持中文（已在状态文档标注）。
enum SettingsStrings {

    // MARK: 分区标题（盲人优先：核心安全置顶，其余按"语音→障碍提示→显示→账号→其他"递减）

    // MARK: 顶部身份卡 / 分区（设置 v3：身份置顶 → 安全 → 语音 → 外观与屏幕 → 法律与帮助）

    /// 顶部身份卡尾注（管理头像/昵称/邮箱/手机号/登录方式与安全，均在账号与安全页内）。
    static func identityFooter(_ l: Language) -> String {
        l == .zh ? "管理头像、昵称、邮箱、手机号、登录方式与账号安全。"
                 : "Manage your avatar, nickname, email, phone, sign-in methods and account security."
    }
    /// 未登录时身份卡主副标题。
    static func signInPrompt(_ l: Language) -> String { l == .zh ? "登录 / 注册" : "Sign in / Register" }
    static func signInSubtitle(_ l: Language) -> String {
        l == .zh ? "登录后可使用通话、亲友、录音等功能" : "Sign in to use calls, family, recordings and more"
    }
    /// 安全分区（避障/导航/摔倒 + 亲友与紧急联系挪到一处）。
    static func safetyHeader(_ l: Language) -> String { l == .zh ? "安全" : "Safety" }
    static func safetyFooter(_ l: Language) -> String {
        l == .zh ? "这些设置保护你的安全。避障与摔倒警报在你行走时运行；关闭避障会先与你确认；检测到摔倒会通知你在「亲友与紧急联系」里设置的家人。"
                 : "These keep you safe. Obstacle and fall alerts run while you walk; turning avoidance off asks first; a detected fall notifies the family you set under \"Family & emergency\"."
    }
    /// 外观与屏幕分区（高对比 + 常亮时长 + 试触，从「更多设置」上移）。
    static func displayScreenHeader(_ l: Language) -> String { l == .zh ? "外观与屏幕" : "Display & screen" }
    static func displayScreenFooter(_ l: Language) -> String {
        l == .zh ? "高对比大字状态条便于低视力查看；文字大小同时跟随系统设置。屏幕常亮默认「永久」，避障使用期间不息屏；可改为若干秒后允许息屏省电（息屏后避障暂停，点亮即恢复）。"
                 : "The high-contrast large status bar helps low vision; text size also follows the system setting. The screen stays on (\"Never dim\") during obstacle detection by default; allow auto-sleep after a delay to save battery (detection pauses while asleep and resumes when you wake the screen)."
    }
    /// 恢复默认的诚实范围说明（resetToDefaults 仅还原 6 个语音/显示偏好键）。
    static func resetScopeFooter(_ l: Language) -> String {
        l == .zh ? "「恢复默认」仅还原语音与显示偏好（简短、语速、详略、通畅确认、高对比、接近声呐），不会改动避障、导航、摔倒、屏幕常亮与语言设置。"
                 : "\"Reset to defaults\" restores only voice & display preferences (concise, rate, verbosity, path-clear, high contrast, sonar). It does not touch obstacle, navigation, fall detection, keep-awake or language settings."
    }

    static func coreSafetyHeader(_ l: Language) -> String { l == .zh ? "核心安全" : "Core safety" }
    static func coreSafetyFooter(_ l: Language) -> String {
        l == .zh ? "这些是最重要的安全功能。实时避障默认开启；关闭前会再次与你确认。导航功能仍在开发中。"
                 : "The most important safety features. Obstacle detection is on by default; you'll be asked to confirm before turning it off. Navigation is still in development."
    }
    static func voiceHeader(_ l: Language) -> String { l == .zh ? "语音播报" : "Voice & speech" }
    static func voiceFooter(_ l: Language) -> String {
        l == .zh ? "决定避障实时引导的语言、语速与详略；简短播报更快说完、降低认知负荷。可随时「试听播报」确认效果。"
                 : "Sets the language, rate and detail of real-time guidance. Concise announcements finish faster. Use \"Preview\" to hear the result."
    }
    static func obstacleHeader(_ l: Language) -> String { l == .zh ? "障碍提示" : "Obstacle cues" }
    static func obstacleFooter(_ l: Language) -> String {
        l == .zh ? "可选的额外提示。接近声呐像倒车雷达，越近蜂鸣越急；空间音从障碍所在方向发声（推荐 AirPods）。"
                 : "Optional extra cues. The sonar works like a parking sensor — beeps speed up as obstacles get closer; spatial audio plays from the obstacle's direction (AirPods recommended)."
    }
    static func displayHeader(_ l: Language) -> String { l == .zh ? "触觉与显示" : "Haptics & display" }
    static func legalHelpHeader(_ l: Language) -> String { l == .zh ? "法律与帮助" : "Legal & help" }
    static func moreSettings(_ l: Language) -> String { l == .zh ? "更多设置" : "More settings" }
    static func moreSettingsHint(_ l: Language) -> String {
        l == .zh ? "障碍提示细节、触觉与显示、屏幕与省电、开发者、关于。"
                 : "Obstacle cues, haptics & display, screen & battery, developer, and about."
    }

    // MARK: 语音提醒

    static func briefReminderToggle(_ l: Language) -> String {
        l == .zh ? "开始避障时播报安全提醒" : "Speak a safety reminder when starting"
    }
    static func reminderHeader(_ l: Language) -> String { l == .zh ? "语音提醒" : "Voice reminder" }
    static func reminderFooter(_ l: Language) -> String {
        l == .zh ? "关闭后，每次开始避障不再播报那句简短提醒；首次启动的完整安全须知仍会保留。"
                 : "When off, the short reminder is skipped at each start; the full first-launch safety notice stays."
    }

    // MARK: 播报

    static func conciseToggle(_ l: Language) -> String { l == .zh ? "简短播报" : "Concise announcements" }
    static func speechRate(_ l: Language) -> String { l == .zh ? "语速" : "Speech rate" }
    static func slow(_ l: Language) -> String { l == .zh ? "慢" : "Slow" }
    static func fast(_ l: Language) -> String { l == .zh ? "快" : "Fast" }
    static func sonarToggle(_ l: Language) -> String {
        l == .zh ? "接近声呐（越近蜂鸣越密）" : "Proximity sonar (faster beeps when closer)"
    }
    static func spatialToggle(_ l: Language) -> String {
        l == .zh ? "空间音方向提示（AirPods 推荐）" : "Spatial direction cues (AirPods recommended)"
    }
    static func spatialHint(_ l: Language) -> String {
        l == .zh ? "播报危险障碍时，从障碍所在方向播一声提示音；戴 AirPods 转头时声音方向保持不变"
                 : "Plays a cue from the obstacle's direction; with AirPods the direction stays fixed as you turn your head"
    }
    static func verbosityPicker(_ l: Language) -> String { l == .zh ? "播报详略" : "Verbosity" }
    static func verbosityQuiet(_ l: Language) -> String { l == .zh ? "安静（只危险）" : "Quiet (danger only)" }
    static func verbosityNormal(_ l: Language) -> String { l == .zh ? "正常（转向+危险）" : "Normal (turns + danger)" }
    static func verbosityDetailed(_ l: Language) -> String { l == .zh ? "详细（全部）" : "Detailed (everything)" }
    static func clearConfirmToggle(_ l: Language) -> String {
        l == .zh ? "前方通畅时定期确认" : "Periodic \"path clear\" confirmation"
    }
    static func fallDetectToggle(_ l: Language) -> String {
        l == .zh ? "摔倒/撞击自动报警" : "Fall & impact alerts"
    }
    static func fallDetectHint(_ l: Language) -> String {
        l == .zh ? "检测到疑似摔倒或剧烈撞击且 30 秒无人取消时，自动通知绑定的亲友"
                 : "If a fall or severe impact is detected and not cancelled within 30 seconds, your family is notified"
    }
    static func previewSpeech(_ l: Language) -> String { l == .zh ? "试听播报" : "Preview announcement" }
    static func previewSpeechHint(_ l: Language) -> String {
        l == .zh ? "用当前语速和详略念一句示例" : "Speaks a sample with the current rate and verbosity"
    }
    static func speechHeader(_ l: Language) -> String { l == .zh ? "播报" : "Announcements" }
    static func speechFooter(_ l: Language) -> String {
        l == .zh ? "简短播报更快说完、降低认知负荷；语速可按习惯调整。接近声呐像倒车雷达，正前方越近蜂鸣越急。"
                 : "Concise announcements finish faster and reduce load. The sonar works like a parking sensor — beeps speed up as obstacles get closer."
    }

    // MARK: 屏幕与省电

    static func keepAwakePicker(_ l: Language) -> String { l == .zh ? "屏幕常亮" : "Keep screen on" }
    static func keepAwakeForever(_ l: Language) -> String {
        l == .zh ? "永久不息屏（避障持续，最费电）" : "Never dim (continuous detection, most battery)"
    }
    static func keepAwakeAfter(_ seconds: Int, _ l: Language) -> String {
        switch l {
        case .zh: return seconds >= 60 ? "\(seconds / 60) 分钟后允许息屏" : "\(seconds) 秒后允许息屏"
        case .en: return seconds >= 60 ? "Allow sleep after \(seconds / 60) min" : "Allow sleep after \(seconds) s"
        }
    }
    static func screenHeader(_ l: Language) -> String { l == .zh ? "屏幕与省电" : "Screen & battery" }
    static func screenFooter(_ l: Language) -> String {
        l == .zh ? "避障使用期间默认保持屏幕常亮（否则息屏会暂停摄像头与避障）。若想省电，可设为若干秒后允许自动息屏；息屏后避障会暂停，重新点亮屏幕即恢复。"
                 : "The screen stays on during obstacle detection (sleeping pauses the camera). To save battery, allow auto-sleep after a delay; detection pauses while asleep and resumes when you wake the screen."
    }

    // MARK: 无障碍

    static func highContrastToggle(_ l: Language) -> String { l == .zh ? "高对比大字状态条" : "High-contrast large status bar" }
    static func hapticsToggle(_ l: Language) -> String { l == .zh ? "震动反馈" : "Vibration feedback" }
    static func hapticsToggleHint(_ l: Language) -> String {
        l == .zh ? "障碍与转向按危险等级震动；关闭后不再震动（省电或嫌打扰时）" : "Vibrates for obstacles and turns by danger level; turn off to stop all vibration (saves battery / avoids distraction)"
    }
    static func previewHaptic(_ l: Language) -> String { l == .zh ? "试一下震动" : "Try the vibration" }
    static func previewHapticHint(_ l: Language) -> String {
        l == .zh ? "播放一次危险等级的震动" : "Plays one danger-level vibration"
    }
    static func resetDefaults(_ l: Language) -> String { l == .zh ? "恢复默认设置" : "Reset to defaults" }
    static func resetDefaultsHint(_ l: Language) -> String {
        l == .zh ? "把语速、详略、对比、声呐等播报设置恢复为默认"
                 : "Resets rate, verbosity, contrast, sonar and other announcement settings"
    }
    static func a11yHeader(_ l: Language) -> String { l == .zh ? "无障碍" : "Accessibility" }
    static func a11yFooter(_ l: Language) -> String {
        l == .zh ? "为低视力用户：避障状态用实底深色 + 高亮大字显示。文字大小同时跟随系统「字体大小」设置。"
                 : "For low vision: the status bar uses a solid dark background with large bright text, and follows the system text size."
    }

    // MARK: 账号 / 功能 / 开发者 / 帮助 / 关于

    static func accountHeader(_ l: Language) -> String { l == .zh ? "账号" : "Account" }
    static func loginRegister(_ l: Language) -> String { l == .zh ? "登录 / 注册" : "Sign in / Register" }
    static func familyAndEmergency(_ l: Language) -> String { l == .zh ? "亲友与紧急呼叫" : "Family & emergency calls" }
    // 语言区：刻意双语并排（看不懂当前语言的用户也要能找到这个切换）。
    static func languageHeader(_ l: Language) -> String { "语言 / Language" }
    static func languagePickerLabel(_ l: Language) -> String { "播报语言 / Speech language" }
    static func languageSystemOption(_ l: Language) -> String { "跟随系统 / System" }
    static func languageFooter(_ l: Language) -> String {
        "决定避障实时语音引导的语言与嗓音（中文 / English）。Sets the language and voice for real-time guidance."
    }
    static func avoidanceOffConfirmTitle(_ l: Language) -> String { l == .zh ? "关闭实时避障？" : "Turn off obstacle detection?" }
    static func avoidanceOffConfirmMessage(_ l: Language) -> String {
        l == .zh ? "关闭后将不再提示前方障碍。这是核心安全功能，确认要关闭吗？"
                 : "You'll no longer be warned about obstacles ahead. This is a core safety feature — turn it off?"
    }
    static func keepOn(_ l: Language) -> String { l == .zh ? "保持开启" : "Keep it on" }
    static func turnOff(_ l: Language) -> String { l == .zh ? "仍要关闭" : "Turn off" }

    static func avoidanceToggle(_ l: Language) -> String { l == .zh ? "实时避障" : "Real-time obstacle detection" }
    static func navigationToggle(_ l: Language) -> String { l == .zh ? "步行导航" : "Walking navigation" }
    static func featuresHeader(_ l: Language) -> String { l == .zh ? "功能" : "Features" }
    static func featuresFooter(_ l: Language) -> String {
        l == .zh ? "避障与导航可分别开关。导航功能仍在开发中。"
                 : "Obstacle detection and navigation can be toggled separately. Navigation is still in development."
    }
    static func devModeToggle(_ l: Language) -> String {
        l == .zh ? "开发者模式（显示温度/帧率）" : "Developer mode (thermal/FPS overlay)"
    }
    static func dynamicROIToggle(_ l: Language) -> String {
        l == .zh ? "动态 ROI 碰撞走廊（实验）" : "Dynamic ROI collision corridor (experimental)"
    }
    static func devHeader(_ l: Language) -> String { l == .zh ? "开发者" : "Developer" }
    static func devFooter(_ l: Language) -> String {
        l == .zh ? "开启开发者模式后首屏叠加显示温度、帧率、检测器、ROI 等。动态 ROI 用碰撞走廊随相机姿态投影检测区（实验，需真机调参；绿框即当前检测区）。"
                 : "Shows thermal, FPS, detector and ROI overlays on the home screen. Dynamic ROI projects the detection area from a collision corridor following camera pose (experimental, needs on-device tuning)."
    }
    static func helpHeader(_ l: Language) -> String { l == .zh ? "帮助" : "Help" }
    static func replayTutorial(_ l: Language) -> String { l == .zh ? "重看使用教程" : "Replay the tutorial" }
    // 常用地点（家/公司）
    static func savedPlacesTitle(_ l: Language) -> String { l == .zh ? "常用地点" : "Saved Places" }
    static func savedPlacesFooter(_ l: Language) -> String {
        // 透明告知：保存地点除了语音直达，还会在你**正共享位置**时、**到达该地点**时提醒能看到你位置的家人（若地址可定位）。
        l == .zh
            ? "填好地址后，说\u{201C}回家\u{201D}或\u{201C}去公司\u{201D}即可直接导航。你正在共享位置时，到达这些地点会提醒能看到你位置的家人（如\u{201C}已到家\u{201D}），让他们安心。"
            : "Once set, say \u{201C}take me home\u{201D} or \u{201C}go to work\u{201D} to navigate directly. While you're sharing your location, arriving at these places notifies the family who can see your location (e.g. \u{201C}arrived home\u{201D}), for their peace of mind."
    }
    // —— 自定义地点管理（与 web iter139-141 同语义）——
    static func customPlacesHeader(_ l: Language) -> String { l == .zh ? "自定义地点" : "Custom places" }
    static func placeLabelPlaceholder(_ l: Language) -> String { l == .zh ? "名称（如：医院、女儿家）" : "Name (e.g. Hospital)" }
    static func placeAddressPlaceholder(_ l: Language) -> String { l == .zh ? "地址或地点名" : "Address or place name" }
    static func addPlace(_ l: Language) -> String { l == .zh ? "添加地点" : "Add place" }
    static func updatePlace(_ l: Language) -> String { l == .zh ? "保存修改" : "Save changes" }
    static func confirmOverwrite(_ l: Language) -> String { l == .zh ? "确认覆盖" : "Confirm overwrite" }
    static func cancelEdit(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }
    static func editPlaceHint(_ l: Language) -> String { l == .zh ? "点击编辑" : "Tap to edit" }
    static func duplicateNameWarning(_ label: String, _ l: Language) -> String {
        l == .zh ? "已有名为「\(label)」的地点，保存将覆盖它的地址。再点一次确认覆盖。"
                 : "A place named “\(label)” already exists — saving will overwrite its address. Tap again to confirm."
    }
    static func homeHeader(_ l: Language) -> String { l == .zh ? "家" : "Home" }
    static func workHeader(_ l: Language) -> String { l == .zh ? "公司" : "Work" }
    static func homeAddressPlaceholder(_ l: Language) -> String { l == .zh ? "家的地址或地点名" : "Home address or place name" }
    static func workAddressPlaceholder(_ l: Language) -> String { l == .zh ? "公司的地址或地点名" : "Work address or place name" }
    static func saveHome(_ l: Language) -> String { l == .zh ? "保存家的地址" : "Save home" }
    static func saveWork(_ l: Language) -> String { l == .zh ? "保存公司地址" : "Save work" }
    static func clearPlace(_ l: Language) -> String { l == .zh ? "清除" : "Clear" }
    static func placeSaved(_ l: Language) -> String { l == .zh ? "已保存" : "Saved" }
    static func placeSaveFailed(_ l: Language) -> String { l == .zh ? "保存失败，请稍后再试" : "Couldn't save — please try again" }
    static func placeCleared(_ l: Language) -> String { l == .zh ? "已清除" : "Cleared" }

    static func aboutHeader(_ l: Language) -> String { l == .zh ? "关于" : "About" }
    static func orgLabel(_ l: Language) -> String { l == .zh ? "组织" : "Organization" }
    static func producerLabel(_ l: Language) -> String { l == .zh ? "软件制作人" : "Producer" }
    static func versionLabel(_ l: Language) -> String { l == .zh ? "版本" : "Version" }
    static func disclaimerHeader(_ l: Language) -> String { l == .zh ? "安全须知" : "Safety notice" }
    static func navTitle(_ l: Language) -> String { l == .zh ? "设置" : "Settings" }
    static func done(_ l: Language) -> String { l == .zh ? "完成" : "Done" }
}
