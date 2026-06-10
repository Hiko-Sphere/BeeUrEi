import Foundation

/// 公交/电车车头牌 OCR 行挑选（纯逻辑，可单测）。OKO 的"公交识别"场景：多辆车同时进站，
/// 盲人需要确认"来的是不是我要坐的那班"。OCR 会混入车身广告/电话等杂讯，这里挑出最像
/// "线路号/终点站"的行：线路号 = 含数字的短行（"103"、"B12"、"103路"）优先；
/// 终点站 = 不含数字的行按长度取最长；含长数字串（≥8 连续数字）的行视为电话/编号，整行丢弃。
public enum BusDisplayReader {
    public static func pick(texts: [String], maxItems: Int = 2) -> [String] {
        let cleaned = texts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && longestDigitRun(in: $0) < 8 }
        var seen = Set<String>()
        let unique = cleaned.filter { seen.insert($0).inserted }
        let routes = unique.filter { $0.count <= 8 && $0.contains(where: \.isNumber) }
        let destinations = unique.filter { !$0.contains(where: \.isNumber) }
            .sorted { $0.count > $1.count }
        return Array((routes + destinations).prefix(maxItems))
    }

    /// 最长连续数字串长度（≥8 视为电话/序列号杂讯）。
    static func longestDigitRun(in text: String) -> Int {
        var best = 0, current = 0
        for ch in text {
            if ch.isASCII && ch.isNumber {
                current += 1
                best = max(best, current)
            } else {
                current = 0
            }
        }
        return best
    }
}
