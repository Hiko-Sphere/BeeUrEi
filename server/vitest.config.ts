import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts 是进程引导（loadEnvFile/listen），无业务逻辑、需真实进程才能跑，排除出覆盖率统计。
      exclude: ['src/index.ts'],
    },
  },
})
