#!/usr/bin/env python3
"""model-guard 安装器，由 install.sh 调用。参数说明见 install.sh。

改动用户配置，全部幂等、改前备份、只动自己的部分：
  settings.json  PreToolUse matcher "*" 注册 guard.sh；statusLine 包一层 statusline-tap.sh
  hooks.json     ~/.codex 存在时，Codex 的 PreToolUse matcher "*" 注册同一个 guard.sh
                 （Codex 要求用户信任新 hook 后才执行；本脚本只检测信任状态，不代为信任）
  CLAUDE.md      <!-- model-guard:start/end --> 标记块写软提示（跟随软链）
  AGENTS.md      ~/.codex 存在时写同一软提示（与 CLAUDE.md 是同一文件则只写一次）
"""
import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_guard as mg  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GUARD = os.path.join(SCRIPT_DIR, "guard.sh")
TAP = os.path.join(SCRIPT_DIR, "statusline-tap.sh")
START, END = "<!-- model-guard:start -->", "<!-- model-guard:end -->"
BLOCK_RE = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)


def codex_home():
    return os.environ.get("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")


def settings_path():
    return os.path.join(mg.claude_home(), "settings.json")


def codex_hooks_path():
    return os.path.join(codex_home(), "hooks.json")


def is_ours(command, name):
    """按「…/model-guard/scripts/<name>」识别本 skill 的命令，仓库挪了位置也认得出来。"""
    try:
        parts = shlex.split(command or "")
    except ValueError:
        return False
    return bool(parts) and parts[0].replace("\\", "/").endswith(f"model-guard/scripts/{name}")


# ── 文件读写 ──────────────────────────────────────────────────────
def load_settings(path=None):
    path = path or settings_path()
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)  # 非法 JSON 直接抛出，由调用方拒绝修改
    if not isinstance(data, dict):
        raise ValueError("顶层不是对象")
    return data


def write_settings(data, path=None):
    path = os.path.realpath(path or settings_path())  # 跟随软链原地写，不把软链换成普通文件
    if os.path.exists(path):
        backup = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, backup)
        print(f"  备份 {os.path.basename(path)} → {backup}")
    atomic_write_json(path, data)


def atomic_write_json(path, data):
    """先写同目录临时文件再 os.replace：中途失败不会留下半截 JSON。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        if os.path.exists(path):
            shutil.copymode(path, tmp)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def write_config(cfg):
    atomic_write_json(mg.config_path(), cfg)


def original_known():
    """配置文件存在、可解析且记录了 statusline_original（null 也算记录过）。"""
    try:
        with open(mg.config_path(), encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return False
    return isinstance(raw, dict) and "statusline_original" in raw


ORIGINAL_LOST = ("状态栏已被 model-guard 包过，但 {cfg} 丢失或损坏，原 statusLine 无从得知。"
                 "请从 settings.json 的 .bak-* 备份里找回原 statusLine 手工写回 settings.json 后重跑")


def hint_targets():
    """软提示要写的文件，按真实路径去重（CLAUDE.md 可能软链到 AGENTS.md）。"""
    paths = [os.path.join(mg.claude_home(), "CLAUDE.md")]
    if os.path.isdir(codex_home()):
        paths.append(os.path.join(codex_home(), "AGENTS.md"))
    seen, out = set(), []
    for p in paths:
        real = os.path.realpath(p)
        if real not in seen:
            seen.add(real)
            out.append((p, real))
    return out


def read_text(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


# ── 软提示 ────────────────────────────────────────────────────────
def bad_note(cfg, key):
    """配置非法时的标注：显示的是与运行时同一个 percent_setting 算出的生效值。"""
    if mg.percent_setting(cfg, key)[1]:
        return ""
    return f"（{key} 配置非法，按默认 {mg.DEFAULTS[key]:g}% 生效）"


def reserve_text(cfg, reserve_key):
    return f"{mg.percent_setting(cfg, reserve_key)[0]:g}%" + bad_note(cfg, reserve_key)


def floor_text(cfg, reserve_key):
    """实际生效的下限 min(配置下限, 保留额)。"""
    floor_key = reserve_key.replace("reserve_", "reserve_floor_")
    return f"{mg.effective_floor(cfg, reserve_key):g}%" + bad_note(cfg, floor_key)


def render_hint(cfg):
    expensive = "、".join(cfg["expensive_models"])
    cheap = cfg["cheap_models"]
    return f"""{START}
