#!/usr/bin/env bash
# shellcheck disable=SC2016  # remote('…') 的单引号是有意的：$(…) 必须原样送到远端展开（base64 隧道），本地展开是 bug。
# BeeUrEi 一键部署到 vultr_tokyo（新服务器，取代 aws）。在本地跑，经 ssh 驱动远端。
#
# 与 deploy-awsjapan.sh 的关键区别：**用 rsync 从本地推代码**，不在远端 git pull。
# 原因：vultr 上 origin 是私有仓 git@github.com，远端无 GitHub 部署密钥（Host key verification failed）；
# 本机才有仓库与 GitHub 访问权，故本机 rsync 到 vultr 再远端构建，最稳、无需在 vultr 上管密钥。
#
# 用法：
#   scripts/deploy-vultr.sh                 # 部署 api + site（默认）
#   scripts/deploy-vultr.sh api             # 只部署后端（server/ → beeurei-api）
#   scripts/deploy-vultr.sh site            # 只部署官网+协助者网页端（site/ → beeurei-site）
#   scripts/deploy-vultr.sh clean           # 只做镜像轮换清理
#   scripts/deploy-vultr.sh rollback <sha> [api|site|all]   # 回滚到已存在的 :<sha> 镜像（默认 api）
#
# 前提：本机能 `ssh vultr_tokyo`（密钥直连，User root，仓库在 /root/repo/BeeUrEi）。
set -euo pipefail

HOST="${DEPLOY_HOST:-vultr_tokyo}"
REMOTE_DIR="/root/repo/BeeUrEi"
COMPONENT="${1:-all}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

# 把一段脚本 base64 后送到远端执行（解码在远端，不走 stdin，抗抖动截断）。
remote() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh -o ConnectTimeout=12 "$HOST" "echo $b64 | base64 -d | bash"
}

# 从本地把 server/ 或 site/ 推到远端。**保护远端生产 .env 与 data 卷、node_modules**（排除即不传也不删）。
push_dir() { # $1=子目录（server|site）
  say "rsync 本地 $1/ → $HOST:$REMOTE_DIR/$1/（保留远端 .env/data/node_modules）"
  rsync -az --delete \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude 'app-src/node_modules/' \
    --exclude 'dist/' \
    --exclude 'coverage/' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude '*.bak' \
    --exclude 'data/' \
    -e 'ssh -o ConnectTimeout=12' \
    "$REPO_ROOT/$1/" "$HOST:$REMOTE_DIR/$1/" \
    || die "rsync $1/ 失败"
}

say "预检：SSH 连通性 + 本地版本"
ssh -o ConnectTimeout=10 -o BatchMode=yes "$HOST" true 2>/dev/null \
  || die "ssh $HOST 不可达"
# SHA 取**本地** git HEAD（远端不 git pull，故不能问远端）——作为镜像 GIT_SHA 注入，/api/version 据此报版本。
SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD)
DIRTY=$(git -C "$REPO_ROOT" status --porcelain -- server site 2>/dev/null | head -1)
[ -z "$DIRTY" ] || printf '\033[1;33m注意：server/ 或 site/ 有未提交改动，将按工作区当前内容部署（非纯 HEAD）。\033[0m\n'
say "本地 HEAD：$SHA"

