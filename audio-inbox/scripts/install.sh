#!/bin/bash
# 安装（或重装）audio-inbox：建目录、写配置、生成并加载 launchd 任务。可重复执行，重装会覆盖旧配置。
# 用法：install.sh --inbox <收件箱目录> --out <输出目录> [--quality 0-9] [--force]
# 退出码：2 参数错误 / 3 非 macOS / 4 缺 ffmpeg / 5 目录受隐私保护（加 --force 跳过）
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.github.hanzhangzzz.audio-inbox"
APP="$HOME/Library/Application Support/audio-inbox"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/audio-inbox.log"
INBOX="" OUT="" QUALITY=2 FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --inbox) INBOX="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --quality) QUALITY="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done
[ -n "$INBOX" ] && [ -n "$OUT" ] || { echo "需要 --inbox 和 --out" >&2; exit 2; }
case "$QUALITY" in [0-9]) ;; *) echo "--quality 取 0–9（越小音质越高，默认 2 约 190kbps）" >&2; exit 2 ;; esac

[ "$(uname)" = Darwin ] || { echo "目前只支持 macOS（依赖 launchd）" >&2; exit 3; }
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v ffmpeg >/dev/null || ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libmp3lame; then
  echo "缺少带 libmp3lame 的 ffmpeg。可用 Homebrew 安装：brew install ffmpeg" >&2
  exit 4
fi

abspath() { mkdir -p "$1" && (cd "$1" && pwd -P); }
INBOX="$(abspath "$INBOX")"; OUT="$(abspath "$OUT")"
[ "$INBOX" != "$OUT" ] || { echo "收件箱和输出目录不能是同一个" >&2; exit 2; }
case "$OUT/" in "$INBOX"/*) echo "输出目录不能放在收件箱里面" >&2; exit 2 ;; esac

# 后台任务默认没有“桌面/文稿/下载/iCloud 云盘”的访问权限，放在这些位置会静默失败
if [ "$FORCE" = 0 ]; then
  for d in "$INBOX" "$OUT"; do
    case "$d/" in
      "$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Downloads/"*|"$HOME/Library/Mobile Documents/"*)
        echo "$d 受 macOS 隐私保护，后台任务默认无权读写。请换到个人文件夹下的普通目录（如 ~/音频收件箱），或给 /bin/bash 开“完全磁盘访问权限”后加 --force" >&2
        exit 5 ;;
    esac
  done
fi

mkdir -p "$APP" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$INBOX/_done"
cp "$HERE/audio_inbox.sh" "$APP/audio_inbox.sh"
{
  printf 'INBOX=%q\n' "$INBOX"
  printf 'OUT=%q\n' "$OUT"
  printf 'QUALITY=%q\n' "$QUALITY"
  printf 'LOG=%q\n' "$LOG"
} > "$APP/config"

xml() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; printf '%s' "$s"; }
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml "$APP/audio_inbox.sh")</string>
    <string>$(xml "$APP/config")</string>
  </array>
  <key>WatchPaths</key><array><string>$(xml "$INBOX")</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$(xml "$HOME/Library/Logs/audio-inbox.err.log")</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "已安装：$LABEL"
echo "收件箱：$INBOX"
echo "输出：  $OUT"
echo "日志：  $LOG"
