#!/usr/bin/env bash
# shellcheck disable=SC2016  # remote('…') 的单引号是**有意**的：$(…) 等表达式必须原样送到远端展开（经 base64 隧道），本地展开反而是 bug。
# BeeUrEi 备份恢复演练（在本地跑，经 ssh 驱动远端）：没验证过"能打开、数据在"的备份不算备份。
#
# 做什么：找到远端最新的每日备份（beeurei-YYYYMMDD.db，卷内 /app/data/backups），在 api 容器里用
# node:sqlite **只读**打开它，跑 PRAGMA integrity_check + foreign_key_check + 关键表计数，
# 并与**线上库**当前计数并排打印（备份是当天/昨天的快照，计数应接近且一般 ≤ 线上）。
# 三重门：备份缺失=红；最新备份超过 26 小时=红（每日节奏断了）；完整性/外键检查不过=红。
#
# 用法：scripts/verify-backup-awsjapan.sh    （DEPLOY_HOST=awsjapan 可切直连）
set -euo pipefail

HOST="${DEPLOY_HOST:-awsjapan-cf}"
say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }
remote() {
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  ssh -o ConnectTimeout=10 "$HOST" "echo $b64 | base64 -d | bash"
}

say "预检：SSH 连通性"
ssh -o ConnectTimeout=8 -o BatchMode=yes "$HOST" true 2>/dev/null || die "ssh $HOST 不可达"

say "恢复演练：最新备份 打开+完整性+外键+计数（容器内 node:sqlite，只读）"
# JS 经 本地单引号→远端 bash 双引号 两层包裹：JS 里不得出现单引号，字符串一律 \" 转义双引号。
remote 'docker exec beeurei-api node -e "
const { DatabaseSync } = require(\"node:sqlite\");
const fs = require(\"node:fs\");
const dir = \"/app/data/backups\";
const names = fs.readdirSync(dir).filter((n) => /^beeurei-[0-9]{8}[.]db$/.test(n)).sort();
if (!names.length) { console.error(\"备份目录为空\"); process.exit(1); }
const latest = dir + \"/\" + names[names.length - 1];
const st = fs.statSync(latest);
const ageH = (Date.now() - st.mtimeMs) / 3600000;
console.log(\"最新备份:\", names[names.length - 1], \"| 大小:\", (st.size / 1024).toFixed(0) + \"KB\", \"| 距今:\", ageH.toFixed(1) + \"h\", \"| 共\", names.length, \"份\");
if (ageH > 26) { console.error(\"最新备份超过 26 小时——每日备份节奏断了\"); process.exit(1); }
const db = new DatabaseSync(latest, { readOnly: true });
const integ = JSON.stringify(db.prepare(\"PRAGMA integrity_check\").get());
const fkBad = db.prepare(\"PRAGMA foreign_key_check\").all().length;
console.log(\"integrity_check:\", integ, \"| foreign_key_check 违例:\", fkBad);
if (!integ.includes(\"ok\") || fkBad > 0) { console.error(\"备份库完整性检查未通过\"); process.exit(1); }
const live = new DatabaseSync(\"/app/data/beeurei.db\", { readOnly: true });
const count = (d, t) => { try { return d.prepare(\"SELECT COUNT(*) AS c FROM \" + t).get().c; } catch { return \"表不存在\"; } };
for (const t of [\"users\", \"messages\", \"recordings\", \"emergency_events\", \"call_records\", \"verifications\"]) {
  console.log(t.padEnd(18), \"备份:\", String(count(db, t)).padEnd(8), \"线上:\", String(count(live, t)));
}
console.log(\"恢复演练通过：备份可打开、结构完整、数据同在\");
"'

say "完成：备份恢复演练通过"
