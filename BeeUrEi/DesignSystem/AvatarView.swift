import SwiftUI
import UIKit

/// 头像视图：有头像(data URL base64)则显示图片，否则显示姓名首字的占位圆。
struct AvatarView: View {
    let dataURL: String?
    let name: String
    var size: CGFloat = 44

    var body: some View {
        Group {
            if let img = Self.image(from: dataURL) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                ZStack {
                    Circle().fill(Color.beeHoney.opacity(0.85))
                    Text(initial).font(.system(size: size * 0.42, weight: .bold)).foregroundStyle(Color.beeInk)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true) // 姓名已在相邻文本里朗读，头像对 VoiceOver 无额外信息
    }

    private var initial: String {
        let t = name.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? "?" : String(t.prefix(1))
    }

    /// 解析 data:image/...;base64,xxxx → UIImage。失败返回 nil。
    static func image(from dataURL: String?) -> UIImage? {
        guard let s = dataURL, let comma = s.firstIndex(of: ","), s.hasPrefix("data:image") else { return nil }
        let b64 = String(s[s.index(after: comma)...])
        guard let data = Data(base64Encoded: b64) else { return nil }
        return UIImage(data: data)
    }
}

/// 把 UIImage 压缩为小尺寸 JPEG 的 data URL（供上传，控制体积）。
enum AvatarEncoder {
    static func dataURL(from image: UIImage, maxDimension: CGFloat = 256, quality: CGFloat = 0.7) -> String? {
        let scaled = downscale(image, maxDimension: maxDimension)
        guard let jpeg = scaled.jpegData(compressionQuality: quality) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

    private static func downscale(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let w = image.size.width, h = image.size.height
        let maxSide = max(w, h)
        guard maxSide > maxDimension else { return image }
        let scale = maxDimension / maxSide
        let newSize = CGSize(width: w * scale, height: h * scale)
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: fmt).image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
