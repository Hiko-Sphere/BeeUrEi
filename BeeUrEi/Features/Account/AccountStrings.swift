import Foundation

/// 账号链路文案中心表——E5 多语言主线第八批（登录门/找回密码/账号页/邮箱验证）。
/// 登录失败、发码、改密等结果全部经 A11y 主动朗读，必须随语言。中文输出与历史完全一致。
enum AccountStrings {

    // MARK: 登录门（AuthGate）

    static func tagline(_ l: Language) -> String {
        l == .zh ? "为视障人士而生的避障与远程协助" : "Obstacle detection and remote assistance, built for blind users"
    }
    static func loginExplain(_ l: Language) -> String {
        l == .zh ? "登录后选择你的角色再进入。求助者也需登录以使用呼叫帮助（实时避障可离线使用）。"
                 : "Sign in, then choose your role. Calling for help requires an account (obstacle detection works offline)."
    }
    static func registerHeader(_ l: Language) -> String { l == .zh ? "注册" : "Register" }
    static func loginHeader(_ l: Language) -> String { l == .zh ? "登录" : "Sign in" }
    static func username(_ l: Language) -> String { l == .zh ? "用户名" : "Username" }
    static func password(_ l: Language) -> String { l == .zh ? "密码" : "Password" }
    static func rolePicker(_ l: Language) -> String { l == .zh ? "身份" : "Role" }
    static func roleBlind(_ l: Language) -> String { l == .zh ? "求助者（视障）" : "Blind / low vision" }
    static func roleHelper(_ l: Language) -> String { l == .zh ? "协助者 / 亲友" : "Helper / family" }
    static func registerAndLogin(_ l: Language) -> String { l == .zh ? "注册并登录" : "Register & sign in" }
    static func signIn(_ l: Language) -> String { l == .zh ? "登录" : "Sign in" }
    static func toLogin(_ l: Language) -> String { l == .zh ? "已有账号？去登录" : "Have an account? Sign in" }
    static func toRegister(_ l: Language) -> String { l == .zh ? "没有账号？去注册" : "No account? Register" }
    static func forgotPassword(_ l: Language) -> String { l == .zh ? "忘记密码？" : "Forgot password?" }
    static func devServerHeader(_ l: Language) -> String { l == .zh ? "服务器地址（开发者）" : "Server address (developer)" }

    // MARK: 启动恢复（有 token，拉 /api/me 恢复账号）

    static func restoreFailedTitle(_ l: Language) -> String { l == .zh ? "连接服务器失败" : "Couldn't reach the server" }
    static func restoreFailedBody(_ l: Language) -> String { l == .zh ? "请检查网络后重试。" : "Check your network and try again." }
    static func retry(_ l: Language) -> String { l == .zh ? "重试" : "Retry" }
    static func signingIn(_ l: Language) -> String { l == .zh ? "正在登录…" : "Signing in…" }
    static func loadingGeneric(_ l: Language) -> String { l == .zh ? "加载中…" : "Loading…" }
    static func loadFailedRetry(_ l: Language) -> String {
        l == .zh ? "加载失败，下拉重试" : "Couldn't load — pull down to retry"
    }

    // MARK: 黑名单

