import SwiftUI

/// 视障侧：亲友绑定（后端 /api/family）+ 紧急呼叫（/api/emergency/trigger 取优先级目标）。
struct FamilyLinksView: View {
    @State private var links: [FamilyLinkInfo] = []
    @State private var newUsername = ""
    @State private var newRelation = ""
    @State private var isEmergency = false
    @State private var errorText: String?
    @State private var emergencyInfo: String?
    @State private var emergencyCall: CallSession?
    @State private var api = APIClient()

    var body: some View {
        List {
            if let errorText {
                Section { Text(errorText).foregroundStyle(.red) }
            }

            Section("紧急呼叫") {
                Button {
                    Task { await triggerEmergency() }
                } label: {
                    Label("紧急呼叫亲友", systemImage: "sos.circle.fill").foregroundStyle(.red).font(.headline)
                }
                .accessibilityHint("按优先级依次呼叫标记为紧急联系人的亲友")
                if let emergencyInfo {
                    Text(emergencyInfo).font(.footnote).foregroundStyle(.secondary)
                }
            }

            Section("我的亲友 / 协助者") {
                if links.isEmpty {
                    Text("还没有绑定。下面按对方用户名添加。").foregroundStyle(.secondary)
                } else {
                    ForEach(links) { l in
                        VStack(alignment: .leading) {
                            Text(l.memberName)
                            Text("\(l.relation)\(l.isEmergency ? " · 紧急联系人" : "")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .onDelete { idx in
                        idx.map { links[$0] }.forEach { l in Task { await remove(l) } }
                    }
                }
            }

            Section("添加亲友（按对方用户名）") {
                TextField("对方用户名", text: $newUsername)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("关系（如 母亲）", text: $newRelation)
                Toggle("设为紧急联系人", isOn: $isEmergency)
                Button("添加") { Task { await add() } }
                    .disabled(newUsername.trimmingCharacters(in: .whitespaces).count < 3)
            }
        }
        .navigationTitle("亲友与紧急呼叫")
        .task { await load() }
        .fullScreenCover(item: $emergencyCall) { s in
            CallView(role: .blind, callId: s.id) { emergencyCall = nil }
        }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { errorText = "请先在「设置 → 账号」登录"; return }
        do { links = try await api.familyLinks(token: token); errorText = nil }
        catch { errorText = "加载失败（需登录并连接后端）" }
    }

    private func add() async {
        guard let token = KeychainStore.read() else { errorText = "请先登录"; return }
        do {
            try await api.addFamilyLink(token: token,
                                        username: newUsername.trimmingCharacters(in: .whitespaces),
                                        relation: newRelation, isEmergency: isEmergency)
            newUsername = ""; newRelation = ""; isEmergency = false
            await load()
        } catch let APIError.server(msg) {
            errorText = msg == "member_not_found" ? "找不到该用户名" : msg
        } catch { errorText = "添加失败" }
    }

    private func remove(_ link: FamilyLinkInfo) async {
        guard let token = KeychainStore.read() else { return }
        do { try await api.deleteFamilyLink(token: token, id: link.id); await load() }
        catch { errorText = "删除失败" }
    }

    private func triggerEmergency() async {
        guard let token = KeychainStore.read() else { errorText = "请先登录"; return }
        do {
            // 优先呼叫"在线可用"的联系人（匹配）；无人在线则回退呼叫全部紧急联系人。
            let online = try await api.assistMatch(token: token, emergency: true)
            let targets = online.isEmpty ? try await api.emergencyTargets(token: token) : online
            guard !targets.isEmpty else {
                emergencyInfo = "没有可呼叫的亲友，请先添加紧急联系人。"
                return
            }
            let prefix = online.isEmpty ? "暂无在线联系人，仍尝试呼叫：" : "正在呼叫在线联系人："
            emergencyInfo = prefix + targets.map(\.memberName).joined(separator: " → ")
            emergencyCall = CallSession()  // 接通由信令负责；真实响铃需推送（真机）
        } catch { errorText = "紧急呼叫发起失败" }
    }
}
