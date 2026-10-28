#!/usr/bin/env python3
"""model-guard 运行时：PreToolUse 判定（guard）与状态栏旁路落盘（tap）。

    python3 model_guard.py guard   读 hook stdin，放行 exit 0，拦截 exit 2 + stderr 原因
                                   stdin 带 model 字段 → Codex（模型取 stdin，用量取 rollout 的 token_count）
                                   否则 → Claude Code（模型取 transcript 末尾，用量取状态栏落盘）
    python3 model_guard.py tap     读 statusLine stdin，落盘 rate_limits，再转交原 statusLine 命令

只用标准库。任何意外都放行（fail open）：闸坏了不能把所有 session 一起锁死。
环境变量 CLAUDE_HOME 可覆盖 ~/.claude（测试用）。
"""
import hashlib
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
    # 保留线下限：线性递减到窗口末尾会趋近 0，临近重置时闸形同虚设（实测 7d 已用 96%、保留线仅 0.37%）。
    # 下限不超过保留额本身，保留额设 0 仍等于关闭该窗口的闸。
    "reserve_floor_5h": 15,
    "reserve_floor_7d": 15,
    # Codex 的模型名与工具名（实测 codex-cli 0.163.0 hook 里的 tool_name，命名空间直接拼接）
    "codex_cheap_models": ["sol", "luna", "terra", "reserve"],
    "codex_allowed_tools": [
        "request_user_input", "request_user_input_async", "update_plan",
        "collaborationwait_agent", "collaborationlist_agents", "collaborationsend_message",
        "collaborationfollowup_task", "collaborationinterrupt_agent", "collaborationclose_agent",
    ],
    "codex_agent_tools": ["collaborationspawn_agent", "spawn_agent"],
    "statusline_original": None,
    "version": 1,
}
WINDOWS = (("five_hour", "5h", 18000, "reserve_5h"), ("seven_day", "7d", 604800, "reserve_7d"))
SHORT_WINDOW_MINUTES = 360  # Codex 窗口不固定是 primary 还是 secondary，≤6 小时按 5h 口径
STALE_SECONDS = 6 * 3600
# transcript 增量超过此值就不做增量扫描，退回整段倒读（倒读本身最多读 8MB）
MODEL_CACHE_MAX_DELTA = 8 << 20
READ_LIMIT_MAX = 200
# 强制分工期间仍放行的工具：问人、任务管理、计划、worktree、协作通信。
# ToolSearch 只加载工具定义，不放行的话 EnterWorktree 这类延迟加载的白名单工具无法调用。
ALLOWED_TOOLS = {
    "AskUserQuestion", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet",
    "EnterPlanMode", "ExitPlanMode", "EnterWorktree", "ExitWorktree", "ScheduleWakeup",
    "SendMessage", "ListAgents", "ToolSearch", "TaskStop",
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
def tail_entries(path, needle):
    """倒序产出 JSONL 末尾含 needle 的行（已解析）。窗口逐级放大，避免整文件加载。"""
    if not path:
        return
    try:
        size = os.path.getsize(path)
        f = open(path, "rb")
    except OSError:
        return
    with f:
        end = size  # [end, size) 已扫过
        for window in (64 << 10, 1 << 20, 8 << 20):
            offset = max(0, size - window)
            if offset >= end:
                continue
            f.seek(offset)
            lines = f.read(end - offset).split(b"\n")
            # 非文件开头时第一段可能是被截断的行，留给下一轮更大的窗口
            end = offset + len(lines.pop(0)) if offset else 0
            for raw in reversed(lines):
                if needle not in raw:
                    continue
                try:
                    entry = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(entry, dict):
                    yield entry
            if not offset:
                return


def entry_model(entry):
    message = entry.get("message")
    if entry.get("type") != "assistant" or not isinstance(message, dict):
        return None  # 畸形行跳过，继续往前找
    model = message.get("model")
    return model if isinstance(model, str) and model and model != "<synthetic>" else None


def scan_model(path):
    """整段倒读：transcript 最后一条 assistant 的 message.model。"""
    for entry in tail_entries(path, b'"assistant"'):
        model = entry_model(entry)
        if model:
            return model
    return None


def model_cache_path(path):
    key = hashlib.sha1(os.path.realpath(path).encode("utf-8", "surrogateescape")).hexdigest()[:20]
    return os.path.join(claude_home(), "model-guard", "model-cache", key + ".json")


def complete_end(f, size):
    """文件里最后一个完整行的结尾偏移（transcript 只追加，之后的增量从这里读起不会切断行）。"""
    pos = size
    while pos > 0:
        step = min(pos, 64 << 10)
        f.seek(pos - step)
        chunk = f.read(step)
        i = chunk.rfind(b"\n")
        if i >= 0:
            return pos - step + i + 1
        pos -= step
    return 0


def last_model(path):
    """Claude Code transcript 最后一条 assistant 的 message.model。

    每次工具调用都倒读大 transcript 曾耗 5.2 秒（hook 超时 5 秒），所以按 transcript 路径缓存
    {模型, 已扫到的偏移}：命中后只扫偏移之后新追加的行，新行里有 assistant 就以最新一条为准
    （/model 切换立即生效），没有就沿用缓存。文件变短（被重写）或增量过大时退回整段倒读。"""
    try:
        size = os.path.getsize(path)
    except OSError:
        return None
    cache = model_cache_path(path)
    try:
        with open(cache, encoding="utf-8") as f:
            cached = json.load(f)
        model, end = cached["model"], int(cached["end"])
        if not (isinstance(model, str) and model and 0 <= end <= size and size - end <= MODEL_CACHE_MAX_DELTA):
            raise ValueError
    except (OSError, ValueError, KeyError, TypeError):
        model = end = None
    try:
        with open(path, "rb") as f:
            new_end = complete_end(f, size)
            if model is not None:
                f.seek(end)
                for raw in f.read(new_end - end).split(b"\n"):
                    if b'"assistant"' not in raw:
                        continue
                    try:
                        entry = json.loads(raw)
                    except ValueError:
                        continue
                    found = entry_model(entry) if isinstance(entry, dict) else None
                    model = found or model
    except OSError:
        return None
    if model is None:
        model = scan_model(path)
    if model:
        try:
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            tmp = f"{cache}.{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"model": model, "end": new_end}, f)
            os.replace(tmp, cache)
        except OSError:
            pass  # 缓存写不进去只是慢，不影响判定
    return model


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
                meta = json.load(f)
            return meta.get("model") if isinstance(meta, dict) else None
        except (OSError, ValueError, AttributeError):
            return None
    return last_model(transcript) if transcript else None


# ── 利用率与触发线 ────────────────────────────────────────────────
def to_epoch(value):
    """epoch 秒（实测 Claude 与 Codex 的 resets_at 都是秒）；>1e11 视为毫秒。"""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value / 1000.0 if value > 1e11 else float(value)
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
    """0-100 的百分比。实测 Claude 状态栏字段为 used_percentage，Codex token_count 为 used_percent。"""
    for key in ("used_percentage", "used_percent"):
        value = window.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
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


def claude_windows(rate_limits):
    """状态栏落盘数据 → [(label, 窗口秒数, 保留额键, 窗口 dict)]"""
    return [(label, span, reserve_key, rate_limits[key]) for key, label, span, reserve_key in WINDOWS
            if isinstance(rate_limits.get(key), dict)]


def codex_windows(path, now):
    """倒序找 rollout 里最后一条带 rate_limits 的 token_count；按 window_minutes 归入 5h/7d 口径。"""
    for entry in tail_entries(path, b'"token_count"'):
        payload = entry.get("payload")
        if entry.get("type") != "event_msg" or not isinstance(payload, dict) or payload.get("type") != "token_count":
            continue
        rate_limits = payload.get("rate_limits")
        if not isinstance(rate_limits, dict):
            continue
        stamp = to_epoch(entry.get("timestamp"))
        if stamp is not None and now - stamp > STALE_SECONDS:
            return []
        out = []
        for key in ("primary", "secondary"):
            window = rate_limits.get(key)
            minutes = window.get("window_minutes") if isinstance(window, dict) else None
            if not isinstance(minutes, (int, float)) or minutes <= 0:
                continue
            short = minutes <= SHORT_WINDOW_MINUTES
            out.append(("5h" if short else "7d", minutes * 60, "reserve_5h" if short else "reserve_7d", window))
        return out
    return []


def evaluate(windows, cfg, now):
    """返回每个窗口的评估：(label, u, 剩余秒, 保留额%, 下限%, 当前线%, 是否越线)。缺数据的窗口跳过。

    当前线 = max(保留额 × 剩余时间占比, min(下限, 保留额))：窗口前段按时间线性递减，
    临近重置时不低于下限，避免最后几小时把额度烧光。"""
    results = []
    for label, span, reserve_key, window in windows:
        u = used_percent(window)
        resets = to_epoch(window.get("resets_at"))
        if u is None or resets is None:
            continue
        left = resets - now
        remaining = min(max(left / span, 0.0), 1.0)
        reserve = float(cfg.get(reserve_key, DEFAULTS[reserve_key]))
        floor_key = reserve_key.replace("reserve_", "reserve_floor_")
        floor = min(float(cfg.get(floor_key, DEFAULTS[floor_key])), reserve)
        line = max(reserve * remaining, floor)
        results.append((label, u, max(left, 0), reserve, floor, line, (100 - u) < line))
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
    for label, u, left, reserve, floor, line, hit in results:
        state = "越线" if hit else "未越线"
        parts.append(f"{label} 已用 {u:.0f}%（{fmt_duration(left)}后重置，余量 {100 - u:.0f}% "
                     f"对保留线 max({reserve:.0f}%×剩余时间, 下限 {floor:.0f}%) = {line:.0f}%，{state}）")
    return "；".join(parts)


# ── 工具判定 ──────────────────────────────────────────────────────
def is_codex(event):
    """Codex 的 hook stdin 必带 model（实测 0.163.0）；Claude Code 没有该字段。"""
    return "model" in event


def cheap_models(cfg, codex):
    key = "codex_cheap_models" if codex else "cheap_models"
    return cfg.get(key) or DEFAULTS[key]


def tool_verdict(tool, tool_input, cfg, codex=False):
    """强制分工期间：放行返回 None，拦截返回针对该工具的一句说明。"""
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    cheap = cheap_models(cfg, codex)
    if codex:
        if tool in (cfg.get("codex_allowed_tools") or DEFAULTS["codex_allowed_tools"]):
            return None
        if tool in (cfg.get("codex_agent_tools") or DEFAULTS["codex_agent_tools"]):
            # 不传 model 时子 agent 继承当前贵模型，所以必须显式指定
            if matches(str(tool_input.get("model") or ""), cheap):
                return None
            return f"派子 agent 必须显式传 model 为 {'/'.join(cheap)} 之一（当前 model={tool_input.get('model')!r}）。"
        return f"{tool} 属于执行类工具，贵模型不直接调用。"
    if tool in ALLOWED_TOOLS:
        return None
    if tool in AGENT_TOOLS:
        if tool_input.get("subagent_type") == "fork":
            return "禁止 fork：fork 继承当前贵模型，等于换个壳继续烧配额。"
        if not matches(str(tool_input.get("model") or ""), cheap):
            return f"派 subagent 必须显式传 model={'/'.join(cheap)}（当前 model={tool_input.get('model')!r}）。"
        return None
    if tool == "Read":
        if tool_input.get("pages") not in (None, ""):
            return "Read 带 pages（PDF/文档分页）不受 limit 约束，一律拒绝，请派 subagent 阅读。"
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
    codex = is_codex(event)
    model = event.get("model") if codex else current_model(event)
    if not isinstance(model, str) or not matches(model, cfg.get("expensive_models")):
        return 0
    now = time.time()
    if codex:
        windows = codex_windows(event.get("transcript_path"), now)
    else:
        rate_limits = load_rate_limits(now)
        windows = claude_windows(rate_limits) if rate_limits else []
    results = evaluate(windows, cfg, now)
    if not any(r[-1] for r in results):
        return 0  # 含无数据、过期、缺 resets_at：一律放行
    tool = event.get("tool_name") or ""
    why = tool_verdict(tool, event.get("tool_input"), cfg, codex)
    if why is None:
        return 0
    cheap = "/".join(cheap_models(cfg, codex))
    if codex:
        todo = (f"派子 agent（spawn_agent 显式传 model 为 {cheap} 之一）干重活；"
                f"或 /model 切到便宜模型；或 /compact 减小上下文。")
    else:
        todo = (f"派 subagent（Agent 工具显式传 model={cheap}，禁止 fork）干重活；"
                f"或 /model opus 切到便宜模型；或 /compact 减小上下文。")
    sys.stderr.write(
        f"[model-guard] 当前模型 {model} 是贵模型，套餐余量已越过保留线，进入强制分工：{describe(results)}。\n"
        f"已拦下 {tool}：{why}请改为：{todo}\n")
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
