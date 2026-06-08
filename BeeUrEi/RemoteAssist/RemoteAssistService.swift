import Foundation
import CallKit
import PushKit

/// 远程协助协议。`Helper` / `RemoteAssistCall` 来自已单测的核心。
protocol RemoteAssisting: AnyObject {
    func contacts() -> [Helper]
    func call(_ helper: Helper)
}

/// MVP：亲友名单定向呼叫 + CallKit/PushKit 来电骨架（真机 + 账号验证，见 PLAN §13.3）。
/// 实际媒体由 RTC SDK 适配负责（Phase 3）；这里把状态机与系统来电接好。
final class RemoteAssistService: NSObject, RemoteAssisting {
    private var callMachine = RemoteAssistCall()
    private let provider: CXProvider
    private let pushRegistry = PKPushRegistry(queue: .main)

    override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallsPerCallGroup = 1
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
        pushRegistry.delegate = self
        pushRegistry.desiredPushTypes = [.voIP]
    }

    func contacts() -> [Helper] {
        // TODO(§13.3): 亲友名单存本地/账户；用 RemoteAssistCall.callable 按在线+语言筛选。
        []
    }

    func call(_ helper: Helper) {
        guard callMachine.call(helper) else { return }
        // TODO(Phase 3): 经匹配后端 + RTC SDK 建立单向视频 + 双向语音。
    }

    /// iOS 强制：收到 VoIP push 后必须立刻 reportNewIncomingCall，否则系统会终止 App。
    func reportIncoming(uuid: UUID, callerID: String, callerName: String) {
        // 把来电接入状态机进入振铃，否则接听时 answer() 在 idle 态是 no-op、永不进入 connected（见审查 #8）。
        callMachine.incoming(callerID: callerID)
        let update = CXCallUpdate()
        update.localizedCallerName = callerName
        update.hasVideo = true
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error != nil { self?.callMachine.reset() } // 上报失败：回滚状态机，避免悬挂的振铃态
        }
    }
}

// MARK: - CallKit

extension RemoteAssistService: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        callMachine.reset()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        callMachine.answer()
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        callMachine.hangUp()
        action.fulfill()
    }
}

// MARK: - PushKit (VoIP)

extension RemoteAssistService: PKPushRegistryDelegate {
    func pushRegistry(_ registry: PKPushRegistry,
                      didUpdate pushCredentials: PKPushCredentials,
                      for type: PKPushType) {
        // TODO(§13.3): 把 VoIP token 上报匹配后端。
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType,
                      completion: @escaping () -> Void) {
        let dict = payload.dictionaryPayload
        let caller = dict["caller"] as? String ?? "BeeUrEi 求助"
        let callerID = dict["callerID"] as? String ?? "unknown"
        reportIncoming(uuid: UUID(), callerID: callerID, callerName: caller)
        completion()
    }
}
