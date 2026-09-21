#!/usr/bin/env bash
# 校验 ci-review sticky，并判断当前分支是否满足自动合入条件。
# 用法：verdict_gate.sh check|merge <head-ref> <head-sha> <sticky-file> <merge-globs> [unresolved]
set -uo pipefail

[ "$#" -ge 5 ] || { echo "用法错误：缺少 mode/head-ref/head-sha/sticky-file/merge-globs" >&2; exit 1; }
MODE="$1"
HEAD_REF="$2"
HEAD_SHA="$3"
STICKY_FILE="$4"
MERGE_GLOBS="$5"
UNRESOLVED="${6:-0}"

case "$MODE" in check|merge) ;; *) echo "未知模式：$MODE" >&2; exit 1;; esac
[ -r "$STICKY_FILE" ] || { echo "sticky 不可读：$STICKY_FILE" >&2; exit 1; }
[[ "$UNRESOLVED" =~ ^[0-9]+$ ]] || { echo "未解决线程数不是整数：$UNRESOLVED" >&2; exit 1; }

FIRST_LINE="$(head -n 1 "$STICKY_FILE")"
if [[ "$FIRST_LINE" =~ ^\<\!--[[:space:]]ci-review[[:space:]]last=([^[:space:]]+)[[:space:]]execution=(pass|fail)[[:space:]]value=(pass|fail|na)[[:space:]]--\>$ ]]; then
  STICKY_SHA="${BASH_REMATCH[1]}"
  EXECUTION="${BASH_REMATCH[2]}"
  VALUE="${BASH_REMATCH[3]}"
else
  echo "sticky 协议无效：缺少精确的 last/execution/value 字段" >&2
  exit 1
fi

[ "$STICKY_SHA" = "$HEAD_SHA" ] || { echo "sticky SHA 不是当前 HEAD" >&2; exit 1; }
[ "$EXECUTION" = pass ] || { echo "execution=$EXECUTION，审查未通过" >&2; exit 1; }

IN_SCOPE=0
for pattern in $MERGE_GLOBS; do
  case "$HEAD_REF" in $pattern) IN_SCOPE=1;; esac
done

if [ "$IN_SCOPE" = 1 ]; then
  [ "$VALUE" = pass ] || { echo "value=$VALUE，do 分支价值审查未通过" >&2; exit 1; }
else
  [ "$VALUE" = na ] || { echo "非 do 分支必须使用 value=na" >&2; exit 1; }
fi

if [ "$MODE" = check ]; then
  echo "审查通过：execution=$EXECUTION value=$VALUE"
  exit 0
fi

[ "$IN_SCOPE" = 1 ] || { echo "跳过自动合入：$HEAD_REF 不在范围"; exit 3; }
[ "$UNRESOLVED" = 0 ] || { echo "跳过自动合入：$UNRESOLVED 条未解决线程"; exit 3; }
echo "允许自动合入：$HEAD_REF@$HEAD_SHA"
