import Foundation

/// 检测标签本地化（见 docs/PLAN.md §5.8）：把 COCO 英文类别映射成中文播报名，
/// 使英文检测模型也能**全中文**播报，并让翻译后的名字命中 `HazardCatalog` 的高危加成。
/// 覆盖完整 COCO-80；未知类别（非 COCO/自训模型）回退成中文通用词，保证播报永远统一中文。
public struct LabelCatalog: Sendable {
    public let map: [String: String]
    public let unknownName: String

    public init(map: [String: String] = LabelCatalog.cocoToChinese, unknownName: String = "障碍物") {
        self.map = map
        self.unknownName = unknownName
    }

    /// 返回中文名；未知标签回退中文通用词（绝不返回英文）。大小写不敏感。
    public func localizedName(_ englishLabel: String) -> String {
        map[englishLabel.lowercased()] ?? unknownName
    }

    /// 完整 COCO-80 类别中文映射（+ 少量街景补充）。
    public static let cocoToChinese: [String: String] = [
        "person": "行人", "bicycle": "自行车", "car": "车辆", "motorcycle": "摩托车",
        "airplane": "飞机", "bus": "公交车", "train": "火车", "truck": "卡车", "boat": "船",
        "traffic light": "红绿灯", "fire hydrant": "消火栓", "stop sign": "停车标志",
        "parking meter": "停车计时器", "bench": "长椅",
        "bird": "鸟", "cat": "猫", "dog": "狗", "horse": "马", "sheep": "羊", "cow": "牛",
        "elephant": "大象", "bear": "熊", "zebra": "斑马", "giraffe": "长颈鹿",
        "backpack": "背包", "umbrella": "雨伞", "handbag": "手提包", "tie": "领带",
        "suitcase": "行李箱", "frisbee": "飞盘", "skis": "滑雪板", "snowboard": "单板滑雪",
        "sports ball": "球", "kite": "风筝", "baseball bat": "球棒", "baseball glove": "棒球手套",
        "skateboard": "滑板", "surfboard": "冲浪板", "tennis racket": "网球拍",
        "bottle": "瓶子", "wine glass": "酒杯", "cup": "杯子", "fork": "叉子", "knife": "刀",
        "spoon": "勺子", "bowl": "碗", "banana": "香蕉", "apple": "苹果", "sandwich": "三明治",
        "orange": "橙子", "broccoli": "西兰花", "carrot": "胡萝卜", "hot dog": "热狗",
        "pizza": "披萨", "donut": "甜甜圈", "cake": "蛋糕",
        "chair": "椅子", "couch": "沙发", "potted plant": "盆栽", "bed": "床",
        "dining table": "餐桌", "toilet": "马桶", "tv": "电视", "laptop": "笔记本电脑",
        "mouse": "鼠标", "remote": "遥控器", "keyboard": "键盘", "cell phone": "手机",
        "microwave": "微波炉", "oven": "烤箱", "toaster": "烤面包机", "sink": "水槽",
        "refrigerator": "冰箱", "book": "书", "clock": "时钟", "vase": "花瓶",
        "scissors": "剪刀", "teddy bear": "玩偶", "hair drier": "吹风机", "toothbrush": "牙刷",
        // 街景补充（非 COCO 但常用于自训）
        "door": "门", "stairs": "台阶", "pole": "路桩", "curb": "路沿",
    ]
}
