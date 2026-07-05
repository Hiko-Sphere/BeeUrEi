import Foundation

/// 实名认证（KYC）文案（双语 zh/en）。盲人侧实时引导经 SpeechHub 朗读，故这里也覆盖语音引导句。
enum KYCStrings {
    static func title(_ l: Language) -> String { l == .zh ? "实名认证" : "Identity verification" }
    static func rowLabel(_ l: Language) -> String { l == .zh ? "实名认证" : "Identity verification" }

    static func statusValue(_ status: String, _ l: Language) -> String {
        switch status {
        case "verified": return l == .zh ? "已认证" : "Verified"
        case "pending": return l == .zh ? "审核中" : "Pending"
        case "rejected": return l == .zh ? "未通过" : "Not approved"
        default: return l == .zh ? "未认证" : "Not verified"
        }
    }

    // 状态屏
    static func verifiedNote(_ l: Language) -> String { l == .zh ? "你已通过实名认证，账号已显示「已认证」徽章。" : "You are verified — the verified badge appears on your account." }
    static func pendingNote(_ l: Language) -> String { l == .zh ? "审核中，通常 1–2 个工作日。结果会通过通知告知你。" : "Under review, usually 1–2 business days. We'll notify you of the result." }
    static func noneNote(_ l: Language) -> String { l == .zh ? "通过实名认证可获得「已认证」徽章，让联系人更信任你。" : "Verify your identity to earn a trusted badge your contacts can see." }
    static func start(_ l: Language) -> String { l == .zh ? "开始认证" : "Start" }
    static func resubmit(_ l: Language) -> String { l == .zh ? "重新提交" : "Resubmit" }
    static func done(_ l: Language) -> String { l == .zh ? "完成" : "Done" }
    static func back(_ l: Language) -> String { l == .zh ? "返回" : "Back" }

