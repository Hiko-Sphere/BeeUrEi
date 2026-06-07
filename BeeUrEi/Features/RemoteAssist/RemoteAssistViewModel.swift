import Foundation
import Observation

/// 远程协助 UI 的视图模型。呼叫状态用核心已测的 `RemoteAssistCall`（状态机）驱动；
/// 亲友名单本地持久化。真正的音视频接通由 RTC SDK 负责（Phase 3 / §13.3）。
@Observable
final class RemoteAssistViewModel {

    private(set) var contacts: [StoredContact] = []
    private(set) var callState: CallState = .idle
    private(set) var activeName: String = ""

    @ObservationIgnored private let store = ContactStore()
    @ObservationIgnored private var callMachine = RemoteAssistCall()
    @ObservationIgnored private let preferredLanguage = "zh"

    func load() {
        contacts = store.load()
    }

    func addContact(name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        store.add(StoredContact(id: UUID().uuidString, name: trimmed, language: preferredLanguage))
        load()
    }

    func removeContact(_ contact: StoredContact) {
        store.remove(id: contact.id)
        load()
    }

    /// 把存储的亲友映射成核心 `Helper`（在线状态暂以 true 占位，待接入在线后端）。
    private func helper(for contact: StoredContact) -> Helper {
        Helper(id: contact.id, name: contact.name, language: contact.language, isOnline: true)
    }

    func call(_ contact: StoredContact) {
        if callMachine.call(helper(for: contact)) {
            activeName = contact.name
        }
        callState = callMachine.state
        // TODO(Phase 3 / §13.3): 经匹配后端 + RTC SDK 建立单向视频 + 双向语音。
    }

    func hangUp() {
        callMachine.hangUp()
        callMachine.reset()
        callState = callMachine.state
    }
}
