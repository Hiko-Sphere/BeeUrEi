import SwiftUI
import UIKit

/// BeeUrEi 设计系统（重设计）：精炼蜂蜜金 + 墨蓝品牌，**自适应明暗**(跟随系统)，组件级无障碍。
/// 设计原则：
/// - 协助/亲友侧：简约精美——克制留白、清晰层级、系统材质、Dynamic Type。
/// - 视障侧：超大点按区、高对比、VoiceOver 友好、尊重 减弱动态效果 / 字体大小 / 增强对比。
/// 配色策略：beeInk 为固定深色(用作深色面/蜜底文字)；其余语义色按明暗自适应，保证两端对比达标。

private extension UIColor {
    convenience init(rgb: UInt) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
                  blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}
/// 明暗自适应色。
private func dyn(_ light: UInt, _ dark: UInt) -> Color {
    Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
}

extension Color {
    /// 品牌蜂蜜金（主行动填充；其上配 beeInk 深色文字，两端皆高对比）。
    static let beeHoney = dyn(0xF2A900, 0xFFC83D)
    /// 品牌墨蓝（**固定深色**）：用作深色面/深色按钮填充、蜂蜜上的文字、头像首字。
    static let beeInk = Color(uiColor: UIColor(rgb: 0x14161F))
    /// 全局强调色(tint)：浅色用墨蓝、深色用蜂蜜——两端对链接/开关/导航都高对比。
    static let beeAccent = dyn(0x14161F, 0xFFC83D)
    /// 语义色（按明暗自适应，且保证作为"白字填充"时对比达标）。
    static let beeDanger = dyn(0xD7382E, 0xE24A40)
    static let beeSuccess = dyn(0x1E7D3F, 0x269B4E)
    static let beeWarn = dyn(0xC8780A, 0xD98A1E)
}

enum BeeSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
}

enum BeeRadius {
    static let card: CGFloat = 18
    static let button: CGFloat = 20
    static let pill: CGFloat = 999
}

/// 按压反馈样式：轻微缩放 + 压暗；尊重「减弱动态效果」。
struct BeePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// 大号主行动按钮：高对比、超大点按区（≥88pt 高）、VoiceOver 合并为单一元素、Dynamic Type 可缩放。
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
                    Image(systemName: systemImage)
                        .font(.system(size: 30, weight: .bold))
                        .frame(width: 34)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.title3.weight(.bold)).multilineTextAlignment(.leading)
                    if let subtitle {
                        Text(subtitle).font(.subheadline).opacity(0.85).multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, BeeSpacing.lg)
            .padding(.vertical, BeeSpacing.md)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .background(tint, in: RoundedRectangle(cornerRadius: BeeRadius.button, style: .continuous))
            .foregroundStyle(foreground)
            .shadow(color: tint.opacity(0.28), radius: 10, y: 5) // 轻投影，精致而不喧宾
            .contentShape(RoundedRectangle(cornerRadius: BeeRadius.button, style: .continuous))
        }
        .buttonStyle(BeePressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// 卡片容器：自适应表面 + 细描边 + 极轻投影（简约精美）。
struct BeeCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(BeeSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground),
                        in: RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.05), radius: 8, y: 3)
    }
}

/// 区块小标题（统一段落标题观感）。
struct BeeSectionHeader: View {
    let title: String
    var systemImage: String?
    init(_ title: String, systemImage: String? = nil) { self.title = title; self.systemImage = systemImage }
    var body: some View {
        HStack(spacing: 6) {
            if let systemImage { Image(systemName: systemImage).font(.caption).foregroundStyle(.secondary) }
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
        }
        .textCase(nil)
        .accessibilityAddTraits(.isHeader)
    }
}

/// 状态药丸（绿点 + 文案；文案由调用方按语言提供）。
struct BeeStatusPill: View {
    let text: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Color.beeSuccess).frame(width: 9, height: 9)
            Text(text).font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
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
            Image(systemName: systemImage).foregroundStyle(Color.beeAccent)
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
            Image(systemName: systemImage)
                .font(.system(size: 44))
                .foregroundStyle(Color.secondary.opacity(0.7))
                .accessibilityHidden(true)
            Text(title).font(.headline)
            if let message {
                Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, BeeSpacing.xl)
        .accessibilityElement(children: .combine)
    }
}