    static func rejectedNote(_ code: String?, note: String? = nil, _ l: Language) -> String {
        let prefix = l == .zh ? "上次未通过：" : "Last attempt was not approved: "
        var s = prefix + rejectReason(code, l)
        // 管理员的**具体说明**（与 web 77aea1a 对齐）：盲人看不到自己的证件/自拍哪里不对，标准理由码之外的这段
        // 具体说明（如"身份证背面缺失，请补拍"）尤其关键——须一并读出/显示，否则只能盲目重交。空说明不加。
        if let note = note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            s += (l == .zh ? " 审核说明：" : " Reviewer note: ") + note
        }
        return s
    }
    static func rejectReason(_ code: String?, _ l: Language) -> String {
        let zh: [String: String] = [
            "blurry": "证件照片不够清晰，请在光线充足处重拍。",
            "glare": "证件照片有反光，请避开强光后重拍。",
            "name_mismatch": "填写姓名与证件不一致，请核对后重新提交。",
            "face_mismatch": "自拍与证件照片不匹配，请由本人重新拍摄。",
            "expired": "证件已过期，请使用有效证件。",
            "unsupported_doc": "证件类型不被支持，请更换证件。",
            "incomplete": "提交资料不完整，请补齐后重新提交。",
            "suspected_fraud": "审核未通过。如有疑问请联系支持。",
            "timeout": "提交超过审核时限已关闭，请重新提交。",
            "revoked": "实名认证已被撤销。如有疑问请联系支持。",
            "other": "审核未通过，请重新提交。",
        ]
        let en: [String: String] = [
            "blurry": "The document photo was too blurry. Retake it in good lighting.",
            "glare": "The document photo had glare. Retake it without reflections.",
            "name_mismatch": "The name didn't match the document. Check and resubmit.",
            "face_mismatch": "The selfie didn't match the document. Retake it yourself.",
            "expired": "The document has expired. Use a valid document.",
            "unsupported_doc": "The document type isn't supported. Use another document.",
            "incomplete": "The submission was incomplete. Complete it and resubmit.",
            "suspected_fraud": "Verification wasn't approved. Contact support if you have questions.",
            "timeout": "The submission timed out and was closed. Please resubmit.",
            "revoked": "Your verification was revoked. Contact support if you have questions.",
            "other": "Verification wasn't approved. Please resubmit.",
        ]
        let map = l == .zh ? zh : en
        return map[code ?? "other"] ?? map["other"]!
    }

    // 同意屏
    static func consentTitle(_ l: Language) -> String { l == .zh ? "认证须知" : "Before you start" }
    static func consentCollect(_ l: Language) -> String { l == .zh ? "我们会收集：你的法定姓名、一张政府证件、一张本人自拍。" : "We collect: your legal name, one government ID, and a selfie." }
    static func consentHuman(_ l: Language) -> String { l == .zh ? "由人工审核员核对是否为你本人——绝非自动通过。" : "A human reviewer confirms it's you — never auto-approved." }
    static func consentEncrypt(_ l: Language) -> String { l == .zh ? "证件以 AES-256 加密存储，仅审核员可见，每次访问都留痕。" : "Documents are AES-256 encrypted, visible only to reviewers, and every access is logged." }
    static func consentRetention(_ l: Language) -> String { l == .zh ? "审核完成后证件图片会按留存策略删除。" : "Document images are deleted per our retention policy after review." }
    static func agree(_ l: Language) -> String { l == .zh ? "我同意并继续" : "I agree & continue" }

    // 表单
    static func legalName(_ l: Language) -> String { l == .zh ? "证件上的法定姓名" : "Legal name on document" }
    static func docType(_ l: Language) -> String { l == .zh ? "证件类型" : "Document type" }
    static func last4(_ l: Language) -> String { l == .zh ? "证件号后 4 位" : "Last 4 of ID number" }
    static func docTypeName(_ v: String, _ l: Language) -> String {
        switch v {
        case "national_id": return l == .zh ? "身份证" : "National ID"
        case "passport": return l == .zh ? "护照" : "Passport"
        case "drivers_license": return l == .zh ? "驾照" : "Driver's license"
        case "residence_permit": return l == .zh ? "居住证" : "Residence permit"
        default: return v
        }
    }
    static func captureFront(_ l: Language) -> String { l == .zh ? "拍摄证件正面" : "Capture document front" }
    static func captureSelfie(_ l: Language) -> String { l == .zh ? "拍摄本人自拍" : "Capture selfie" }
    static func captured(_ l: Language) -> String { l == .zh ? "已拍摄" : "Captured" }
    static func retake(_ l: Language) -> String { l == .zh ? "重拍" : "Retake" }
    static func submit(_ l: Language) -> String { l == .zh ? "提交审核" : "Submit for review" }
    static func submitting(_ l: Language) -> String { l == .zh ? "提交中…" : "Submitting…" }
    static func submitted(_ l: Language) -> String { l == .zh ? "已提交，等待人工审核" : "Submitted — pending review" }

    static func errNameRequired(_ l: Language) -> String { l == .zh ? "请填写证件上的法定姓名" : "Enter your legal name as on the document" }
    static func errLast4(_ l: Language) -> String { l == .zh ? "请填写证件号后 4 位" : "Enter the last 4 of the ID number" }
    static func errDocsRequired(_ l: Language) -> String { l == .zh ? "请拍摄证件正面与本人自拍" : "Capture the document front and a selfie" }
    static func errAlreadyPending(_ l: Language) -> String { l == .zh ? "已有一份待审核的申请" : "You already have a pending submission" }
    static func errAlreadyVerified(_ l: Language) -> String { l == .zh ? "你已通过实名认证" : "You are already verified" }
    static func errSubmit(_ l: Language) -> String { l == .zh ? "提交失败，请重试" : "Submission failed — please try again" }

    // 相机引导（盲人侧 SpeechHub 朗读）
    static func camPermissionDenied(_ l: Language) -> String { l == .zh ? "需要相机权限才能拍摄证件，请在系统设置中开启。" : "Camera access is needed to capture the document. Enable it in Settings." }
    static func camStartDoc(_ l: Language) -> String { l == .zh ? "请将证件正面对准摄像头，铺平在画面中。" : "Hold the document front flat and centered in the frame." }
    static func camStartSelfie(_ l: Language) -> String { l == .zh ? "请把脸对准摄像头，保持在画面中央。" : "Face the camera and keep your face centered." }
    static func camMoveCloser(_ l: Language) -> String { l == .zh ? "再靠近一点" : "Move closer" }
    static func camMoveBack(_ l: Language) -> String { l == .zh ? "稍微远一点" : "Move back a little" }
    static func camMoveLeft(_ l: Language) -> String { l == .zh ? "向左移一点" : "Move left a little" }
    static func camMoveRight(_ l: Language) -> String { l == .zh ? "向右移一点" : "Move right a little" }
    static func camMoveUp(_ l: Language) -> String { l == .zh ? "向上移一点" : "Move up a little" }
    static func camMoveDown(_ l: Language) -> String { l == .zh ? "向下移一点" : "Move down a little" }
    static func camSearching(_ l: Language) -> String { l == .zh ? "正在寻找证件，请放进画面" : "Looking for the document — bring it into view" }
    static func camSearchingFace(_ l: Language) -> String { l == .zh ? "正在寻找面部，请正对摄像头" : "Looking for your face — face the camera" }
    static func camHold(_ l: Language) -> String { l == .zh ? "对准了，保持不动" : "Good — hold still" }
    static func camShutter(_ l: Language) -> String { l == .zh ? "拍摄" : "Capture" }
    static func capturedFront(_ l: Language) -> String { l == .zh ? "已拍到证件正面" : "Captured the document front" }
    static func capturedSelfie(_ l: Language) -> String { l == .zh ? "已拍到自拍" : "Captured the selfie" }
    static func camCancel(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }
    static func camFromLibrary(_ l: Language) -> String { l == .zh ? "从相册选择" : "Choose from library" }
}
