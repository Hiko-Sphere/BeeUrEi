# BeeUrEi 后端容器（自托管）。Node 22 + tsx + node:sqlite。
FROM node:22-alpine
WORKDIR /app

# 用 npm ci（而非 npm install）：严格按 package-lock.json 装**锁定版本**，与 CI(backend job 亦 npm ci)
# 一致、可复现——避免生产容器解析到 semver 范围内的更新版本、跑未经测试/未审计的依赖。npm ci 要求 lockfile 在场。
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ENV PORT=8787
ENV DB_PATH=/app/data/beeurei.db
EXPOSE 8787

# 容器健康检查：打 /api/ready（就绪探针，触达存储确认可用；见 app.ts），编排层据此判活 / 重启不健康容器。
# 与官网镜像 /healthz healthcheck 同口径（alpine 自带 busybox wget）；start-period 给足服务端启动(store 初始化)时间。
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/api/ready || exit 1

# npm start 已带 NODE_OPTIONS=--experimental-sqlite（启用 node:sqlite）。
CMD ["npm", "start"]
