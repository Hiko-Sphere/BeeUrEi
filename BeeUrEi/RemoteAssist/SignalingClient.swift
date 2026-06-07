import Foundation

/// 连接自托管后端 /ws 的 WebRTC 信令客户端（URLSessionWebSocketTask）。
/// 负责 join / offer / answer / ice / video-gate / end 的收发；媒体本身由 MediaEngine 负责。
final class SignalingClient {
    private var task: URLSessionWebSocketTask?

    /// 收到信令消息（已切回主线程）。
    var onMessage: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?

    func connect(token: String, baseURL: URL) {
        guard var comps = URLComponents(url: baseURL.appendingPathComponent("ws"), resolvingAgainstBaseURL: false) else { return }
        comps.scheme = (baseURL.scheme == "https") ? "wss" : "ws"
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = comps.url else { return }
        let task = URLSession.shared.webSocketTask(with: url)
        self.task = task
        task.resume()
        receive()
    }

    func join(callId: String, role: String) { send(["type": "join", "callId": callId, "role": role]) }
    func videoGate(on: Bool) { send(["type": "video-gate", "on": on]) }
    func end() { send(["type": "end"]) }

    func send(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { _ in }
    }

    func close() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                DispatchQueue.main.async { self.onClose?() }
            case .success(let message):
                if case .string(let text) = message,
                   let data = text.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    DispatchQueue.main.async { self.onMessage?(obj) }
                }
                self.receive()
            }
        }
    }
}
