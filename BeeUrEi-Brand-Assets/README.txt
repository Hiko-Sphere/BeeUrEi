BeeUrEi 品牌资产包
==============================================================

概念
  名字 BeeUrEi = “Be Your Eye”（成为你的眼睛）。一只蜜蜂正好是眼睛的瞳孔——
  它替你“看”路。外圈微光暗示 LiDAR 扫描 / 空间音 / 蜂鸣；蜂蜜黄 + 深蓝近黑
  既是蜜蜂本色，也是通用警示/安全色，并满足低视力用户所需的高对比。

配色
  蜂蜜黄（主）          #FFC42E
  蜂蜜黄·高光           #FFD874
  蜂蜜黄·深（浅底用）   #E89B12
  墨蓝（纹理 / 底）     #14161F
  深蓝面板             #1E2230
  浅色底               #F1F2F6

字体
  拉丁：SF Pro Display / Helvetica Neue / Arial（系统无衬线）
  中文：PingFang SC / Noto Sans CJK
  文字标识为“可编辑文本”，换字体或文案直接改对应 SVG 即可。

目录结构
  01-app-icon/
    beeurei-app-icon-square.(svg/png)     方形满版，iOS 用（系统自动切圆角、无透明通道）
    beeurei-app-icon-rounded.(svg/png)    圆角版，用于网页 / 商店 / 演示（1024 / 512 / 256）
  02-mark/
    beeurei-mark-color.(svg/png)          彩色主图形（透明底，建议深色背景上使用）
    beeurei-mark-mono-honey.(svg/png)     单色·蜂蜜黄线稿（深色背景）
    beeurei-mark-mono-ink.(svg/png)       单色·墨蓝线稿（浅色背景）
  03-wordmark/
    beeurei-wordmark-horizontal-dark      横向文字标识（深色背景）
    beeurei-wordmark-horizontal-light     横向文字标识（浅色背景）
    beeurei-wordmark-stacked-dark         竖排文字标识（深色背景）
  04-ios-appicon/AppIcon.appiconset/      可直接拖进 Xcode 的图标集
  05-brand-board/                         一张总览图（含全部变体）

iOS 用法
  将 04-ios-appicon/AppIcon.appiconset 整个文件夹拖进 Xcode 的 Assets.xcassets，
  覆盖原有 AppIcon 即可。已包含全部 iPhone / iPad 尺寸 + App Store 1024 与 Contents.json。
  若使用新版“单尺寸”方式，也可只取 icon-1024.png 自行配置。

使用建议
  - 深色背景：用彩色图形或蜂蜜黄单色版。
  - 浅色背景：用墨蓝单色版（彩色版的白色翅膀在浅底上会看不清）。
  - 留白：图标四周至少留出约“一个眼睛高度”的安全距离。
  - 最小可用：约 24pt 仍可辨识；更小处建议改用单色版。

  SVG 为矢量源文件，可无限缩放与二次编辑；PNG 为对应导出位图。
