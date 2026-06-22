import Foundation

/// 两步验证（2FA）相关文案（双语 zh/en）。
enum TwoFactorStrings {
    static func title(_ l: Language) -> String { l == .zh ? "两步验证" : "Two-factor authentication" }
    static func rowLabel(_ l: Language) -> String { l == .zh ? "两步验证" : "Two-factor authentication" }
    static func statusOn(_ l: Language) -> String { l == .zh ? "已开启" : "On" }
    static func statusOff(_ l: Language) -> String { l == .zh ? "未开启" : "Off" }

    // 登录时的验证码挑战
    static func challengeTitle(_ l: Language) -> String { l == .zh ? "需要验证码" : "Verification needed" }
    static func challengePrompt(_ l: Language) -> String {
        l == .zh ? "打开你的身份验证器 App，输入 6 位验证码继续登录；也可输入一次性恢复码。"
                 : "Open your authenticator app and enter the 6-digit code to finish signing in. You can also use a one-time recovery code."
    }
    static func codeField(_ l: Language) -> String { l == .zh ? "验证码 / 恢复码" : "Code / recovery code" }
    static func verify(_ l: Language) -> String { l == .zh ? "验证" : "Verify" }
    static func invalidCode(_ l: Language) -> String { l == .zh ? "验证码不对，请重试" : "That code didn't work — please try again" }

    // 介绍 / 启用
    static func intro(_ l: Language) -> String {
        l == .zh ? "开启后，登录时除了密码，还需输入身份验证器 App 显示的验证码——即使密码泄露，账号也更安全。"
                 : "When on, signing in needs a code from your authenticator app in addition to your password — keeping your account safe even if your password leaks."
    }
    static func setupTitle(_ l: Language) -> String { l == .zh ? "开启两步验证" : "Turn on two-factor" }
    static func step1(_ l: Language) -> String {
        l == .zh ? "第一步：把下面的密钥添加到身份验证器 App（如 Google Authenticator、1Password、Microsoft Authenticator）。"
                 : "Step 1: Add the key below to an authenticator app (e.g. Google Authenticator, 1Password, Microsoft Authenticator)."
    }
    static func secretLabel(_ l: Language) -> String { l == .zh ? "密钥（手动输入到验证器）" : "Key (enter manually in your authenticator)" }
    static func addToApp(_ l: Language) -> String { l == .zh ? "添加到身份验证器 App" : "Add to authenticator app" }
    static func copyKey(_ l: Language) -> String { l == .zh ? "复制密钥" : "Copy key" }
    static func keyCopied(_ l: Language) -> String { l == .zh ? "密钥已复制" : "Key copied" }
    static func step2(_ l: Language) -> String {
        l == .zh ? "第二步：输入验证器现在显示的 6 位验证码以确认开启。"
                 : "Step 2: Enter the 6-digit code your authenticator shows now to confirm."
    }
    static func enable(_ l: Language) -> String { l == .zh ? "确认开启" : "Confirm & turn on" }
    static func enabledToast(_ l: Language) -> String { l == .zh ? "两步验证已开启" : "Two-factor is on" }

    // 恢复码
    static func recoveryTitle(_ l: Language) -> String { l == .zh ? "恢复码" : "Recovery codes" }
    static func recoveryIntro(_ l: Language) -> String {
        l == .zh ? "把这些一次性恢复码存到安全的地方。丢失验证器时，每个码可代替验证码登录一次。此页关闭后将不再显示。"
                 : "Save these one-time recovery codes somewhere safe. If you lose your authenticator, each code signs you in once. They won't be shown again after you close this."
    }
    static func copyAll(_ l: Language) -> String { l == .zh ? "全部复制" : "Copy all" }
    static func codesCopied(_ l: Language) -> String { l == .zh ? "恢复码已复制" : "Recovery codes copied" }
    static func remaining(_ n: Int, _ l: Language) -> String {
        l == .zh ? "剩余 \(n) 个恢复码" : "\(n) recovery codes left"
    }
    static func regenerate(_ l: Language) -> String { l == .zh ? "重新生成恢复码" : "Regenerate recovery codes" }
    static func regenerateNote(_ l: Language) -> String {
        l == .zh ? "重新生成会作废所有旧恢复码。" : "Regenerating invalidates all old recovery codes."
    }

    // 关闭
    static func disable(_ l: Language) -> String { l == .zh ? "关闭两步验证" : "Turn off two-factor" }
    static func disablePrompt(_ l: Language) -> String {
        l == .zh ? "为确认是你本人，请输入当前验证码或一个恢复码。" : "To confirm it's you, enter a current code or a recovery code."
    }
    static func disabledToast(_ l: Language) -> String { l == .zh ? "两步验证已关闭" : "Two-factor is off" }

    static func done(_ l: Language) -> String { l == .zh ? "完成" : "Done" }
    static func cancel(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }
}
