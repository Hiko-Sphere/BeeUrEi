import SwiftUI
import ARKit

/// 用 ARSCNView 渲染给定 ARSession 的相机画面，桥接进 SwiftUI。
/// 预览对视障用户无意义（会被 `accessibilityHidden`），主要给明眼开发者/协助者看。
struct ARSessionPreviewView: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = session
        view.automaticallyUpdatesLighting = true
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        uiView.session = session
    }
}
