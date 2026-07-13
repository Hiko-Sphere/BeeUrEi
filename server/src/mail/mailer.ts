/// 可插拔邮件器（D1 邮箱验证 / 找回密码）。
/// 默认 ConsoleMailer：把邮件内容打到服务器日志——自托管/开发下**完全可用**（管理员从日志读验证码），
/// 无需任何外部服务商。配置 SMTP_* 环境变量并安装 nodemailer 后，makeMailer 自动切到真实 SMTP 发信。
export interface Mailer {
  /// html 可选：提供则发 multipart（text + html），客户端优先渲染 html、纯文本兜底。
  send(to: string, subject: string, text: string, html?: string): Promise<void>
}

/// 空邮件器：什么都不做。notify 模块的安全邮件单例默认——未注入真实邮件器时，安全事件仅走 App 内+推送、不额外发信。
export class NoopMailer implements Mailer {
  async send(): Promise<void> { /* no-op */ }
}

/// 计数装饰器：包裹任意 Mailer，把每次 send 的成/败喂给 onOutcome（进 /metrics 与 admin 面板）——让运维**看得见**
/// SMTP 故障（如 163 授权码失效撞 535），而非等第一个用户发码失败才从日志翻出来。失败照旧向上抛，保持
/// "发信失败 → 路由回 503 mail_unavailable" 契约不变（与 CountingWebPushSender 同款单点包裹）。
export class CountingMailer implements Mailer {
  constructor(private readonly inner: Mailer, private readonly onOutcome: (ok: boolean, error?: string) => void) {}
  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    try {
      await this.inner.send(to, subject, text, html)
      this.onOutcome(true)
    } catch (e) {
      // 失败原因（如 SMTP "535 authentication failed"）一并上报——运维在面板一眼看出"为什么发不出去"，
      // 而非只有一个失败计数还要去翻日志。SMTP 错误文本不含密码（只报状态/原因），透传安全。
      this.onOutcome(false, e instanceof Error ? e.message : String(e))
      throw e
    }
  }
}

/// 控制台邮件器：打印到日志。零依赖、零外部服务（管理员可从日志读验证码）。
export class ConsoleMailer implements Mailer {
  // 允许注入 sink 以便单测捕获（默认 console.log）。
  constructor(private readonly sink: (line: string) => void = (l) => console.log(l)) {}
  async send(to: string, subject: string, text: string, _html?: string): Promise<void> {
    this.sink(`[MAIL] → ${to} | ${subject} | ${text}`)
  }
}

/// 工厂：设了 SMTP_HOST 且能动态加载 nodemailer 则用 SMTP，否则回落 ConsoleMailer。
/// nodemailer 为**可选**依赖（未安装也不影响其余功能）——用非静态模块名 import 规避打包器静态解析。
export async function makeMailer(): Promise<Mailer> {
  const host = process.env.SMTP_HOST
  if (!host) return new ConsoleMailer()
  try {
    const moduleName = ['node', 'mailer'].join('') // 'nodemailer'，非静态名避免类型/打包解析
    const nodemailer: any = await import(moduleName)
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
    const from = process.env.SMTP_FROM ?? 'BeeUrEi <no-reply@beeurei.app>'
    // 启动自检：SMTP 凭据失效（如 163 授权码过期）要在日志里立刻可见，而不是等第一个用户撞 535。
    transport.verify()
      .then(() => console.log(`[mail] SMTP 已就绪（${host}）`))
      .catch((e: Error) => console.warn(`[mail] SMTP 自检失败（${host}）——发码功能将不可用：`, e.message))
    return {
      async send(to: string, subject: string, text: string, html?: string): Promise<void> {
        await transport.sendMail({ from, to, subject, text, ...(html ? { html } : {}) })
      },
    }
  } catch {
    // 未安装 nodemailer 或加载失败：回落到控制台，绝不让发信失败拖垮服务。
    return new ConsoleMailer()
  }
}
