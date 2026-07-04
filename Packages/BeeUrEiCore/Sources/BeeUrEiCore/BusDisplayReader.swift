import Foundation

/// 公交/电车车头牌 OCR 行挑选（纯逻辑，可单测）。OKO 的"公交识别"场景：多辆车同时进站，
/// 盲人需要确认"来的是不是我要坐的那班"。OCR 会混入车身广告/电话等杂讯，这里挑出最像
/// "线路号/终点站"的行：线路号 = 含**阿拉伯数字**的短行（"103"、"B12"、"103路"）优先；
/// 终点站 = 不含阿拉伯数字的行按长度取最长；含长数字串（≥8 连续数字）的行视为电话/编号，整行丢弃。
///
/// ⚠️ "数字"一律指**阿拉伯数字**（ch.isASCII && ch.isNumber），不含中文数字一二三…百。
/// Swift 的 `Character.isNumber` 对中文数字也为 true——若用它当"含数字"判据，含中文数字的
/// 中文终点站（"开往二七广场火车站"、"二环"、"三里屯"极常见）会被踢出终点站列表：>8 字被整行
/// 丢弃、盲人只听到杂字，短的则被误塞进线路号列表打乱顺序。两个 filter 必须用**同一**谓词以保持
/// 互补划分（只改一个会让含中文数字的行既进 routes 又进 destinations，被重复播报）。
public enum BusDisplayReader {
    public static func pick(texts: [String], maxItems: Int = 2) -> [String] {
        let cleaned = texts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && longestDigitRun(in: $0) < 8 }
        var seen = Set<String>()
        let unique = cleaned.filter { seen.insert($0).inserted }
        let routes = unique.filter { $0.count <= 8 && $0.contains(where: isAsciiDigit) }
        let destinations = unique.filter { !$0.contains(where: isAsciiDigit) }
            .sorted { $0.count > $1.count }
        return Array((routes + destinations).prefix(maxItems))
    }

    /// 阿拉伯数字判定。**不含**中文数字（一二三…十百）——中文数字是地名/终点站文本的一部分，
    /// 不是线路号信号。与 longestDigitRun 的电话号识别口径一致。
    static func isAsciiDigit(_ ch: Character) -> Bool { ch.isASCII && ch.isNumber }

    /// 最长连续阿拉伯数字串长度（≥8 视为电话/序列号杂讯）。
    static func longestDigitRun(in text: String) -> Int {
        var best = 0, current = 0
        for ch in text {
            if isAsciiDigit(ch) {
                current += 1
                best = max(best, current)
            } else {
                current = 0
            }
        }
        return best
    }
}
