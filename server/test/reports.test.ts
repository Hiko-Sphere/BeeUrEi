import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

async function reg(a: ReturnType<typeof buildApp>, username: string) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  const j = r.json() as { token: string; user: { id: string } }
  return { token: j.token, id: j.user.id }
}

describe('reports', () => {
  it('logged-in user can submit a report against a real target', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter1')
    const target = await reg(a, 'target1')
    const res = await a.inject({
      method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${reporter.token}` },
      payload: { targetUserId: target.id, callId: 'c1', reason: '骚扰' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().report).toMatchObject({ targetUserId: target.id, status: 'open', reason: '骚扰' })
    await a.close()
  })

  it('dedupes repeated open reports against the same target', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter3')
    const target = await reg(a, 'target3')
    const auth = { authorization: `Bearer ${reporter.token}` }
    const r1 = await a.inject({ method: 'POST', url: '/api/reports', headers: auth, payload: { targetUserId: target.id, reason: 'a' } })
    expect(r1.statusCode).toBe(201)
    const r2 = await a.inject({ method: 'POST', url: '/api/reports', headers: auth, payload: { targetUserId: target.id, reason: 'b' } })
    expect(r2.statusCode).toBe(200)
    expect(r2.json().deduped).toBe(true)
    expect(r2.json().report.id).toBe(r1.json().report.id)
    await a.close()
  })

  it('拒绝举报不存在的用户（防伪造 targetUserId 绕过去重灌报）', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter4')
    const res = await a.inject({ method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${reporter.token}` }, payload: { targetUserId: 'ghost-id-nope', reason: 'x' } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('target_not_found')
    await a.close()
  })

  it('拒绝举报自己', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter5')
    const res = await a.inject({ method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${reporter.token}` }, payload: { targetUserId: reporter.id, reason: 'x' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('cannot_report_self')
    await a.close()
  })

  it('requires auth', async () => {
    const a = app()
    const res = await a.inject({ method: 'POST', url: '/api/reports', payload: { targetUserId: 'x', reason: 'y' } })
    expect(res.statusCode).toBe(401)
    await a.close()
  })

  it('validates input', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter2')
    const res = await a.inject({
      method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${reporter.token}` },
      payload: { reason: '' },
    })
    expect(res.statusCode).toBe(400)
    await a.close()
  })

  it('证据去重比对全部开放举报：已有 E1 举报在前时，重复提交同一 E2 证据不再新建重复举报', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reporter = await reg(a, 'repev')
    const target = await reg(a, 'tgtev')
    const auth = { authorization: `Bearer ${reporter.token}` }
    // 举报人拥有两段录制（证据须为本人拥有），且录制**确实拍到了被举报人**（target 是同意被录的参与方）。
    const rec = (id: string) => store.createRecording({ id, callId: 'c', ownerId: reporter.id, consentBy: [target.id], reason: 'r', recordedAt: Date.now() })
    rec('ev1'); rec('ev2')
    const post = (evidenceRecordingId?: string) => a.inject({ method: 'POST', url: '/api/reports', headers: auth, payload: { targetUserId: target.id, reason: 'x', evidenceRecordingId } })

    const r1 = await post('ev1'); expect(r1.statusCode).toBe(201) // 建 R1(E1)
    const r2 = await post('ev2'); expect(r2.statusCode).toBe(201) // 不同证据 → 建 R2(E2)
    // 关键：R1(E1) 在前，重复提交 E2。旧逻辑只看首条 R1(E1≠E2) → 会新建重复 R3(E2)。
    const r3 = await post('ev2')
    expect(r3.statusCode).toBe(200)
    expect(r3.json().deduped).toBe(true)
    expect(r3.json().report.id).toBe(r2.json().report.id) // 去重到 R2，而非新建
    // 全局只应有 2 条开放举报（不因重复 E2 膨胀）。
    const open = store.allReports().filter((r) => r.reporterId === reporter.id && r.status === 'open')
    expect(open).toHaveLength(2)
    // 首条同证据仍去重（原有行为不回退）。
    const r4 = await post('ev1'); expect(r4.statusCode).toBe(200); expect(r4.json().report.id).toBe(r1.json().report.id)
    await a.close()
  })

  it('证据录制须确实拍到被举报人：录制参与者不含 target → 400（防拿无关第三方录制当证据暴露给管理员）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reporter = await reg(a, 'reprel')
    const target = await reg(a, 'tgtrel')
    const third = await reg(a, 'thirdrel')
    const auth = { authorization: `Bearer ${reporter.token}` }
    const post = (evidenceRecordingId: string) => a.inject({ method: 'POST', url: '/api/reports', headers: auth, payload: { targetUserId: target.id, reason: 'x', evidenceRecordingId } })
    // 举报人拥有一段与**第三方**的通话录制（target 不在其中）——拿它举报 target 应被拒。
    store.createRecording({ id: 'unrel', callId: 'c1', ownerId: reporter.id, consentBy: [third.id], reason: 'r', recordedAt: Date.now() })
    expect((await post('unrel')).statusCode).toBe(400)
    // 老录制无 participants 字段：回退 ownerId+consentBy 推导同样生效（含 target 才放行）。
    store.createRecording({ id: 'legacyok', callId: 'c2', ownerId: reporter.id, consentBy: [target.id], reason: 'r', recordedAt: Date.now() })
    expect((await post('legacyok')).statusCode).toBe(201)
    // 显式 participants 含 target 也放行（新录制口径）——不同证据，各自留存 → 201（关键是没被 400 拒）。
    store.createRecording({ id: 'newok', callId: 'c3', ownerId: reporter.id, consentBy: [], participants: [reporter.id, target.id], reason: 'r', recordedAt: Date.now() })
    expect((await post('newok')).statusCode).toBe(201)
    await a.close()
  })
})
