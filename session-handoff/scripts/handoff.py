#!/usr/bin/env python3
"""session-handoff：给出交接文件路径、列出交接文件、跨 Claude Code / Codex 找回 session。

只用标准库。交接文件由模型写，本脚本只定路径、只读会话记录。

  handoff.py path [--task 名称]      当前仓库某任务的交接文件路径（仓库键按 origin 定，改名不变）
  handoff.py list [--limit N]        当前仓库的交接文件 + 全局最近更新的几份，按时间倒序
  handoff.py find [关键词 ...]       在 Claude / Codex 会话记录里找 session，给出恢复命令
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HOME = Path.home()
HANDOFF_ROOT = HOME / ".claude" / "handoffs"
CLAUDE_PROJECTS = HOME / ".claude" / "projects"
CODEX_SESSIONS = HOME / ".codex" / "sessions"
MAIN_BRANCHES = {"main", "master", "develop", "trunk"}
TS_RE = re.compile(r'"timestamp":\s*"(\d{4}-[^"]+)"')
SECRET_RE = re.compile(r"(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{10,}|[A-Za-z0-9]{32,})")


# ── 仓库身份 ──────────────────────────────────────────────────────
def git(cwd, *args):
    try:
        r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def normalize_origin(url):
    """各种写法的同一个远端归一成 host/group/repo（小写，无协议、用户、端口、.git）。"""
    u = url.strip()
    u = re.sub(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", "", u)
    u = re.sub(r"^[^@/]+@", "", u)
    m = re.match(r"^([^/:]+):(\d+)/(.*)$", u)
    if m:
        u = m.group(1) + "/" + m.group(3)
    else:
        u = re.sub(r"^([^/:]+):", r"\1/", u)
    u = re.sub(r"\.git/*$", "", u.strip("/"))
    parts = [re.sub(r"[^\w.-]+", "-", p) for p in u.lower().split("/") if p not in ("", ".", "..")]
    return "/".join(parts)


_KEY_CACHE = {}


def repo_key(cwd):
    """有 origin 用规范化 origin；否则用主检出目录名（worktree 与主检出同键），前缀 local/。"""
    cwd = str(cwd)
    if cwd in _KEY_CACHE:
        return _KEY_CACHE[cwd]
    key = ""
    if os.path.isdir(cwd):
        origin = git(cwd, "remote", "get-url", "origin")
        if origin:
            key = normalize_origin(origin)
        else:
            common = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
            base = Path(common).parent if common else Path(cwd)
            key = "local/" + slug(base.name or "root")
    _KEY_CACHE[cwd] = key
    return key


def slug(name):
    s = re.sub(r"[^\w.-]+", "-", name.strip()).strip("-.")
    return s[:80]


# ── path ─────────────────────────────────────────────────────────
def cmd_path(args):
    cwd = os.getcwd()
    key = repo_key(cwd)
    task = args.task
    if not task:
        branch = git(cwd, "branch", "--show-current")
        if not branch or branch in MAIN_BRANCHES:
            sys.exit("✗ 当前不在任务分支上，请用 --task <任务名> 指定任务名")
        task = re.sub(r"^(task|feat|fix|dep)/", "", branch)
    task = slug(task)
    if not task:
        sys.exit("✗ 任务名为空")
    path = HANDOFF_ROOT / key / f"{task}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"仓库键: {key}")
    print(f"任务: {task}")
    print(f"路径: {path}")
    print(f"已存在: {'是（先读再更新，保留旧裁决）' if path.exists() else '否（新建）'}")


# ── list ─────────────────────────────────────────────────────────
def goal_of(path):
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    for i, line in enumerate(lines):
        if re.match(r"^#+\s*目标", line):
            for nxt in lines[i + 1:]:
                if nxt.strip():
                    return short(nxt.lstrip("-* "), 70)
    return ""


def fmt_time(ts):
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def print_handoff(path):
    rel = path.relative_to(HANDOFF_ROOT)
    print(f"  {fmt_time(path.stat().st_mtime)}  {rel.parent}  {rel.stem}")
    goal = goal_of(path)
    if goal:
        print(f"    目标: {goal}")
    print(f"    {path}")


def cmd_list(args):
    files = sorted(HANDOFF_ROOT.glob("**/*.md"), key=lambda p: p.stat().st_mtime, reverse=True) if HANDOFF_ROOT.is_dir() else []
    key = repo_key(os.getcwd())
    here = [p for p in files if key and p.parent == HANDOFF_ROOT / key]
    print(f"当前仓库（{key or '不在目录中'}）的交接文件：")
    for p in here:
        print_handoff(p)
    if not here:
        print("  （无）")
    others = [p for p in files if p not in here][: args.limit]
    print("\n全局最近更新：")
    for p in others:
        print_handoff(p)
    if not others:
        print("  （无）")


# ── find ─────────────────────────────────────────────────────────
def short(text, n=80):
    text = SECRET_RE.sub("***", re.sub(r"\s+", " ", text).strip())
    return text if len(text) <= n else text[: n - 1] + "…"


def is_injected(text):
    t = text.lstrip()
    return (not t or t.startswith("<") or t.startswith("# AGENTS.md instructions")
            or t.startswith("This session is being continued") or t.startswith("Caveat:")
            or t.startswith("[Request interrupted"))


def claude_user_text(o):
    if o.get("type") != "user" or o.get("isMeta") or o.get("isSidechain"):
        return ""
    c = (o.get("message") or {}).get("content")
    if isinstance(c, list):
        if any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
            return ""
        c = " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
    return c if isinstance(c, str) and not is_injected(c) else ""


def parse_claude(path):
    s = {"tool": "claude", "id": path.stem, "cwds": [], "origin": "", "msgs": [], "ts": [], "project": path.parent.name}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = TS_RE.search(line)
            if m:
                s["ts"].append(m.group(1))
            if '"type":"user"' not in line:
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            cwd = o.get("cwd")
            if cwd and cwd not in s["cwds"]:
                s["cwds"].append(cwd)
            text = claude_user_text(o)
            if text:
                s["msgs"].append(text)
    return s


def parse_codex(path):
    s = {"tool": "codex", "id": "", "cwds": [], "origin": "", "msgs": [], "ts": []}
    with open(path, encoding="utf-8", errors="replace") as f:
        for n, line in enumerate(f):
            m = TS_RE.search(line)
            if m:
                s["ts"].append(m.group(1))
            if n == 0 or '"turn_context"' in line[:200] or ('"user"' in line and '"message"' in line):
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                p = o.get("payload") if isinstance(o.get("payload"), dict) else {}
                t = o.get("type")
                if t == "session_meta":
                    src = p.get("source")
                    if p.get("thread_source") == "subagent" or (isinstance(src, dict) and "subagent" in src):
                        return None  # 子 agent 线程不单独列出，恢复父会话即可
                    s["id"] = p.get("id") or p.get("session_id") or ""
                    s["origin"] = normalize_origin(((p.get("git") or {}).get("repository_url")) or "")
                    if p.get("cwd"):
                        s["cwds"].append(p["cwd"])
                elif t == "turn_context":
                    if p.get("cwd") and p["cwd"] not in s["cwds"]:
                        s["cwds"].append(p["cwd"])
                elif t == "response_item" and p.get("type") == "message" and p.get("role") == "user":
                    text = " ".join(x.get("text", "") for x in p.get("content") or [] if isinstance(x, dict))
                    if not is_injected(text):
                        s["msgs"].append(text)
    if not s["id"]:
        m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$", path.name)
        s["id"] = m.group(1) if m else ""
    return s if s["id"] else None


def candidates(days):
    cutoff = time.time() - days * 86400 if days > 0 else 0
    files = []
    if CLAUDE_PROJECTS.is_dir():
        files += [("claude", p) for p in CLAUDE_PROJECTS.glob("*/*.jsonl")]
    if CODEX_SESSIONS.is_dir():
        files += [("codex", p) for p in CODEX_SESSIONS.glob("**/rollout-*.jsonl")]
    out = []
    for tool, p in files:
        try:
            mt = p.stat().st_mtime
        except OSError:
            continue
        if mt >= cutoff:
            out.append((mt, tool, p))
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def fill_origin(s):
    """Claude 记录不存 origin：取会话里仍存在的目录现查。"""
    if s["tool"] == "claude" and not s["origin"]:
        s["origin"] = next((k for k in (repo_key(c) for c in s["cwds"]) if k and not k.startswith("local/")), "")


def matches(s, keywords):
    if not keywords:
        return True
    fill_origin(s)
    hay = "\n".join(s["cwds"] + [s["origin"]] + s["msgs"]).lower()
    return all(k.lower() in hay for k in keywords)


def local_time(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return iso[:16]


def primary_cwd(s):
    """Claude：取与记录所在项目目录同名编码的 cwd（进 worktree 后会跟着换），否则取首个；
    Codex：恢复时以最后记录的 cwd 为准，取末个。"""
    if not s["cwds"]:
        return ""
    if s["tool"] == "codex":
        return s["cwds"][-1]
    return next((c for c in s["cwds"] if re.sub(r"[^A-Za-z0-9]", "-", c) == s["project"]), s["cwds"][0])


def resume_lines(s):
    cwd = primary_cwd(s)
    cmd = f"claude --resume {s['id']}" if s["tool"] == "claude" else f"codex resume {s['id']}"
    if cwd and os.path.isdir(cwd):
        return [f"恢复: cd {shlex.quote(cwd)} && {cmd}"]
    # 原目录没了：会话后来到过、且属于同一仓库的现存目录，多半就是改名后的位置
    moved = next((c for c in s["cwds"] if os.path.isdir(c) and s["origin"] and repo_key(c) == s["origin"]), "")
    lines = [f"恢复: cd {shlex.quote(moved)} && {cmd}" if moved else f"恢复: cd <改名后的新目录> && {cmd}",
             "  原目录已不存在（改名或删除）。" + ("上面的目录是该会话后来所在、同一仓库的现存目录。" if moved else "")]
    if s["tool"] == "claude":
        lines.append("  Claude Code 按 session id 跨目录查找，在新目录直接运行即可，无需复制记录文件")
    else:
        lines.append("  Codex 询问工作目录时选 Use current directory")
    return lines


def print_session(s):
    fill_origin(s)
    cwd = primary_cwd(s) or "?"
    gone = "" if os.path.isdir(cwd) else "  （目录已不存在）"
    print(f"[{s['tool']}] {s['id']}")
    print(f"  cwd: {cwd}{gone}")
    for other in [c for c in s["cwds"] if c != cwd][:2]:
        print(f"  曾在: {other}{'' if os.path.isdir(other) else '  （已不存在）'}")
    if s["origin"]:
        print(f"  仓库: {s['origin']}")
    if s["ts"]:
        print(f"  时间: {local_time(min(s['ts']))} → {local_time(max(s['ts']))}")
    if s["msgs"]:
        print(f"  首条: {short(s['msgs'][0])}")
        if len(s["msgs"]) > 1:
            print(f"  末条: {short(s['msgs'][-1])}")
    for line in resume_lines(s):
        print(f"  {line}")
    print()


def cmd_find(args):
    found = 0
    for _, tool, path in candidates(args.days):
        try:
            s = parse_claude(path) if tool == "claude" else parse_codex(path)
        except OSError:
            continue
        if not s or not s["msgs"]:  # 没有真实用户消息的记录（空会话、纯注入）不值得恢复
            continue
        if matches(s, args.keywords):
            print_session(s)
            found += 1
            if found >= args.limit:
                break
    scope = f"最近 {args.days} 天" if args.days > 0 else "全部历史"
    if not found:
        hint = "可换关键词，或加 --days 0 搜全部历史。" if args.days > 0 else "可换关键词再试。"
        print(f"未找到匹配的 session（范围：{scope}，关键词：{' '.join(args.keywords) or '无'}）。{hint}")
    else:
        print(f"共 {found} 个（范围：{scope}，按最后活动时间倒序，上限 {args.limit}）")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("path", help="当前仓库某任务的交接文件路径")
    p.add_argument("--task", help="任务名；省略时取当前分支名（去掉 task/ 等前缀）")
    p.set_defaults(func=cmd_path)
    p = sub.add_parser("list", help="列出交接文件")
    p.add_argument("--limit", type=int, default=5, help="全局最近列出几份（默认 5）")
    p.set_defaults(func=cmd_list)
    p = sub.add_parser("find", help="在 Claude / Codex 会话记录里找 session")
    p.add_argument("keywords", nargs="*", help="关键词，全部命中才算匹配；匹配 cwd、仓库 origin、用户消息")
    p.add_argument("--days", type=int, default=30, help="只看最近 N 天有活动的记录（默认 30，0 为全部）")
    p.add_argument("--limit", type=int, default=10, help="最多列出几个（默认 10）")
    p.set_defaults(func=cmd_find)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
