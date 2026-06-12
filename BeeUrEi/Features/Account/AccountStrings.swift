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
        l == .zh ? "昵称用于通话、来电界面和联系人显示，可重复。用户名是唯一登录标识，不可修改。"
                 : "Your nickname shows in calls and contacts and can repeat. The username is your unique sign-in ID and can't change."
    }
    static func currentPassword(_ l: Language) -> String { l == .zh ? "当前密码" : "Current password" }
    static func confirmChange(_ l: Language) -> String { l == .zh ? "确认修改" : "Confirm" }
    static func changePasswordTitle(_ l: Language) -> String { l == .zh ? "修改密码" : "Change Password" }
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
        case "invalid_input": return l == .zh ? "输入有误，请检查后重试" : "Invalid input, please check and retry"
        default: return code
        }
    }

    // MARK: 手机号 / Apple 登录

    static func usernameOrPhone(_ l: Language) -> String { l == .zh ? "用户名或手机号" : "Username or phone" }
    static func phoneOptional(_ l: Language) -> String { l == .zh ? "手机号（选填，可用于登录）" : "Phone (optional, can log in with it)" }
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
