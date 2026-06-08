import { createHmac } from 'node:crypto'

export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

/// 生成 coturn REST API（use-auth-secret）短时效凭据：
/// username = 过期 unix 时间戳，credential = base64(HMAC-SHA1(username, secret))。
/// 纯逻辑、可单测。客户端用这对凭据连 TURN，过期即失效，无需在 coturn 建用户。
export function turnCredentials(secret: string, ttlSeconds: number, nowMs: number): { username: string; credential: string } {
  const expiry = Math.floor(nowMs / 1000) + ttlSeconds
  const username = String(expiry)
  const credential = createHmac('sha1', secret).update(username).digest('base64')
  return { username, credential }
}

/// 组装客户端用的 ICE servers（STUN 始终给；有 TURN 密钥才给带短时效凭据的 TURN）。
export function buildIceServers(opts: {
  stun: string[]
  turn: string[]
  secret?: string
  ttlSeconds: number
  nowMs: number
}): IceServer[] {
  const servers: IceServer[] = []
  if (opts.stun.length) servers.push({ urls: opts.stun })
  if (opts.secret && opts.turn.length) {
    const { username, credential } = turnCredentials(opts.secret, opts.ttlSeconds, opts.nowMs)
    servers.push({ urls: opts.turn, username, credential })
  }
  return servers
}
