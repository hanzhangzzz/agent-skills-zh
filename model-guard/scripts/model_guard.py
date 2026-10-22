#!/usr/bin/env python3
"""model-guard 运行时：PreToolUse 判定（guard）与状态栏旁路落盘（tap）。

    python3 model_guard.py guard   读 hook stdin，放行 exit 0，拦截 exit 2 + stderr 原因
    python3 model_guard.py tap     读 statusLine stdin，落盘 rate_limits，再转交原 statusLine 命令

只用标准库。任何意外都放行（fail open）：闸坏了不能把所有 session 一起锁死。
环境变量 CLAUDE_HOME 可覆盖 ~/.claude（测试用）。
"""
import json
import os
import subprocess
import sys
import time

DEFAULTS = {
    "expensive_models": ["fable", "astra"],
    "cheap_models": ["opus", "sonnet", "haiku"],
    "reserve_5h": 40,
    "reserve_7d": 50,
    "statusline_original": None,
    "version": 1,
}
WINDOWS = (("five_hour", "5h", 18000, "reserve_5h"), ("seven_day", "7d", 604800, "reserve_7d"))
STALE_SECONDS = 6 * 3600
READ_LIMIT_MAX = 200
# 强制分工期间仍放行的工具：问人、任务管理、计划、worktree、协作通信。
# ToolSearch 只加载工具定义，不放行的话 EnterWorktree 这类延迟加载的白名单工具无法调用。
ALLOWED_TOOLS = {
    "AskUserQuestion", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet",
    "EnterPlanMode", "ExitPlanMode", "EnterWorktree", "ExitWorktree", "ScheduleWakeup",
    "SendMessage", "ListAgents", "ToolSearch",
}
AGENT_TOOLS = {"Agent", "Task"}  # Task 是 Agent 工具的旧名


def claude_home():
    return os.environ.get("CLAUDE_HOME") or os.path.join(os.path.expanduser("~"), ".claude")


def config_path():
    return os.path.join(claude_home(), "model-guard.json")