    static func blocklistExplain(_ l: Language) -> String {
        l == .zh ? "被你拉黑的人无法向你发起协助/求助请求，匹配也不会把你们配到一起。"
                 : "People you block can't send you assistance/help requests, and you won't be matched together."
    }
    static func blocklistEmptyTitle(_ l: Language) -> String { l == .zh ? "黑名单为空" : "No one blocked" }
    static func blocklistEmptyMessage(_ l: Language) -> String {
        l == .zh ? "拉黑的用户会出现在这里，可随时解除。" : "Blocked users appear here. You can unblock anytime."
    }
    static func blockedCount(_ n: Int, _ l: Language) -> String { l == .zh ? "已拉黑（\(n)）" : "Blocked (\(n))" }
    static func unblock(_ l: Language) -> String { l == .zh ? "解除" : "Unblock" }
    static func blockedRowA11y(_ name: String, _ l: Language) -> String {
        l == .zh ? "已拉黑 \(name)，双击解除" : "\(name) blocked. Double-tap to unblock."
    }
    static func blockUserA11y(_ l: Language) -> String { l == .zh ? "拉黑用户" : "Block a user" }
    static func addBlockTitle(_ l: Language) -> String { l == .zh ? "拉黑用户" : "Block a user" }
    static func blockUsernamePlaceholder(_ l: Language) -> String { l == .zh ? "对方用户名" : "Their username" }
    static func blockAction(_ l: Language) -> String { l == .zh ? "拉黑" : "Block" }
    static func addBlockMessage(_ l: Language) -> String {
        l == .zh ? "输入要拉黑的用户名。拉黑后将互不收到对方的请求/匹配。"
                 : "Enter the username to block. Neither of you will get the other's requests or matches."
    }
    static func blockedOk(_ name: String, _ l: Language) -> String { l == .zh ? "已拉黑 \(name)" : "Blocked \(name)" }
    static func blockFailed(_ l: Language) -> String {
        l == .zh ? "拉黑失败：找不到该用户名或网络错误" : "Couldn't block: user not found or network error"
    }
    static func unblockedOk(_ name: String, _ l: Language) -> String { l == .zh ? "已解除拉黑 \(name)" : "Unblocked \(name)" }
    static func unblockFailed(_ l: Language) -> String { l == .zh ? "解除失败，请重试" : "Couldn't unblock, please retry" }

    // MARK: 通话记录

    static func callHistoryEmptyTitle(_ l: Language) -> String { l == .zh ? "暂无通话记录" : "No calls yet" }
    static func callHistoryEmptyMessage(_ l: Language) -> String {
        l == .zh ? "呼出与呼入的通话都会记录在这里。" : "Outgoing and incoming calls are listed here."
    }
    static func callHistoryLoadFailed(_ l: Language) -> String {
        l == .zh ? "通话记录加载失败，下拉重试。" : "Couldn't load call history — pull down to retry."
    }
    /// 通话状态：呼出/呼入 × 已接通/已拒绝/未接。
    static func callStatus(direction: String, status: String, _ l: Language) -> String {
        let outgoing = direction == "outgoing"
        switch status {
        case "answered": return outgoing ? (l == .zh ? "已接通（呼出）" : "Connected (outgoing)")
                                          : (l == .zh ? "已接听（呼入）" : "Answered (incoming)")
        case "declined": return outgoing ? (l == .zh ? "对方已拒绝" : "They declined")
                                          : (l == .zh ? "已拒绝" : "Declined")
        default:         return outgoing ? (l == .zh ? "未接通（呼出）" : "No answer (outgoing)")
                                          : (l == .zh ? "未接来电" : "Missed call")
        }
    }

    // MARK: 找回密码

    static func forgotTitle(_ l: Language) -> String { l == .zh ? "找回密码" : "Reset Password" }
    static func forgotFooter(_ l: Language) -> String {
        l == .zh ? "我们会把验证码发到你账号绑定的邮箱。若未绑定邮箱，请联系管理员重置。"
                 : "We'll send a code to the email linked to your account. If none is linked, contact the admin."
    }
    static func resetHeader(_ l: Language) -> String { l == .zh ? "重置密码" : "Reset password" }
    static func codePlaceholder(_ l: Language) -> String { l == .zh ? "邮箱收到的验证码" : "Code from your email" }
    static func codeA11y(_ l: Language) -> String { l == .zh ? "验证码" : "Verification code" }
    static func newPasswordPlaceholder(_ l: Language) -> String { l == .zh ? "新密码（至少 6 位）" : "New password (6+ characters)" }
    static func sendCode(_ l: Language) -> String { l == .zh ? "发送验证码" : "Send code" }
    static func confirmReset(_ l: Language) -> String { l == .zh ? "确认重置密码" : "Confirm reset" }
    static func resendCode(_ l: Language) -> String { l == .zh ? "重新发送验证码" : "Resend code" }
    static func cancel(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }
    static func codeSent(_ l: Language) -> String {
        l == .zh ? "如果该账号绑定了邮箱，验证码已发送。请查收后填写下方验证码。"
                 : "If this account has a linked email, a code has been sent. Check your inbox and enter it below."
    }
    static func sendFailed(_ l: Language) -> String {
        l == .zh ? "发送失败，请检查网络后重试。" : "Couldn't send — check your network and retry."
    }
    static func resetDone(_ l: Language) -> String {
        l == .zh ? "密码已重置，请用新密码登录。" : "Password reset. Sign in with your new password."
    }
    static func codeInvalid(_ l: Language) -> String {
        l == .zh ? "验证码无效或已过期，请重试。" : "The code is invalid or expired — try again."
    }

