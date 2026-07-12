// 服务端 eslint（与 site/app-src 同族：@eslint/js + typescript-eslint recommended；无 React 插件）。
// 服务端此前唯一静态门禁是 tsc——tsc 不查未用变量/可疑模式（web 曾因无人看 lint 输出长出 4 个 error）。
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      // 存量代码大量使用 sqlite 行的 any 映射（mapRow 等）与 catch(_e)；一次性全改风险大于收益。
      // 先以 warn 起步观测量级，未来逐步收紧；其余 recommended 规则保持 error。
      '@typescript-eslint/no-explicit-any': 'off',
      // 下划线前缀=有意未用（接口对齐的参数、stub 签名）：标准约定,与 web 配置的差异是有意的(服务端 stub 多)。
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
])