## 贵模型分工（model-guard 生成，重跑安装脚本更新，勿手改本块）

当前模型名包含 {expensive} 之一（大小写不敏感）时，本 session 是贵模型，按以下分工工作：

- 只做：理解需求、拆方案、查缺补漏、推理、审阅 subagent 结论、最终汇报。
- 读大量代码/文档、写代码、写文档、跑测试、调研，一律派 subagent，并显式传 model。Claude Code：默认 opus，批量机械活用 sonnet，纯搜索、提取用 haiku，禁止 fork（fork 会继承贵模型）。Codex：spawn_agent 显式传 {'/'.join(cfg['codex_cheap_models'])} 之一，不传会继承贵模型。
- 为什么：贵模型消耗套餐配额极快，一个 session 就能把 5 小时或 7 天额度烧光，所有 session 随之停摆。
- 硬约束：5h 余量低于 {reserve_text(cfg, 'reserve_5h')}、或 7d 余量低于 {reserve_text(cfg, 'reserve_7d')} 时（保留线随窗口剩余时间线性递减，但不低于下限 5h {floor_text(cfg, 'reserve_5h')} / 7d {floor_text(cfg, 'reserve_7d')}，防止临近重置时把额度烧光），PreToolUse hook 会把这条分工变成硬约束：贵模型只能派 model={'/'.join(cheap)} 的 subagent、Read（limit≤200）和任务管理类工具，其余工具被拦。被拦时派 subagent、`/model opus` 或 `/compact`。Codex 同样由 PreToolUse hook 把关：越线后只能派显式指定便宜模型（{'/'.join(cfg['codex_cheap_models'])}）的子 agent、提问和计划。
{END}"""


def put_block(text, block):
    if BLOCK_RE.search(text):
        return BLOCK_RE.sub(lambda _: block, text, count=1)
    if not text:
        return block + "\n"
    return text + ("" if text.endswith("\n") else "\n") + "\n" + block + "\n"


def drop_block(text):
    return re.sub(r"\n?" + BLOCK_RE.pattern + r"\n?", "", text, count=1, flags=re.S)


def write_hints(transform):
    for shown, real in hint_targets():
        old = read_text(real)
        new = transform(old)
        if new != old:
            os.makedirs(os.path.dirname(real), exist_ok=True)
            with open(real, "w", encoding="utf-8") as f:
                f.write(new)
            note = f"（软链 → {real}）" if real != os.path.abspath(shown) else ""
            print(f"  ✓ 软提示已更新 {shown}{note}")
        else:
            print(f"  · 软提示无变化 {shown}")


# ── settings.json 的 hook 与状态栏 ───────────────────────────────
def guard_hooks(settings):
    for entry in settings.get("hooks", {}).get("PreToolUse", []) or []:
        if isinstance(entry, dict):
            for hook in entry.get("hooks", []) or []:
                if isinstance(hook, dict) and is_ours(hook.get("command"), "guard.sh"):
                    yield entry, hook


def add_hook(settings):
    command = shlex.quote(GUARD)
    found = list(guard_hooks(settings))
    for _, hook in found:
        hook["command"] = command  # 仓库移动后刷新路径
    if found:
        return
    pre = settings.setdefault("hooks", {}).setdefault("PreToolUse", [])
    entry = next((e for e in pre if isinstance(e, dict) and e.get("matcher") == "*"), None)
    hook = {"type": "command", "command": command, "timeout": 5}
    if entry is None:
        pre.append({"matcher": "*", "hooks": [hook]})
    else:
        entry.setdefault("hooks", []).append(hook)


def remove_hook(settings):
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict) or not isinstance(hooks.get("PreToolUse"), list):
        return
    pre = hooks["PreToolUse"]
    for entry in list(pre):
        if not isinstance(entry, dict):
            continue
        entry["hooks"] = [h for h in entry.get("hooks", []) or []
                          if not (isinstance(h, dict) and is_ours(h.get("command"), "guard.sh"))]
        if not entry["hooks"]:
            pre.remove(entry)  # 整条空了才删，不动别人的
    if not pre:
        hooks.pop("PreToolUse")
    if not hooks:
        settings.pop("hooks")


def tapped(settings):
    sl = settings.get("statusLine")
    return isinstance(sl, dict) and is_ours(sl.get("command"), "statusline-tap.sh")


def codex_trust_state(hooks_data):
    """只读判断 Codex 是否已信任本 hook：按 Codex 的信任登记规则（hook 身份的规范化 JSON 取 sha256，
    键为 <hooks.json>:pre_tool_use:<组>:<序号>）比对 config.toml。返回 None 表示未注册。"""
    path = codex_hooks_path()
    try:
        with open(os.path.join(codex_home(), "config.toml"), encoding="utf-8") as f:
            toml = f.read()
    except OSError:
        toml = ""
    entries = (hooks_data.get("hooks") or {}).get("PreToolUse") or []
    found = None
    for gi, entry in enumerate(entries):
        for hi, hook in enumerate((entry or {}).get("hooks") or []):
            if not (isinstance(hook, dict) and is_ours(hook.get("command"), "guard.sh")):
                continue
            identity = {"event_name": "pre_tool_use", "hooks": [{
                "type": "command", "command": hook["command"],
                "timeout": max(1, hook.get("timeout") or 600), "async": False}]}
            if entry.get("matcher"):
                identity["matcher"] = entry["matcher"]
            digest = "sha256:" + hashlib.sha256(json.dumps(
                identity, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
            trusted = False
            for p in {os.path.abspath(path), os.path.realpath(path)}:
                m = re.search(r'\[hooks\.state\."' + re.escape(f"{p}:pre_tool_use:{gi}:{hi}")
                              + r'"\]\s*\n\s*trusted_hash\s*=\s*"([^"]+)"', toml)
                trusted = trusted or bool(m and m.group(1) == digest)
            found = bool(found) or trusted
    return found


TRUST_HINT = ("Codex 只执行用户信任过的 hook：下次启动交互式 Codex 时会提示 Hooks need review，"
              "选 Review hooks 或 Trust all and continue；codex exec 不提示，未信任的 hook 静默不执行")


def wrap_statusline(settings, cfg):
    current = settings.get("statusLine")
    if not tapped(settings):  # 未包过（或用户之后改过状态栏）：当前的就是原命令
        cfg["statusline_original"] = current if isinstance(current, dict) else None
    base = dict(cfg["statusline_original"] or {"type": "command", "padding": 0})
    base["command"] = shlex.quote(TAP)
    settings["statusLine"] = base


def unwrap_statusline(settings, cfg):
    if not tapped(settings):
        return
    if cfg.get("statusline_original"):
        settings["statusLine"] = cfg["statusline_original"]
    else:
        settings.pop("statusLine")


# ── 子命令 ────────────────────────────────────────────────────────
def build_config(args):
    cfg = mg.load_config()
    if args.models is not None:
        cfg["expensive_models"] = [m.strip() for m in args.models.split(",") if m.strip()]
    if args.reserve_5h is not None:
        cfg["reserve_5h"] = args.reserve_5h
    if args.reserve_7d is not None:
        cfg["reserve_7d"] = args.reserve_7d
    for key in ("reserve_floor_5h", "reserve_floor_7d"):
        if getattr(args, key) is not None:
            cfg[key] = getattr(args, key)
    if not cfg["expensive_models"]:
        sys.exit("❌ 贵模型列表不能为空")
    for key in mg.PERCENT_KEYS:
        value = cfg[key]
        if not mg.valid_percent(value):
            flag = "--" + key.replace("_", "-")
            sys.exit(f"❌ {key} 必须是 0-100 的数字（当前 {str(value)[:20]!r}），用 {flag} 重新指定")
    cfg["version"] = 1
    return cfg


def install(args):
    cfg = build_config(args)
    try:
        settings = load_settings()
    except ValueError as e:
        sys.exit(f"❌ {settings_path()} 无法解析（{e}），不敢改，请先手工修复")
    if tapped(settings) and not original_known():
        sys.exit("❌ " + ORIGINAL_LOST.format(cfg=mg.config_path()))
    before = json.dumps(settings, sort_keys=True)
    add_hook(settings)
    wrap_statusline(settings, cfg)
    if json.dumps(settings, sort_keys=True) != before:
        write_settings(settings)
        print("  ✓ settings.json 已更新（PreToolUse guard.sh + 状态栏旁路）")
    else:
        print("  · settings.json 已是目标状态，未改动")
    if os.path.isdir(codex_home()):
        try:
            codex = load_settings(codex_hooks_path())
        except ValueError as e:
            sys.exit(f"❌ {codex_hooks_path()} 无法解析（{e}），不敢改，请先手工修复")
        before = json.dumps(codex, sort_keys=True)
        add_hook(codex)
        if json.dumps(codex, sort_keys=True) != before:
            write_settings(codex, codex_hooks_path())
            print("  ✓ Codex hooks.json 已注册 guard.sh")
        else:
            print("  · Codex hooks.json 已是目标状态，未改动")
        if not codex_trust_state(codex):
            print(f"  ! {TRUST_HINT}")
    os.makedirs(os.path.dirname(mg.config_path()), exist_ok=True)
    write_config(cfg)
    print(f"  ✓ 配置 {mg.config_path()}")
    write_hints(lambda text: put_block(text, render_hint(cfg)))
    print("hook 与状态栏热生效；状态栏下次刷新后开始记录用量。")


def uninstall(_args):
    cfg = mg.load_config()
    try:
        settings = load_settings()
    except ValueError as e:
        sys.exit(f"❌ {settings_path()} 无法解析（{e}），不敢改，请先手工修复")
    before = json.dumps(settings, sort_keys=True)
    remove_hook(settings)
    if tapped(settings) and not original_known():
        print("  ! 未还原状态栏：" + ORIGINAL_LOST.format(cfg=mg.config_path()))
    else:
        unwrap_statusline(settings, cfg)
    if json.dumps(settings, sort_keys=True) != before:
        write_settings(settings)
        print("  ✓ 已移除 hook 并还原状态栏")
    else:
        print("  · settings.json 中没有本 skill 的配置")
    if os.path.exists(codex_hooks_path()):
        try:
            codex = load_settings(codex_hooks_path())
        except ValueError as e:
            sys.exit(f"❌ {codex_hooks_path()} 无法解析（{e}），不敢改，请先手工修复")
        before = json.dumps(codex, sort_keys=True)
        remove_hook(codex)
        if json.dumps(codex, sort_keys=True) != before:
            write_settings(codex, codex_hooks_path())
            print("  ✓ 已从 Codex hooks.json 移除 hook")
    write_hints(drop_block)
    print(f"  · 保留配置 {mg.config_path()}（重装时沿用）")


def status(_args):
    cfg = mg.load_config()
    try:
        settings = load_settings()
        settings_err = None
    except ValueError as e:
        settings, settings_err = {}, str(e)
    has_cfg = os.path.exists(mg.config_path())
    hook_ok = bool(list(guard_hooks(settings)))
    tap_ok = tapped(settings)
    yes = lambda b: "✓" if b else "✗"  # noqa: E731
    rows = [
        ("配置文件", f"{yes(has_cfg)} {mg.config_path()}"),
        ("贵模型", "、".join(cfg["expensive_models"])),
        ("便宜模型", "、".join(cfg["cheap_models"])),
        ("Codex 便宜模型", "、".join(cfg["codex_cheap_models"])),
        ("保留额", f"5h {reserve_text(cfg, 'reserve_5h')} / 7d {reserve_text(cfg, 'reserve_7d')}"),
        ("保留线下限", f"5h {floor_text(cfg, 'reserve_5h')} / 7d {floor_text(cfg, 'reserve_7d')}"
                      f"（实际生效值 = min(配置下限, 保留额)）"),
        ("PreToolUse hook", yes(hook_ok) + (f"（settings.json 非法：{settings_err}）" if settings_err else "")),
        ("状态栏旁路", yes(tap_ok) + (f"，原命令 {cfg['statusline_original'].get('command')}"
                                      if tap_ok and cfg.get("statusline_original") else "")),
    ]
    for shown, real in hint_targets():
        rows.append((f"软提示 {os.path.basename(shown)}", f"{yes(START in read_text(real))} {shown}"
                     + (f" → {real}" if real != os.path.abspath(shown) else "")))
    codex_ok = True
    if os.path.isdir(codex_home()):
        try:
            trust = codex_trust_state(load_settings(codex_hooks_path()))
        except ValueError as e:
            trust = None
            rows.append(("Codex hooks.json", f"✗ 非法 JSON：{e}"))
        codex_ok = trust is not None
        rows.append(("Codex 硬闸", "✗ 未注册" if trust is None else
                     "✓ 已注册，已信任" if trust else f"✓ 已注册，✗ 未信任：{TRUST_HINT}"))
        rows.append(("Codex 用量", "从 session 的 token_count 读取，本 session 跑过一轮后才有数据"))
    else:
        rows.append(("Codex", "未检测到 ~/.codex"))
    now = time.time()
    rl = mg.load_rate_limits(now)
    if rl is None:
        rows.append(("用量数据", "无或已过期（>6 小时）：hook 放行，等状态栏刷新"))
    else:
        results = mg.evaluate(mg.claude_windows(rl), cfg, now)
        state = "强制分工中" if any(r[-1] for r in results) else "未触发"
        rows.append(("用量数据", f"{int(now - rl['saved_at'])} 秒前；{state}"))
        rows.append(("明细", mg.describe(results) or "缺 resets_at，不判定"))
    cols = lambda t: sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in t)  # noqa: E731
    width = max(cols(k) for k, _ in rows)
    for k, v in rows:
        print(f"  {k}{' ' * (width - cols(k))}  {v}")
    installed = has_cfg and hook_ok and tap_ok and codex_ok
    print(f"\n  结论：{'已安装' if installed else '未安装或不完整'}")
    return 0 if installed else 1


def run_guard(home, event):
    env = dict(os.environ, CLAUDE_HOME=home)
    p = subprocess.run([GUARD], input=json.dumps(event), capture_output=True, text=True, env=env)
    return p.returncode, p.stderr.strip()


def selftest(_args):
    cfg = mg.load_config()
    expensive, cheap = cfg["expensive_models"][0], cfg["cheap_models"][0]
    failures = 0

    def check(name, ok, detail=""):
        nonlocal failures
        print(f"  {'✓ 通过' if ok else '✗ 失败'}  {name}" + (f"\n      {detail}" if detail and not ok else ""))
        failures += 0 if ok else 1

    try:
        settings = load_settings()
    except ValueError:
        settings = {}
    hooks = list(guard_hooks(settings))
    check("settings.json 已注册 guard.sh", bool(hooks))
    for _, hook in hooks:
        path = shlex.split(hook["command"])[0]
        check(f"hook 脚本可执行 {path}", os.access(path, os.X_OK))

    with tempfile.TemporaryDirectory() as home:
        with open(os.path.join(home, "model-guard.json"), "w") as f:
            json.dump(dict(cfg, statusline_original=None), f)
        os.makedirs(os.path.join(home, "model-guard"))
        now = int(time.time())
        with open(os.path.join(home, "model-guard", "rate-limits.json"), "w") as f:
            json.dump({"five_hour": {"used_percentage": 99, "resets_at": now + 4 * 3600},
                       "seven_day": {"used_percentage": 10, "resets_at": now + 6 * 86400},
                       "saved_at": now}, f)
        transcript = os.path.join(home, "t.jsonl")
        with open(transcript, "w") as f:
            f.write(json.dumps({"type": "assistant", "message": {"model": f"claude-{expensive}-selftest"}}) + "\n")
        base = {"session_id": "selftest", "transcript_path": transcript, "cwd": home,
                "hook_event_name": "PreToolUse"}
        rc, err = run_guard(home, dict(base, tool_name="Bash", tool_input={"command": "ls"}))
        check(f"贵模型（{expensive}）+ 过线 → Bash 被拒（exit 2）", rc == 2 and "model-guard" in err, f"rc={rc} {err}")
        rc, err = run_guard(home, dict(base, tool_name="Agent",
                                       tool_input={"prompt": "x", "model": cheap, "subagent_type": "general-purpose"}))
        check(f"贵模型 + 过线 → Agent(model={cheap}) 放行（exit 0）", rc == 0, f"rc={rc} {err}")

        if os.path.isdir(codex_home()):
            try:
                trust = codex_trust_state(load_settings(codex_hooks_path()))
            except ValueError:
                trust = None
            check("Codex hooks.json 已注册 guard.sh", trust is not None)
            if trust is False:
                print(f"  ! 未信任：{TRUST_HINT}")
            rollout = os.path.join(home, "rollout.jsonl")
            with open(rollout, "w") as f:
                f.write(json.dumps({"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                    "type": "event_msg", "payload": {"type": "token_count", "rate_limits": {
                                        "primary": {"used_percent": 99, "window_minutes": 10080,
                                                    "resets_at": now + 6 * 86400},
                                        "secondary": None}}}) + "\n")
            codex_cheap = cfg["codex_cheap_models"][0]
            cbase = dict(base, transcript_path=rollout, model=f"gpt-{expensive}-selftest", turn_id="t")
            rc, err = run_guard(home, dict(cbase, tool_name="Bash", tool_input={"command": "ls"}))
            check("Codex 贵模型 + 7d 过线 → Bash 被拒（exit 2）", rc == 2, f"rc={rc} {err}")
            rc, err = run_guard(home, dict(cbase, tool_name="collaborationspawn_agent",
                                           tool_input={"message": "x", "model": f"gpt-{codex_cheap}"}))
            check(f"Codex 贵模型 + 过线 → spawn_agent(model=gpt-{codex_cheap}) 放行", rc == 0, f"rc={rc} {err}")
    print(f"\n  自检{'全部通过' if failures == 0 else f'失败 {failures} 项'}")
    return 1 if failures else 0


def percent_arg(text):
    """CLI 百分比参数：与配置文件同一口径（mg.valid_percent），非法时由 argparse 给出可读错误并退出 2。"""
    try:
        value = float(text)
    except ValueError:
        value = None
    if not mg.valid_percent(value):
        raise argparse.ArgumentTypeError(f"必须是 0-100 的数字（收到 {text!r}）")
    return int(value) if value == int(value) else value


def main():
    ap = argparse.ArgumentParser(prog="install.sh", description="model-guard 安装器")
    ap.add_argument("--models", help="贵模型列表，逗号分隔，如 fable,astra")
    ap.add_argument("--reserve-5h", type=percent_arg, dest="reserve_5h")
    ap.add_argument("--reserve-7d", type=percent_arg, dest="reserve_7d")
    ap.add_argument("--reserve-floor-5h", type=percent_arg, dest="reserve_floor_5h")
    ap.add_argument("--reserve-floor-7d", type=percent_arg, dest="reserve_floor_7d")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--status", action="store_true")
    group.add_argument("--selftest", action="store_true")
    group.add_argument("--uninstall", action="store_true")
    args = ap.parse_args()
    if args.status:
        return status(args)
    if args.selftest:
        return selftest(args)
    if args.uninstall:
        return uninstall(args)
    return install(args) or 0


if __name__ == "__main__":
    sys.exit(main())
