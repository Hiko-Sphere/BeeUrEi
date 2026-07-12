# 运维手册（自托管）

面向 BeeUrEi 服务端运营者的最小运维手册：备份/恢复/监控/回滚。所有命令以生产部署形态为准
（Docker，镜像内 `DB_PATH=/app/data/beeurei.db`，数据卷 `beeurei-data:/app/data`，见
`scripts/deploy-awsjapan.sh` 与 `server/Dockerfile`）。环境变量总表见 `server/.env.example`。

## 备份

三层，互为补充：

1. **每日自动快照**（无人值守，默认开启）：服务端每天在 `<DB 目录>/backups/beeurei-YYYYMMDD.db`
   落一份 `VACUUM INTO` 一致性快照（在线、不锁写），默认保留 7 天。
   - 调节：`BACKUP_DIR` / `BACKUP_KEEP_DAYS`（`0` = 显式关闭）。
   - Docker 下位于数据卷内：`docker exec beeurei-api ls /app/data/backups`。
2. **管理面板手动下载**：`/admin` → 系统控制 → 数据库备份。适合升级/迁移前手动取一份离机副本。
3. **异地容灾（运营者自理）**：同盘/同卷备份**不防磁盘或主机整体损坏**。把备份目录定期同步出去：
   ```sh
   # 宿主机示例（cron 每日）：把卷内 backups 拉到异地
   docker cp beeurei-api:/app/data/backups /your/offsite/beeurei-backups
   ```

媒体文件（视频消息等）在 `/app/data` 卷内独立目录、**不在**数据库快照里；异地同步整卷即全覆盖。

**恢复演练（建议每月跑一次）**：没验证过"能打开、数据在"的备份不算备份。

```sh
./scripts/verify-backup-awsjapan.sh
# 找最新每日备份 → 容器内 node:sqlite 只读打开 → integrity_check + foreign_key_check
# + 关键表计数与线上并排比对；备份缺失/超 26h/完整性不过 任一即非零退出（可挂 cron 告警）。
```

## 恢复

> 快照是完整独立的 SQLite 库文件，恢复 = 用快照替换现行库文件。

```sh
# 1. 停服务（防止恢复期间写入）
docker stop beeurei-api

# 2. 备份现场（即便它已损坏——保留取证/二次尝试的余地）
docker run --rm -v beeurei-data:/data alpine \
  sh -c 'cp /data/beeurei.db /data/beeurei.db.broken 2>/dev/null; true'

# 3. 用快照覆盖库文件，并删除 WAL 伴生文件（关键！见下）
docker run --rm -v beeurei-data:/data alpine sh -c '
  cp /data/backups/beeurei-YYYYMMDD.db /data/beeurei.db &&
  rm -f /data/beeurei.db-wal /data/beeurei.db-shm'

# 4. 起服务并验证
docker start beeurei-api
curl -fsS http://127.0.0.1:8787/api/ready    # 就绪=存储可用
curl -fsS http://127.0.0.1:8787/api/version  # commit 应为所部署的 SHA
```

**为什么必须删 `-wal`/`-shm`**：服务端 SQLite 以 WAL 模式运行，库文件旁会有 `beeurei.db-wal`
（未合并的写日志）与 `-shm`。只替换主文件而留下旧 WAL，属于把两个不同数据库的部件拼在一起——
SQLite 依 salt 校验通常会拒用不匹配的 WAL，但**绝不应赌这个**：恢复时一并删除伴生文件是唯一
正确做法。

恢复自管理面板下载的备份同理（先 `docker cp` 进卷再执行第 3 步）。

## 监控

| 端点 | 用途 |
|---|---|
| `GET /health` | 轻量存活探针（进程活着即 200） |
| `GET /api/ready` | 就绪探针（触达存储确认可用）——**Docker HEALTHCHECK 用它**，配合 `--restart unless-stopped` 自愈；部署脚本的上线等待也打它 |
| `GET /api/version` | 部署验证：`{version, commit}`，commit 应等于所部署的 git SHA |
| `GET /metrics` | Prometheus 抓取（设 `METRICS_TOKEN` 则需 `Authorization: Bearer`） |
| 管理面板 → 总览 | 在线人数/紧急事件/举报/版本·运行时长 |

日志：`docker logs beeurei-api`。容器日志已封顶 **20MB×5 自动轮换**（`docker run --log-opt`，
防日志吃满磁盘）。每小时留存清扫（录音/KYC/孤儿媒体/通知/refresh token/
紧急事件日志/自动备份）各自打印一行结果，失败互不阻断。崩溃监控：配 `SENTRY_DSN` 即启用。

## 部署与回滚

```sh
./scripts/deploy-awsjapan.sh                     # 构建并部署 origin/main（镜像同时打 :SHA 标签）
./scripts/deploy-awsjapan.sh clean               # 只做镜像轮换清理（部署尾部也会自动跑）
./scripts/deploy-awsjapan.sh rollback <SHA> api  # 一键回滚（api|site|all，默认 api）：
#   校验镜像存在（不存在则列出可用 SHA）→ :latest 重打到 <SHA>（容器意外重启不会跳回坏版）
#   → 按部署同款参数重建容器 → 健康检查 → 公网验证 + /api/version 打印线上实际 commit。
#   已在生产实测（回滚到当前版自身 = 零风险全路径演练）。
```

**回滚窗口 = 最近 5 个 SHA**：每次部署自动做镜像轮换（beeurei-api/site 各保留最近 5 个 SHA
标签，其余连同悬空层/构建缓存清理——防高频部署把磁盘囤满）。需要回滚到更早版本时，从对应
commit 重新构建镜像即可（`git checkout <SHA> && docker build …`），数据不受影响。

数据库 schema 迁移是加列式幂等（`ALTER TABLE … ADD COLUMN` + try/catch），**新版可直接读旧库；
回滚到旧版时新列被忽略、不破坏**——但新版写入的新字段语义会丢，回滚后建议尽快前滚。

## 密钥清单（缺失即启动失败或功能关闭）

| 变量 | 必需性 |
|---|---|
| `JWT_SECRET`、`KYC_ENC_KEY` | **必需**，缺失拒绝启动 |
| `ADMIN_USERNAME/PASSWORD` | 首次引导管理员 |
| `APNS_*` / `VAPID_*` / `SMTP_*` / `VISION_*` / `AMAP_API_KEY` / `SENTRY_DSN` / `METRICS_TOKEN` | 可选，未配对应功能诚实降级（Noop/503），绝不假装 |

生成：`openssl rand -hex 32`（密钥）、`npx web-push generate-vapid-keys`（VAPID）。
完整说明见 `server/.env.example`。
