import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { buildUserExportBundle } from '../src/account/exportBundle'

// 自助数据导出（GDPR 可携权）：本人拿得到自己的一切、拿不到别人的话、永远拿不到密钥类。
describe('GET /api/account/export', () => {
  it('含档案/亲友/路线/本人发出的文字消息；不含对方消息正文；绝无密码哈希与令牌', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const me = await reg('exportme', 'blind')
    const peer = await reg('exportpeer', 'helper')
    const auth = { authorization: `Bearer ${me.token}` }
    const pAuth = { authorization: `Bearer ${peer.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'exportpeer', relation: '志愿者', isEmergency: true } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: pAuth })
    // 双向消息：我发的进导出，对方发的不进
    await a.inject({ method: 'POST', url: '/api/messages', headers: auth, payload: { toId: peer.user.id, kind: 'text', text: '我的话-地址是幸福路1号' } })
    await a.inject({ method: 'POST', url: '/api/messages', headers: pAuth, payload: { toId: me.user.id, kind: 'text', text: '对方的话-秘密内容' } })
    // 我的路线
    await a.inject({ method: 'POST', url: '/api/routes', headers: auth, payload: { name: '回家', waypoints: [{ lat: 31.2, lng: 121.4 }, { lat: 31.21, lng: 121.41 }] } })
    // 一次带坐标的手动 SOS（本人事故记录 → 应进导出）
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'manual', lat: 31.2, lon: 121.4 } })
    // 群聊（本人为群主 → 应进导出的 groups；此前漏了群归属）
    const g = await a.inject({ method: 'POST', url: '/api/groups', headers: auth, payload: { name: '家庭群', memberIds: [peer.user.id] } })
    expect(g.statusCode).toBe(201)

    const res = await a.inject({ method: 'GET', url: '/api/account/export', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('beeurei-my-data.json')
    const body = res.json()
    const raw = res.payload
    expect(body.profile.username).toBe('exportme')
    expect(body.familyLinks.length).toBe(1)
    expect(body.savedRoutes.length).toBe(1)
    expect(body.savedRoutes[0].waypoints.length).toBe(2)
    expect(body.emergencyEvents.length).toBe(1)
    expect(body.emergencyEvents[0]).toMatchObject({ kind: 'manual', lat: 31.2, contacts: 1 })
    expect(body.messagesSent.length).toBe(1)
    expect(body.messagesSent[0].text).toContain('幸福路')      // 自己的话，含正文
    // 群归属（回归：此前漏导出）
    expect(body.groups.length).toBe(1)
    expect(body.groups[0]).toMatchObject({ name: '家庭群', role: 'owner' })
    // 通知收件箱（回归：此前漏导出）——peer 接受我的好友请求 → 我(请求者)收到 friend_accepted
    expect(body.notifications.some((n: { kind: string }) => n.kind === 'friend_accepted')).toBe(true)
    expect(raw).not.toContain('秘密内容')                       // 对方的话绝不出现
    expect(raw).not.toContain('passwordHash')                   // 安全底线（底座保证）
    expect(raw.toLowerCase()).not.toContain('refreshtoken')
    // 未登录 401
    expect((await a.inject({ method: 'GET', url: '/api/account/export' })).statusCode).toBe(401)
    await a.close()
  })

  it('含常用地点/安全报到历史/勿扰时段（本人 PII，GDPR 访问完整性回归）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const me = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'exportpii', password: 'a-strong-pass-9', role: 'blind' } })).json()
    const auth = { authorization: `Bearer ${me.token}` }
    await a.inject({ method: 'PUT', url: '/api/places/home', headers: auth, payload: { address: '幸福路1号' } })          // 常用地点
    await a.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: auth, payload: { durationMinutes: 30, note: '走夜路' } }) // 安全报到
    await a.inject({ method: 'PUT', url: '/api/notifications/quiet-hours', headers: auth, payload: { enabled: true, startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' } }) // 勿扰
    await a.inject({ method: 'PUT', url: '/api/notifications/push-categories', headers: auth, payload: { muted: ['route', 'social'] } }) // 按类别静音偏好

    const body = (await a.inject({ method: 'GET', url: '/api/account/export', headers: auth })).json()
    expect(body.savedPlaces.length).toBe(1)
    expect(body.savedPlaces[0]).toMatchObject({ label: 'home', address: '幸福路1号' })
    expect(body.safetyTimers.length).toBe(1)
    expect(body.safetyTimers[0]).toMatchObject({ note: '走夜路', status: 'active' })
    expect(body.profile.quietHours).toMatchObject({ enabled: true, startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' })
    // 按类别静音偏好也在 profile（与 quietHours 同为粗粒度勿扰配置，GDPR 访问完整性）；规整为稳定序。
    expect(body.profile.mutedPushCategories).toEqual(['social', 'route'])
    await a.close()
  })

  it('含本人免打扰偏好（静音的群/单聊对端）——GDPR 完整性；群/对端以名称呈现、方向正确、admin 底座不含', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const me = await reg('muteexport', 'blind')
    const peer = await reg('mutepeer', 'helper')
    const other = await reg('muteother', 'helper') // 方向性诱饵：一个静音了本人的**第三方**（不同于 peer，才能真正区分方向）
    const auth = { authorization: `Bearer ${me.token}` }
    const pAuth = { authorization: `Bearer ${peer.token}` }
    // 先建立已接受的亲友关系（建群要求成员与创建者 areLinked）。
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'mutepeer', relation: '亲友' } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: pAuth })
    // 建群（本人为群主）+ 静音该群 + 静音与 peer 的单聊（直接经 store 置静音，与 KYC 测同法）。
    const g = await a.inject({ method: 'POST', url: '/api/groups', headers: auth, payload: { name: '吵闹群', memberIds: [peer.user.id] } })
    const gid = g.json().group.id
    store.setGroupMuted(gid, me.user.id, true)
    store.setDmMuted(me.user.id, peer.user.id, true)
    // 方向性诱饵：第三方 other 静音了本人（other 作为 muter）——绝不进本人导出（导出的是"本人静音了谁"，非"谁静音了本人"）。
    store.setDmMuted(other.user.id, me.user.id, true)

    const body = (await a.inject({ method: 'GET', url: '/api/account/export', headers: auth })).json()
    expect(body.mutedConversations.groups).toEqual(['吵闹群'])           // 群以名称呈现（非 UUID）
    expect(body.mutedConversations.directContacts).toEqual(['mutepeer']) // 只含本人静音的对端、以显示名呈现
    expect(body.mutedConversations.directContacts).not.toContain('muteother') // 方向：静音本人的第三方绝不泄漏进本人导出

    // admin 代办导出底座不含 mutedConversations（静音谁属本人隐私，与住址/健康/头像同的最小化）。
    const adminBase = buildUserExportBundle(store, me.user.id, Date.now())!
    expect('mutedConversations' in adminBase).toBe(false)
    await a.close()
  })

  it('非文字消息只给元信息（data URL/mediaId 不内联）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const me = await reg('exportau', 'blind')
    const peer = await reg('exportau2', 'helper')
    const auth = { authorization: `Bearer ${me.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'exportau2', relation: '亲友' } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: { authorization: `Bearer ${peer.token}` } })
    await a.inject({ method: 'POST', url: '/api/messages', headers: auth, payload: { toId: peer.user.id, kind: 'audio', text: 'data:audio/mp4;base64,AAAA' } })
    const res = await a.inject({ method: 'GET', url: '/api/account/export', headers: auth })
    const m = res.json().messagesSent[0]
    expect(m.kind).toBe('audio')
    expect(m.text).toBeNull()                       // 元信息 only
    expect(m.location).toBeNull()                   // 非位置 → 无坐标
    expect(res.payload).not.toContain('base64,AAAA') // data URL 绝不内联
    await a.close()
  })

  it('位置消息导出坐标（本人自己分享的位置属可携权；坏坐标省略）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const me = await reg('exportloc', 'blind')
    const peer = await reg('exportloc2', 'helper')
    const auth = { authorization: `Bearer ${me.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'exportloc2', relation: '亲友' } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: { authorization: `Bearer ${peer.token}` } })
    await a.inject({ method: 'POST', url: '/api/messages', headers: auth, payload: { toId: peer.user.id, kind: 'location', text: JSON.stringify({ lat: 31.23, lng: 121.47, name: '人民广场' }) } })
    const body = (await a.inject({ method: 'GET', url: '/api/account/export', headers: auth })).json()
    const m = body.messagesSent[0]
    expect(m.kind).toBe('location')
    expect(m.text).toBeNull()                                              // location 不走 text 字段
    expect(m.location).toMatchObject({ lat: 31.23, lng: 121.47, name: '人民广场' }) // 本人分享的坐标进导出
    await a.close()
  })

  it('含本人 KYC 元数据（状态/证件类型/尾4位/在档姓名标记）；绝不把姓名/证件号密文解密进导出', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const me = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'kycexport', password: 'secret123', role: 'helper' } })).json()
    // 直接造一条已通过的认证：含密文姓名 + 明文尾4位。
    store.createVerification({
      id: 'vx', userId: me.user.id, status: 'verified', idType: 'national_id', idLast4: '1234',
      nameSealed: { keyId: 'k1', wrappedDek: 'wrapWWW', iv: 'ivZZZ', tag: 'tagQQQ', ct: 'SECRET_NAME_CIPHERTEXT' },
      submittedVia: 'self', submittedById: me.user.id, submittedAt: 1000, decidedAt: 2000, attempt: 1, consentVersion: 'kyc-v1',
    } as any)
    const res = await a.inject({ method: 'GET', url: '/api/account/export', headers: { authorization: `Bearer ${me.token}` } })
    const body = res.json()
    expect(body.kyc).toMatchObject({ status: 'verified', idType: 'national_id', idLast4: '1234', legalNameOnFile: true, attempt: 1, consentVersion: 'kyc-v1' })
    // 数据最小化：密文姓名与 sealed 结构绝不出现在导出里。
    expect(res.payload).not.toContain('SECRET_NAME_CIPHERTEXT')
    expect(res.payload.toLowerCase()).not.toContain('namesealed')
    await a.close()
  })

  it('无 KYC 记录则 kyc 为 null', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const me = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'nokyc', password: 'secret123', role: 'blind' } })).json()
    const res = await a.inject({ method: 'GET', url: '/api/account/export', headers: { authorization: `Bearer ${me.token}` } })
    expect(res.json().kyc).toBeNull()
    await a.close()
  })

  it('只导出"你拉黑了谁"(blocking)，不导出"谁拉黑了你"(blockedBy)——不向本人暴露谁在躲他（防报复）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role: 'blind' } })).json()
    const me = await reg('blkme')
    const iBlocked = await reg('blkvictim')   // 我主动拉黑的人（属我的数据 → 应导出）
    const blockedMe = await reg('blkabuser')  // 拉黑了我的人（属他的数据 → 绝不在我的导出里暴露）
    const auth = { authorization: `Bearer ${me.token}` }
    await a.inject({ method: 'POST', url: '/api/blocks', headers: auth, payload: { userId: iBlocked.user.id } })
    await a.inject({ method: 'POST', url: '/api/blocks', headers: { authorization: `Bearer ${blockedMe.token}` }, payload: { userId: me.user.id } })

    const res = await a.inject({ method: 'GET', url: '/api/account/export', headers: auth })
    const body = res.json()
    // 我拉黑的人在导出里（我的决定＝我的数据）。
    expect(body.blocks.blocking.some((b: { other: string }) => b.other === 'blkvictim')).toBe(true)
    // "谁拉黑了我"整个字段不存在——绝不向本人（可能是被拉黑的骚扰方）披露谁在躲他。
    expect(body.blocks.blockedBy).toBeUndefined()
    expect(res.payload).not.toContain('blockedBy')
    expect(res.payload).not.toContain('blkabuser') // 拉黑我的人名不出现在我的导出里
    await a.close()
  })

  it('自助导出含本人头像原图（自己上传的照片=本人数据，GDPR 可携）；admin 底座只标 hasAvatar、不含原图（最小化）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const me = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'avexport', password: 'secret123', role: 'blind' } })).json()
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANS'
    store.updateUser(me.user.id, { avatar: dataUrl })

    const body = (await a.inject({ method: 'GET', url: '/api/account/export', headers: { authorization: `Bearer ${me.token}` } })).json()
    expect(body.avatar).toBe(dataUrl)          // 自助版含头像原图
    expect(body.profile.hasAvatar).toBe(true)

    // admin 代办导出的底座（buildUserExportBundle）不含 avatar 字段（只 hasAvatar），与住址/健康数据同的最小化。
    const adminBase = buildUserExportBundle(store, me.user.id, Date.now())!
    expect('avatar' in adminBase).toBe(false)
    expect(adminBase.profile.hasAvatar).toBe(true)
    await a.close()
  })
})
