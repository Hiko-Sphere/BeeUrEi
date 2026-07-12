import Foundation

struct AMapWalkStep: Decodable {
    let instruction: String
    // 可选：后端某步距离若为非数（NaN→JSON null）也不致整条路线解码失败、丢失整条路线（见审查 #8）。
    let distanceMeters: Double?
    /// 该步折线坐标（GCJ-02，[lat, lon] 对）。首点即该步转向点，供实时逐向引导/偏航检测。
    /// 可选：旧后端无此字段时仍可解码（退化为静态步骤列表）。
    let polyline: [[Double]]?
}

/// 国内路线：目的地坐标（GCJ-02）+ 各步（含折线），供实时逐向引导。
struct AMapWalkRoute: Decodable {
    let destinationLat: Double?
    let destinationLon: Double?
    let steps: [AMapWalkStep]
    /// 高德权威全程里程/时长（服务端 /api/nav/walking 一直在返，此前被 Codable 静默丢弃）：
    /// 里程按真实道路算（含折线采样点之间的路程）、时长按高德步行模型——比本地"转向点连线累距+
    /// 默认步速"更准。可选：旧后端无此字段仍可解码。
    let distanceMeters: Double?
    let durationSeconds: Double?
}

/// 国内步行路线客户端：调用自托管后端 `/api/nav/walking`（后端持高德 key，App 不接触 key）。
struct AMapRouteClient {
    /// destination=名字（服务端 geocode）；或 destGcj=(lat,lon) **已知 GCJ-02 坐标**（聊天分享位置精确导航，
    /// 服务端跳过 geocode 直接路由，绝不再搜名字命中别处，见复审#8/#9）。二者传其一。
    func walking(originLat: Double, originLon: Double,
                 destination: String, destGcj: (lat: Double, lon: Double)? = nil) async throws -> AMapWalkRoute {
        guard let token = KeychainStore.read() else { throw APIError.server("请先登录") }
        guard var comps = URLComponents(url: ServerConfig.baseURL.appendingPathComponent("api/nav/walking"),
                                        resolvingAgainstBaseURL: false) else { throw APIError.network }
        // 显式百分号编码：URLComponents 不编码 '+'，而服务端会把查询里的 '+' 解成空格，
        // 使含 '+' 的目的地(如"A+B大厦")被破坏 → 这里把 '+' 等也编码掉（见审查 #9）。
        let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+&=?#"))
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
        var items = [
            URLQueryItem(name: "originLat", value: enc(String(originLat))),
            URLQueryItem(name: "originLon", value: enc(String(originLon))),
            URLQueryItem(name: "destination", value: enc(destination)),
        ]
        if let g = destGcj {
            items.append(URLQueryItem(name: "destLat", value: enc(String(g.lat))))
            items.append(URLQueryItem(name: "destLon", value: enc(String(g.lon))))
        }
        comps.percentEncodedQueryItems = items
        guard let url = comps.url else { throw APIError.network }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode < 400 else {
            // 透传后端错误码（destination_not_found / amap_error / amap_not_configured / nav_unavailable），
            // 供上层区分"找不到目的地"与"导航服务配置/不可用"，给盲人正确的失败原因（而非一律"路线获取失败"）。
            struct ErrBody: Decodable { let error: String? }
            let code = (try? JSONDecoder().decode(ErrBody.self, from: data))?.error ?? "nav_unavailable"
            throw APIError.server(code)
        }
        return try JSONDecoder().decode(AMapWalkRoute.self, from: data)
    }
}
