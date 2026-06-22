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
}

/// 国内步行路线客户端：调用自托管后端 `/api/nav/walking`（后端持高德 key，App 不接触 key）。
struct AMapRouteClient {
    func walking(originLat: Double, originLon: Double, destination: String) async throws -> AMapWalkRoute {
        guard let token = KeychainStore.read() else { throw APIError.server("请先登录") }
        guard var comps = URLComponents(url: ServerConfig.baseURL.appendingPathComponent("api/nav/walking"),
                                        resolvingAgainstBaseURL: false) else { throw APIError.network }
        // 显式百分号编码：URLComponents 不编码 '+'，而服务端会把查询里的 '+' 解成空格，
        // 使含 '+' 的目的地(如"A+B大厦")被破坏 → 这里把 '+' 等也编码掉（见审查 #9）。
        let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+&=?#"))
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
        comps.percentEncodedQueryItems = [
            URLQueryItem(name: "originLat", value: enc(String(originLat))),
            URLQueryItem(name: "originLon", value: enc(String(originLon))),
            URLQueryItem(name: "destination", value: enc(destination)),
        ]
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
