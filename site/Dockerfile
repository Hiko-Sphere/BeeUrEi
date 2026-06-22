# BeeUrEi 官网 + 协助者/亲友网页端镜像。
# 阶段一：构建 React/Vite 单页应用（协助者端，base = /app/）。
# 阶段二：nginx 直出官网静态内容，并把构建产物挂到 /app。

# —— 阶段一：构建协助者网页端 ——
FROM node:22-alpine AS app
WORKDIR /app-src
# 先装依赖（利用层缓存：仅 lockfile 变化才重装）。
COPY app-src/package.json app-src/package-lock.json ./
RUN npm ci
# 源码 + 构建（tsc -b && vite build → dist/，base=/app/）。
COPY app-src/ ./
RUN npm run build

# —— 阶段二：nginx 静态镜像 ——
FROM nginx:1.27-alpine

# 站点配置 + 安全头片段（含官网严格头 security-headers + /app 放宽头 app-headers）。
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY snippets/ /etc/nginx/snippets/

# 官网静态内容
COPY public/ /usr/share/nginx/html/

# 协助者网页端构建产物 → /app（与 nginx 的 /app location 对应）。
COPY --from=app /app-src/dist/ /usr/share/nginx/html/app/

EXPOSE 80

# 镜像内健康检查（与 nginx /healthz 一致）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