    // MARK: 账号页（已登录）

    static func loggedIn(_ l: Language) -> String { l == .zh ? "已登录" : "Signed in" }
    static func uploadAvatar(_ l: Language) -> String { l == .zh ? "上传头像" : "Upload photo" }
    static func changeAvatar(_ l: Language) -> String { l == .zh ? "更换头像" : "Change photo" }
    static func editNickname(_ l: Language) -> String { l == .zh ? "改昵称" : "Edit nickname" }
    static func accountHeader(_ l: Language) -> String { l == .zh ? "账号" : "Account" }
    static func callHistory(_ l: Language) -> String { l == .zh ? "通话记录" : "Call history" }
    static func blocklist(_ l: Language) -> String { l == .zh ? "黑名单" : "Blocklist" }
    static func changePassword(_ l: Language) -> String { l == .zh ? "修改密码" : "Change password" }
    static func logout(_ l: Language) -> String { l == .zh ? "退出登录" : "Sign out" }
    static func deleteAccount(_ l: Language) -> String { l == .zh ? "删除账号" : "Delete account" }
    static func emailHeader(_ l: Language) -> String { l == .zh ? "邮箱（用于找回密码）" : "Email (for password recovery)" }
    static func verified(_ l: Language) -> String { l == .zh ? "已验证" : "Verified" }
    static func unverified(_ l: Language) -> String { l == .zh ? "未验证" : "Unverified" }
    static func changeEmail(_ l: Language) -> String { l == .zh ? "更换邮箱" : "Change email" }
    static func changeOrVerifyEmail(_ l: Language) -> String { l == .zh ? "更换 / 验证邮箱" : "Change / verify email" }
    static func noEmailYet(_ l: Language) -> String {
        l == .zh ? "尚未绑定邮箱。绑定后可在忘记密码时自助找回。"
                 : "No email linked yet. Link one to recover your password yourself."
    }
    static func bindEmail(_ l: Language) -> String { l == .zh ? "绑定邮箱" : "Link email" }
    static func nicknameTitle(_ l: Language) -> String { l == .zh ? "修改昵称" : "Edit nickname" }
    static func nicknamePlaceholder(_ l: Language) -> String { l == .zh ? "昵称" : "Nickname" }
    static func save(_ l: Language) -> String { l == .zh ? "保存" : "Save" }
    static func nicknameMessage(_ l: Language) -> String {
        l == .zh ? "昵称用于通话、来电界面和联系人显示，可重复。用户名是唯一登录标识，可在「登录与安全」中修改。"
                 : "Your nickname shows in calls and contacts and can repeat. Your username is your unique sign-in ID — change it under Sign-in & security."
    }
    static func currentPassword(_ l: Language) -> String { l == .zh ? "当前密码" : "Current password" }
    static func confirmChange(_ l: Language) -> String { l == .zh ? "确认修改" : "Confirm" }
    static func changePasswordTitle(_ l: Language) -> String { l == .zh ? "修改密码" : "Change Password" }
    static func logoutConfirmAction(_ l: Language) -> String { l == .zh ? "确认退出登录" : "Confirm sign out" }
    static func logoutConfirmMessage(_ l: Language) -> String {
        l == .zh ? "退出后需要重新登录才能使用通话与协助功能。"
                 : "After signing out you'll need to sign in again to use calls and assistance."
    }
    static func deleteConfirmTitle(_ l: Language) -> String { l == .zh ? "删除账号" : "Delete account" }
    static func deleteForever(_ l: Language) -> String { l == .zh ? "永久删除我的账号" : "Permanently delete my account" }
    static func deleteConfirmMessage(_ l: Language) -> String {
        l == .zh ? "将永久删除你的账号、亲友绑定与登录信息，且不可恢复。"
                 : "This permanently deletes your account, family links and sign-in data. It can't be undone."
    }
    static func navTitle(_ l: Language) -> String { l == .zh ? "账号" : "Account" }
    static func nicknameUpdated(_ name: String, _ l: Language) -> String {
        l == .zh ? "昵称已更新为 \(name)" : "Nickname updated to \(name)"
    }
    static func nicknameFailed(_ l: Language) -> String { l == .zh ? "昵称修改失败，请重试。" : "Couldn't update nickname, retry." }
    static func uploadingAvatar(_ l: Language) -> String { l == .zh ? "正在上传头像…" : "Uploading photo…" }
    static func readImageFailed(_ l: Language) -> String { l == .zh ? "读取图片失败" : "Couldn't read the image" }
    static func avatarUpdated(_ l: Language) -> String { l == .zh ? "头像已更新" : "Photo updated" }
    static func avatarUploadFailed(_ l: Language) -> String {
        l == .zh ? "上传失败：图片太大或网络错误" : "Upload failed: image too large or network error"
    }
    static func loginFirstShort(_ l: Language) -> String { l == .zh ? "请先登录" : "Sign in first" }
    static func passwordChanged(_ l: Language) -> String {
        l == .zh ? "密码已修改，请用新密码重新登录。" : "Password changed — sign in again with the new one."
    }
    static func passwordChangeFailed(_ l: Language) -> String {
        l == .zh ? "修改失败：当前密码不正确或网络错误。" : "Change failed: wrong current password or network error."
    }
    static func accountDeleted(_ l: Language) -> String { l == .zh ? "账号已删除。" : "Account deleted." }

