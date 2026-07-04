import Foundation

/// 一个周边地点（GCJ-02 坐标 + 高德算好的直线距离米 + 分类）。
struct AMapAroundPoi: Decodable {
    let name: String
    let lat: Double
    let lon: Double
    let distanceMeters: Double
    let category: String?
}

struct AMapAroundResponse: Decodable {
    let radius: Int
    let pois: [AMapAroundPoi]
}

/// 「周围有什么」国内数据源：调用自托管后端 `/api/nav/around`（后端持高德 key）。
/// 传入 **GCJ-02** 经纬度（与步行导航同约定——App 已把用户 WGS-84 位置转 GCJ-02 再传）。
struct AMapAroundClient {
    /// keywords 非空时定向检索（"最近的X"用），空则周边全类型（"周围有什么"用）。
    func around(latGcj: Double, lonGcj: Double, radiusMeters: Int, keywords: String? = nil) async throws -> AMapAroundResponse {
        guard let token = KeychainStore.read() else { throw APIError.server("请先登录") }
        guard var comps = URLComponents(url: ServerConfig.baseURL.appendingPathComponent("api/nav/around"),
                                        resolvingAgainstBaseURL: false) else { throw APIError.network }
        var items = [
            URLQueryItem(name: "lat", value: String(latGcj)),
            URLQueryItem(name: "lon", value: String(lonGcj)),
            URLQueryItem(name: "radius", value: String(radiusMeters)),
        ]
        if let kw = keywords?.trimmingCharacters(in: .whitespacesAndNewlines), !kw.isEmpty {
            items.append(URLQueryItem(name: "keywords", value: kw))
        }
        comps.queryItems = items
        guard let url = comps.url else { throw APIError.network }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode < 400 else {
            // 透传后端错误码（amap_error / amap_not_configured / nav_unavailable），供上层决定回退 Apple Maps POI。
            struct ErrBody: Decodable { let error: String? }
            let code = (try? JSONDecoder().decode(ErrBody.self, from: data))?.error ?? "nav_unavailable"
            throw APIError.server(code)
        }
        return try JSONDecoder().decode(AMapAroundResponse.self, from: data)
    }
}
