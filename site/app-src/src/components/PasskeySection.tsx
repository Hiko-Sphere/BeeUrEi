import { useEffect, useState } from 'react'
import { api, APIError } from '../lib/api'
import { passkeySupported, createPasskey } from '../lib/webauthn'
import { useI18n } from '../lib/i18n'
import { Button, Modal, useToast, fmtTime } from './ui'

/// 通行密钥管理（Account 安全区）：列出/添加/删除本账号的 passkey。
/// web 端补齐 iOS 已有的免密登录 parity——浏览器本就是 WebAuthn 的原生平台（Chrome/Safari/1Password 等）。
/// 添加走 options→navigator.credentials.create→verify 三步；服务端按 Origin 用前端域做 rpID。
export function PasskeySection() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<{ id: string; deviceName: string | null; createdAt: number }[] | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async () => { try { setList((await api.passkeyList()).passkeys) } catch { /* 打开时再报 */ } }
  useEffect(() => { if (open) void reload() }, [open])

  if (!passkeySupported()) return null // 浏览器不支持 WebAuthn：整块不出现（不摆一个必然失败的按钮）

  const add = async () => {
    setBusy(true)
    try {
      const options = await api.passkeyRegisterOptions()
      const credential = await createPasskey(options) // 浏览器弹系统级指纹/面容/PIN 确认
      await api.passkeyRegisterVerify(credential, defaultDeviceName())
      toast(t('通行密钥已添加，下次可免密登录', 'Passkey added — you can sign in without a password next time'), 'ok')
      await reload()
    } catch (e) {
      if (e instanceof APIError) toast(t('添加失败，请重试', 'Could not add the passkey — try again'), 'error')
      else toast(t('已取消或此设备不支持', 'Cancelled, or not supported on this device'), 'error')
    } finally { setBusy(false) }
  }

  const remove = async (id: string, name: string | null) => {
    if (!confirm(t(`删除通行密钥「${name ?? t('未命名', 'Unnamed')}」？删除后它将无法再用于登录。`,
      `Delete passkey "${name ?? 'Unnamed'}"? It can no longer be used to sign in.`))) return
    try { await api.passkeyDelete(id); await reload(); toast(t('已删除', 'Deleted'), 'ok') }
    catch { toast(t('删除失败，请重试', 'Could not delete — try again'), 'error') }
  }

  return (
    <>
      <Button variant="soft" onClick={() => setOpen(true)}>{t('通行密钥', 'Passkeys')}</Button>
      {open && (
        <Modal onClose={() => setOpen(false)} label={t('通行密钥', 'Passkeys')} panelClassName="w-full max-w-md">
          <p className="text-xs text-faint">
            {t('用这台设备的指纹 / 面容 / 密码直接登录，无需输入账号密码。密钥只在本网页端有效（App 内的另有一套）。',
              'Sign in with this device’s fingerprint / face / passcode — no password needed. Keys added here work for the web app (the iOS app keeps its own).')}
          </p>
          {list === null ? (
            <p className="mt-3 text-sm text-faint">{t('加载中…', 'Loading…')}</p>
          ) : list.length === 0 ? (
            <p className="mt-3 text-sm text-soft">{t('还没有通行密钥。', 'No passkeys yet.')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {list.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="text-sm font-medium">{p.deviceName ?? t('未命名设备', 'Unnamed device')}</div>
                    <div className="text-xs text-faint">{t('添加于 ', 'Added ') + fmtTime(p.createdAt, lang)}</div>
                  </div>
                  <Button variant="danger" onClick={() => void remove(p.id, p.deviceName)}
                    aria-label={t(`删除通行密钥 ${p.deviceName ?? '未命名设备'}`, `Delete passkey ${p.deviceName ?? 'unnamed device'}`)}>
                    {t('删除', 'Delete')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Button loading={busy} onClick={() => void add()}>{t('添加通行密钥', 'Add a passkey')}</Button>
          </div>
        </Modal>
      )}
    </>
  )
}

/// 设备默认名：从 UA 粗判（仅展示用，用户看得懂即可）。
function defaultDeviceName(): string {
  const ua = navigator.userAgent
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : t2('浏览器')
  return os ? `${br} · ${os}` : br
}
const t2 = (zh: string) => zh // 设备名非 i18n 面（存服务端原样展示）
