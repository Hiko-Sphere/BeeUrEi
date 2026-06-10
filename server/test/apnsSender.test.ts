import { describe, it, expect, afterEach } from 'vitest'
import { generateKeyPairSync, createPrivateKey } from 'node:crypto'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoopPushSender, ApnsPushSender, makePushSender, type PushSender } from '../src/push/apns'

/// A1 VoIP/提醒推送发送器单测。不打真实 APNs（不需要 Apple 账号）：
/// 用本机生成的 P-256 私钥走真实 ES256 JWT 签名路径，网络则指向本机已关闭端口走「失败被吞」路径。
function p256Pem(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
}

const APNS_ENV = ['APNS_KEY_PATH', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_TOPIC', 'APNS_HOST'] as const
const HEX_TOKEN = 'a1b2c3d4'.repeat(8) // 64 位合法 token 形态

describe('APNs 推送发送器（A1）', () => {
  afterEach(() => {
    for (const k of APNS_ENV) delete process.env[k]
  })

  it('NoopPushSender 静默 resolve（未配置 APNs 时仍不阻断）', async () => {
    const noop: PushSender = new NoopPushSender()
    await expect(noop.sendCallInvite('tok', 'cid', 'name', 'uid')).resolves.toBeUndefined()
    await expect(noop.sendAlert('tok', 't', 'b')).resolves.toBeUndefined()
  })

  it('makePushSender：缺 env → Noop；env 齐全且 .p8 可读 → 真实 ApnsPushSender', () => {
    expect(makePushSender()).toBeInstanceOf(NoopPushSender)

    const dir = mkdtempSync(join(tmpdir(), 'apns-'))
    const keyPath = join(dir, 'AuthKey_TEST.p8')
    writeFileSync(keyPath, p256Pem())
    process.env.APNS_KEY_PATH = keyPath
    process.env.APNS_KEY_ID = 'ABC123DEFG'
    process.env.APNS_TEAM_ID = 'TEAM123456'
    process.env.APNS_TOPIC = 'com.beeurei.BeeUrEi.voip'
    expect(makePushSender()).toBeInstanceOf(ApnsPushSender)
  })

  it('makePushSender：.p8 路径不存在 → 回退 Noop（绝不抛）', () => {
    process.env.APNS_KEY_PATH = '/nonexistent/AuthKey.p8'
    process.env.APNS_KEY_ID = 'ABC123DEFG'
    process.env.APNS_TEAM_ID = 'TEAM123456'
    process.env.APNS_TOPIC = 'com.beeurei.BeeUrEi.voip'
    expect(makePushSender()).toBeInstanceOf(NoopPushSender)
  })

  it('ApnsPushSender：网络失败只记日志、绝不抛（签 ES256 JWT 路径被覆盖）', async () => {
    const key = createPrivateKey(p256Pem())
    // host 指向本机已关闭端口 → 连接立即被拒 → 走 error 兜底 → catch 吞掉，Promise 正常 resolve。
    const sender = new ApnsPushSender(key, 'KID1234567', 'TEAM123456', 'com.beeurei.BeeUrEi.voip', '127.0.0.1:1', 'com.beeurei.BeeUrEi')
    await expect(sender.sendCallInvite(HEX_TOKEN, 'cid', 'caller', 'uid')).resolves.toBeUndefined()
    // 第二次发送命中 providerToken 的 ~40 分钟缓存复用分支。
    await expect(sender.sendAlert(HEX_TOKEN, 'title', 'body', { k: 'v' })).resolves.toBeUndefined()
  })
})
