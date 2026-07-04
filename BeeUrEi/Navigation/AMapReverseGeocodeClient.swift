import Foundation

/// 「我在哪」国内数据源：调用自托管后端 `/api/nav/whereami`（后端持高德 key）。
/// 传入 **GCJ-02** 经纬度（与 around/walking 同约定——App 已把用户 WGS-84 位置转 GCJ-02 再传）。
/// 返回 core 的 `ReverseGeocode`（与服务端 JSON 契约一致，供 WhereAmIComposer 组织播报）。
struct AMapReverseGeocodeClient {
    func whereAmI(latGcj: Double, lonGcj: Double) async throws -> ReverseGeocode {
        guard let token = KeychainStore.read() else { throw APIError.server("请先登录") }
        guard var comps = URLComponents(url: ServerConfig.baseURL.appendingPathComponent("api/nav/whereami"),
                                        resolvingAgainstBaseURL: false) else { throw APIError.network }
        comps.queryItems = [
            URLQueryItem(name: "lat", value: String(latGcj)),
            URLQueryItem(name: "lon", value: String(lonGcj)),
        ]
        guard let url = comps.url else { throw APIError.network }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode < 400 else {
            // 透传后端错误码（address_not_found / amap_error / amap_not_configured / nav_unavailable），
            // 供上层决定回退 Apple CLGeocoder。
            struct ErrBody: Decodable { let error: String? }
            let code = (try? JSONDecoder().decode(ErrBody.self, from: data))?.error ?? "nav_unavailable"
            throw APIError.server(code)
        }
        return try JSONDecoder().decode(ReverseGeocode.self, from: data)
    }
}
