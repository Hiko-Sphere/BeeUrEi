import Foundation

/// 法律文件（中英）：隐私政策 / 使用条款 / 最终用户许可协议（EULA）。
/// ⚠️ 这是依据本 App 真实行为撰写的认真文本，但**不构成法律意见**；正式上架前请由法务/母语者审校。
/// 与之配套的安全免责声明见 `DisclaimerText`（"辅助工具，非安全设备"）。
enum LegalText {
    /// 文件版本/生效日期（更新内容时同步修改；客户端与网页一致）。
    static let version = "1.0"
    static let effectiveDate = "2026-06-13"

    static func privacyPolicy(_ l: Language) -> String { l == .zh ? privacyZh : privacyEn }
    static func termsOfService(_ l: Language) -> String { l == .zh ? termsZh : termsEn }
    static func eula(_ l: Language) -> String { l == .zh ? eulaZh : eulaEn }

    // MARK: - 隐私政策

    private static let privacyZh = """
    BeeUrEi 隐私政策
    生效日期：2026-06-13　·　版本 1.0
    提供者：Hiko Sphere 彦穹科技（软件制作人 Li Yanpei Hiko）

    我们把隐私当作安全的一部分来设计。核心原则：摄像头画面默认不离开你的手机；只有你主动发起远程协助时才把画面传给你选定的对方。

    1. 端侧处理（画面不上云）
    避障、识别物体、读文字、识别纸币、扫码、辨颜色、找物、"周围的人"、光线探测等所有视觉 AI 推理都在你的 iPhone 本地完成。相机画面与深度数据仅用于本地实时分析，不上传、不留存、不用于训练。

    2. 我们处理的数据
    • 账号信息：用户名、昵称、头像；以及你选择绑定的邮箱、手机号、Apple ID。用于登录、找回账号与联系人查找。
    • 关系与通讯：你建立的亲友/协助者绑定关系、聊天消息、通话路由信息（谁在什么时间呼叫谁）。消息为送达双方而存储。
    • 推送令牌：用于来电与重要通知的 APNs / VoIP 令牌。
    • 设备语言：用于选择播报与推送的语言。
    • 粗粒度位置（可选）：发起求助时可附带"省/市/区"级别地点帮助协助者了解你大概在哪；导航与"我在哪"在本地使用精确定位但不上传精确坐标。
    • 诊断（可选）：崩溃与错误报告用于修复问题。

    3. 我们不收集
    我们不出售你的任何数据。我们不收集你的精确位置历史、不做广告画像、不对"周围的人"识别身份或存储人脸。

    4. 第三方
    • Sign in with Apple（可选登录方式，受 Apple 隐私政策约束）。
    • 导航：海外用 Apple 地图；中国大陆用持牌图商（经我们后端转发，仅发送必要坐标）。
    • 天气：Open-Meteo（仅发送降精度坐标，不含身份信息）。
    • 推送：Apple APNs。
    后端、信令与 TURN 中继均由我们自托管，数据存放在我们自己的服务器上。

    5. 录制
    通话默认不录制。仅在你与对方均明确同意时方可录制；录制内容加密保存、到期自动删除，仅用于留证/回看。

    6. 你的权利
    你可以随时在 App 内查看与修改账号信息，解除绑定关系，或永久删除账号（删除会移除你的账号、绑定关系与登录信息，不可恢复）。

    7. 儿童
    本 App 不面向 13 周岁以下儿童，且不会故意收集其个人信息。

    8. 安全
    传输使用 TLS；密码经加盐哈希存储；本机敏感数据（识别历史、商品库、教学物品等）启用文件保护。

    9. 变更
    隐私政策更新时我们会更新本页版本与生效日期，重大变更会在 App 内提示。

    10. 联系
    隐私相关问题请联系 Hiko Sphere 彦穹科技。
    """

