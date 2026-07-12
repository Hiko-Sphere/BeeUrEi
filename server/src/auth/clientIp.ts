/// 限流用客户端标识：本 API 生产形态在 Cloudflare 隧道之后（容器绑 127.0.0.1，直连口被安全组
/// 关死），fastify 的 req.ip 恒为环回/桥接地址——未登录流量会退化成**全站共享一个限流桶**：
/// 一个攻击者打满 login 桶=所有人都登不进（现成的登录 DoS），正常并发用户也互相挤兑。
///
/// 修复：对端是本机/私网（=流量经本机隧道/docker 桥进来）时，采用 Cloudflare 边缘设置的
/// CF-Connecting-IP 作为真实客户端标识。**刻意不用 X-Forwarded-For**：CF 对 XFF 是 append，
/// 最左值可被客户端预置（伪造即可旋转限流桶）；CF-Connecting-IP 则由边缘覆写、不可预置。
/// 对端是公网地址（误部署成直连暴露）时忽略该头——伪造头旋转桶需要先能直连源站，而直连
/// 形态下 req.ip 本就是真实地址，回落即正确。

/// 对端是否本机/私网（IPv4 私段 + 环回 + IPv6 环回/ULA + v4-mapped 形态）。
export function isPrivatePeer(addr: string | undefined): boolean {
  if (!addr) return false
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr // v4-mapped v6 → 纯 v4 再判
  if (a === '::1' || a.toLowerCase().startsWith('fc') || a.toLowerCase().startsWith('fd')) return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a)
  if (!m) return false
  const [o1, o2] = [Number(m[1]), Number(m[2])]
  return o1 === 127 || o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168)
}

/// 限流键：可信对端 + 有 CF-Connecting-IP → 真实客户端 IP；否则 req.ip（本地开发/直连形态本就正确）。
export function rateLimitClientKey(req: {
  ip: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}): string {
  const cfip = req.headers['cf-connecting-ip']
  if (typeof cfip === 'string' && cfip && isPrivatePeer(req.socket?.remoteAddress ?? req.ip)) {
    return `ip:${cfip}`
  }
  return req.ip
}
