import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // 我们刻意把 Context Provider 与其配套 hook（useI18n/useSession/useToast/useCall 等）同文件共置——
      // 这是社区惯例且利于内聚。该规则仅影响开发期 HMR 粒度，对产物/正确性无影响，故关闭。
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Service Worker（public/sw.js，不参与打包）：此前只被 files 通配 **/*.{ts,tsx} 略过=0 规则生效
    //（--print-config 验证过）——推送/离线的生命线打错标识符要到运行时才炸。no-undef 静态兜底；
    // serviceworker 全局（self/clients/registration…）；空 catch 是文内 best-effort 惯例。
    files: ['public/sw.js'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
