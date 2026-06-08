import Foundation

struct AMapWalkStep: Decodable {
    let instruction: String
    // 可选：后端某步距离若为非数（NaN→JSON null）也不致整条路线解码失败、丢失整条路线（见审查 #8）。
    let distanceMeters: Double?
}

private struct AMapWalkResponse: Decodable {
    let destination: String
    let steps: [AMapWalkStep]
}

/// 国内步行路线客户端：调用自托管后端 `/api/nav/walking`（后端持高德 key，App 不接触 key）。
struct AMapRouteClient {
    func walking(originLat: Double, originLon: Double, destination: String) async throws -> [AMapWalkStep] {
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
            throw APIError.server("路线获取失败")
        }
        return try JSONDecoder().decode(AMapWalkResponse.self, from: data).steps
    }
}
