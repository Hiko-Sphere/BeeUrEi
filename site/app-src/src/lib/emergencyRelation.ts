/// 紧急联系人关系**方向**（纯逻辑，可单测）：同一个 isEmergency 标志因谁是链 owner 而含义相反——
/// - theyAreMine：我是 owner，是我把对方设为**我的**紧急联系人（我遇险时通知 TA）。
/// - iAmTheirs：对方是 owner，是对方把**我**设为 TA 的紧急联系人（TA 遇险时通知我——我对 TA 负责）。
/// 此前 web 对两种方向都笼统显示"紧急联系人",让协助者误以为对方是自己的紧急联系人、
/// 而非意识到"我才是对方遇险时被叫的人"——安全责任方向的误读。

export type EmergencyDirection = 'none' | 'theyAreMine' | 'iAmTheirs'

/// amOwner: 我是否为该链 owner（服务端 viewLink 提供）。
/// - undefined（老数据/无此字段）→ 回退 'theyAreMine'（沿用旧通用标签，缺信息时不做方向性断言）。
/// - 对 incoming 待确认请求：发起者恒为 owner，故调用方应显式传 amOwner=false（→ iAmTheirs）。
export function emergencyDirection(isEmergency: boolean | undefined, amOwner: boolean | undefined): EmergencyDirection {
  if (!isEmergency) return 'none'
  if (amOwner === false) return 'iAmTheirs'
  return 'theyAreMine'
}
