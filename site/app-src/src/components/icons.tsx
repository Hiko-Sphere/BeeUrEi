// 轻量线性图标（继承 currentColor，无第三方依赖）。stroke 1.75，圆角端点，视觉统一。
import type { SVGProps, CSSProperties } from 'react'

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p,
})

export const IconHome = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>)
export const IconPhone = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M5 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L17 14l5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z" /></svg>)
export const IconChat = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M21 11.5a8.5 7.5 0 0 1-12.5 6.6L3 20l1.9-4.3A8.5 7.5 0 1 1 21 11.5Z" /></svg>)
export const IconUsers = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M17.5 14.3A5.5 5.5 0 0 1 20.5 19" /></svg>)
export const IconFilm = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" /></svg>)
export const IconBell = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 9a6 6 0 0 1 12 0c0 5 1.5 6 2 7H4c.5-1 2-2 2-7Z" /><path d="M10.5 20a1.8 1.8 0 0 0 3 0" /></svg>)
export const IconUser = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="8" r="3.6" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>)
export const IconShield = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3Z" /></svg>)
export const IconMicOff = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M9 9V5a3 3 0 0 1 6 0v4M5 11a7 7 0 0 0 11 5.3M19 11a7 7 0 0 1-.5 2.6M12 19v3M3 3l18 18" /></svg>)
export const IconMic = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>)
export const IconFlash = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>)
export const IconZoom = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" /></svg>)
export const IconRecord = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></svg>)
export const IconHangup = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 12c5-4 13-4 18 0l-2.5 3-3.5-1.5V11a12 12 0 0 0-6 0v2.5L5.5 15 3 12Z" /></svg>)
export const IconFlag = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>)
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>)
export const IconSend = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 12 20 4l-6 16-3-7-7-1Z" /></svg>)
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="m5 13 4 4L19 7" /></svg>)
export const IconX = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>)
export const IconPin = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></svg>)
// 低电量：电池外壳 + 仅左侧一小格填充（共享位置者手机快没电，家人主动联系的提醒）。
export const IconBattery = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="3" y="8" width="16" height="8" rx="2" /><path d="M21 11v2" /><rect x="5" y="10" width="3" height="4" rx="0.5" fill="currentColor" stroke="none" /></svg>)
// 品牌 Logo：直接用现有的官方 logo（site/public/assets/logo.svg，已随构建打包到 /app/logo.svg），
// 不再用占位图形。圆角方形深底 + 蜂巢蜜蜂。
export const IconLogo = ({ width = 28, height = 28, className, style }: { width?: number; height?: number; className?: string; style?: CSSProperties }) => (
  <img src={`${import.meta.env.BASE_URL}logo.svg`} width={width} height={height} alt="BeeUrEi"
    className={className} style={{ borderRadius: Math.round(Number(width) * 0.22), ...style }} />
)
