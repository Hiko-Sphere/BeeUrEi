import Foundation

/// 识别屏（FramingAssist）播报文案中心表——E5 多语言主线第一批。
/// 此前识别屏所有播报硬编码中文、TTS 固定中文嗓音，英文用户在识别屏听到的全是中文；
/// 这里把 ViewModel 产出的全部"盲人听到的话"（引导/结果/语音）集中按语言分支，
/// 与核心 SpokenStrings 同一模式。中文输出与历史完全一致。View 静态文案（按钮/弹窗标题）走 String Catalog（另行）。
enum FramingStrings {

    // MARK: 启动/状态

    static func unsupportedDevice(_ l: Language) -> String {
        l == .zh ? "识别功能需要带 LiDAR 的 iPhone。" : "Recognition requires an iPhone with LiDAR."
    }
    static func unsupportedShort(_ l: Language) -> String { l == .zh ? "设备不支持" : "Device not supported" }
    static func starting(_ l: Language) -> String { l == .zh ? "正在启动…" : "Starting…" }

    // MARK: 取景识别

    static func recognizedResult(_ name: String, _ l: Language) -> String {
        l == .zh ? "识别到：\(name)" : "Recognized: \(name)"
    }
    static func thisIs(_ name: String, _ l: Language) -> String { l == .zh ? "这是\(name)" : "This is \(name)" }

    // MARK: 找我的东西（教学/寻找）

