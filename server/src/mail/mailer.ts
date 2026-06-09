/// 可插拔邮件器（D1 邮箱验证 / 找回密码）。
/// 默认 ConsoleMailer：把邮件内容打到服务器日志——自托管/开发下**完全可用**（管理员从日志读验证码），
/// 无需任何外部服务商。配置 SMTP_* 环境变量并安装 nodemailer 后，makeMailer 自动切到真实 SMTP 发信。
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>
}

/// 控制台邮件器：打印到日志。零依赖、零外部服务。
export class ConsoleMailer implements Mailer {
  // 允许注入 sink 以便单测捕获（默认 console.log）。
  constructor(private readonly sink: (line: string) => void = (l) => console.log(l)) {}
  async send(to: string, subject: string, text: string): Promise<void> {
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
    return {
      async send(to: string, subject: string, text: string): Promise<void> {
        await transport.sendMail({ from, to, subject, text })
      },
    }
  } catch {
    // 未安装 nodemailer 或加载失败：回落到控制台，绝不让发信失败拖垮服务。
    return new ConsoleMailer()
  }
}
