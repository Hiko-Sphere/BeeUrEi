import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Store, User, Role, UserStatus, FamilyLink, Report, ReportStatus, Recording, RecordingConfig } from './store'

// 用运行时 require + 非静态模块名加载 node:sqlite，避免打包器(vitest/vite)静态解析失败；
// 由 Node 在运行时解析（需 --experimental-sqlite，已在 npm 脚本里通过 NODE_OPTIONS 开启）。
const nodeRequire = createRequire(import.meta.url)
const sqliteModuleName = ['node', 'sqlite'].join(':')
const { DatabaseSync } = nodeRequire(sqliteModuleName) as { DatabaseSync: typeof DatabaseSyncType }

/// SQLite 持久化（用 Node 内置 `node:sqlite`，零原生依赖；需 --experimental-sqlite）。
/// 与 Store 接口对齐，可平滑替换 JSON 文件存储。
export class SqliteStore implements Store {
  private db: DatabaseSyncType

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE, passwordHash TEXT,
        displayName TEXT, role TEXT, status TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY, ownerId TEXT, memberId TEXT, relation TEXT,
        isEmergency INTEGER, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, reporterId TEXT, targetUserId TEXT, callId TEXT,
        reason TEXT, status TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY, callId TEXT, ownerId TEXT, consentBy TEXT,
        reason TEXT, recordedAt INTEGER);
      CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT);
    `)
  }

  // MARK: users
  createUser(u: User): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO users (id, username, passwordHash, displayName, role, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(u.id, u.username, u.passwordHash, u.displayName, u.role, u.status, u.createdAt)
  }
  findByUsername(username: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username)
    return row ? this.toUser(row) : undefined
  }
  findById(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    return row ? this.toUser(row) : undefined
  }
  allUsers(): User[] {
    return this.db.prepare('SELECT * FROM users').all().map((r) => this.toUser(r))
  }
  updateUser(id: string, patch: Partial<User>): User | undefined {
    const cur = this.findById(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.createUser(next)
    return next
  }

  // MARK: links
  createLink(l: FamilyLink): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO links (id, ownerId, memberId, relation, isEmergency, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(l.id, l.ownerId, l.memberId, l.relation, l.isEmergency ? 1 : 0, l.createdAt)
  }
  linksByOwner(ownerId: string): FamilyLink[] {
    return this.db.prepare('SELECT * FROM links WHERE ownerId = ?').all(ownerId).map((r) => this.toLink(r))
  }
  linksByMember(memberId: string): FamilyLink[] {
    return this.db.prepare('SELECT * FROM links WHERE memberId = ?').all(memberId).map((r) => this.toLink(r))
  }
  findLink(id: string): FamilyLink | undefined {
    const row = this.db.prepare('SELECT * FROM links WHERE id = ?').get(id)
    return row ? this.toLink(row) : undefined
  }
  deleteLink(id: string): void {
    this.db.prepare('DELETE FROM links WHERE id = ?').run(id)
  }

  // MARK: reports
  createReport(r: Report): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO reports (id, reporterId, targetUserId, callId, reason, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(r.id, r.reporterId, r.targetUserId, r.callId ?? null, r.reason, r.status, r.createdAt)
  }
  allReports(): Report[] {
    return this.db.prepare('SELECT * FROM reports').all().map((r) => this.toReport(r))
  }
  findReport(id: string): Report | undefined {
    const row = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id)
    return row ? this.toReport(row) : undefined
  }
  updateReport(id: string, patch: Partial<Report>): Report | undefined {
    const cur = this.findReport(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.createReport(next)
    return next
  }

  // MARK: recordings + config
  getRecordingConfig(): RecordingConfig {
    const row = this.db.prepare('SELECT v FROM config WHERE k = ?').get('recording') as { v: string } | undefined
    if (!row) return { enabled: false, retentionDays: 7, requireConsent: true }
    return JSON.parse(row.v) as RecordingConfig
  }
  setRecordingConfig(patch: Partial<RecordingConfig>): RecordingConfig {
    const next = { ...this.getRecordingConfig(), ...patch }
    this.db.prepare('INSERT OR REPLACE INTO config (k, v) VALUES (?, ?)').run('recording', JSON.stringify(next))
    return next
  }
  createRecording(rec: Recording): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO recordings (id, callId, ownerId, consentBy, reason, recordedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(rec.id, rec.callId, rec.ownerId, JSON.stringify(rec.consentBy), rec.reason, rec.recordedAt)
  }
  allRecordings(): Recording[] {
    return this.db.prepare('SELECT * FROM recordings').all().map((r) => this.toRecording(r))
  }
  findRecording(id: string): Recording | undefined {
    const row = this.db.prepare('SELECT * FROM recordings WHERE id = ?').get(id)
    return row ? this.toRecording(row) : undefined
  }
  deleteRecording(id: string): void {
    this.db.prepare('DELETE FROM recordings WHERE id = ?').run(id)
  }

  // MARK: row mappers
  private toUser(r: any): User {
    return { id: r.id, username: r.username, passwordHash: r.passwordHash, displayName: r.displayName, role: r.role as Role, status: r.status as UserStatus, createdAt: Number(r.createdAt) }
  }
  private toLink(r: any): FamilyLink {
    return { id: r.id, ownerId: r.ownerId, memberId: r.memberId, relation: r.relation, isEmergency: Number(r.isEmergency) === 1, createdAt: Number(r.createdAt) }
  }
  private toReport(r: any): Report {
    return { id: r.id, reporterId: r.reporterId, targetUserId: r.targetUserId, callId: r.callId ?? undefined, reason: r.reason, status: r.status as ReportStatus, createdAt: Number(r.createdAt) }
  }
  private toRecording(r: any): Recording {
    return { id: r.id, callId: r.callId, ownerId: r.ownerId, consentBy: JSON.parse(r.consentBy ?? '[]'), reason: r.reason, recordedAt: Number(r.recordedAt) }
  }
}
