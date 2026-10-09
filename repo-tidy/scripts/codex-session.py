#!/usr/bin/env python3
"""按 Codex thread 隔离目录；终端绑定由真实 TUI 客户端 PID 与启动时间校验。"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


STATE = Path(os.environ.get("CLAUDE_HOME", str(Path.home() / ".claude"))) / "session-cwd"


def safe_key(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value)


def ps(*args):
    try:
        return subprocess.run(["ps", *args], capture_output=True, text=True,
                              timeout=2, check=False).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def clients(key):
    """只认有控制终端的 Codex 客户端，忽略共享 app-server 与后台 worker。"""
    matches = []
    for row in ps("-axo", "pid=,tty=,comm=").splitlines():
        fields = row.split(None, 2)
        if len(fields) != 3:
            continue
        pid, tty, command = fields
        if not pid.isdigit() or tty in ("?", "??") or Path(command).name != "codex":
            continue
        command = ps("-p", pid, "-o", "command=")
        if "app-server" in command:
            continue
        # 捕获 ps 的输出，只提取终端键；不要把包含凭据的进程环境打印到日志。
        environment = ps("eww", "-p", pid, "-o", "command=")
        terminal = re.search(r"(?:^|\s)(?:TERM_SESSION_ID|ITERM_SESSION_ID)=([^\s]+)", environment)
        if terminal and terminal.group(1).rsplit(":", 1)[-1] == key:
            started = ps("-p", pid, "-o", "lstart=")
            if started:
                matches.append({"pid": int(pid), "started": started})
    return matches


def save(path, value):
    STATE.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=STATE, prefix=".write-",
                                     delete=False, encoding="utf-8") as file:
        temporary = Path(file.name)
        file.write(value + "\n")
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def session_key(session):
    if not safe_key(session):
        raise ValueError("缺少有效的 Codex 会话 ID")
    return "codex-" + session


def bind(key, session):
    if not safe_key(key):
        raise ValueError("无效的终端会话键")
    session_key(session)
    owners = clients(key)
    if len(owners) != 1:
        raise ValueError("该终端没有唯一的 Codex TUI 客户端，未建立绑定")
    owner = owners[0]
    save(STATE / (key + ".codex"), json.dumps(dict(owner, session_id=session)))


def local_terminal():
    """独立后端可自动绑定；共享后端的祖先终端属于启动者，必须拒绝。"""
    pid = os.getppid()
    for _ in range(12):
        fields = ps("-p", str(pid), "-o", "ppid=,tty=,comm=").split(None, 2)
        if len(fields) != 3:
            return None
        parent, tty, command = fields
        if Path(command).name == "codex":
            arguments = ps("-p", str(pid), "-o", "command=")
            if "--managed-daemon" in arguments or "app-server daemon" in arguments:
                return None
            if tty not in ("?", "??") and "app-server" not in arguments:
                key = os.environ.get("TERM_SESSION_ID") or os.environ.get("ITERM_SESSION_ID", "")
                key = key.rsplit(":", 1)[-1]
                return key if safe_key(key) else None
        if not parent.isdigit() or int(parent) <= 1:
            return None
        pid = int(parent)
    return None


def write():
    try:
        payload = json.load(sys.stdin)
        session = payload.get("session_id")
        name = session_key(session)
        cwd = payload.get("cwd")
        if not isinstance(cwd, str) or not Path(cwd).is_absolute() or not Path(cwd).is_dir():
            return
        save(STATE / name, cwd)
        key = local_terminal()
        if key:
            bind(key, session)
    except (OSError, ValueError, AttributeError):
        # Hook 始终静默；无效输入不能覆盖其它会话或猜测终端归属。
        return


def target(key):
    if not safe_key(key):
        return 4
    owners = clients(key)
    if not owners:
        # 已关闭的 Codex 客户端留下的旧终端位置也不能被继续采用。
        return 3 if (STATE / (key + ".codex")).exists() else 4
    if len(owners) != 1:
        return 3
    owner = owners[0]
    try:
        binding = json.loads((STATE / (key + ".codex")).read_text())
        if any(binding.get(field) != owner[field] for field in ("pid", "started")):
            return 3
        name = session_key(binding.get("session_id"))
        for suffix in (".task", ""):
            path = STATE / (name + suffix)
            if path.is_file():
                directory = path.read_text().strip()
                if Path(directory).is_absolute() and Path(directory).is_dir():
                    print(directory)
                    return 0
    except (OSError, ValueError, AttributeError):
        pass
    return 3  # Codex 未绑定或绑定失效：禁止读取可能已被污染的终端位置文件。


def task(argument):
    session = os.environ.get("CODEX_THREAD_ID") or os.environ.get("CODEX_SESSION_ID")
    path = STATE / (session_key(session) + ".task")
    if argument == "--clear":
        path.unlink(missing_ok=True)
        print("✓ 已取消本 Codex 会话的任务目录声明")
    elif argument == "--show":
        if path.is_file():
            print(path.read_text().strip())
    else:
        if not argument:
            raise ValueError("用法: task-here.sh <目录> | --clear | --show | --bind <终端键>")
        directory = Path(argument).resolve()
        if not directory.is_dir():
            raise ValueError("目录不存在: " + str(directory))
        save(path, str(directory))
        print("✓ 当前 Codex 任务目录已声明: " + str(directory))


def main():
    command = sys.argv[1]
    if command == "write":
        write()
    elif command == "target":
        return target(sys.argv[2])
    elif command == "bind":
        session = os.environ.get("CODEX_THREAD_ID") or os.environ.get("CODEX_SESSION_ID")
        bind(sys.argv[2], session)
        print("✓ 终端已绑定当前 Codex 会话: " + sys.argv[2])
    elif command == "task":
        task(sys.argv[2])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, IndexError) as error:
        print("✗ " + str(error), file=sys.stderr)
        sys.exit(1)
