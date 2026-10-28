#!/bin/bash
# 停止并移除 audio-inbox 的后台任务和程序文件。收件箱、输出目录和日志保留，由用户自己决定是否删除。
set -uo pipefail
LABEL="com.github.hanzhangzzz.audio-inbox"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/audio-inbox"
echo "已卸载 ${LABEL}（收件箱、输出目录和日志 ~/Library/Logs/audio-inbox.log 保留）"
