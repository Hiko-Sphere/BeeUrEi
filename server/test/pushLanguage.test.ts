import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { pushLang, pushStrings } from '../src/push/pushStrings'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function reg(a: ReturnType<typeof buildApp>, username: string, role = 'blind', language?: string) {
  const res = await a.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret123', role, language },
  })
  return res.json() as { token: string; user: { id: string } }
}

describe('推送文案双语（pushStrings）', () => {
  it('语言解析：en* 走英文，其余（含未设置）走中文', () => {
    expect(pushLang('en')).toBe('en')
    expect(pushLang('en-US')).toBe('en')
    expect(pushLang('zh')).toBe('zh')
    expect(pushLang(undefined)).toBe('zh')
    expect(pushLang('fr')).toBe('zh') // 未翻译语言回退中文（与历史一致）
  })

  it('中文文案与历史逐字一致', () => {
    expect(pushStrings.incomingCallTitle('小明', 'zh')).toBe('小明 来电')
    expect(pushStrings.incomingCallBody('zh')).toBe('点击打开 App 接听')
    expect(pushStrings.friendRequestTitle('zh')).toBe('新的好友请求')
    expect(pushStrings.friendRequestBody('小明', '儿子', 'zh')).toBe('小明 想加你为儿子')
    expect(pushStrings.friendAcceptedBody('小明', 'zh')).toBe('小明 接受了你的请求')
  })

  it('英文文案不混入中文', () => {
    const samples = [
      pushStrings.incomingCallTitle('Ming', 'en'), pushStrings.incomingCallBody('en'),
      pushStrings.friendRequestTitle('en'), pushStrings.friendRequestBody('Ming', 'son', 'en'),
      pushStrings.friendAcceptedTitle('en'), pushStrings.friendAcceptedBody('Ming', 'en'),
    ]
    for (const s of samples) expect(/[一-鿿]/.test(s)).toBe(false)
  })
})

describe('POST /api/account/language（语言偏好同步）', () => {
  it('更新 users.language，推送据此选语言', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const me = await reg(a, 'lang_user')
    expect(store.findById(me.user.id)?.language).toBeUndefined()

    const res = await a.inject({
      method: 'POST',
      url: '/api/account/language',
      headers: auth(me.token),
      payload: { language: 'en' },
    })
    expect(res.statusCode).toBe(200)
    expect(store.findById(me.user.id)?.language).toBe('en')
    expect(pushLang(store.findById(me.user.id)?.language)).toBe('en')
  })

  it('非法输入 400；未登录 401', async () => {
    const a = buildApp(new MemoryStore())
    const me = await reg(a, 'lang_user2')
    const bad = await a.inject({
      method: 'POST', url: '/api/account/language', headers: auth(me.token), payload: { language: 'x' },
    })
    expect(bad.statusCode).toBe(400)
    const noauth = await a.inject({ method: 'POST', url: '/api/account/language', payload: { language: 'en' } })
    expect(noauth.statusCode).toBe(401)
  })
})
