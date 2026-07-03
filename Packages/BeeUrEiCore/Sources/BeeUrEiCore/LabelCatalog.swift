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

    /// 按语言选映射表与未知回退词。中文用 COCO→中文，英文用 COCO→英文。
    public init(language: Language) {
        switch language {
        case .zh: self.init(map: LabelCatalog.cocoToChinese, unknownName: "障碍物")
        case .en: self.init(map: LabelCatalog.cocoToEnglish, unknownName: "obstacle")
        }
    }

    /// 返回本地化名；未知标签回退通用词。大小写不敏感。
    public func localizedName(_ englishLabel: String) -> String {
        map[englishLabel.lowercased()] ?? unknownName
    }

    /// 大型机动车组（车辆/卡车/公交车/摩托车）。YOLO 在这些 COCO 类间**逐帧抖动**是极常见混淆——
    /// 一辆逼近的车会被判成 car→truck→bus 交替。跟踪关联时须视为同组，否则同一物理目标被碎成多条
    /// 互斥轨迹，每条只拿到 1/N 距离样本 → 距离被显著低估、确认被延迟（安全攸关的假安心，见安全复审）。
    /// 中英本地化名都认（tracker 收到的是本地化名）。
    public static let motorVehicleNames: Set<String> = [
        "车辆", "卡车", "公交车", "摩托车", "vehicle", "truck", "bus", "motorcycle",
    ]

    /// 两个（本地化）标签是否属跟踪意义上的同一组：相等，或同为大型机动车。
    /// 供 ObstacleTracker 关联门用——把 car/truck/bus 抖动关联到同一条轨迹。
    public static func sameTrackingGroup(_ a: String, _ b: String) -> Bool {
        a == b || (motorVehicleNames.contains(a) && motorVehicleNames.contains(b))
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

    /// COCO-80 的“规范英文显示名”映射（几乎是恒等，仅统一少量别名，如 car→vehicle）+ 街景补充。
    /// 英文圈用户听到的便是这些词；localizedName 未知回退 "obstacle"。
    public static let cocoToEnglish: [String: String] = [
        "person": "person", "bicycle": "bicycle", "car": "vehicle", "motorcycle": "motorcycle",
        "airplane": "airplane", "bus": "bus", "train": "train", "truck": "truck", "boat": "boat",
        "traffic light": "traffic light", "fire hydrant": "fire hydrant", "stop sign": "stop sign",
        "parking meter": "parking meter", "bench": "bench",
        "bird": "bird", "cat": "cat", "dog": "dog", "horse": "horse", "sheep": "sheep", "cow": "cow",
        "elephant": "elephant", "bear": "bear", "zebra": "zebra", "giraffe": "giraffe",
        "backpack": "backpack", "umbrella": "umbrella", "handbag": "handbag", "tie": "tie",
        "suitcase": "suitcase", "frisbee": "frisbee", "skis": "skis", "snowboard": "snowboard",
        "sports ball": "ball", "kite": "kite", "baseball bat": "baseball bat", "baseball glove": "baseball glove",
        "skateboard": "skateboard", "surfboard": "surfboard", "tennis racket": "tennis racket",
        "bottle": "bottle", "wine glass": "wine glass", "cup": "cup", "fork": "fork", "knife": "knife",
        "spoon": "spoon", "bowl": "bowl", "banana": "banana", "apple": "apple", "sandwich": "sandwich",
        "orange": "orange", "broccoli": "broccoli", "carrot": "carrot", "hot dog": "hot dog",
        "pizza": "pizza", "donut": "donut", "cake": "cake",
        "chair": "chair", "couch": "couch", "potted plant": "potted plant", "bed": "bed",
        "dining table": "table", "toilet": "toilet", "tv": "TV", "laptop": "laptop",
        "mouse": "mouse", "remote": "remote", "keyboard": "keyboard", "cell phone": "phone",
        "microwave": "microwave", "oven": "oven", "toaster": "toaster", "sink": "sink",
        "refrigerator": "refrigerator", "book": "book", "clock": "clock", "vase": "vase",
        "scissors": "scissors", "teddy bear": "teddy bear", "hair drier": "hair drier", "toothbrush": "toothbrush",
        // 街景补充
        "door": "door", "stairs": "stairs", "pole": "pole", "curb": "curb",
    ]
}