# —— 容器启动/健康检查（deploy 与 rollback 共用；tag 唯一变量）——
start_api_container() { # $1=镜像 tag
  remote 'docker stop beeurei-api >/dev/null 2>&1 || true; docker rm beeurei-api >/dev/null 2>&1 || true
docker run -d --name beeurei-api --restart unless-stopped \
  --log-driver json-file --log-opt max-size=20m --log-opt max-file=5 \
  -p 127.0.0.1:8787:8787 --env-file '"$REMOTE_DIR"'/server/.env \
  -v beeurei-data:/app/data beeurei-api:'"$1"' >/dev/null && echo 容器已启动'

  say "健康检查：/api/ready（最多等 30s）"
  remote 'for i in $(seq 1 30); do
  out=$(curl -sf -m 2 http://127.0.0.1:8787/api/ready 2>/dev/null) && { echo "ready: $out"; exit 0; }
  sleep 1
done
echo "!! /api/ready 30s 未就绪，最近日志："; docker logs --tail 30 beeurei-api; exit 1'
}

start_site_container() { # $1=镜像 tag
  remote 'docker rm -f beeurei-site >/dev/null 2>&1 || true
docker run -d --name beeurei-site --restart unless-stopped \
  --log-driver json-file --log-opt max-size=20m --log-opt max-file=5 \
  -p 127.0.0.1:8088:80 beeurei-site:'"$1"' >/dev/null && echo 容器已启动'

  say "健康检查：/healthz + /app/"
  remote 'for i in $(seq 1 15); do
  curl -sf -m 2 -o /dev/null http://127.0.0.1:8088/healthz && { echo healthz OK; break; }
  sleep 1
done
curl -sf -m 3 -o /dev/null http://127.0.0.1:8088/app/ && echo "/app/ OK" || { echo "!! /app/ 不可用"; exit 1; }'
}

deploy_api() {
  push_dir server
  say "构建 beeurei-api:$SHA（远端 docker build，npm ci 锁版本）"
  remote "cd $REMOTE_DIR && docker build -q --build-arg GIT_SHA=$SHA -t beeurei-api:$SHA -t beeurei-api:latest server/"
  say "重建容器 beeurei-api"
  start_api_container latest
  remote 'sleep 2; docker logs beeurei-api 2>&1 | grep -m1 "\[mail\]" || echo "（暂无 [mail] 日志行）"'
}

deploy_site() {
  push_dir site
  say "构建 beeurei-site:$SHA（官网 + /app 协助者端 vite build）"
  remote "cd $REMOTE_DIR && docker build -q -t beeurei-site:$SHA -t beeurei-site:latest site/"
  say "重建容器 beeurei-site"
  start_site_container latest
}

rollback_one() { # $1=repo(beeurei-api|beeurei-site) $2=sha
  say "回滚 $1 → :$2"
  remote 'docker image inspect '"$1:$2"' >/dev/null 2>&1 || { echo "!! 镜像 '"$1:$2"' 不存在。可用 SHA："; docker images --format "{{.Tag}}" '"$1"' | grep -vE "^(latest|<none>)$" | head -6; exit 1; }
docker tag '"$1:$2"' '"$1"':latest && echo "latest 已重打到 '"$2"'"'
  case "$1" in
    beeurei-api)  start_api_container "$2" ;;
    beeurei-site) start_site_container "$2" ;;
  esac
}

cleanup_images() {
  say "镜像轮换（各保留最近 5 个 SHA 供回滚）+ 清悬空层/构建缓存（绝不 system prune，本机有他项目）"
  remote 'for repo in beeurei-api beeurei-site; do
  docker images --format "{{.Tag}}" "$repo" | grep -vE "^(latest|<none>)$" | tail -n +6 \
    | while read -r t; do docker rmi "$repo:$t" >/dev/null 2>&1 || true; done
done
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f >/dev/null 2>&1 || true
echo "清理后磁盘："; df -h / | tail -1'
}

# 本地直连 vultr 验证（不经公网隧道——beeurei.hikosphere.com 可能仍指向 aws，验证会打错后端）。
verify_local() {
  say "vultr 本地验证（127.0.0.1，绕开公网隧道）"
  remote 'curl -sf -m 6 http://127.0.0.1:8787/api/version && echo " ← vultr api 实际版本"
curl -sf -m 6 -o /dev/null -w "%{http_code} ← vultr site\n" http://127.0.0.1:8088/ || true
curl -sf -m 6 -o /dev/null -w "%{http_code} ← vultr app\n" http://127.0.0.1:8088/app/ || true'
}

case "$COMPONENT" in
  api)  deploy_api; cleanup_images ;;
  site) deploy_site; cleanup_images ;;
  all)  deploy_api; deploy_site; cleanup_images ;;
  clean) cleanup_images; exit 0 ;;
  rollback)
    RB_SHA="${2:-}"; RB_COMP="${3:-api}"
    [ -n "$RB_SHA" ] || die "用法：deploy-vultr.sh rollback <sha> [api|site|all]"
    case "$RB_COMP" in
      api)  rollback_one beeurei-api "$RB_SHA" ;;
      site) rollback_one beeurei-site "$RB_SHA" ;;
      all)  rollback_one beeurei-api "$RB_SHA"; rollback_one beeurei-site "$RB_SHA" ;;
      *)    die "未知组件：$RB_COMP（可选 api|site|all）" ;;
    esac
    verify_local
    say "回滚完成：$RB_COMP → :$RB_SHA"
    exit 0
    ;;
  *)    die "未知组件：$COMPONENT（可选 api|site|all|clean|rollback）" ;;
esac

verify_local

say "完成：本地 $SHA 已部署到 vultr（镜像同时打了 :$SHA 标签，回滚用 scripts/deploy-vultr.sh rollback $SHA）"
