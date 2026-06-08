import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

/// 角色（见 PLAN §14.2）。admin/developer 不可自助注册，由后台分配。
export type Role = 'blind' | 'helper' | 'family' | 'admin' | 'developer'
export type UserStatus = 'active' | 'disabled'

export interface User {
  id: string
  username: string
  passwordHash: string
  displayName: string
  role: Role
  status: UserStatus
  createdAt: number
}

/// 亲友绑定：视障用户(owner) ↔ 亲友/协助者账号(member)，可标记为紧急联系人。
export interface FamilyLink {
  id: string
  ownerId: string
  memberId: string
  relation: string
  isEmergency: boolean
  phone?: string // 亲友真实手机号（App 通话连不上时一键拨打兜底）
  createdAt: number
}

/// 举报（通话后一键举报 → 管理员审核）。
export type ReportStatus = 'open' | 'resolved'
export interface Report {
  id: string
  reporterId: string
  targetUserId: string
  callId?: string
  reason: string
  status: ReportStatus
  createdAt: number
}

/// refresh token（仅存哈希，轮换+撤销）。
export interface RefreshToken {
  tokenHash: string
  userId: string
  expiresAt: number
}

/// 录制策略（Q6）：默认不录、需同意、到期自动删。
export interface RecordingConfig {
  enabled: boolean
  retentionDays: number
  requireConsent: boolean
}

/// 一条录制的元数据（媒体文件本身由客户端/录制器处理，这里只管元数据与留存）。
export interface Recording {
  id: string
  callId: string
  ownerId: string
  consentBy: string[]
  reason: string
  recordedAt: number
}

/// 持久化接口——上层只依赖它；可换内存 / JSON 文件 / 未来 SQLite。
export interface Store {
  createUser(user: User): void
  findByUsername(username: string): User | undefined
  findById(id: string): User | undefined
  allUsers(): User[]
  updateUser(id: string, patch: Partial<User>): User | undefined
  deleteUser(id: string): void

  createLink(link: FamilyLink): void
  linksByOwner(ownerId: string): FamilyLink[]
  linksByMember(memberId: string): FamilyLink[]
  findLink(id: string): FamilyLink | undefined
  deleteLink(id: string): void

  createReport(report: Report): void
  allReports(): Report[]
  findReport(id: string): Report | undefined
  updateReport(id: string, patch: Partial<Report>): Report | undefined

  createRefreshToken(rt: RefreshToken): void
  findRefreshToken(tokenHash: string): RefreshToken | undefined
  deleteRefreshToken(tokenHash: string): void
  deleteRefreshTokensForUser(userId: string): void

  getRecordingConfig(): RecordingConfig
  setRecordingConfig(patch: Partial<RecordingConfig>): RecordingConfig
  createRecording(rec: Recording): void
  allRecordings(): Recording[]
  findRecording(id: string): Recording | undefined
  deleteRecording(id: string): void
}

/// 内存实现（测试用）。
export class MemoryStore implements Store {
  protected users = new Map<string, User>()
  protected links = new Map<string, FamilyLink>()
  protected reports = new Map<string, Report>()
  protected recordings = new Map<string, Recording>()
  protected refreshTokens = new Map<string, RefreshToken>()
  protected recordingConfig: RecordingConfig = { enabled: false, retentionDays: 7, requireConsent: true }

  createRefreshToken(rt: RefreshToken): void {
    this.refreshTokens.set(rt.tokenHash, rt)
    this.afterMutate()
  }
  findRefreshToken(tokenHash: string): RefreshToken | undefined {
    return this.refreshTokens.get(tokenHash)
  }
  deleteRefreshToken(tokenHash: string): void {
    if (this.refreshTokens.delete(tokenHash)) this.afterMutate()
  }
  deleteRefreshTokensForUser(userId: string): void {
    let changed = false
    for (const [k, v] of this.refreshTokens) if (v.userId === userId) { this.refreshTokens.delete(k); changed = true }
    if (changed) this.afterMutate()
  }

