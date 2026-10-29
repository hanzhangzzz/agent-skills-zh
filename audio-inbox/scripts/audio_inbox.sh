#!/bin/bash
# audio-inbox 运行时：把收件箱里的音频/视频转成 mp3 放进输出目录，成功后把原文件移到 收件箱/_done/。
# 由 launchd 以 `/bin/bash 本脚本 配置文件` 启动（WatchPaths 监听收件箱 + StartInterval 兜底）。
# 支持一层子文件夹：收件箱/周一/a.m4a → 输出/周一/a.mp3。以下划线开头的文件夹（如 _done）不处理。
# 有意不加 set -e：单个文件失败不应阻塞其他文件。
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CONF="${1:?用法: audio_inbox.sh <配置文件>}"
unset NOTIFY LOCK                          # 只认配置文件，不受外部同名环境变量影响
# shellcheck source=/dev/null
. "$CONF"                                  # 提供 INBOX OUT QUALITY LOG，可选 NOTIFY LOCK
DONE="$INBOX/_done"
LOCK="${LOCK:-/tmp/audio-inbox-$(id -u).lock}"   # 配置可覆盖（测试用，避免与真实实例抢锁）
EXTS="m4a aac wav flac ogg opus amr wma mp4 mov"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# 通知内容通过 argv 传入 AppleScript，文件名不会被当作代码执行；配置里 NOTIFY=0 则不弹（测试用）
notify() {
  [ "${NOTIFY:-1}" = 0 ] && return 0
  /usr/bin/osascript - "$1" "$2" >/dev/null 2>&1 <<'EOF' || true
on run argv
  display notification (item 2 of argv) with title "音频收件箱" subtitle (item 1 of argv)
end run
EOF
}

# 互斥：macOS 没有 flock，用 mkdir 原子锁；超过 2 小时的锁视为残留
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

shopt -s nullglob nocaseglob
scan() {
  files=()
  for ext in $EXTS; do
    for f in "$INBOX"/*."$ext" "$INBOX"/*/*."$ext"; do
      case "$f" in "$INBOX"/_*) continue ;; esac
      files+=("$f")
    done
  done
}

convert_one() {
  local src="$1" rel sub name base outdir donedir dest prev cur work
  [ -f "$src" ] || return 0
  rel="${src#"$INBOX"/}"
  sub="$(dirname "$rel")"
  name="$(basename "$src")"
  base="${name%.*}"
  if [ "$sub" = "." ]; then outdir="$OUT"; donedir="$DONE"; else outdir="$OUT/$sub"; donedir="$DONE/$sub"; fi
  mkdir -p "$outdir" "$donedir"
  dest="$outdir/$base.mp3"

  # 等文件大小稳定（另存为、下载、同步可能还在写）
  prev=-1; cur=0
  for _ in 1 2 3 4 5 6; do
    cur=$(stat -f%z "$src" 2>/dev/null || echo 0)
    [ "$cur" = "$prev" ] && break
    prev="$cur"; sleep 2
  done
  [ "$cur" -gt 0 ] || { log "⏭ 空文件，跳过：$rel"; return 0; }

  if [ ! -f "$dest" ] || [ "$src" -nt "$dest" ]; then
    log "转换：$rel"
    # ffmpeg 只读写临时目录，收件箱和输出目录里的文件由 cp/mv 搬进搬出：
    # 这样即使目录受 macOS 隐私权限保护，也只需要 bash 有权限，不必给 ffmpeg 单独授权
    work="$(mktemp -d -t audio-inbox)"
    if cp "$src" "$work/in" \
       && ffmpeg -nostdin -y -i "$work/in" -vn -codec:a libmp3lame -q:a "$QUALITY" "$work/out.mp3" -hide_banner -loglevel error 2>>"$LOG" \
       && cp "$work/out.mp3" "$dest.part" && mv -f "$dest.part" "$dest"; then
      rm -rf "$work"
    else
      rm -rf "$work"; rm -f "$dest.part"
      log "❌ 转换失败：${rel}（原文件留在收件箱）"
      notify "转换失败" "$name"
      return 0
    fi
  fi
  mv -f "$src" "$donedir/"
  log "✅ $rel → $dest"
  notify "已转成 mp3" "$base.mp3"
}

scan
if [ ${#files[@]} -eq 0 ]; then
  # 读不了收件箱（多半是 macOS 隐私权限拦截）要留痕，否则就是静默失败
  err="$(ls "$INBOX" 2>&1 >/dev/null)" && exit 0
  log "❌ 无法读取收件箱 ${INBOX}：$err"
  exit 0
fi

# 处理期间新放进来的文件触发的那次运行会因为拿不到锁而退出，所以处理完要重新扫描，直到没有新文件。
# 本轮试过的文件（含失败、空文件）不再重试，避免死循环；它们等下一次触发或定时轮询。
seen=$'\n'
while :; do
  todo=()
  for f in ${files[@]+"${files[@]}"}; do
    case "$seen" in *$'\n'"$f"$'\n'*) ;; *) todo+=("$f") ;; esac
  done
  [ ${#todo[@]} -gt 0 ] || break
  for src in "${todo[@]}"; do
    seen+="$src"$'\n'
    convert_one "$src"
  done
  scan
done
exit 0