    // MARK: 邮箱验证

    static func emailFieldHeader(_ l: Language) -> String { l == .zh ? "邮箱" : "Email" }
    static func emailFooter(_ l: Language) -> String {
        l == .zh ? "绑定后会发一封验证码邮件。验证后即可在忘记密码时自助找回。"
                 : "We'll send a verification code. Once verified, you can recover your password yourself."
    }
    static func enterCodeHeader(_ l: Language) -> String { l == .zh ? "输入验证码" : "Enter the code" }
    static func sixDigitCode(_ l: Language) -> String { l == .zh ? "邮箱收到的 6 位验证码" : "6-digit code from your email" }
    static func confirmVerify(_ l: Language) -> String { l == .zh ? "确认验证" : "Verify" }
    static func resend(_ l: Language) -> String { l == .zh ? "重新发送" : "Resend" }
    static func emailVerifyTitle(_ l: Language) -> String { l == .zh ? "邮箱验证" : "Email Verification" }
    static func close(_ l: Language) -> String { l == .zh ? "关闭" : "Close" }
    static func emailCodeSent(_ l: Language) -> String {
        l == .zh ? "验证码已发送，请查收邮箱后填写。" : "Code sent — check your inbox and enter it."
    }
    static func emailSendFailed(_ l: Language) -> String {
        l == .zh ? "发送失败，请检查邮箱格式或稍后再试。" : "Couldn't send — check the address or try later."
    }
    static func emailVerified(_ l: Language) -> String { l == .zh ? "邮箱已验证。" : "Email verified." }

    // MARK: 多登录方式（邮箱验证码 / Passkey / Apple）

    static func methodEmailCode(_ l: Language) -> String { l == .zh ? "用邮箱验证码登录" : "Sign in with email code" }
    static func methodPassword(_ l: Language) -> String { l == .zh ? "用密码登录" : "Sign in with password" }
    static func methodPasskey(_ l: Language) -> String { l == .zh ? "用 Passkey 登录" : "Sign in with a passkey" }
    static func orDivider(_ l: Language) -> String { l == .zh ? "或" : "or" }
    static func emailCodeHeader(_ l: Language) -> String { l == .zh ? "邮箱登录 / 注册" : "Email sign-in / sign-up" }
    static func emailCodeFooter(_ l: Language) -> String {
        l == .zh ? "输入邮箱，我们发一个验证码。新邮箱会自动创建账号，无需密码。"
                 : "Enter your email and we'll send a code. New emails create an account automatically — no password."
    }
    static func emailPlaceholder(_ l: Language) -> String { l == .zh ? "you@example.com" : "you@example.com" }
    static func sendLoginCode(_ l: Language) -> String { l == .zh ? "发送验证码" : "Send code" }
    static func emailCodeLoginSent(_ l: Language) -> String { l == .zh ? "验证码已发送，请查收邮箱。" : "Code sent — check your inbox." }
    static func continueAction(_ l: Language) -> String { l == .zh ? "继续" : "Continue" }
    static func passkeyHint(_ l: Language) -> String {
        l == .zh ? "用面容 / 指纹一键登录，免密码、更安全。" : "Sign in with Face ID / Touch ID — passwordless and more secure."
    }
    static func passkeyCancelled(_ l: Language) -> String { l == .zh ? "已取消 Passkey 操作" : "Passkey cancelled" }
    static func passkeyFailedMsg(_ l: Language) -> String {
        l == .zh ? "Passkey 未完成（需在设备上完成验证，且 App 已配置关联域）"
                 : "Passkey didn't finish (complete it on device; the app must be configured with an associated domain)"
    }

