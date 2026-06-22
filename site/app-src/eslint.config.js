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
])
