# BeeUrEi 后端容器（自托管）。Node 22 + tsx + node:sqlite。
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

ENV PORT=8787
ENV DB_PATH=/app/data/beeurei.db
EXPOSE 8787

# npm start 已带 NODE_OPTIONS=--experimental-sqlite（启用 node:sqlite）。
CMD ["npm", "start"]
