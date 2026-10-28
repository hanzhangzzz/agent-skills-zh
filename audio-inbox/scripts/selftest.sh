#!/bin/bash
# 装好后的真实自检：生成一段 3 秒的 m4a 放进收件箱，等后台任务把它转成 mp3，核对后清理测试文件。
# 退出码：0 通过 / 1 超时或产物不对 / 2 未安装
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
CONF="$HOME/Library/Application Support/audio-inbox/config"
[ -f "$CONF" ] || { echo "未安装（找不到 ${CONF}）" >&2; exit 2; }
# shellcheck source=/dev/null
. "$CONF"

name="audio-inbox-自检-$$"
tmp="$(mktemp -d)"
ffmpeg -v error -f lavfi -i "sine=f=440:d=3" -c:a aac "$tmp/$name.m4a" || exit 1
cp "$tmp/$name.m4a" "$INBOX/"
rm -rf "$tmp"

echo "已放入测试文件，等待后台任务处理（最长 150 秒）…"
for _ in $(seq 1 75); do
  [ -f "$OUT/$name.mp3" ] && [ -f "$INBOX/_done/$name.m4a" ] && break
  sleep 2
done
if [ -f "$OUT/$name.mp3" ] && [ -f "$INBOX/_done/$name.m4a" ]; then
  dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$name.mp3")"
  rm -f "$OUT/$name.mp3" "$INBOX/_done/$name.m4a"
  echo "✅ 通过：m4a 已转成 mp3（时长 ${dur}s），原文件已移到 _done；测试文件已清理"
  exit 0
fi
echo "❌ 失败：150 秒内没有得到 mp3。最近日志：" >&2
tail -n 5 "$LOG" >&2 2>/dev/null
tail -n 5 "$HOME/Library/Logs/audio-inbox.err.log" >&2 2>/dev/null
rm -f "$INBOX/$name.m4a"
exit 1