    private static let privacyEn = """
    BeeUrEi Privacy Policy
    Effective: 2026-06-13　·　Version 1.0
    Provider: Hiko Sphere (Producer: Li Yanpei Hiko)

    We treat privacy as part of safety. Core principle: your camera frames do not leave your phone by default; video is shared only when you actively start remote assistance with someone you choose.

    1. On-device processing (frames stay on device)
    All vision AI — obstacle avoidance, object/text/banknote/barcode/color recognition, find-my-things, "people nearby", light detection — runs locally on your iPhone. Camera and depth data are used only for local real-time analysis; they are not uploaded, stored, or used for training.

    2. Data we process
    • Account: username, display name, avatar; plus any email, phone, or Apple ID you choose to link. Used for sign-in, account recovery, and contact lookup.
    • Relationships & communication: the family/helper links you create, chat messages, and call-routing metadata (who called whom and when). Messages are stored to deliver them to both parties.
    • Push tokens: APNs / VoIP tokens for incoming calls and important notifications.
    • Device language: to choose the language of speech and notifications.
    • Coarse location (optional): when you request help, an approximate province/city/district may be attached so a helper knows roughly where you are. Navigation and "Where am I" use precise location locally but do not upload precise coordinates.
    • Diagnostics (optional): crash and error reports to fix problems.

    3. What we do not collect
    We do not sell any of your data. We do not collect your precise location history, build advertising profiles, or identify people or store faces in "people nearby".

    4. Third parties
    • Sign in with Apple (optional sign-in, governed by Apple's privacy policy).
    • Navigation: Apple Maps overseas; a licensed map provider in mainland China (proxied via our backend, sending only the necessary coordinates).
    • Weather: Open-Meteo (only reduced-precision coordinates, no identity).
    • Push: Apple APNs.
    Backend, signaling, and TURN relay are self-hosted; data resides on our own servers.

    5. Recording
    Calls are not recorded by default. Recording requires explicit consent from both parties; recordings are encrypted, auto-deleted on expiry, and used only for evidence/review.

    6. Your rights
    You can view and edit your account, remove links, or permanently delete your account at any time in the app (deletion removes your account, links, and sign-in data and cannot be undone).

    7. Children
    The app is not directed to children under 13 and does not knowingly collect their personal information.

    8. Security
    Transport uses TLS; passwords are salted-hashed; on-device sensitive data (recognition history, product memory, taught items) uses file protection.

    9. Changes
    We update the version and effective date here when the policy changes, and prompt in-app for material changes.

    10. Contact
    For privacy questions, contact Hiko Sphere.
    """

    // MARK: - 使用条款

    private static let termsZh = """
    BeeUrEi 使用条款
    生效日期：2026-06-13　·　版本 1.0

    欢迎使用 BeeUrEi（"本 App"），由 Hiko Sphere 彦穹科技提供。使用即表示你同意本条款与《隐私政策》。

    1. 服务说明
    本 App 为视障人士提供实时避障、步行导航、场景识别与远程真人协助。

    2. 安全须知（最重要）
    本 App 是"感知增强的辅助工具"，不是"安全保障设备"。它不能替代白手杖、导盲犬或定向行走（O&M）训练，也不保证检测出所有障碍（尤其是低矮路桩、台阶边缘、坑洞、玻璃门、悬空物、移动车辆）。摄像头/LiDAR 受光线、发热、设备性能影响，可能漏报或误报。请始终保留并优先使用白手杖/导盲犬，切勿将本 App 作为出行的唯一依据。你自行承担使用风险。

    3. 账号
    你需对账号下的活动负责，并对登录凭证保密。禁止冒用他人身份、共享账号用于滥用。

    4. 行为规范
    使用远程协助、聊天与求助队列时，禁止骚扰、欺诈、传播违法或侵权内容。我们可对违规账号封禁，并提供举报与拉黑机制。

    5. 远程协助与志愿者
    协助者/志愿者为独立个人，其建议仅供参考；对其行为我们不作担保。请勿在通话中泄露敏感信息（如密码、验证码）。

    6. 用户内容
    你对自己发送的消息/图片/位置负责。为提供服务我们会按《隐私政策》存储与传输这些内容。

    7. 知识产权与许可
    本软件依 PolyForm Noncommercial 1.0.0 许可（可非商业使用/学习/修改/分发，禁止商用）。BeeUrEi 名称与品牌资产归 Hiko Sphere 彦穹科技所有。

    8. 免责与责任限制
    在法律允许的最大范围内，本 App 按"现状"提供，不附带任何明示或暗示担保；对因使用或无法使用本 App 造成的任何损害，我们不承担责任。

    9. 终止
    你可随时停止使用并删除账号。违反条款的账号可被暂停或终止。

    10. 变更与适用法律
    我们可更新条款并在 App 内提示。条款的解释与争议解决适用提供者所在地法律。

    11. 联系
    Hiko Sphere 彦穹科技。
    """

