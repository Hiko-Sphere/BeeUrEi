// 为组件测试注册 @testing-library/jest-dom 的 DOM 断言（toBeInTheDocument 等）。
// 在 node 环境的纯逻辑测试里只是注册扩展、不触碰 DOM，安全无副作用。
import '@testing-library/jest-dom/vitest'
