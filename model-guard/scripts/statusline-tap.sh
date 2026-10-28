#!/usr/bin/env bash
# statusLine 旁路：落盘 rate_limits，再把原 stdin 交给安装前的 statusLine 命令。
exec python3 "$(dirname "${BASH_SOURCE[0]}")/model_guard.py" tap
