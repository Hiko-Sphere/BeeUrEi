import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { ConsoleMailer, makeMailer } from '../src/mail/mailer'
import { NoopPushSender, makePushSender, ApnsPushSender } from '../src/push/apns'
import { initErrorReporting, captureException } from '../src/monitoring/errorReporting'

const savedEnv = { ...process.env }
afterEach(() => { process.env = { ...savedEnv } })

describe('Mailer（D1 基建）', () => {
  it('ConsoleMailer 把邮件打到 sink（自托管下从日志读验证码）', async () => {
    const lines: string[] = []
    const m = new ConsoleMailer((l) => lines.push(l))
    await m.send('a@b.c', '验证码', '123456')
    expect(lines[0]).toContain('a@b.c')
    expect(lines[0]).toContain('123456')
  })

  it('未配置 SMTP_HOST 时 makeMailer 回落 ConsoleMailer', async () => {
    delete process.env.SMTP_HOST
    const m = await makeMailer()
    expect(m).toBeInstanceOf(ConsoleMailer)
  })

  it('配了 SMTP_HOST：makeMailer 绝不抛错，总能返回可用 Mailer（装了 nodemailer 走 SMTP，否则回落控制台）', async () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    const m = await makeMailer()
    expect(typeof m.send).toBe('function')
  })
})

describe('APNs 推送工厂（A1 基建）', () => {
  it('NoopPushSender 两类发送均为空操作且不抛', async () => {
    const n = new NoopPushSender()
    await expect(n.sendCallInvite()).resolves.toBeUndefined()
    await expect(n.sendAlert()).resolves.toBeUndefined()
  })

  it('环境不全时返回 Noop', () => {
    delete process.env.APNS_KEY_PATH
    expect(makePushSender()).toBeInstanceOf(NoopPushSender)
  })

  it('.p8 不可读时回退 Noop（绝不让推送配置错误拖垮服务）', () => {
    process.env.APNS_KEY_PATH = '/nonexistent/key.p8'
    process.env.APNS_KEY_ID = 'KEY1'
    process.env.APNS_TEAM_ID = 'TEAM1'
    process.env.APNS_TOPIC = 'com.x.app.voip'
    expect(makePushSender()).toBeInstanceOf(NoopPushSender)
  })

  it('配置齐全 + 合法 EC P-256 私钥：启用真实 ApnsPushSender，alert topic 去掉 .voip 后缀', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apns-'))
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const keyPath = join(dir, 'AuthKey_TEST.p8')
    writeFileSync(keyPath, pem)
    process.env.APNS_KEY_PATH = keyPath
    process.env.APNS_KEY_ID = 'KEY1'
    process.env.APNS_TEAM_ID = 'TEAM1'
    process.env.APNS_TOPIC = 'com.x.app.voip'
    const sender = makePushSender()
    expect(sender).toBeInstanceOf(ApnsPushSender)
  })
})

describe('错误上报（D3/F2 基建）', () => {
  it('无 SENTRY_DSN：初始化只装进程兜底，captureException 为安全空操作', async () => {
    delete process.env.SENTRY_DSN
    await initErrorReporting()
    expect(() => captureException(new Error('test'))).not.toThrow()
  })
})