    static func teachGuidance(_ l: Language) -> String {
        l == .zh ? "教我认东西：把物品举在镜头前" : "Teach me: hold the item in front of the camera"
    }
    static func teachIntro(_ l: Language) -> String {
        l == .zh ? "教我认东西。把物品举在镜头前约三十厘米，慢慢转动它，我会自动拍三张。"
                 : "Teach me to recognize it. Hold the item about thirty centimeters from the camera and rotate it slowly. I'll take three photos automatically."
    }
    static func teachShot(_ n: Int, _ l: Language) -> String { l == .zh ? "拍了第\(n)张" : "Photo \(n) taken" }
    static func teachProgress(_ n: Int, _ l: Language) -> String { l == .zh ? "已拍 \(n)/3" : "\(n) of 3 taken" }
    static func teachNamePrompt(_ l: Language) -> String {
        l == .zh ? "拍好了。请输入这个东西的名字，可以用键盘上的话筒说出来。"
                 : "Done. Type a name for it — you can also dictate with the keyboard microphone."
    }
    static func learnedResult(_ name: String, _ l: Language) -> String { l == .zh ? "已学会：\(name)" : "Learned: \(name)" }
    static func learnedSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "学会了。以后可以让我帮你找\(name)。" : "Got it. You can ask me to find \(name) from now on."
    }
    static func noRecord(_ name: String, _ l: Language) -> String {
        l == .zh ? "没有找到\(name)的学习记录" : "No training record for \(name)"
    }
    static func findingGuidance(_ name: String, _ l: Language) -> String { l == .zh ? "寻找：\(name)" : "Finding: \(name)" }
    static func findStartTaught(_ name: String, _ l: Language) -> String {
        l == .zh ? "开始找\(name)。拿着手机慢慢左右移动扫一圈，对到了我会告诉你方位。"
                 : "Looking for \(name). Sweep the phone slowly left and right; I'll tell you where it is."
    }
    static func findStartCategory(_ name: String, _ l: Language) -> String {
        l == .zh ? "开始找\(name)。拿着手机慢慢左右移动扫一圈，看到了我会报方位。"
                 : "Looking for \(name). Sweep the phone slowly left and right; I'll call out its direction."
    }
    static func stopped(_ l: Language) -> String { l == .zh ? "已停止" : "Stopped" }
    static func maybeFoundGuide(_ name: String, _ direction: String, _ l: Language) -> String {
        l == .zh ? "可能找到\(name)：\(direction)" : "Possible \(name): \(direction)"
    }
    static func maybeFoundSpeak(_ name: String, _ direction: String, _ dist: String, _ l: Language) -> String {
        l == .zh ? "可能是\(name)，在\(direction)\(dist)" : "Possibly \(name), \(direction)\(dist)"
    }
    static func foundCategoryGuide(_ name: String, _ direction: String, _ l: Language) -> String {
        l == .zh ? "\(name)：\(direction)" : "\(name): \(direction)"
    }
    static func foundCategorySpeak(_ name: String, _ direction: String, _ dist: String, _ l: Language) -> String {
        l == .zh ? "\(name)，在\(direction)\(dist)" : "\(name), \(direction)\(dist)"
    }
    static func stillSearching(_ l: Language) -> String {
        l == .zh ? "还在找，慢慢移动手机" : "Still looking — keep moving slowly"
    }
    static func stillSearchingFor(_ name: String, _ l: Language) -> String {
        l == .zh ? "还在找\(name)，慢慢移动手机" : "Still looking for \(name) — keep moving slowly"
    }
    /// 方位："正前方" / "x 点钟方向"（复用核心 SpokenStrings）。
    static func direction(hour: Int, _ l: Language) -> String {
        hour == 12 ? SpokenStrings.coarseDirection(hour: 12, l) : SpokenStrings.clockDirection(hour: hour, l)
    }
    /// "，大约 1.5 米"（复用核心 meters）。
    static func approx(_ meters: Double, _ l: Language) -> String {
        l == .zh ? "，大约\(SpokenStrings.meters(meters, l))" : ", about \(SpokenStrings.meters(meters, l))"
    }

    // MARK: 触摸探索

    static func analyzing(_ l: Language) -> String { l == .zh ? "正在分析画面" : "Analyzing the view" }
    static func analyzeFailed(_ l: Language) -> String { l == .zh ? "分析失败，请重试" : "Analysis failed, please try again" }
    static func exploreIntro(objects: Int, texts: Int, _ l: Language) -> String {
        l == .zh ? "触摸探索。手指在屏幕上滑动，碰到什么读什么。共\(objects)个物体、\(texts)段文字。"
                 : "Touch to explore. Slide your finger and I'll read whatever you touch. \(objects) objects and \(texts) text snippets."
    }

    // MARK: 读整页

    static func docGuidance(_ l: Language) -> String { l == .zh ? "读整页：把整页纸放进画面" : "Full page: fit the whole page in view" }
    static func docIntro(_ l: Language) -> String {
        l == .zh ? "读整页模式。把手机举在纸张上方约三十厘米，听提示调整，对好后会自动拍摄并朗读全文。"
                 : "Full-page mode. Hold the phone about thirty centimeters above the page and follow the prompts; it will capture and read the whole page automatically."
    }
    static func docExited(_ l: Language) -> String { l == .zh ? "已退出读整页" : "Exited full-page mode" }
    static func docNoPage(_ l: Language) -> String {
        l == .zh ? "没有找到纸张，请把整页纸放进画面" : "No page found — fit the whole page in view"
    }
    static func docEdge(_ l: Language) -> String {
        l == .zh ? "纸张边缘超出画面，请拿远一点并居中" : "Page edges are cut off — move farther away and center it"
    }
    static func docCloser(_ l: Language) -> String { l == .zh ? "靠近一点" : "Move closer" }
    static func docHold(_ l: Language) -> String { l == .zh ? "对准了，保持不动…" : "Aligned — hold still…" }
    static func docCaptured(_ l: Language) -> String { l == .zh ? "拍好了，正在识别整页" : "Captured. Reading the page" }
    static func docReading(_ l: Language) -> String { l == .zh ? "正在识别整页…" : "Reading the page…" }
    static func captureFailed(_ l: Language) -> String { l == .zh ? "拍摄失败，请重试" : "Capture failed, please try again" }
    static func noTextFound(_ l: Language) -> String { l == .zh ? "没有识别到文字" : "No text found" }
    static func docRetryGuide(_ l: Language) -> String {
        l == .zh ? "没有识别到文字，请再试一次" : "No text found, please try again"
    }
    static func docRetrySpeak(_ l: Language) -> String {
        l == .zh ? "没有识别到文字，请再点一次读整页重试" : "No text found. Tap Full Page again to retry."
    }
    static func docResult(_ firstLine: String, _ l: Language) -> String { l == .zh ? "整页：\(firstLine)…" : "Page: \(firstLine)…" }
    static func docDoneGuide(_ lines: Int, _ l: Language) -> String {
        l == .zh ? "识别完成，共 \(lines) 行" : "Done — \(lines) lines"
    }
    static func docDonePrefix(_ l: Language) -> String { l == .zh ? "识别完成。" : "Done. " }
    static func docJoinSeparator(_ l: Language) -> String { l == .zh ? "。" : ". " }

    // MARK: 读整页 · 多页连读

    static func docPageDonePrefix(_ n: Int, _ l: Language) -> String {
        l == .zh ? "第\(n)页识别完成。" : "Page \(n) done. "
    }
    static func docPageResult(_ n: Int, _ firstLine: String, _ l: Language) -> String {
        l == .zh ? "第\(n)页：\(firstLine)…" : "Page \(n): \(firstLine)…"
    }
    static func docNextPageHint(_ l: Language) -> String {
        l == .zh ? "。翻页后继续对准，或点读整页结束。" : ". Turn the page to continue, or tap Full Page to finish."
    }
    static func docTurnPage(_ l: Language) -> String {
        l == .zh ? "这一页读过了，翻到下一页再对准" : "This page is done — turn to the next page"
    }
    static func docRetryStay(_ l: Language) -> String {
        l == .zh ? "没有识别到文字，请重新对准这一页" : "No text found — line up this page again"
    }
    static func docMultiDoneResult(_ pages: Int, _ l: Language) -> String {
        l == .zh ? "读整页结束：共\(pages)页，全文已可复制" : "Finished: \(pages) pages, full text ready to copy"
    }
    static func docMultiDoneSpeak(_ pages: Int, _ l: Language) -> String {
        l == .zh ? "读整页结束，共\(pages)页，全文已可复制。" : "Finished — \(pages) pages. The full text is ready to copy."
    }

    // MARK: 公交识别（OKO 式）

    static func noBusFound(_ l: Language) -> String {
        l == .zh ? "没有看到公交车，把手机对准来车方向再试" : "No bus in view — point the phone toward the road and try again"
    }
    static func readingBus(_ l: Language) -> String { l == .zh ? "正在读车头牌…" : "Reading the bus sign…" }
    static func busResult(_ name: String, _ direction: String, _ info: String, _ l: Language) -> String {
        l == .zh ? "\(name)，在\(direction)：\(info)" : "\(name) \(direction): \(info)"
    }
    static func busNoText(_ name: String, _ direction: String, _ l: Language) -> String {
        l == .zh ? "看到\(name)在\(direction)，没读清车头牌，等车近一点再试"
                 : "I see a \(name) \(direction) but can't read its sign — try when it's closer"
    }
    static func busInfoSeparator(_ l: Language) -> String { l == .zh ? "，" : ", " }

    // MARK: 朗读文字

    static func aimText(_ l: Language) -> String {
        l == .zh ? "请先把要读的文字对准相机" : "Point the camera at the text first"
    }
    static func recognizeFailed(_ l: Language) -> String { l == .zh ? "识别失败，请重试" : "Recognition failed, please try again" }
    static func readingText(_ l: Language) -> String { l == .zh ? "正在识别文字…" : "Reading text…" }

    // MARK: 扫码

    static func aimBarcode(_ l: Language) -> String {
        l == .zh ? "请把二维码或条码对准相机" : "Point the camera at the QR code or barcode"
    }
    static func scanning(_ l: Language) -> String { l == .zh ? "正在扫码…" : "Scanning…" }
    static func noBarcode(_ l: Language) -> String { l == .zh ? "没有识别到二维码或条码" : "No QR code or barcode found" }
    static func productResult(_ name: String, _ l: Language) -> String { l == .zh ? "商品：\(name)" : "Product: \(name)" }
    static func productCodeResult(_ code: String, _ l: Language) -> String {
        l == .zh ? "商品条码：\(code)" : "Product barcode: \(code)"
    }
    static func productUnknownSpeak(_ l: Language) -> String {
        l == .zh ? "是商品条码，我还不认识它。给它起个名字，下次扫到我直接报名字。"
                 : "It's a product barcode I don't know yet. Give it a name and I'll say it next time."
    }
    static func wifiResult(_ ssid: String?, _ l: Language) -> String {
        (l == .zh ? "无线网络码" : "Wi-Fi code") + (ssid.map { l == .zh ? "：\($0)" : ": \($0)" } ?? "")
    }
    static func wifiSpeak(_ ssid: String?, _ l: Language) -> String {
        l == .zh ? "是无线网络配置码" + (ssid.map { "，网络名称\($0)" } ?? "")
                 : "It's a Wi-Fi setup code" + (ssid.map { ", network \($0)" } ?? "")
    }
    static func urlResult(_ payload: String, _ l: Language) -> String { l == .zh ? "网址：\(payload)" : "Link: \(payload)" }
    static func urlSpeak(_ host: String?, _ l: Language) -> String {
        l == .zh ? "是一个网址" + (host.map { "，网站是\($0)" } ?? "") + "，内容已可复制"
                 : "It's a web link" + (host.map { ", site \($0)" } ?? "") + "; you can copy it"
    }
    static func phoneResult(_ n: String, _ l: Language) -> String { l == .zh ? "电话：\(n)" : "Phone: \(n)" }
    static func phoneSpeak(_ n: String, _ l: Language) -> String { l == .zh ? "是电话号码：\(n)" : "It's a phone number: \(n)" }
    static func contactResult(_ l: Language) -> String { l == .zh ? "名片码" : "Contact card" }
    static func contactSpeak(_ l: Language) -> String {
        l == .zh ? "是一张电子名片，内容已可复制" : "It's a contact card; you can copy it"
    }
    static func codeContent(_ payload: String, _ l: Language) -> String { l == .zh ? "码内容：\(payload)" : "Code: \(payload)" }
    static func rememberedResult(_ name: String, _ l: Language) -> String { l == .zh ? "已记住：\(name)" : "Saved: \(name)" }
    static func rememberedSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "记住了。下次扫到这个条码我会直接说\(name)。" : "Saved. Next time I scan this barcode I'll say \(name)."
    }

    // MARK: 识别纸币

    static func aimBanknote(_ l: Language) -> String {
        l == .zh ? "请把纸币平整地对准相机" : "Hold the banknote flat in front of the camera"
    }
    static func readingBanknote(_ l: Language) -> String { l == .zh ? "正在识别纸币…" : "Reading the banknote…" }
    static func banknoteResult(_ name: String, _ l: Language) -> String { l == .zh ? "纸币：\(name)" : "Banknote: \(name)" }
    static func banknoteUncertain(_ name: String, _ l: Language) -> String {
        l == .zh ? "可能是\(name)，请换个角度再拍一次确认" : "Possibly \(name) — try another angle to confirm"
    }
    static func banknoteNone(_ l: Language) -> String {
        l == .zh ? "没认出纸币面额。请把纸币平整地举在镜头前约三十厘米再试"
                 : "Couldn't read the denomination. Hold the note flat about thirty centimeters away and try again."
    }
    static func yuan(_ d: Int, _ l: Language) -> String {
        switch l {
        case .zh:
            switch d {
            case 100: return "一百元"
            case 50: return "五十元"
            case 20: return "二十元"
            case 10: return "十元"
            case 5: return "五元"
            default: return "一元"
            }
        case .en:
            return "\(d) yuan"
        }
    }

    // MARK: 周围的人 / 颜色 / 光线

    static func aimAhead(_ l: Language) -> String { l == .zh ? "请先把相机对准前方" : "Point the camera ahead first" }
    static func findingPeople(_ l: Language) -> String { l == .zh ? "正在找人…" : "Looking for people…" }
    static func aimObject(_ l: Language) -> String { l == .zh ? "请先把物体对准相机" : "Point the camera at the object first" }
    static func colorResult(_ name: String, _ l: Language) -> String { l == .zh ? "颜色：\(name)" : "Color: \(name)" }
    static func colorSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "中间的颜色大概是\(name)" : "The color in the center is about \(name)"
    }
    static func colorFailed(_ l: Language) -> String { l == .zh ? "无法识别颜色" : "Couldn't read the color" }
    static func lightResult(_ desc: String, _ l: Language) -> String { l == .zh ? "光线：\(desc)" : "Light: \(desc)" }
    static func lightFailed(_ l: Language) -> String { l == .zh ? "无法检测光线" : "Couldn't measure the light" }
}
