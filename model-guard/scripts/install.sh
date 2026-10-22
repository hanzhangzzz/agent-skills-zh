#!/usr/bin/env bash
# model-guard 安装入口：幂等，重跑即更新；改 settings.json 前自动备份。
#
#   bash install.sh [--models fable,astra] [--reserve-5h 40] [--reserve-7d 50]   安装/更新
#   bash install.sh --status      现状表（配置、hook、状态栏旁路、软提示、用量数据）
#   bash install.sh --selftest    在临时目录伪造数据，验证拦截与放行真的生效
#   bash install.sh --uninstall   移除 hook、还原状态栏、删除软提示块，保留配置文件
#
# 环境变量 CLAUDE_HOME / CODEX_HOME 可覆盖 ~/.claude、~/.codex（测试用）。
set -u
command -v python3 >/dev/null 2>&1 || { echo "❌ 需要 python3" >&2; exit 1; }
exec python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install.py" "$@"