    private static let termsEn = """
    BeeUrEi Terms of Service
    Effective: 2026-06-13　·　Version 1.0

    Welcome to BeeUrEi ("the App"), provided by Hiko Sphere. By using it you agree to these Terms and the Privacy Policy.

    1. The service
    The App provides real-time obstacle avoidance, walking navigation, scene recognition, and live human assistance for blind and low-vision users.

    2. Safety notice (most important)
    The App is a perception-enhancing assistive tool, not a safety device. It does not replace a white cane, a guide dog, or Orientation & Mobility (O&M) training, and it cannot detect every obstacle (especially low bollards, step edges, potholes, glass doors, overhanging objects, moving vehicles). Camera/LiDAR are affected by lighting, heat, and device performance and may miss or misreport. Always keep and prioritize your white cane/guide dog, and never rely on the App as your only means of getting around. You use it at your own risk.

    3. Accounts
    You are responsible for activity under your account and for keeping your credentials confidential. Impersonation or account sharing for abuse is prohibited.

    4. Acceptable use
    When using remote assistance, chat, and the help queue, harassment, fraud, and unlawful or infringing content are prohibited. We may ban violators and provide reporting and blocking tools.

    5. Remote assistance & volunteers
    Helpers/volunteers are independent individuals; their guidance is advisory and we make no warranty about their conduct. Do not disclose sensitive information (passwords, verification codes) during calls.

    6. User content
    You are responsible for messages/images/locations you send. We store and transmit them to provide the service per the Privacy Policy.

    7. Intellectual property & license
    The software is licensed under PolyForm Noncommercial 1.0.0 (noncommercial use/study/modify/distribute; no commercial use). The BeeUrEi name and brand assets belong to Hiko Sphere.

    8. Disclaimer & limitation of liability
    To the maximum extent permitted by law, the App is provided "as is" without warranties of any kind, and we are not liable for any damages arising from use of or inability to use the App.

    9. Termination
    You may stop using the App and delete your account at any time. Accounts violating these Terms may be suspended or terminated.

    10. Changes & governing law
    We may update these Terms and will prompt in-app. Interpretation and disputes are governed by the laws of the provider's jurisdiction.

    11. Contact
    Hiko Sphere.
    """

    // MARK: - 最终用户许可协议（EULA）

    private static let eulaZh = """
    BeeUrEi 最终用户许可协议（EULA）
    生效日期：2026-06-13　·　版本 1.0

    本协议是你与 Hiko Sphere 彦穹科技之间就 BeeUrEi 软件达成的许可协议。

    1. 许可授予
    依 PolyForm Noncommercial 1.0.0，授予你在你拥有或控制的 Apple 设备上，出于非商业目的安装与使用本 App 的非独占、不可转让许可。

    2. 范围
    你可使用、学习、修改与分发本软件用于非商业用途；不得用于商业目的（出售，或向其服务的视障用户收费）。

    3. 限制
    不得移除版权与署名声明；不得将本软件用于违法用途。

    4. 第三方条款
    通过 Apple App Store 获取时，本协议同时受 Apple《最终用户许可协议（标准 EULA）》约束；如有冲突，以保护用户的更严格条款为准。

    5. 无担保 / 责任限制
    见《使用条款》第 8 条。本 App 是辅助工具，不是安全设备。

    6. 联系
    Hiko Sphere 彦穹科技。
    """

    private static let eulaEn = """
    BeeUrEi End-User License Agreement (EULA)
    Effective: 2026-06-13　·　Version 1.0

    This is a license agreement between you and Hiko Sphere for the BeeUrEi software.

    1. License grant
    Under PolyForm Noncommercial 1.0.0, you are granted a non-exclusive, non-transferable license to install and use the App for noncommercial purposes on Apple devices you own or control.

    2. Scope
    You may use, study, modify, and distribute the software for noncommercial purposes; you may not use it for commercial purposes (selling it, or charging the blind users it serves).

    3. Restrictions
    Do not remove copyright/attribution notices; do not use the software for unlawful purposes.

    4. Third-party terms
    When obtained via the Apple App Store, this agreement is also subject to Apple's Licensed Application End User License Agreement (standard EULA); in case of conflict, the stricter user-protective terms prevail.

    5. No warranty / limitation of liability
    See Terms of Service section 8. The App is an assistive tool, not a safety device.

    6. Contact
    Hiko Sphere.
    """
}
