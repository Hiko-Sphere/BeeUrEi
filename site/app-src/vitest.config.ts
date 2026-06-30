import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 测试默认 node 环境（纯逻辑测试更快、且能验证 config 在非浏览器下的回退）；
// 组件测试用文件顶部 `// @vitest-environment jsdom` 单独切到 jsdom。
// 不引 tailwindcss 插件——测试不需要处理 CSS。
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./src/test-setup.ts'],
  },
})
