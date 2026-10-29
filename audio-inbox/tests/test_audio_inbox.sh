#!/bin/bash
# 离线行为测试：直接运行 audio_inbox.sh（不经 launchd），并检查 install.sh 的拒绝路径（不会真正安装）。
# 依赖 macOS 与带 libmp3lame 的 ffmpeg；其他环境跳过。
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ "$(uname)" != Darwin ] || ! command -v ffmpeg >/dev/null; then
  echo "跳过：需要 macOS 和 ffmpeg"; exit 0
fi
HERE="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
fail=0
check() { if eval "$2"; then echo "  ✓ $1"; else echo "  ✗ $1"; fail=1; fi; }

mkdir -p "$W/in/周一" "$W/in/_skip" "$W/out"
ffmpeg -v error -f lavfi -i "sine=f=440:d=2" -c:a aac "$W/in/a b's \"song\"?.m4a"
ffmpeg -v error -f lavfi -i "sine=f=660:d=2" "$W/in/周一/x.WAV"
ffmpeg -v error -f lavfi -i "sine=f=330:d=2" -f lavfi -i "color=c=red:s=64x64:d=2" -shortest -c:a aac -c:v libx264 "$W/in/clip.mp4" 2>/dev/null \
  || ffmpeg -v error -f lavfi -i "sine=f=330:d=2" -c:a aac "$W/in/clip.mp4"
ffmpeg -v error -f lavfi -i "sine=f=550:d=2" -c:a aac "$W/in/_skip/no.m4a"
echo "not audio" > "$W/in/broken.m4a"
: > "$W/in/empty.m4a"
printf 'INBOX=%q\nOUT=%q\nQUALITY=5\nLOG=%q\nNOTIFY=0\n' "$W/in" "$W/out" "$W/log" > "$W/config"

bash "$HERE/scripts/audio_inbox.sh" "$W/config"
echo "运行时："
check "根目录 m4a（含引号、问号、空格）转成 mp3" '[ "$(ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$W/out/a b'"'"'s \"song\"?.mp3")" = mp3 ]'
check "子文件夹大写扩展名 wav 转到同名子文件夹" '[ -f "$W/out/周一/x.mp3" ]'
check "视频只取音轨" '[ "$(ffprobe -v error -show_entries stream=codec_type -of csv=p=0 "$W/out/clip.mp3")" = audio ]'
check "成功的原文件移到 _done 并保持子文件夹" '[ -f "$W/in/_done/周一/x.WAV" ] && [ ! -e "$W/in/周一/x.WAV" ]'
check "下划线文件夹不处理" '[ -f "$W/in/_skip/no.m4a" ] && [ ! -e "$W/out/no.mp3" ]'
check "损坏文件留在收件箱且不留半成品" '[ -f "$W/in/broken.m4a" ] && [ ! -e "$W/out/broken.mp3" ] && [ ! -e "$W/out/broken.mp3.part" ]'
check "空文件跳过" '[ -f "$W/in/empty.m4a" ] && grep -q "空文件" "$W/log"'
before="$(stat -f%m "$W/out/周一/x.mp3")"
bash "$HERE/scripts/audio_inbox.sh" "$W/config"
check "重复运行不重复处理已完成的文件" '[ "$(stat -f%m "$W/out/周一/x.mp3")" = "$before" ]'
ffmpeg -v error -f lavfi -i "sine=f=440:d=2" -c:a aac "$W/in/first.m4a"
bash "$HERE/scripts/audio_inbox.sh" "$W/config" & pid=$!
sleep 1; mkdir -p "$W/in/周二"; ffmpeg -v error -f lavfi -i "sine=f=440:d=2" -c:a aac "$W/in/周二/mid.m4a"
wait $pid
check "处理期间新放入的文件在同一轮被处理" '[ -f "$W/out/周二/mid.mp3" ] && [ -f "$W/out/first.mp3" ]'
check "失败文件同一轮只尝试一次" '[ "$(grep -c "转换失败：broken.m4a" "$W/log")" -le 3 ]'
mkdir "/tmp/audio-inbox-$(id -u).lock" 2>/dev/null && held=1 || held=0
ffmpeg -v error -f lavfi -i "sine=f=440:d=1" -c:a aac "$W/in/later.m4a"
bash "$HERE/scripts/audio_inbox.sh" "$W/config"
check "已有实例运行时直接退出" '[ -f "$W/in/later.m4a" ]'
[ "$held" = 1 ] && rmdir "/tmp/audio-inbox-$(id -u).lock"
echo "not audio" > "$W/in/broken2.m4a"
bash -x "$HERE/scripts/audio_inbox.sh" "$W/config" 2>"$W/trace" >/dev/null
check "NOTIFY=0 时不调 osascript（测试不弹真实通知）" '! grep -q "/usr/bin/osascript" "$W/trace" && grep -q "转换失败：broken2.m4a" "$W/log"'

echo "安装脚本拒绝路径（不安装）："
bash "$HERE/scripts/install.sh" --inbox "$W/i2" >/dev/null 2>&1; rc=$?; check "缺 --out 退出码 2" '[ $rc -eq 2 ]'
bash "$HERE/scripts/install.sh" --inbox "$W/i2" --out "$W/i2/o" >/dev/null 2>&1; rc=$?; check "输出在收件箱内退出码 2" '[ $rc -eq 2 ]'
bash "$HERE/scripts/install.sh" --inbox "$W/i2" --out "$W/o2" --quality 12 >/dev/null 2>&1; rc=$?; check "quality 越界退出码 2" '[ $rc -eq 2 ]'
bash "$HERE/scripts/install.sh" --inbox "$HOME/Desktop/audio-inbox-test-$$" --out "$W/o2" >/dev/null 2>&1; rc=$?
rmdir "$HOME/Desktop/audio-inbox-test-$$" 2>/dev/null
check "桌面目录被拦下退出码 5" '[ $rc -eq 5 ]'
exit $fail
