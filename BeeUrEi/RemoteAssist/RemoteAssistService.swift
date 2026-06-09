import Foundation
import CallKit
import PushKit
import Observation

/// CallKit 接听后，把"要进入哪通通话"桥接给 SwiftUI 呈现层。
/// RemoteAssistService 不是视图，无法直接 present；它写这里，RootView 观察并弹出 CallView。
@MainActor
@Observable
final class IncomingCallCenter {
    static let shared = IncomingCallCenter()
    /// 被 CallKit 接听、待 RootView 呈现的通话（复用 AnsweringCall）。
    var pending: AnsweringCall?
    private init() {}
    func present(callId: String, callerName: String) {
        pending = AnsweringCall(callId: callId, title: callerName, isIncoming: true)
    }
    func clear() { pending = nil }
}

/// 远程协助：CallKit 系统来电 + PushKit VoIP 推送（A1 后台/息屏来电）。
/// 流程：后端发 VoIP push → didReceiveIncomingPush → reportIncoming 拉起 CallKit →
/// 用户接听 → 桥接到 RootView 呈现 CallView(role:.helper) 加入 callId 房间。
/// 需 Apple 开发者账号 + APNs Key + Push/VoIP 能力，详见 docs/SETUP_AND_HANDOFF.md §A1。
final class RemoteAssistService: NSObject {
    static let shared = RemoteAssistService()

    private var callMachine = RemoteAssistCall()
    private let provider: CXProvider
    private let callController = CXCallController()
    private let pushRegistry = PKPushRegistry(queue: .main)
    private var voipToken: String?
    /// CallKit UUID → 该来电的会合信息（接听/挂断时回查）。仅在主线程访问（CallKit/PushKit 回调均走主队列，
    /// 其余调用方为 SwiftUI MainActor，见复审 #6）。
    private var active: [UUID: (callId: String, name: String)] = [:]

    override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
        pushRegistry.delegate = self
        pushRegistry.desiredPushTypes = [.voIP]
    }

    /// App 启动调用一次，确保单例存活（PushKit 注册随之生效）。
    func start() {}

    /// 登录后调用：把已拿到的 VoIP token 绑定到当前账号。
    func refreshRegistration() {
        Task { @MainActor in await registerToken() }
    }

    /// voipToken 仅在主线程读写（见复审 #6）。
    @MainActor
    private func registerToken() async {
        guard let voip = voipToken, let auth = KeychainStore.read() else { return }
        await APIClient().registerVoipToken(token: auth, voipToken: voip)
    }

    /// 收到 VoIP push 后必须立刻 reportNewIncomingCall，否则系统会终止 App。
    func reportIncoming(uuid: UUID, callId: String, callerName: String) {
        callMachine.incoming(callerID: callId)
        active[uuid] = (callId, callerName)
        let update = CXCallUpdate()
        update.localizedCallerName = callerName
        update.hasVideo = true
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            guard let self else { return }
            if error != nil { self.callMachine.reset(); self.active[uuid] = nil; return } // 上报失败回滚
            // 未登录设备不应把来电做成"可接但接通即失败"——仍满足"必须先 report"的系统要求后立即结束（见复审 #3）。
            if KeychainStore.read() == nil {
                self.active[uuid] = nil
                self.provider.reportCall(with: uuid, endedAt: nil, reason: .failed)
            }
        }
    }

    /// CallView 内用户挂断时调用：经 CXCallController 规范结束对应 CallKit 通话（正确的通话记录语义，见复审 #9）。
    func endCall() {
        for uuid in Array(active.keys) {
            callController.request(CXTransaction(action: CXEndCallAction(call: uuid))) { _ in }
        }
    }
}

// MARK: - CallKit

extension RemoteAssistService: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        active.removeAll()
        callMachine.reset()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        callMachine.answer()
        if let info = active[action.callUUID] {
            // 桥接到 SwiftUI：RootView 会据此弹出 CallView 加入该 callId 房间。
            Task { @MainActor in IncomingCallCenter.shared.present(callId: info.callId, callerName: info.name) }
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        // 系统通话界面挂断：清空呈现层（关掉 CallView）+ 复位状态机。
        active[action.callUUID] = nil
        Task { @MainActor in IncomingCallCenter.shared.clear() }
        callMachine.hangUp()
        action.fulfill()
    }
}

// MARK: - PushKit (VoIP)

extension RemoteAssistService: PKPushRegistryDelegate {
    func pushRegistry(_ registry: PKPushRegistry,
                      didUpdate pushCredentials: PKPushCredentials,
                      for type: PKPushType) {
        // token 是二进制，转十六进制字符串（与后端 /3/device/<token> 期望一致）。
        voipToken = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in await registerToken() } // 已登录则立即绑定到账号
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        voipToken = nil
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType,
                      completion: @escaping () -> Void) {
        let dict = payload.dictionaryPayload
        let caller = dict["caller"] as? String ?? "BeeUrEi 求助"
        let callId = dict["callId"] as? String ?? (dict["callerID"] as? String ?? "unknown")
        reportIncoming(uuid: UUID(), callId: callId, callerName: caller)
        completion()
    }
}
