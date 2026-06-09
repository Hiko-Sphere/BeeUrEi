import SwiftUI

/// BeeUrEi 设计系统：品牌色 + 间距 + 可复用无障碍组件。
/// 品牌：蜂蜜黄 #FFC42E / 墨蓝 #14161F（见 BeeUrEi-Brand-Assets）。
/// 设计原则（面向视障/低视力）：超大点按区、高对比、清晰层级、所有交互件 VoiceOver 友好、尊重 Dynamic Type。
extension Color {
    static let beeHoney = Color(red: 1.0, green: 0.768, blue: 0.180) // #FFC42E
    static let beeInk = Color(red: 0.078, green: 0.086, blue: 0.122) // #14161F
    static let beeDanger = Color(red: 0.90, green: 0.22, blue: 0.21)
    static let beeSuccess = Color(red: 0.10, green: 0.50, blue: 0.27) // 较深绿：白字胶囊达 WCAG 对比、白底成功文字也更清晰（见无障碍审计）
    static let beeWarn = Color(red: 0.98, green: 0.62, blue: 0.11)
}

enum BeeSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
}

/// 大号主行动按钮：高对比、超大点按区（≥88pt 高）、VoiceOver 合并为单一元素。盲人首要操作用它。
struct BeeBigButton: View {
    let title: String
    var systemImage: String?
    var subtitle: String?
    var tint: Color = .beeHoney
    var foreground: Color = .beeInk
    var role: ButtonRole?
    let action: () -> Void

    init(_ title: String, systemImage: String? = nil, subtitle: String? = nil,
         tint: Color = .beeHoney, foreground: Color = .beeInk, role: ButtonRole? = nil,
         action: @escaping () -> Void) {
        self.title = title; self.systemImage = systemImage; self.subtitle = subtitle
        self.tint = tint; self.foreground = foreground; self.role = role; self.action = action
    }

    var body: some View {
        Button(role: role, action: action) {
            HStack(spacing: BeeSpacing.md) {
                if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 32, weight: .bold))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.title2.weight(.bold)).multilineTextAlignment(.leading)
                    if let subtitle {
                        Text(subtitle).font(.subheadline).opacity(0.85).multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(BeeSpacing.lg)
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
            .background(tint, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .foregroundStyle(foreground)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// 卡片容器（分组背景）。
struct BeeCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(BeeSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// 在线/离线状态药丸。
struct BeeStatusPill: View {
    let online: Bool
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(online ? Color.beeSuccess : Color.secondary).frame(width: 10, height: 10)
            Text(online ? "在线待命" : "离线").font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(online ? "在线待命中" : "当前离线")
    }
}

/// 信息标签行（图标 + 文本），用于详情展示（地点/语言/时间等）。
struct BeeInfoRow: View {
    let systemImage: String
    let text: String
    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(.secondary)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }
}

/// 空状态占位（图标 + 标题 + 说明），居中。
struct BeeEmptyState: View {
    let systemImage: String
    let title: String
    var message: String?
    var body: some View {
        VStack(spacing: BeeSpacing.sm) {
            Image(systemName: systemImage).font(.system(size: 40)).foregroundStyle(.secondary)
            Text(title).font(.headline)
            if let message {
                Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, BeeSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
