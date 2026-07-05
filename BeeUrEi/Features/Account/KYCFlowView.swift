import SwiftUI
import PhotosUI
import UIKit

/// 实名认证（KYC）流程：状态 → 同意 → 填表 → 拍证件正面 + 自拍 → 提交人工审核。
/// `spoken=true`（盲人侧）时每步与相机引导都经 SpeechHub 朗读。
/// 由账号与安全里以 NavigationLink 推入。
struct KYCFlowView: View {
    let token: String
    let spoken: Bool
    var onChanged: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    private var lang: Language { FeatureSettings().language }
    private let api = APIClient()

    @State private var status: VerificationStatusInfo?
    @State private var loading = true
    @State private var step: Step = .status
    @State private var legalName = ""
    @State private var idType = "national_id"
    @State private var last4 = ""
    @State private var frontJPEG: Data?
    @State private var selfieJPEG: Data?
    @State private var capture: KYCCamera.Target?
    @State private var busy = false
    @State private var err: String?

    private enum Step { case status, consent, form }
    private let idTypes = ["national_id", "passport", "drivers_license", "residence_permit"]

    var body: some View {
        Form {
            if let err { Section { Text(err).foregroundStyle(Color.beeDanger) } }
            switch step {
            case .status: statusSection
            case .consent: consentSection
            case .form: formSection
            }
        }
        .navigationTitle(KYCStrings.title(lang))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(item: $capture) { target in
            KYCCaptureScreen(target: target, spoken: spoken, lang: lang, onCaptured: { data in
                if target == .face { selfieJPEG = data } else { frontJPEG = data }
                capture = nil
            }, onCancel: { capture = nil })
        }
    }

    // MARK: 状态
    @ViewBuilder private var statusSection: some View {
        let st = status?.status ?? "none"
        Section {
            switch st {
            case "verified": Label(KYCStrings.verifiedNote(lang), systemImage: "checkmark.seal.fill").foregroundStyle(Color.beeHoney)
            case "pending": Text(KYCStrings.pendingNote(lang))
            case "rejected": Text(KYCStrings.rejectedNote(status?.rejectReasonCode, note: status?.rejectReasonNote, lang)).foregroundStyle(Color.beeDanger)
            default: Text(KYCStrings.noneNote(lang))
            }
        }
        if st == "none" || st == "rejected" {
            Section {
                Button(st == "rejected" ? KYCStrings.resubmit(lang) : KYCStrings.start(lang)) {
                    step = .consent
                    announce(KYCStrings.consentCollect(lang))
                }
            }
        }
    }

    // MARK: 同意
    @ViewBuilder private var consentSection: some View {
        Section(KYCStrings.consentTitle(lang)) {
            Text(KYCStrings.consentCollect(lang))
            Label(KYCStrings.consentHuman(lang), systemImage: "person.fill.checkmark")
            Label(KYCStrings.consentEncrypt(lang), systemImage: "lock.shield")
            Label(KYCStrings.consentRetention(lang), systemImage: "clock.arrow.circlepath")
        }
        Section {
            Button(KYCStrings.agree(lang)) { step = .form }
            Button(KYCStrings.back(lang), role: .cancel) { step = .status }
        }
    }

    // MARK: 表单
    @ViewBuilder private var formSection: some View {
        Section {
            TextField(KYCStrings.legalName(lang), text: $legalName)
                .textContentType(.name)
            Picker(KYCStrings.docType(lang), selection: $idType) {
                ForEach(idTypes, id: \.self) { Text(KYCStrings.docTypeName($0, lang)).tag($0) }
            }
            TextField(KYCStrings.last4(lang), text: $last4)
                .keyboardType(.asciiCapable)
                .onChange(of: last4) { _, v in last4 = String(v.filter(\.isLetterOrNumberASCII).prefix(4)) }
        }
        Section {
            captureRow(KYCStrings.captureFront(lang), done: frontJPEG != nil) { capture = .document }
            captureRow(KYCStrings.captureSelfie(lang), done: selfieJPEG != nil) { capture = .face }
        }
        Section {
            Button(busy ? KYCStrings.submitting(lang) : KYCStrings.submit(lang)) { Task { await submit() } }
                .disabled(busy)
            Button(KYCStrings.back(lang), role: .cancel) { step = .consent }
        }
    }

    private func captureRow(_ title: String, done: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: done ? "checkmark.circle.fill" : "camera.fill")
                    .foregroundStyle(done ? Color.beeHoney : Color.secondary)
                Text(title)
                Spacer()
                if done { Text(KYCStrings.captured(lang)).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .accessibilityLabel(done ? "\(title)，\(KYCStrings.captured(lang))" : title)
    }

    // MARK: 动作
    private func load() async {
        loading = true
        status = try? await api.verificationStatus(token: token)
        loading = false
        if let s = status?.status {
            switch s {
            case "verified": announce(KYCStrings.verifiedNote(lang))
            case "pending": announce(KYCStrings.pendingNote(lang))
            case "rejected": announce(KYCStrings.rejectedNote(status?.rejectReasonCode, note: status?.rejectReasonNote, lang))
            default: announce(KYCStrings.noneNote(lang))
            }
        }
    }

