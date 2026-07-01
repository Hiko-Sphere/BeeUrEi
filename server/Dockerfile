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

# npm start 已带 NODE_OPTIONS=--experimental-sqlite（启用 node:sqlite）。
CMD ["npm", "start"]
