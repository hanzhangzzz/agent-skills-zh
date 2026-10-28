#!/usr/bin/env bash
# PreToolUse hook：贵模型越过套餐保留线后强制分工。规则见 model_guard.py。
exec python3 "$(dirname "${BASH_SOURCE[0]}")/model_guard.py" guard
