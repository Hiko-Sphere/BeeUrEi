import Foundation
import AuthenticationServices
import UIKit

enum PasskeyError: Error { case cancelled, failed, badOptions }

/// base64url ⇄ Data（WebAuthn 字段编码；服务端 @simplewebauthn 用 base64url）。
enum Base64URL {
    static func decode(_ s: String) -> Data? {
        var str = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let pad = str.count % 4
        if pad > 0 { str += String(repeating: "=", count: 4 - pad) }
        return Data(base64Encoded: str)
    }
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Passkey（WebAuthn）系统侧操作：用 ASAuthorizationPlatformPublicKeyCredentialProvider 创建/断言，
/// 字段 base64url 编码后回传服务器。需 Associated Domains 能力 webcredentials:<rpID> + 该域托管 AASA 文件。
final class PasskeyManager: NSObject {
    private var continuation: CheckedContinuation<[String: Any], Error>?
    private var controller: ASAuthorizationController? // 必须强引用到回调，否则提前释放

    /// 注册：用服务器创建 options 生成新 passkey，回传可提交的 response 字典。
    func register(options: [String: Any]) async throws -> [String: Any] {
        guard let rp = options["rp"] as? [String: Any], let rpId = rp["id"] as? String,
              let challengeB64 = options["challenge"] as? String, let challenge = Base64URL.decode(challengeB64),
              let userDict = options["user"] as? [String: Any], let userIdB64 = userDict["id"] as? String,
              let userId = Base64URL.decode(userIdB64), let userName = userDict["name"] as? String else {
            throw PasskeyError.badOptions
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: userName, userID: userId)
        return try await perform(request)
    }

    /// 登录：用服务器请求 options 生成断言。
    func assert(options: [String: Any]) async throws -> [String: Any] {
        guard let rpId = options["rpId"] as? String,
              let challengeB64 = options["challenge"] as? String, let challenge = Base64URL.decode(challengeB64) else {
            throw PasskeyError.badOptions
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        return try await perform(request)
    }

    private func perform(_ request: ASAuthorizationRequest) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { cont in
            self.continuation = cont
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }
}

extension PasskeyManager: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        let cont = continuation
        continuation = nil
        self.controller = nil
        if let reg = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            guard let attestation = reg.rawAttestationObject else { cont?.resume(throwing: PasskeyError.failed); return }
            cont?.resume(returning: [
                "id": Base64URL.encode(reg.credentialID),
                "rawId": Base64URL.encode(reg.credentialID),
                "type": "public-key",
                "clientExtensionResults": [String: Any](),
                "authenticatorAttachment": "platform",
                "response": [
                    "clientDataJSON": Base64URL.encode(reg.rawClientDataJSON),
                    "attestationObject": Base64URL.encode(attestation),
                ],
            ])
        } else if let asrt = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            cont?.resume(returning: [
                "id": Base64URL.encode(asrt.credentialID),
                "rawId": Base64URL.encode(asrt.credentialID),
                "type": "public-key",
                "clientExtensionResults": [String: Any](),
                "authenticatorAttachment": "platform",
                "response": [
                    "clientDataJSON": Base64URL.encode(asrt.rawClientDataJSON),
                    "authenticatorData": Base64URL.encode(asrt.rawAuthenticatorData),
                    "signature": Base64URL.encode(asrt.signature),
                    "userHandle": Base64URL.encode(asrt.userID),
                ],
            ])
        } else {
            cont?.resume(throwing: PasskeyError.failed)
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cont = continuation
        continuation = nil
        self.controller = nil
        if let e = error as? ASAuthorizationError, e.code == .canceled {
            cont?.resume(throwing: PasskeyError.cancelled)
        } else {
            cont?.resume(throwing: PasskeyError.failed)
        }
    }
}

extension PasskeyManager: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
        return window ?? ASPresentationAnchor()
    }
}
