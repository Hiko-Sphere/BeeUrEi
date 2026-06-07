import Foundation

struct AMapWalkStep: Decodable {
    let instruction: String
    let distanceMeters: Double
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
        comps.queryItems = [
            URLQueryItem(name: "originLat", value: String(originLat)),
            URLQueryItem(name: "originLon", value: String(originLon)),
            URLQueryItem(name: "destination", value: destination),
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
