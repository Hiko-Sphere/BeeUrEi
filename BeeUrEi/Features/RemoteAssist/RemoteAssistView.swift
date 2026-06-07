import SwiftUI

/// 一个通话会话标识（用于 fullScreenCover 呈现）。
struct CallSession: Identifiable {
    let id = UUID().uuidString
}

/// 远程协助：一键求助 + 亲友名单；发起即进入隐私门控通话界面。VoiceOver 友好。
struct RemoteAssistView: View {
    @State private var model = RemoteAssistViewModel()
    @State private var showAdd = false
    @State private var newName = ""
    @State private var activeCall: CallSession?
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            contactsList
                .navigationTitle("呼叫帮手")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { onClose() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button { showAdd = true } label: { Image(systemName: "plus") }
                            .accessibilityLabel("添加亲友")
                    }
                }
                .alert("添加亲友", isPresented: $showAdd) {
                    TextField("姓名", text: $newName)
                    Button("添加") { model.addContact(name: newName); newName = "" }
                    Button("取消", role: .cancel) { newName = "" }
                } message: {
                    Text("添加一位可以帮你看东西的家人或朋友。")
                }
        }
        .onAppear { model.load() }
        .fullScreenCover(item: $activeCall) { session in
            CallView(role: .blind, callId: session.id) { activeCall = nil }
        }
    }

    private var contactsList: some View {
        List {
            Section {
                Button { activeCall = CallSession() } label: {
                    Label("一键求助（呼叫帮手）", systemImage: "person.fill.questionmark")
                        .font(.headline)
                }
                .accessibilityLabel("一键求助，呼叫帮手")
            }

            if model.contacts.isEmpty {
                Text("还没有添加亲友。点右上角「＋」添加可以帮你看东西的家人或朋友。")
                    .foregroundStyle(.secondary)
            } else {
                Section("亲友") {
                    ForEach(model.contacts) { contact in
                        Button { activeCall = CallSession() } label: {
                            HStack {
                                Image(systemName: "person.crop.circle.fill")
                                Text(contact.name).font(.headline)
                                Spacer()
                                Image(systemName: "video.fill").foregroundStyle(.green)
                            }
                        }
                        .accessibilityLabel("呼叫 \(contact.name)")
                    }
                    .onDelete { indexSet in
                        indexSet.map { model.contacts[$0] }.forEach(model.removeContact)
                    }
                }
            }
        }
    }
}