  createUser(user: User): void {
    this.users.set(user.id, user)
    this.afterMutate()
  }
  findByUsername(username: string): User | undefined {
    for (const u of this.users.values()) if (u.username === username) return u
    return undefined
  }
  findById(id: string): User | undefined {
    return this.users.get(id)
  }
  allUsers(): User[] {
    return [...this.users.values()]
  }
  updateUser(id: string, patch: Partial<User>): User | undefined {
    const u = this.users.get(id)
    if (!u) return undefined
    const next = { ...u, ...patch, id: u.id }
    this.users.set(id, next)
    this.afterMutate()
    return next
  }
  deleteUser(id: string): void {
    if (this.users.delete(id)) this.afterMutate()
  }

  createLink(link: FamilyLink): void {
    this.links.set(link.id, link)
    this.afterMutate()
  }
  linksByOwner(ownerId: string): FamilyLink[] {
    return [...this.links.values()].filter((l) => l.ownerId === ownerId)
  }
  linksByMember(memberId: string): FamilyLink[] {
    return [...this.links.values()].filter((l) => l.memberId === memberId)
  }
  findLink(id: string): FamilyLink | undefined {
    return this.links.get(id)
  }
  deleteLink(id: string): void {
    if (this.links.delete(id)) this.afterMutate()
  }

  createReport(report: Report): void {
    this.reports.set(report.id, report)
    this.afterMutate()
  }
  allReports(): Report[] {
    return [...this.reports.values()]
  }
  findReport(id: string): Report | undefined {
    return this.reports.get(id)
  }
  updateReport(id: string, patch: Partial<Report>): Report | undefined {
    const r = this.reports.get(id)
    if (!r) return undefined
    const next = { ...r, ...patch, id: r.id }
    this.reports.set(id, next)
    this.afterMutate()
    return next
  }

  getRecordingConfig(): RecordingConfig {
    return { ...this.recordingConfig }
  }
  setRecordingConfig(patch: Partial<RecordingConfig>): RecordingConfig {
    this.recordingConfig = { ...this.recordingConfig, ...patch }
    this.afterMutate()
    return { ...this.recordingConfig }
  }
  createRecording(rec: Recording): void {
    this.recordings.set(rec.id, rec)
    this.afterMutate()
  }
  allRecordings(): Recording[] {
    return [...this.recordings.values()]
  }
  findRecording(id: string): Recording | undefined {
    return this.recordings.get(id)
  }
  deleteRecording(id: string): void {
    if (this.recordings.delete(id)) this.afterMutate()
  }

  protected afterMutate(): void { /* 内存无需持久化 */ }
}

/// JSON 文件实现（自托管持久化，零原生依赖）。
export class JsonFileStore extends MemoryStore {
  constructor(private path: string) {
    super()
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as {
          users?: User[]
          links?: FamilyLink[]
          reports?: Report[]
          recordings?: Recording[]
          refreshTokens?: RefreshToken[]
          recordingConfig?: RecordingConfig
        }
        for (const u of data.users ?? []) this.users.set(u.id, u)
        for (const l of data.links ?? []) this.links.set(l.id, l)
        for (const r of data.reports ?? []) this.reports.set(r.id, r)
        for (const rec of data.recordings ?? []) this.recordings.set(rec.id, rec)
        for (const rt of data.refreshTokens ?? []) this.refreshTokens.set(rt.tokenHash, rt)
        if (data.recordingConfig) this.recordingConfig = data.recordingConfig
      } catch {
        /* 损坏的文件忽略，从空开始 */
      }
    }
  }

  protected override afterMutate(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const data = {
      users: [...this.users.values()],
      links: [...this.links.values()],
      reports: [...this.reports.values()],
      recordings: [...this.recordings.values()],
      refreshTokens: [...this.refreshTokens.values()],
      recordingConfig: this.recordingConfig,
    }
    writeFileSync(this.path, JSON.stringify(data, null, 2))
  }
}

/// 对外暴露的安全用户字段（不含 passwordHash）。
export function publicUser(u: User) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, status: u.status }
}