    // MARK: 账号补全（新登录方式后引导）

    static func setupTitle(_ l: Language) -> String { l == .zh ? "完善账号" : "Finish setup" }
    static func setupUseridHeader(_ l: Language) -> String { l == .zh ? "设置你的用户名" : "Choose your username" }
    static func setupUseridFooter(_ l: Language) -> String {
        l == .zh ? "用户名是你唯一的登录标识，亲友可凭它找到你。仅限字母、数字、下划线、点、连字符。"
                 : "Your username is your unique sign-in ID and how contacts find you. Letters, digits, _ . - only."
    }
    static func useridPlaceholder(_ l: Language) -> String { l == .zh ? "如 li_hua" : "e.g. li_hua" }
    static func useridTaken(_ l: Language) -> String { l == .zh ? "该用户名已被使用，换一个" : "That username is taken — try another" }
    static func useridInvalid(_ l: Language) -> String {
        l == .zh ? "用户名需 3–32 位，仅字母数字 . _ -" : "Username must be 3–32 chars: letters, digits, . _ -"
    }
    static func setupEmailHeader(_ l: Language) -> String { l == .zh ? "绑定并验证邮箱" : "Verify your email" }
    static func setupEmailFooter(_ l: Language) -> String {
        l == .zh ? "用于找回账号与重要通知。我们会发一个验证码到此邮箱。"
                 : "Used for account recovery and important notices. We'll email you a code."
    }
    static func setupSkip(_ l: Language) -> String { l == .zh ? "暂时跳过" : "Skip for now" }
    static func setupDone(_ l: Language) -> String { l == .zh ? "完成" : "Done" }
    static func setupStepUserid(_ l: Language) -> String { l == .zh ? "第 1 步，共 2 步：用户名" : "Step 1 of 2: username" }
    static func setupStepEmail(_ l: Language) -> String { l == .zh ? "绑定邮箱" : "Verify email" }

    // MARK: 新账号引导 — 选择身份（所有注册方式统一在认证后选）
    static func setupRoleHeader(_ l: Language) -> String { l == .zh ? "你是哪种用户？" : "How will you use BeeUrEi?" }
    static func setupRoleFooter(_ l: Language) -> String {
        l == .zh ? "选择后可随时在账号页更改。" : "You can change this anytime in Account."
    }
    static func roleBlindCardTitle(_ l: Language) -> String { l == .zh ? "我是视障用户" : "I'm blind or low vision" }
    static func roleBlindCardSub(_ l: Language) -> String {
        l == .zh ? "使用避障、导航、识别，并可呼叫亲友协助" : "Use obstacle alerts, navigation, recognition, and call for help"
    }
    static func roleHelperCardTitle(_ l: Language) -> String { l == .zh ? "我是亲友或协助者" : "I'm family or a helper" }
    static func roleHelperCardSub(_ l: Language) -> String {
        l == .zh ? "接听视障亲友的来电，远程看路协助" : "Answer calls from blind family and assist remotely"
    }
    static func roleSaveFailed(_ l: Language) -> String { l == .zh ? "身份保存失败，请重试" : "Couldn't save your choice — try again" }

    // MARK: 登录门（行业标准方法优先式）
    static func welcomeBack(_ l: Language) -> String { l == .zh ? "欢迎使用 BeeUrEi" : "Welcome to BeeUrEi" }
    static func continueWithEmail(_ l: Language) -> String { l == .zh ? "用邮箱继续（免密码）" : "Continue with email" }
    static func continueWithPassword(_ l: Language) -> String { l == .zh ? "用账号密码登录或注册" : "Use password instead" }
    static func methodFootnote(_ l: Language) -> String {
        l == .zh ? "新用户用任意方式登录即自动创建账号，下一步选择身份。"
                 : "New here? Any option creates your account — you'll pick your role next."
    }