def rate_limits_path():
    return os.path.join(claude_home(), "model-guard", "rate-limits.json")


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(config_path(), encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            cfg.update({k: v for k, v in data.items() if v is not None or k == "statusline_original"})
    except (OSError, ValueError):
        pass
    return cfg


def matches(model, names):
    model = (model or "").lower()
    return any(n and n.lower() in model for n in names or [])


# ── 当前模型 ──────────────────────────────────────────────────────
def last_model(path):
    """只读 transcript 末尾，找最后一条 assistant 的 message.model。窗口逐级放大，避免整文件加载。"""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            for window in (64 << 10, 1 << 20, 8 << 20):
                offset = max(0, size - window)
                f.seek(offset)
                lines = f.read().split(b"\n")
                if offset:
                    lines = lines[1:]  # 第一行可能被截断
                for raw in reversed(lines):
                    if b'"assistant"' not in raw:
                        continue
                    try:
                        entry = json.loads(raw)
                    except ValueError:
                        continue
                    if entry.get("type") != "assistant":
                        continue
                    model = (entry.get("message") or {}).get("model")
                    if model and model != "<synthetic>":
                        return model
                if not offset:
                    break
    except OSError:
        pass
    return None


def current_model(event):
    """subagent 里的 hook 拿到的 transcript_path 仍是主 session 的（实测 2.1.307），
    靠 agent_id 定位 subagent 自己的 transcript，否则贵模型主 session 会把它派出的便宜 subagent 也拦死。"""
    transcript = event.get("transcript_path") or ""
    agent_id = event.get("agent_id")
    if agent_id:
        base = transcript[:-len(".jsonl")] if transcript.endswith(".jsonl") else transcript
        sub = os.path.join(base, "subagents", f"agent-{agent_id}")
        model = last_model(sub + ".jsonl")
        if model:
            return model
        try:
            with open(sub + ".meta.json", encoding="utf-8") as f:
                return json.load(f).get("model")
        except (OSError, ValueError, AttributeError):
            return None
    return last_model(transcript) if transcript else None


# ── 利用率与触发线 ────────────────────────────────────────────────
def to_epoch(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            pass
        try:
            from datetime import datetime
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def used_percent(window):
    """实测 statusLine 给的是 used_percentage（0-100）；兼容 used_percent / utilization。
    utilization 量纲未确认：≤1 按比例，>1 按百分比。"""
    for key in ("used_percentage", "used_percent"):
        if isinstance(window.get(key), (int, float)):
            return float(window[key])
    u = window.get("utilization")
    if isinstance(u, (int, float)):
        return float(u) * 100 if u <= 1 else float(u)
    return None


def load_rate_limits(now):
    try:
        with open(rate_limits_path(), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    saved = to_epoch(data.get("saved_at"))
    if saved is None or now - saved > STALE_SECONDS:
        return None
    return data


def evaluate(rate_limits, cfg, now):
    """返回每个窗口的评估：(label, u, 剩余秒, 保留线%, 当前线%, 是否越线)。缺数据的窗口跳过。"""
    results = []
    for key, label, span, reserve_key in WINDOWS:
        window = rate_limits.get(key)
        if not isinstance(window, dict):
            continue
        u = used_percent(window)
        resets = to_epoch(window.get("resets_at"))
        if u is None or resets is None:
            continue
        left = resets - now
        remaining = min(max(left / span, 0.0), 1.0)
        reserve = float(cfg.get(reserve_key, DEFAULTS[reserve_key]))
        line = reserve * remaining
        results.append((label, u, max(left, 0), reserve, line, (100 - u) < line))
    return results


def fmt_duration(seconds):
    seconds = int(seconds)
    d, rem = divmod(seconds, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    if d:
        return f"{d}天{h}小时"
    if h:
        return f"{h}小时{m}分"
    return f"{m}分"


def describe(results):
    parts = []
    for label, u, left, reserve, line, hit in results:
        state = "越线" if hit else "未越线"
        parts.append(f"{label} 已用 {u:.0f}%（{fmt_duration(left)}后重置，余量 {100 - u:.0f}% "
                     f"对保留线 {reserve:.0f}%×剩余时间 = {line:.0f}%，{state}）")
    return "；".join(parts)


# ── 工具判定 ──────────────────────────────────────────────────────
def tool_verdict(tool, tool_input, cfg):
    """强制分工期间：放行返回 None，拦截返回针对该工具的一句说明。"""
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    cheap = cfg.get("cheap_models") or DEFAULTS["cheap_models"]
    if tool in ALLOWED_TOOLS:
        return None
    if tool in AGENT_TOOLS:
        if tool_input.get("subagent_type") == "fork":
            return "禁止 fork：fork 继承当前贵模型，等于换个壳继续烧配额。"
        if not matches(str(tool_input.get("model") or ""), cheap):
            return f"派 subagent 必须显式传 model={'/'.join(cheap)}（当前 model={tool_input.get('model')!r}）。"
        return None
    if tool == "Read":
        limit = tool_input.get("limit")
        if isinstance(limit, (int, float)) and not isinstance(limit, bool) and 0 < limit <= READ_LIMIT_MAX:
            return None
        return f"Read 只允许带 limit≤{READ_LIMIT_MAX} 的小范围读取，大段阅读请派 subagent。"
    return f"{tool} 属于执行类工具，贵模型不直接调用。"


def guard(stdin):
    try:
        event = json.load(stdin)
    except ValueError:
        return 0
    if not isinstance(event, dict):
        return 0
    cfg = load_config()
    model = current_model(event)
    if not model or not matches(model, cfg.get("expensive_models")):
        return 0
    now = time.time()
    rate_limits = load_rate_limits(now)
    if rate_limits is None:
        return 0
    results = evaluate(rate_limits, cfg, now)
    if not any(r[-1] for r in results):
        return 0
    tool = event.get("tool_name") or ""
    why = tool_verdict(tool, event.get("tool_input"), cfg)
    if why is None:
        return 0
    cheap = "/".join(cfg.get("cheap_models") or DEFAULTS["cheap_models"])
    sys.stderr.write(
        f"[model-guard] 当前模型 {model} 是贵模型，套餐余量已越过保留线，进入强制分工：{describe(results)}。\n"
        f"已拦下 {tool}：{why}请改为：派 subagent（Agent 工具显式传 model={cheap}，禁止 fork）干重活；"
        f"或 /model opus 切到便宜模型；或 /compact 减小上下文。\n")
    return 2


# ── 状态栏旁路 ────────────────────────────────────────────────────
def tap(stdin_bytes):
    try:
        event = json.loads(stdin_bytes or b"{}")
        rate_limits = event.get("rate_limits") if isinstance(event, dict) else None
        if isinstance(rate_limits, dict):
            path = rate_limits_path()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = f"{path}.{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(dict(rate_limits, saved_at=int(time.time())), f)
            os.replace(tmp, path)
    except Exception:  # 落盘失败不能影响状态栏显示
        pass
    original = load_config().get("statusline_original")
    command = original.get("command") if isinstance(original, dict) else None
    if not command:
        return 0
    return subprocess.run(command, shell=True, input=stdin_bytes).returncode


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "guard":
        try:
            return guard(sys.stdin)
        except Exception:
            return 0
    if mode == "tap":
        return tap(sys.stdin.buffer.read())
    print("用法: model_guard.py guard|tap", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
