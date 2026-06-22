import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 协助者 / 亲友 Web 端。生产部署于 beeurei.hikosphere.com/app（官网容器），
// 跨源调用 beeurei-api.hikosphere.com 的 REST + /ws（API 已放行该来源的 CORS）。
// 本地开发：把 /api 与 /ws 代理到本地后端，免 CORS。
export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
