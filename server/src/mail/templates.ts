/// 交易邮件模板（验证码 / 重置密码）：中英双语、品牌化、可访问（语义化 + 纯文本兜底）、
/// 安全合规（明确有效期、反钓鱼提示「绝不索要验证码」、误收忽略、自动发送勿回复）。
/// 返回 { subject, text, html }；text 始终含 6 位验证码，供客户端/iOS 一次性验证码自动填充与单测提取。

const INK = '#14161f'
const HONEY_ON_DARK = '#ffc83d'
const SOFT = '#5d6470'
const FAINT = '#8b929e'
const LINK = '#8c6000' // 在浅底上 ≥ AA 对比
const LINE = '#e2e5ea'
const PAGE = '#f6f7f9'
const SITE = 'https://beeurei.hikosphere.com'
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Roboto,Helvetica,Arial,sans-serif`
const MONO = `'SF Mono',ui-monospace,Menlo,Consolas,'Liberation Mono',monospace`

export interface Mail { subject: string; text: string; html: string }

interface Copy {
  subjectZh: string; subjectEn: string
  titleZh: string; titleEn: string
  leadZh: string; leadEn: string
  noteZh: string; noteEn: string
  preheaderZh: string; preheaderEn: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function render(c: Copy, code: string): Mail {
  const subject = `${c.subjectZh} / ${c.subjectEn}`
  const text = [
    `${c.titleZh} — BeeUrEi 蜂之眼`,
    ``,
    `你的 BeeUrEi 验证码是：${code}`,
    `有效期 10 分钟。${c.noteZh}`,
    `为保护账号安全，BeeUrEi 绝不会主动向你索要此验证码。`,
    ``,
    `----------------------------------------`,
    ``,
    `${c.titleEn} — BeeUrEi`,
    ``,
    `Your BeeUrEi verification code is: ${code}`,
    `This code expires in 10 minutes. ${c.noteEn}`,
    `For your security, BeeUrEi will never ask you for this code.`,
    ``,
    `BeeUrEi 蜂之眼 · Hiko Sphere 彦穹科技 · ${SITE}`,
    `此为系统自动发送的邮件，请勿回复。This is an automated message — please do not reply.`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(c.preheaderZh)} · ${esc(c.preheaderEn)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;font-family:${FONT};">
<tr><td style="background:${INK};padding:18px 28px;">
<span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-.2px;">BeeUrEi <span style="color:${HONEY_ON_DARK};">蜂之眼</span></span>
</td></tr>
<tr><td style="padding:28px 28px 22px;">
<h1 lang="zh" style="margin:0 0 8px;font-size:20px;line-height:1.3;color:${INK};font-weight:700;">${esc(c.titleZh)}</h1>
<p lang="zh" style="margin:0 0 18px;font-size:15px;line-height:1.65;color:${SOFT};">${esc(c.leadZh)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:18px;background:#fff8e6;border:1px solid #ffe08a;border-radius:12px;">
<span style="font-family:${MONO};font-size:34px;font-weight:700;letter-spacing:8px;color:${INK};">${esc(code)}</span>
</td></tr></table>
<p lang="zh" style="margin:16px 0 4px;font-size:14px;line-height:1.6;color:${SOFT};">有效期 <strong style="color:${INK};">10 分钟</strong>。${esc(c.noteZh)}</p>
<p lang="zh" style="margin:0;font-size:13px;line-height:1.6;color:${FAINT};">为保护账号安全，BeeUrEi 绝不会主动向你索要此验证码。</p>
<hr style="border:none;border-top:1px solid ${LINE};margin:22px 0;">
<h2 lang="en" style="margin:0 0 8px;font-size:18px;line-height:1.3;color:${INK};font-weight:700;">${esc(c.titleEn)}</h2>
<p lang="en" style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${SOFT};">${esc(c.leadEn)} The code above expires in <strong style="color:${INK};">10 minutes</strong>. ${esc(c.noteEn)}</p>
<p lang="en" style="margin:0;font-size:13px;line-height:1.6;color:${FAINT};">For your security, BeeUrEi will never ask you for this code.</p>
</td></tr>
<tr><td style="padding:18px 28px;background:${PAGE};border-top:1px solid ${LINE};">
<p style="margin:0;font-size:12px;line-height:1.6;color:${FAINT};">BeeUrEi 蜂之眼 · Hiko Sphere 彦穹科技 · <a href="${SITE}" style="color:${LINK};text-decoration:none;">beeurei.hikosphere.com</a></p>
<p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:${FAINT};">此为系统自动发送的邮件，请勿回复。This is an automated message — please do not reply.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  return { subject, text, html }
}

/// 邮箱验证码（绑定/验证邮箱）。
export function emailVerificationMail(code: string): Mail {
  return render({
    subjectZh: 'BeeUrEi 邮箱验证码', subjectEn: 'Your BeeUrEi verification code',
    titleZh: '验证你的邮箱', titleEn: 'Verify your email',
    leadZh: '请在 BeeUrEi 中输入下面的验证码，完成邮箱绑定与验证：',
    leadEn: 'Enter this code in BeeUrEi to confirm your email address:',
    noteZh: '若不是你本人操作，请忽略本邮件。',
    noteEn: 'If you didn’t request this, you can safely ignore this email.',
    preheaderZh: '你的 BeeUrEi 验证码（10 分钟内有效）',
    preheaderEn: 'Your BeeUrEi verification code (expires in 10 minutes)',
  }, code)
}

/// 重置密码验证码（找回密码）。
export function passwordResetMail(code: string): Mail {
  return render({
    subjectZh: 'BeeUrEi 重置密码验证码', subjectEn: 'Reset your BeeUrEi password',
    titleZh: '重置你的密码', titleEn: 'Reset your password',
    leadZh: '请在 BeeUrEi 中输入下面的验证码，以重置你的账号密码：',
    leadEn: 'Enter this code in BeeUrEi to reset your account password:',
    noteZh: '若不是你本人发起，请忽略本邮件，你的密码不会被更改。',
    noteEn: 'If you didn’t request this, ignore this email — your password will not change.',
    preheaderZh: '你的 BeeUrEi 重置密码验证码（10 分钟内有效）',
    preheaderEn: 'Your BeeUrEi password-reset code (expires in 10 minutes)',
  }, code)
}
