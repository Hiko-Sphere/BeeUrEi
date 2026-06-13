#!/usr/bin/env bash
# 一键换入真机实拍截图 → 压图 → 解开对应特性行注释 → 提交 → 部署官网。
# 用法：把截图按 home/look/navigation/messages(或 group) 命名放进 incoming-screenshots/，
#       然后在仓库根运行：  bash incoming-screenshots/apply.sh
# 幂等：可反复运行；只处理当前存在的文件，缺的跳过。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
IN="incoming-screenshots"
SHOTS="site/public/assets/shots"
HTML="site/public/index.html"
W=760; Q=86

# 压图：优先 ImageMagick（更好），回退 macOS sips。统一 760px 宽 JPEG q86。
resize() { # $1=src $2=dst
  if command -v magick >/dev/null 2>&1; then
    magick "$1" -auto-orient -resize "${W}x>" -strip -quality "$Q" "$2"
  elif command -v convert >/dev/null 2>&1; then
    convert "$1" -auto-orient -resize "${W}x>" -strip -quality "$Q" "$2"
  else
    sips --resampleWidth "$W" -s format jpeg -s formatOptions "$Q" "$1" --out "$2" >/dev/null
  fi
}

# 找某个名字的源文件（任意常见扩展名，大小写不敏感）。
find_src() { # $1=basename → echoes path or empty
  local n="$1" f
  for f in "$IN/$n".jpg "$IN/$n".jpeg "$IN/$n".png "$IN/$n".JPG "$IN/$n".JPEG "$IN/$n".PNG; do
    [ -f "$f" ] && { echo "$f"; return; }
  done
}

# 解开某行特性的注释（删掉 pending 标记行）。幂等。
uncomment() { # $1=name (look|navigation|messages)
  sed -i '' -e "/<!--pending:$1\$/d" -e "/pending:$1:end-->/d" "$HTML"
}

changed=0

# home → hero + 避障行（已引用 home.jpg，无需改 HTML）
src=$(find_src home); if [ -n "$src" ]; then echo "→ home  ← $src"; resize "$src" "$SHOTS/home.jpg"; changed=1; fi

# look / navigation → 各自特性行
for n in look navigation; do
  src=$(find_src "$n"); if [ -n "$src" ]; then echo "→ $n  ← $src"; resize "$src" "$SHOTS/$n.jpg"; uncomment "$n"; changed=1; fi
done

# 聊天行：messages.jpg 优先，没有就用 group.jpg
src=$(find_src messages); [ -z "$src" ] && src=$(find_src group)
if [ -n "$src" ]; then echo "→ messages  ← $src"; resize "$src" "$SHOTS/messages.jpg"; uncomment messages; changed=1; fi

if [ "$changed" = 0 ]; then
  echo "没有在 $IN/ 找到任何 home/look/navigation/messages/group 截图——把文件放进去再运行。"
  exit 0
fi

echo "=== 改动 ==="; git status --short site/public/index.html "$SHOTS"
git add "$SHOTS"/*.jpg "$HTML"
git commit -q -m "feat(site): 换入真机实拍截图（主屏/看一看/步行导航/消息）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push origin main

echo "=== 部署官网到 awsjapan ==="
ssh awsjapan 'cd ~/repo/BeeUrEi && git pull --ff-only origin main >/dev/null 2>&1 && docker build -t beeurei-site:latest site/ >/dev/null && docker rm -f beeurei-site >/dev/null 2>&1; docker run -d --name beeurei-site --restart unless-stopped -p 127.0.0.1:8088:80 beeurei-site:latest >/dev/null && sleep 1 && curl -s -o /dev/null -w "healthz:%{http_code}\n" http://127.0.0.1:8088/healthz'
echo "✅ 完成。公网生效仍需 Cloudflare Public Hostname（见 README / round2 备忘）。"