    // MARK: 账号页 — 用户名 / 手机号 / Apple / Passkey 换绑

    static func usernameSectionHeader(_ l: Language) -> String { l == .zh ? "用户名（登录标识）" : "Username (sign-in ID)" }
    static func changeUsername(_ l: Language) -> String { l == .zh ? "修改用户名" : "Change username" }
    static func changeUsernameTitle(_ l: Language) -> String { l == .zh ? "修改用户名" : "Change username" }
    static func usernameUpdated(_ l: Language) -> String { l == .zh ? "用户名已更新" : "Username updated" }
    static func phoneSectionHeader(_ l: Language) -> String { l == .zh ? "手机号" : "Phone number" }
    static func bindPhone(_ l: Language) -> String { l == .zh ? "绑定手机号" : "Link phone" }
    static func changePhone(_ l: Language) -> String { l == .zh ? "更换手机号" : "Change phone" }
    static func phonePlaceholder(_ l: Language) -> String { l == .zh ? "手机号" : "Phone number" }
    static func phoneUpdated(_ l: Language) -> String { l == .zh ? "手机号已更新" : "Phone updated" }
    static func noPhoneYet(_ l: Language) -> String { l == .zh ? "尚未绑定手机号。" : "No phone linked yet." }
    static func appleSectionHeader(_ l: Language) -> String { l == .zh ? "Apple ID" : "Apple ID" }
    static func appleLinkedLabel(_ l: Language) -> String { l == .zh ? "已绑定" : "Linked" }
    static func linkAppleAction(_ l: Language) -> String { l == .zh ? "绑定 Apple ID" : "Link Apple ID" }
    static func unlinkAppleAction(_ l: Language) -> String { l == .zh ? "解绑 Apple ID" : "Unlink Apple ID" }
    static func appleLinkedDone(_ l: Language) -> String { l == .zh ? "已绑定 Apple ID" : "Apple ID linked" }
    static func appleUnlinkedDone(_ l: Language) -> String { l == .zh ? "已解绑 Apple ID" : "Apple ID unlinked" }
    static func passkeySectionHeader(_ l: Language) -> String { l == .zh ? "Passkey（无密码登录）" : "Passkeys (passwordless)" }
    static func addPasskey(_ l: Language) -> String { l == .zh ? "添加 Passkey" : "Add a passkey" }
    static func passkeyAdded(_ l: Language) -> String { l == .zh ? "Passkey 已添加" : "Passkey added" }
    static func removePasskey(_ l: Language) -> String { l == .zh ? "移除" : "Remove" }
    static func removePasskeyConfirmTitle(_ l: Language) -> String { l == .zh ? "移除这个 Passkey？" : "Remove this passkey?" }
    static func removePasskeyConfirmMessage(_ l: Language) -> String {
        l == .zh ? "移除后，这台设备将无法再用 Passkey 一键登录，需要时可重新添加。"
                 : "After removing, this device can no longer sign in with this passkey. You can add it again later."
    }
    static func passkeyRemoved(_ l: Language) -> String { l == .zh ? "Passkey 已移除" : "Passkey removed" }
    static func passkeyRemoveFailed(_ l: Language) -> String { l == .zh ? "移除失败，请重试" : "Couldn't remove, please retry" }
    static func noPasskeysYet(_ l: Language) -> String { l == .zh ? "尚未添加 Passkey。" : "No passkeys yet." }
    static func passkeyDeviceFallback(_ l: Language) -> String { l == .zh ? "此设备" : "This device" }
    static func accountSecurityHeader(_ l: Language) -> String { l == .zh ? "登录与安全" : "Sign-in & security" }

