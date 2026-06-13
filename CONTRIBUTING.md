# Contributing to BeeUrEi / 参与贡献

Thank you for your interest in BeeUrEi. Noncommercial contributions are welcome.

## Before you open a pull request

1. **Run the tests** and make sure everything is green:

   ```bash
   swift test --package-path Packages/BeeUrEiCore   # core safety logic
   xcodebuild test -scheme BeeUrEi                   # app-layer regression (simulator)
   cd server && npm test                             # backend
   ```

2. **Follow the existing style and structure.** Keep safety logic in
   `Packages/BeeUrEiCore` and cover it with tests. Keep I/O behind the
   protocol-driven ports so it stays injectable and testable.

3. **Submit under the project's license** — PolyForm Noncommercial 1.0.0. By
   contributing, you agree your contribution is provided under that license.

## Safety-critical changes

For anything touching the safety-critical subsystems — **obstacle avoidance,
navigation gating, or call privacy** — please include a regression test. These
subsystems each have a dedicated regression net, and changes are reviewed with
extra care because real users rely on them to travel.

## A note on scope

BeeUrEi is an assistive tool, not a safety device. It does not replace the white
cane, a guide dog, or Orientation & Mobility (O&M) training. Contributions should
preserve the conservative, fail-safe behavior the project is built around.

---

## 参与贡献

感谢你对 BeeUrEi 的关注。欢迎非商业贡献。

## 提交 Pull Request 前

1. **跑通测试**，确保全绿：

   ```bash
   swift test --package-path Packages/BeeUrEiCore   # 核心安全逻辑
   xcodebuild test -scheme BeeUrEi                   # 应用层回归（模拟器）
   cd server && npm test                             # 后端
   ```

2. **遵循现有风格与结构。** 把安全逻辑放在 `Packages/BeeUrEiCore` 并配测试；
   把 I/O 放在协议驱动的端口之后，保持可注入、可测试。

3. **在本项目许可下提交**——PolyForm Noncommercial 1.0.0。提交即表示你同意你的
   贡献以该许可提供。

## 安全攸关改动

凡涉及安全攸关子系统——**避障、导航门控、通话隐私**——请附带回归测试。这些子系统各有
专门的回归网，改动会被更谨慎地审查，因为真实用户依赖它们出行。

## 关于范围

BeeUrEi 是辅助工具，不是安全设备。它不能替代白手杖、导盲犬或定向行走（O&M）训练。
贡献应保持本项目所秉持的保守、失败安全（fail-safe）行为。
