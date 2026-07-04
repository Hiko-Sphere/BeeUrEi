import Foundation

/// 公交/地铁路径规划客户端：调用自托管后端 `/api/nav/transit`（后端持高德 key，做逆地理取城市 + 公交规划）。
/// 传 **GCJ-02** 起点经纬度（与步行导航同约定）+ 目的地名字（服务端 geocode）。返回 core 的 TransitPlan（可直接朗读）。
struct AMapTransitClient {
    func transit(originLatGcj: Double, originLonGcj: Double, destination: String) async throws -> TransitPlan {
        guard let token = KeychainStore.read() else { throw APIError.server("请先登录") }
        guard var comps = URLComponents(url: ServerConfig.baseURL.appendingPathComponent("api/nav/transit"),
                                        resolvingAgainstBaseURL: false) else { throw APIError.network }
        // 与步行导航同款百分号编码：URLComponents 不编码 '+'，而服务端会把查询里的 '+' 解成空格。
        let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+&=?#"))
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
        comps.percentEncodedQueryItems = [
            URLQueryItem(name: "originLat", value: enc(String(originLatGcj))),
            URLQueryItem(name: "originLon", value: enc(String(originLonGcj))),
            URLQueryItem(name: "destination", value: enc(destination)),
        ]
        guard let url = comps.url else { throw APIError.network }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode < 400 else {
            // 透传后端错误码（no_transit_route / destination_not_found / city_unresolved / amap_error /
            // amap_not_configured / nav_unavailable），供上层给盲人准确的失败原因。
            struct ErrBody: Decodable { let error: String? }
            let code = (try? JSONDecoder().decode(ErrBody.self, from: data))?.error ?? "nav_unavailable"
            throw APIError.server(code)
        }
        return try JSONDecoder().decode(TransitPlan.self, from: data)
    }
}