    /// 账号页操作的后端错误码 → 文案。
    static func accountErrorText(_ code: String, _ l: Language) -> String {
        switch code {
        case "username_taken": return l == .zh ? "用户名已被使用" : "Username already taken"
        case "invalid_username": return useridInvalid(l)
        case "apple_taken": return l == .zh ? "该 Apple ID 已绑定到其它账号" : "That Apple ID is linked to another account"
        case "last_login_method":
            return l == .zh ? "无法解绑：请先绑定邮箱/手机号或添加 Passkey，以免无法登录"
                            : "Can't unlink: add an email, phone, or passkey first so you don't get locked out"
        case "phone_taken": return l == .zh ? "手机号已被使用" : "Phone number already in use"
        case "invalid_phone": return l == .zh ? "手机号格式不正确" : "Invalid phone number"
        case "invalid_code": return codeInvalid(l)
        case "email_taken":
            return l == .zh ? "该邮箱已绑定到另一个账号。可改用其他邮箱；或退出登录后，用这个邮箱直接登录原来的账号。"
                            : "That email is linked to another account. Use a different email, or sign out and sign in with that email instead."
        case "invalid_input": return l == .zh ? "邮箱格式不正确，请检查后重试" : "Invalid email format — please check and retry"
        case "mail_unavailable":
            return l == .zh ? "邮件服务暂时不可用（服务器发信失败），请稍后再试或联系管理员"
                            : "Email service is temporarily unavailable (server couldn't send). Try again later."
        default: return code
        }
    }

    // MARK: 登录错误（AuthSession）

    static func wrongCredentials(_ l: Language) -> String { l == .zh ? "用户名或密码错误" : "Wrong username or password" }
    static func networkError(_ l: Language) -> String {
        l == .zh ? "网络错误，请检查服务器地址" : "Network error — check the server address"
    }
    /// 后端错误码 → 用户可读文案（未知码原样显示，便于排障）。
    static func serverErrorText(_ code: String, _ l: Language) -> String {
        switch code {
        case "username_taken": return l == .zh ? "用户名已被使用" : "Username already taken"
        case "email_taken": return l == .zh ? "邮箱已被使用" : "Email already in use"
        case "phone_taken": return l == .zh ? "手机号已被使用" : "Phone number already in use"
        case "invalid_phone": return l == .zh ? "手机号格式不正确" : "Invalid phone number"
        case "account_disabled": return l == .zh ? "账号已被停用" : "Account disabled"
        case "invalid_apple_token": return l == .zh ? "Apple 登录校验失败，请重试" : "Apple sign-in verification failed"
        case "apple_login_not_configured":
            return l == .zh ? "服务器尚未配置 Apple 登录" : "Apple sign-in isn't configured on the server"
        case "mail_unavailable":
            return l == .zh ? "邮件服务暂时不可用（服务器发信失败），请稍后再试" : "Email service is temporarily unavailable. Try again later."
        case "invalid_input": return l == .zh ? "输入有误，请检查后重试" : "Invalid input, please check and retry"
        default: return code
        }
    }

    // MARK: 手机号 / Apple 登录

    static func usernameOrPhone(_ l: Language) -> String { l == .zh ? "用户名或手机号" : "Username or phone" }
    static func loginIdentifier(_ l: Language) -> String { l == .zh ? "用户名 / 手机号 / 邮箱" : "Username, phone, or email" }
    static func phoneOptional(_ l: Language) -> String { l == .zh ? "手机号（选填，可用于登录）" : "Phone (optional, can log in with it)" }
    static func registerMethod(_ l: Language) -> String { l == .zh ? "注册方式" : "Sign-up method" }
    static func methodPhone(_ l: Language) -> String { l == .zh ? "手机号" : "Phone" }
    static func methodEmail(_ l: Language) -> String { l == .zh ? "邮箱" : "Email" }
    static func phoneField(_ l: Language) -> String { l == .zh ? "手机号" : "Phone number" }
    static func emailField(_ l: Language) -> String { l == .zh ? "邮箱" : "Email" }
    static func appleContinue(_ l: Language) -> String { l == .zh ? "通过 Apple 登录或注册" : "Continue with Apple" }
    static func appleFailed(_ l: Language) -> String {
        l == .zh ? "Apple 登录未完成（需在 Xcode 配置 Sign in with Apple 能力）"
                 : "Apple sign-in didn't finish (requires the Sign in with Apple capability)"
    }

    /// 角色显示名。
    static func roleName(_ role: String, _ l: Language) -> String {
        switch role {
        case "blind": return roleBlind(l)
        case "helper": return roleHelper(l)
        default: return role
        }
    }
}
