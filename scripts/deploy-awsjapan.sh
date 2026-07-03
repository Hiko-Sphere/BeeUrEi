#!/usr/bin/env bash
# BeeUrEi 一键部署到 awsjapan（EC2，东京）。在本地跑，经 ssh 驱动远端。
#
# 用法：
#   scripts/deploy-awsjapan.sh          # 部署 api + site（默认）
#   scripts/deploy-awsjapan.sh api      # 只部署后端（server/ → beeurei-api）
#   scripts/deploy-awsjapan.sh site     # 只部署官网+协助者网页端（site/ → beeurei-site）
#
# 前提：本机能 `ssh awsjapan`（~/.ssh/config 已配 alias；出口 22 口未被墙）。
# 远端命令统一 base64 编码后作参数传递——经验教训：抖动连接下 stdin 喂脚本会被截断。
set -euo pipefail

# 默认走 Cloudflare Tunnel 通路（awsjapan-cf，IP 无关、任何网络可用）；DEPLOY_HOST=awsjapan 可切回直连。
HOST="${DEPLOY_HOST:-awsjapan-cf}"
COMPONENT="${1:-all}"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

# 把一段脚本 base64 后送到远端执行（解码发生在远端，不走 stdin 传输）。
remote() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh -o ConnectTimeout=10 "$HOST" "echo $b64 | base64 -d | bash"
}

say "预检：SSH 连通性 + 远端仓库同步"
ssh -o ConnectTimeout=8 -o BatchMode=yes "$HOST" true 2>/dev/null \
  || die "ssh $HOST 不可达（本网络 22 口可能被墙——换网络或热点再试）"

SHA=$(remote 'cd ~/repo/BeeUrEi && git fetch origin main -q && git rev-parse --short origin/main')
remote 'cd ~/repo/BeeUrEi && git pull --ff-only origin main -q && echo "远端已同步到 $(git rev-parse --short HEAD)"'

deploy_api() {
  say "构建 beeurei-api:$SHA（npm ci 锁定版本）"
  remote "cd ~/repo/BeeUrEi && docker build -q --build-arg GIT_SHA=$SHA -t beeurei-api:$SHA -t beeurei-api:latest server/"

  say "重建容器 beeurei-api"
  # 改过 .env 也生效：docker restart 不重读 env-file，必须 stop/rm/run 重建。
  remote 'docker stop beeurei-api >/dev/null 2>&1 || true; docker rm beeurei-api >/dev/null 2>&1 || true
docker run -d --name beeurei-api --restart unless-stopped \
  -p 127.0.0.1:8787:8787 --env-file ~/repo/BeeUrEi/server/.env \
  -v beeurei-data:/app/data beeurei-api:latest >/dev/null && echo 容器已启动'

  say "健康检查：/api/ready（最多等 30s）"
  remote 'for i in $(seq 1 30); do
  out=$(curl -sf -m 2 http://127.0.0.1:8787/api/ready 2>/dev/null) && { echo "ready: $out"; exit 0; }
  sleep 1
done
echo "!! /api/ready 30s 未就绪，最近日志："; docker logs --tail 30 beeurei-api; exit 1'

  say "SMTP 自检（线上凭据是否仍好）"
  remote 'sleep 2; docker logs beeurei-api 2>&1 | grep -m1 "\[mail\]" || echo "（暂无 [mail] 日志行）"'
}

deploy_site() {
  say "构建 beeurei-site:$SHA（官网 + /app 协助者端 vite build）"
  remote "cd ~/repo/BeeUrEi && docker build -q -t beeurei-site:$SHA -t beeurei-site:latest site/"

  say "重建容器 beeurei-site"
  remote 'docker rm -f beeurei-site >/dev/null 2>&1 || true
docker run -d --name beeurei-site --restart unless-stopped \
  -p 127.0.0.1:8088:80 beeurei-site:latest >/dev/null && echo 容器已启动'

  say "健康检查：/healthz + /app/"
  remote 'for i in $(seq 1 15); do
  curl -sf -m 2 -o /dev/null http://127.0.0.1:8088/healthz && { echo healthz OK; break; }
  sleep 1
done
curl -sf -m 3 -o /dev/null http://127.0.0.1:8088/app/ && echo "/app/ OK" || { echo "!! /app/ 不可用"; exit 1; }'
}

case "$COMPONENT" in
  api)  deploy_api ;;
  site) deploy_site ;;
  all)  deploy_api; deploy_site ;;
  *)    die "未知组件：$COMPONENT（可选 api|site|all）" ;;
esac

say "公网验证（经 Cloudflare 隧道）"
curl -sf -m 10 https://beeurei-api.hikosphere.com/api/ready && echo " ← api" || echo "!! 公网 api 探测失败"
curl -sf -m 10 -o /dev/null -w '%{http_code} ← site\n' https://beeurei.hikosphere.com/ || true
curl -sf -m 10 -o /dev/null -w '%{http_code} ← app\n' https://beeurei.hikosphere.com/app/ || true

say "完成：origin/main $SHA 已部署（镜像同时打了 :$SHA 标签，回滚用 docker run …:$SHA）"
echo "提示：本次 api 部署首次启用每小时孤儿媒体清扫（sweepOrphanMedia，删除 ≥7 天未被任何消息/录制引用的媒体文件）。"