    private func submit() async {
        err = nil
        guard !legalName.trimmingCharacters(in: .whitespaces).isEmpty else { err = KYCStrings.errNameRequired(lang); announce(err!); return }
        guard last4.count == 4 else { err = KYCStrings.errLast4(lang); announce(err!); return }
        guard let front = frontJPEG, let selfie = selfieJPEG else { err = KYCStrings.errDocsRequired(lang); announce(err!); return }
        busy = true
        defer { busy = false }
        do {
            let id = try await api.submitVerification(token: token, legalName: legalName.trimmingCharacters(in: .whitespaces), idType: idType, idNumberLast4: last4, idNumber: nil, consentVersion: "kyc-1")
            try await api.uploadVerificationDoc(token: token, id: id, kind: "front", jpeg: front)
            try await api.uploadVerificationDoc(token: token, id: id, kind: "selfie", jpeg: selfie)
            announce(KYCStrings.submitted(lang))
            onChanged()
            dismiss()
        } catch let APIError.server(code) {
            err = code == "already_pending" ? KYCStrings.errAlreadyPending(lang)
                : code == "already_verified" ? KYCStrings.errAlreadyVerified(lang)
                : KYCStrings.errSubmit(lang)
            announce(err!)
        } catch {
            err = KYCStrings.errSubmit(lang)
            announce(err!)
        }
    }

    private func announce(_ text: String) {
        guard spoken else { return }
        SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode)
    }
}

extension KYCCamera.Target: Identifiable { public var id: Int { self == .face ? 1 : 0 } }

private extension Character {
    var isLetterOrNumberASCII: Bool { isASCII && (isLetter || isNumber) }
}

/// 整屏拍摄界面：实时引导（盲人侧朗读）+ 整屏快门（点屏任意处拍）+ 相册兜底。
struct KYCCaptureScreen: View {
    let target: KYCCamera.Target
    let spoken: Bool
    let lang: Language
    let onCaptured: (Data) -> Void
    let onCancel: () -> Void

    @StateObject private var cam: KYCCamera
    @State private var pickerItem: PhotosPickerItem?
    private let impact = UIImpactFeedbackGenerator(style: .medium)
    private let success = UINotificationFeedbackGenerator()

    init(target: KYCCamera.Target, spoken: Bool, lang: Language, onCaptured: @escaping (Data) -> Void, onCancel: @escaping () -> Void) {
        self.target = target
        self.spoken = spoken
        self.lang = lang
        self.onCaptured = onCaptured
        self.onCancel = onCancel
        _cam = StateObject(wrappedValue: KYCCamera(target: target, lang: lang))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            KYCCameraPreview(session: cam.session).ignoresSafeArea()

            // 取景框引导（视觉）
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(cam.phase == .locked ? Color.beeHoney : Color.white.opacity(0.7), lineWidth: 3)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(target == .face ? 60 : 28)
                .allowsHitTesting(false)

            VStack {
                HStack {
                    Button(KYCStrings.camCancel(lang)) { cam.stop(); onCancel() }
                        .padding(12).background(.ultraThinMaterial, in: Capsule())
                    Spacer()
                }
                .padding()
                Spacer()
                Text(cam.guidance)
                    .font(.headline).foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 8)
                HStack(spacing: 20) {
                    PhotosPicker(selection: $pickerItem, matching: .images) {
                        Text(KYCStrings.camFromLibrary(lang)).font(.subheadline)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(.ultraThinMaterial, in: Capsule()).foregroundStyle(.white)
                    }
                    Button { cam.captureNow() } label: {
                        Circle().fill(.white).frame(width: 72, height: 72)
                            .overlay(Circle().strokeBorder(.black.opacity(0.15), lineWidth: 2))
                    }
                    .accessibilityLabel(KYCStrings.camShutter(lang))
                }
                .padding(.bottom, 28)
            }
        }
        // 整屏可点快门（盲人点屏任意处拍）；不拦截上方按钮。
        .contentShape(Rectangle())
        .onTapGesture { cam.captureNow() }
        .onAppear {
            cam.onGuidance = { text, positive in
                if spoken { SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode, droppable: !positive) }
                if positive { impact.impactOccurred() }
            }
            cam.onCaptured = { data in
                success.notificationOccurred(.success)
                if spoken { SpeechHub.shared.speak(target == .face ? KYCStrings.capturedSelfie(lang) : KYCStrings.capturedFront(lang), channel: .query, voiceCode: lang.voiceCode) }
                cam.stop()
                onCaptured(data)
            }
            cam.start()
        }
        .onDisappear { cam.stop() }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let img = UIImage(data: data),
                   let jpeg = normalize(img) {
                    cam.stop()
                    onCaptured(jpeg)
                }
            }
        }
    }

    // 相册图片：缩放 + 重编码 JPEG（剥 EXIF）。
    private func normalize(_ img: UIImage) -> Data? {
        let maxEdge: CGFloat = 2048
        let longest = max(img.size.width, img.size.height)
        let scale = longest > maxEdge ? maxEdge / longest : 1
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            img.draw(in: CGRect(origin: .zero, size: size))
        }.jpegData(compressionQuality: 0.85)
    }
}
