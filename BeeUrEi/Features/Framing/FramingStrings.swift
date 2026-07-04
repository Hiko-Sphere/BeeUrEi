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
    static func cameraDenied(_ l: Language) -> String {
        l == .zh ? "需要相机权限才能识别。请在系统设置中开启相机。"
                 : "Camera access is needed to recognize things. Enable the camera in Settings."
    }
    static func cameraError(_ msg: String, _ l: Language) -> String {
        l == .zh ? "相机出错：\(msg)" : "Camera error: \(msg)"
    }
    static func openSettings(_ l: Language) -> String { l == .zh ? "打开系统设置" : "Open Settings" }
    static func torchFailed(_ l: Language) -> String {
        l == .zh ? "手电筒打开失败" : "Couldn't turn on the flashlight"
    }
    static func copied(_ l: Language) -> String { l == .zh ? "已复制到剪贴板" : "Copied to clipboard" }
    static func nothingToExplore(_ l: Language) -> String {
        l == .zh ? "这一帧没认出物体或文字，请对准后再试" : "Nothing recognized in this frame — aim and try again"
    }

    // MARK: 取景识别

    static func recognizedResult(_ name: String, _ l: Language) -> String {
        l == .zh ? "识别到：\(name)" : "Recognized: \(name)"
    }
    static func thisIs(_ name: String, _ l: Language) -> String { l == .zh ? "这是\(name)" : "This is \(name)" }
    /// 低置信版本（核心 ConfidencePolicy 判定）："少说但说对"——不确定就明说。
    static func recognizedMaybeResult(_ name: String, _ l: Language) -> String {
        l == .zh ? "可能是：\(name)" : "Possibly: \(name)"
    }
    static func maybeThis(_ name: String, _ l: Language) -> String {
        l == .zh ? "可能是\(name)" : "Possibly \(name)"
    }

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
    /// 语音"找X"但 X 既非已教物品也非可找类别：提示先教或换常见物名。
    static func findNotRecognized(_ name: String, _ l: Language) -> String {
        l == .zh ? "还不认识\(name)。可以先教我认它，或说一个常见物品，比如椅子、瓶子。"
                 : "I don't recognize \(name) yet. Teach it first, or name a common object like a chair or bottle."
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
    /// 找空座位（椅子/沙发命中时的占用后缀）：保守措辞——"可能有人"而非断言，遮挡场景会误报。
    static func seatLooksFree(_ l: Language) -> String { l == .zh ? "，看起来空着" : " — looks free" }
    static func seatMaybeOccupied(_ l: Language) -> String { l == .zh ? "，可能有人" : " — someone may be there" }
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

    /// 配色比对：记住第一件后提示对准第二件。
    static func colorMatchFirstStored(_ name: String, _ l: Language) -> String {
        l == .zh ? "第一件是\(name)。现在把第二件对准中间，再说一次“搭配”。"
                 : "First item is \(name). Now aim at the second item and say “does this match” again."
    }
    /// 配色比对结果：两件颜色 + 和谐度结论（结论文案来自核心 SpokenStrings.colorHarmony）。
    static func colorMatchResult(_ first: String, _ second: String, _ verdict: String, _ l: Language) -> String {
        l == .zh ? "第一件\(first)，第二件\(second)：\(verdict)。"
                 : "First \(first), second \(second): \(verdict)."
    }

    // MARK: 朗读文字

    static func aimText(_ l: Language) -> String {
        l == .zh ? "请先把要读的文字对准相机" : "Point the camera at the text first"
    }
    static func recognizeFailed(_ l: Language) -> String { l == .zh ? "识别失败，请重试" : "Recognition failed, please try again" }
    static func readingText(_ l: Language) -> String { l == .zh ? "正在识别文字…" : "Reading text…" }
    static func readingDates(_ l: Language) -> String { l == .zh ? "正在找日期…" : "Looking for dates…" }
    static func noDatesFound(_ l: Language) -> String {
        l == .zh ? "没找到带标签的日期，可以说“读文字”听完整文字" : "No labeled date found — say “read text” to hear all the text"
    }
    static func readingPhone(_ l: Language) -> String { l == .zh ? "正在找电话号码…" : "Looking for phone numbers…" }
    static func noPhoneFound(_ l: Language) -> String {
        l == .zh ? "没找到电话号码，可以说“读文字”听完整文字" : "No phone number found — say “read text” to hear all the text"
    }
    /// 号码逐个读出 + 核对提醒（绝不自动拨——OCR 可能错位）。
    static func phoneResult(_ numbers: [String], _ l: Language) -> String {
        let joined = numbers.joined(separator: l == .zh ? "；" : "; ")
        return l == .zh ? "识别到电话号码，请核对后再拨：\(joined)" : "Found phone number(s), please verify before dialing: \(joined)"
    }
    static func readingEmail(_ l: Language) -> String { l == .zh ? "正在找邮箱…" : "Looking for email addresses…" }
    static func noEmailFound(_ l: Language) -> String {
        l == .zh ? "没找到邮箱，可以说“读文字”听完整文字" : "No email address found — say “read text” to hear all the text"
    }
    static func emailFoundResult(_ emails: [String], _ l: Language) -> String {
        let joined = emails.joined(separator: l == .zh ? "；" : "; ")
        return l == .zh ? "识别到邮箱，请核对后再发：\(joined)" : "Found email address(es), please verify before sending: \(joined)"
    }

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
    /// 在线查询商品名时的即时提示（可丢弃）：避免网络往返期间盲人以为卡住/没反应。
    static func productLookingUp(_ l: Language) -> String { l == .zh ? "正在查询商品…" : "Looking up the product…" }
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
    static func emailResult(_ a: String?, _ l: Language) -> String { l == .zh ? "邮箱：\(a ?? "")" : "Email: \(a ?? "")" }
    static func emailSpeak(_ a: String?, _ l: Language) -> String {
        l == .zh ? "是电子邮箱地址" + (a.map { "：\($0)" } ?? "") + "，内容已可复制"
                 : "It's an email address" + (a.map { ": \($0)" } ?? "") + "; you can copy it"
    }
    static func smsResult(_ n: String?, _ l: Language) -> String { l == .zh ? "短信：\(n ?? "")" : "SMS: \(n ?? "")" }
    static func smsSpeak(_ n: String?, _ l: Language) -> String {
        l == .zh ? "是发短信的码" + (n.map { "，号码\($0)" } ?? "") : "It's a text-message code" + (n.map { ", number \($0)" } ?? "")
    }
    static func contactResult(_ l: Language) -> String { l == .zh ? "名片码" : "Contact card" }
    static func contactSpeak(_ l: Language) -> String {
        l == .zh ? "是一张电子名片，内容已可复制" : "It's a contact card; you can copy it"
    }
    /// 已解析的名片：读出姓名/单位/电话/邮箱（核心 VCardParser）。
    static func contactDetail(name: String?, org: String?, phones: [String], emails: [String], _ l: Language) -> String {
        let sep = l == .zh ? "，" : ", "
        var parts: [String] = []
        if let name, !name.isEmpty { parts.append(name) }
        if let org, !org.isEmpty { parts.append(org) }
        if !phones.isEmpty { parts.append((l == .zh ? "电话 " : "phone ") + phones.joined(separator: l == .zh ? "、" : ", ")) }
        if !emails.isEmpty { parts.append((l == .zh ? "邮箱 " : "email ") + emails.joined(separator: l == .zh ? "、" : ", ")) }
        let body = parts.joined(separator: sep)
        return l == .zh ? "名片：\(body)" : "Contact card: \(body)"
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
    /// 不确定时的屏显文案也要带"可能"——不能屏上显得很确定而只有语音含糊（见审计 P2）。
    static func banknoteUncertainResult(_ name: String, _ l: Language) -> String {
        l == .zh ? "纸币：可能是\(name)" : "Banknote: possibly \(name)"
    }
    static func banknoteNone(_ l: Language) -> String {
        l == .zh ? "没认出纸币面额。请把纸币平整地举在镜头前约三十厘米再试"
                 : "Couldn't read the denomination. Hold the note flat about thirty centimeters away and try again."
    }
    static func yuan(_ d: Int, jiao: Bool = false, _ l: Language) -> String {
        // 角面额（第四套 1角/2角/5角）：单位不同，绝不与"元"混说——防 5 角被读成 5 元（10 倍）。
        if jiao {
            switch l {
            case .zh:
                switch d { case 5: return "五角"; case 2: return "两角"; default: return "一角" }
            case .en:
                return "\(d) jiao"
            }
        }
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

    // MARK: 界面文案（识别屏 View 静态文案——按钮/弹窗/对话框，含 VoiceOver hint）

    enum UIAction { case whatsAhead, readText, fullPage, light, color, scan, explore, banknote, people, find, stopFind, bus }

    /// 光探测按钮标题：开启连续音调后变"关闭光探测"，否则为"光线"。
    static func lightToneTitle(_ on: Bool, _ l: Language) -> String {
        if on { return l == .zh ? "关闭光探测" : "Stop Light" }
        return uiTitle(.light, l)
    }
    /// 颜色按钮标题：开启连续模式后变"关闭连续颜色"，否则为"识别颜色"。
    static func colorContinuousTitle(_ on: Bool, _ l: Language) -> String {
        if on { return l == .zh ? "关闭连续颜色" : "Stop Color" }
        return uiTitle(.color, l)
    }

    static func uiTitle(_ a: UIAction, _ l: Language) -> String {
        switch l {
        case .zh:
            switch a {
            case .whatsAhead: return "前方有什么"
            case .readText: return "朗读文字"
            case .fullPage: return "读整页"
            case .light: return "光线"
            case .color: return "识别颜色"
            case .scan: return "扫码"
            case .explore: return "触摸探索"
            case .banknote: return "识别纸币"
            case .people: return "周围的人"
            case .find: return "找东西"
            case .stopFind: return "停止寻找"
            case .bus: return "公交识别"
            }
        case .en:
            switch a {
            case .whatsAhead: return "What's Ahead"
            case .readText: return "Read Text"
            case .fullPage: return "Full Page"
            case .light: return "Light"
            case .color: return "Color"
            case .scan: return "Scan Code"
            case .explore: return "Touch Explore"
            case .banknote: return "Banknote"
            case .people: return "People Nearby"
            case .find: return "Find Things"
            case .stopFind: return "Stop Finding"
            case .bus: return "Bus Reader"
            }
        }
    }

    static func uiHint(_ a: UIAction, _ l: Language) -> String {
        switch l {
        case .zh:
            switch a {
            case .whatsAhead: return "汇总播报前方识别到的物体"
            case .readText: return "识别并朗读相机里看到的文字"
            case .fullPage: return "引导你把整页纸放进画面，自动拍摄并按顺序朗读全文"
            case .light: return "报告明暗和亮光方向，并开启连续音调——扫动手机、越亮音越高，靠耳朵找窗户或灯"
            case .color: return "报出画面中央的颜色，并开启连续模式——指哪报哪、颜色变了才说，适合配衣服/比色"
            case .scan: return "识别并朗读二维码或条码的内容"
            case .explore: return "定格画面后，手指滑到哪里就朗读那里的物体或文字"
            case .banknote: return "识别人民币纸币的面额"
            case .people: return "数一数前方有几个人，报方位和距离。不识别身份"
            case .find, .stopFind: return "教 App 认你自己的钥匙、水杯等，或寻找周围的椅子、瓶子等物品"
            case .bus: return "认出进站的公交车或电车，朗读车头的线路号和终点站"
            }
        case .en:
            switch a {
            case .whatsAhead: return "Summarize the objects detected ahead"
            case .readText: return "Recognize and read text seen by the camera"
            case .fullPage: return "Guides you to fit the whole page, then captures and reads it in order"
            case .light: return "Report brightness and light direction, then play a continuous tone — sweep the phone, brighter is higher-pitched, to find a window or lamp by ear"
            case .color: return "Say the center color, then keep going continuously — point and it announces on change, for matching clothes"
            case .scan: return "Recognize and read a QR code or barcode"
            case .explore: return "Freeze the view, then slide your finger to hear what you touch"
            case .banknote: return "Identify RMB banknote denominations"
            case .people: return "Count people ahead with direction and distance. No identity recognition"
            case .find, .stopFind: return "Teach the app your own items, or find nearby chairs, bottles and more"
            case .bus: return "Spot an arriving bus or tram and read its route number and destination"
            }
        }
    }

    static func uiWhatsAheadSubtitle(_ l: Language) -> String {
        l == .zh ? "汇总播报识别到的物体" : "Summarize detected objects"
    }
    static func uiTorch(on: Bool, _ l: Language) -> String {
        switch l {
        case .zh: return on ? "关闭手电筒" : "打开手电筒"
        case .en: return on ? "Turn off flashlight" : "Turn on flashlight"
        }
    }
    /// 太暗→自动点亮手电筒后的播报：告诉盲人已用手电筒解决"太暗"（而非只说太暗后卡住），并提示重新对准。
    static func torchAutoOn(_ l: Language) -> String {
        l == .zh ? "光线太暗，已为你打开手电筒，请重新对准再试。"
                 : "Too dark — I turned on the flashlight. Point at it again."
    }
    static func uiDone(_ l: Language) -> String { l == .zh ? "完成" : "Done" }
    static func uiCopy(_ l: Language) -> String { l == .zh ? "复制内容" : "Copy" }
    static func uiCopyHint(_ l: Language) -> String {
        l == .zh ? "把识别到的文字或码内容复制到剪贴板" : "Copy the recognized text or code to the clipboard"
    }
    static func uiDial(_ l: Language) -> String { l == .zh ? "拨打" : "Call" }
    static func uiOpenLink(_ l: Language) -> String { l == .zh ? "打开链接" : "Open link" }
    static func uiSendEmail(_ l: Language) -> String { l == .zh ? "发邮件" : "Email" }
    static func uiSendSms(_ l: Language) -> String { l == .zh ? "发短信" : "Text" }
    /// 一键动作通用提示：打开系统应用并预填，绝不代执行——先核对内容。
    static func uiActionHint(_ l: Language) -> String {
        l == .zh ? "用系统对应的应用打开并预填（拨号盘／浏览器／邮件／信息）——内容可能识别有误或来源不明，请先核对再操作"
                 : "Opens the matching system app prefilled (dialer/browser/mail/messages) — the content may be misread or untrusted, so verify before acting"
    }
    static func uiCancel(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }
    static func uiSave(_ l: Language) -> String { l == .zh ? "保存" : "Save" }

    // 找东西对话框
    static func uiFindMenuTitle(_ l: Language) -> String { l == .zh ? "找东西" : "Find things" }
    static func uiFindItem(_ name: String, _ l: Language) -> String { l == .zh ? "找：\(name)" : "Find: \(name)" }
    static func uiFindNearby(_ name: String, _ l: Language) -> String {
        l == .zh ? "找周围的\(name)" : "Find nearby \(name)"
    }
    static func uiTeachNew(_ l: Language) -> String { l == .zh ? "教我认一个新东西" : "Teach me a new item" }
    static func uiFindMenuMessage(_ l: Language) -> String {
        l == .zh ? "个人物品先「教我认一个新东西」拍三张；椅子、瓶子这类通用物品不用教，直接找。"
                 : "For your own items, use \"Teach me a new item\" first; common items like chairs and bottles need no teaching."
    }

    // 教学命名弹窗
    static func uiTeachNameTitle(_ l: Language) -> String { l == .zh ? "给它起个名字" : "Name it" }
    static func uiTeachNamePlaceholder(_ l: Language) -> String { l == .zh ? "如：家门钥匙" : "e.g. house keys" }
    static func uiTeachNameMessage(_ l: Language) -> String {
        l == .zh ? "可以点键盘上的话筒用语音说出名字。" : "You can dictate the name with the keyboard microphone."
    }

    // 商品命名弹窗
    static func uiProductNameTitle(_ l: Language) -> String { l == .zh ? "给这个商品起个名字" : "Name this product" }
    static func uiProductNamePlaceholder(_ l: Language) -> String { l == .zh ? "如：牛奶、感冒药" : "e.g. milk, cold medicine" }
    static func uiProductNameMessage(_ l: Language) -> String {
        l == .zh ? "下次扫到同一条码会直接报这个名字。可以点键盘上的话筒用语音输入。"
                 : "Next scan of this barcode will say this name. You can dictate with the keyboard microphone."
    }

    // 识别历史（Supersense Read History 式）
    static func uiHistory(_ l: Language) -> String { l == .zh ? "识别历史" : "History" }
    static func uiHistoryHint(_ l: Language) -> String {
        l == .zh ? "回放、复制或删除你读过的文字、整页、码和纸币" : "Replay, copy or delete what you've read"
    }
    static func historyEmpty(_ l: Language) -> String {
        l == .zh ? "还没有识别记录。朗读文字、读整页、扫码、识别纸币的结果会自动存在这里（只存在本机）。"
                 : "No history yet. Text, pages, codes and banknotes you read are saved here (on this device only)."
    }
    static func historyNoMatch(_ l: Language) -> String {
        l == .zh ? "没有匹配的记录，换个关键词试试。" : "No matching records — try another keyword."
    }
    static func historySearchPrompt(_ l: Language) -> String {
        l == .zh ? "搜索识别记录" : "Search recognized content"
    }
    static func historyKind(_ kind: String, _ l: Language) -> String {
        switch l {
        case .zh:
            switch kind {
            case "page": return "整页"
            case "barcode": return "扫码"
            case "banknote": return "纸币"
            case "dates": return "日期"
            case "phone": return "电话"
            case "email": return "邮箱"
            default: return "文字"
            }
        case .en:
            switch kind {
            case "page": return "Page"
            case "barcode": return "Code"
            case "banknote": return "Banknote"
            case "dates": return "Date"
            case "phone": return "Phone"
            case "email": return "Email"
            default: return "Text"
            }
        }
    }
    static func uiClearAll(_ l: Language) -> String { l == .zh ? "清空" : "Clear All" }
    static func uiDelete(_ l: Language) -> String { l == .zh ? "删除" : "Delete" }
    static func uiHistoryRowHint(_ l: Language) -> String {
        l == .zh ? "点按朗读这条记录" : "Tap to read this entry aloud"
    }

    // 触摸探索画布
    static func uiExploreCanvasLabel(_ l: Language) -> String {
        l == .zh ? "触摸探索画布。手指在屏幕上滑动，碰到物体或文字会朗读。"
                 : "Touch-explore canvas. Slide your finger to hear the objects and text you touch."
    }
}
