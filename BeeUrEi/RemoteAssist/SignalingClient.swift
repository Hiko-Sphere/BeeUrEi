import Foundation

/// 连接自托管后端 /ws 的 WebRTC 信令客户端（URLSessionWebSocketTask）。
/// 负责 join / offer / answer / ice / video-gate / end 的收发；媒体本身由 MediaEngine 负责。
///
/// 线程安全：`task` 会被多个线程访问——send 来自 WebRTC 信令线程（onLocalCandidate/Description）、
/// close 来自主线程(hangUp)、receive 完成在 URLSession 内部队列。统一用一个串行队列串行化所有
/// 对 `task` 的读写，避免数据竞争/use-after-free（见审查 #6）。回调仍切回主线程。
final class SignalingClient {
    private var task: URLSessionWebSocketTask?
    private let queue = DispatchQueue(label: "com.beeurei.signaling")

    /// 收到信令消息（已切回主线程）。
    var onMessage: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?

    func connect(token: String, baseURL: URL) {
        guard var comps = URLComponents(url: baseURL.appendingPathComponent("ws"), resolvingAgainstBaseURL: false) else { return }
        comps.scheme = (baseURL.scheme == "https") ? "wss" : "ws"
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = comps.url else { return }
        queue.async {
            let task = URLSession.shared.webSocketTask(with: url)
            self.task = task
            task.resume()
            self.receiveLocked()
        }
    }

    func join(callId: String, role: String) { send(["type": "join", "callId": callId, "role": role]) }
    func videoGate(on: Bool) { send(["type": "video-gate", "on": on]) }
    func end() { send(["type": "end"]) }

    func send(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let text = String(data: data, encoding: .utf8) else { return }
        queue.async { self.task?.send(.string(text)) { _ in } }
    }

    func close() {
        queue.async {
            self.task?.cancel(with: .goingAway, reason: nil)
            self.task = nil
        }
    }

    /// 必须在 `queue` 上调用：读取/重新挂载 receive。
    private func receiveLocked() {
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
                self.queue.async { self.receiveLocked() } // 在串行队列上重新挂载，安全读 task
            }
        }
    }
}
