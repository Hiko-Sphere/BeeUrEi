import SwiftUI

/// 远程协助界面：亲友名单 + 一键呼叫 + 呼叫中状态。VoiceOver 友好、大按钮。
struct RemoteAssistView: View {
    @State private var model = RemoteAssistViewModel()
    @State private var showAdd = false
    @State private var newName = ""
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                switch model.callState {
                case .ringing, .connected:
                    callingView
                default:
                    contactsList
                }
            }
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
    }

    private var contactsList: some View {
        List {
            if model.contacts.isEmpty {
                Text("还没有添加亲友。点右上角「＋」添加可以帮你看东西的家人或朋友。")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.contacts) { contact in
                    Button { model.call(contact) } label: {
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

    private var callingView: some View {
        VStack(spacing: 20) {
            Image(systemName: "video.fill").font(.system(size: 56))
            Text(callStateText).font(.title2).bold()
            Text(model.activeName).font(.title3)
            Button(role: .destructive) { model.hangUp() } label: {
                Label("结束", systemImage: "phone.down.fill")
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
            Text("提示：真正接通需要网络与远程视频服务（开发中）。")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(callStateText)，\(model.activeName)")
    }

    private var callStateText: String {
        switch model.callState {
        case .ringing:   return "正在呼叫…"
        case .connected: return "已接通"
        default:         return ""
        }
    }
}

#Preview {
    RemoteAssistView {}
}
