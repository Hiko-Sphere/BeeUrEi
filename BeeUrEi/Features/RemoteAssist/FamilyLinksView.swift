import SwiftUI
import UIKit

/// 视障侧：亲友绑定（后端 /api/family）+ 紧急呼叫（/api/emergency/trigger 取优先级目标）+ 电话兜底。
struct FamilyLinksView: View {
    @State private var links: [FamilyLinkInfo] = []
    @State private var newUsername = ""
    @State private var newRelation = ""
    @State private var newPhone = ""
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
                        HStack {
                            VStack(alignment: .leading) {
                                Text(l.memberName)
                                Text("\(l.relation)\(l.isEmergency ? " · 紧急联系人" : "")")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let phone = l.phone, !phone.isEmpty {
                                Button {
                                    if let url = URL(string: "tel://\(phone)") { UIApplication.shared.open(url) }
                                } label: {
                                    Label("拨打", systemImage: "phone.fill")
                                }
                                .buttonStyle(.bordered)
                                .accessibilityLabel("拨打 \(l.memberName) 的电话")
                            }
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
                TextField("手机号（可选，App 连不上时电话兜底）", text: $newPhone)
                    .keyboardType(.phonePad)
                Toggle("设为紧急联系人", isOn: $isEmergency)
                Button("添加") { Task { await add() } }
                    .disabled(newUsername.trimmingCharacters(in: .whitespaces).count < 3)
            }
        }
        .navigationTitle("亲友与紧急呼叫")
        .task { await load() }
        .fullScreenCover(item: $emergencyCall) { s in
            CallView(role: .blind, callId: s.id) {
                // 挂断时取消待接登记，避免对端在 TTL 内仍弹出已结束的来电。
                if let token = KeychainStore.read() { Task { await api.cancelCall(token: token, callId: s.id) } }
                emergencyCall = nil
            }
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
                                        relation: newRelation, isEmergency: isEmergency,
                                        phone: newPhone.trimmingCharacters(in: .whitespaces))
            newUsername = ""; newRelation = ""; newPhone = ""; isEmergency = false
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
            let session = CallSession()
            // 登记本次呼叫，使在线的协助者/亲友前台轮询即可接听（免推送会合；真机后台响铃仍需推送）。
            try? await api.startEmergencyCall(token: token, callId: session.id, targetUserIds: targets.map(\.memberId))
            emergencyCall = session
        } catch { errorText = "紧急呼叫发起失败" }
    }
}
