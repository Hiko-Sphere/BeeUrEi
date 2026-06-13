# BeeUrEi 官网静态镜像。零运行时依赖，nginx 直出。
FROM nginx:1.27-alpine

# 站点配置 + 安全头片段
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY snippets/security-headers.conf /etc/nginx/snippets/security-headers.conf

# 站点内容
COPY public/ /usr/share/nginx/html/

EXPOSE 80

# 镜像内健康检查（与 nginx /healthz 一致）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
