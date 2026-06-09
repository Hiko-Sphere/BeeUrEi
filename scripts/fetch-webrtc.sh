#!/usr/bin/env bash
# 下载并解压 WebRTC.xcframework 到 Frameworks/（A2 真实音视频）。
# 需能访问 github.com（CI / 海外网络）。国内开发机若已本地 vendored 则无需运行（文件已在 Frameworks/）。
# 用法：bash scripts/fetch-webrtc.sh
set -euo pipefail

VERSION="148.0.0"
URL="https://github.com/stasel/WebRTC/releases/download/${VERSION}/WebRTC-M148.xcframework.zip"
DEST="Frameworks"

if [ -d "${DEST}/WebRTC.xcframework" ]; then
  echo "✓ ${DEST}/WebRTC.xcframework 已存在，跳过下载。"
  exit 0
fi

mkdir -p "${DEST}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "下载 ${URL} ..."
curl -L --fail -o "${TMP}/webrtc.zip" "${URL}"
unzip -q "${TMP}/webrtc.zip" -d "${TMP}"

FW="$(find "${TMP}" -maxdepth 2 -name 'WebRTC.xcframework' -type d | head -1)"
if [ -z "${FW}" ]; then
  echo "✗ 解压后未找到 WebRTC.xcframework" >&2
  exit 1
fi
mv "${FW}" "${DEST}/"
echo "✓ 已就绪：${DEST}/WebRTC.xcframework"
