#!/usr/bin/env python3
"""session-handoff 行为测试：临时 HOME + 伪造的 Claude / Codex 会话记录，只跑真实脚本。"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "handoff.py"


class HandoffTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="handoff-test-")).resolve()
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.env = {**os.environ, "HOME": str(self.home),
                    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

    def tearDown(self):
        shutil.rmtree(self.tmp)

    # ── 工具 ──
    def run_cli(self, *args, cwd=None, ok=True):
        r = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd or self.tmp,
                           env=self.env, capture_output=True, text=True)
        if ok:
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r

    def git_repo(self, name, origin=None, branch="task/demo"):
        d = self.tmp / name
        d.mkdir(parents=True)
        for cmd in (["init", "-q"], ["checkout", "-q", "-b", branch]):
            subprocess.run(["git", *cmd], cwd=d, env=self.env, check=True)
        if origin:
            subprocess.run(["git", "remote", "add", "origin", origin], cwd=d, env=self.env, check=True)
        return d

    @staticmethod
    def field(out, label):
        for line in out.splitlines():
            if line.startswith(label + ": "):
                return line.split(": ", 1)[1]
        raise AssertionError(f"输出里没有 {label}：\n{out}")

    def write_jsonl(self, path, records, mtime=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in records))
        if mtime:
            os.utime(path, (mtime, mtime))

    def claude_session(self, sid, cwd, messages, mtime=None):
        recs = [{"type": "mode", "mode": "normal", "sessionId": sid}]
        for i, text in enumerate(messages):
            recs.append({"type": "user", "cwd": str(cwd), "sessionId": sid, "isSidechain": False,
                         "timestamp": f"2026-10-0{i + 1}T01:00:00.000Z",
                         "message": {"role": "user", "content": text}})
            recs.append({"type": "user", "cwd": str(cwd), "sessionId": sid, "isSidechain": False,
                         "timestamp": f"2026-10-0{i + 1}T01:00:05.000Z",
                         "message": {"role": "user", "content": [{"type": "tool_result", "content": "工具输出不算用户消息"}]}})
        encoded = "".join(c if c.isalnum() else "-" for c in str(cwd))
        self.write_jsonl(self.home / ".claude/projects" / encoded / f"{sid}.jsonl", recs, mtime)

    def codex_session(self, sid, cwd, messages, origin=None, subagent=False, mtime=None):
        meta = {"id": sid, "session_id": sid, "cwd": str(cwd), "timestamp": "2026-10-20T02:00:00.000Z",
                "source": {"subagent": {"thread_spawn": {"parent_thread_id": "p"}}} if subagent else "vscode",
                "thread_source": "subagent" if subagent else "user"}
        if origin:
            meta["git"] = {"branch": "master", "repository_url": origin}
        recs = [{"timestamp": "2026-10-20T02:00:00.000Z", "type": "session_meta", "payload": meta},
                {"timestamp": "2026-10-20T02:00:01.000Z", "type": "response_item",
                 "payload": {"type": "message", "role": "user",
                             "content": [{"type": "input_text", "text": "# AGENTS.md instructions\n注入的指令"}]}}]
        for i, text in enumerate(messages):
            recs.append({"timestamp": f"2026-10-2{i + 1}T02:00:00.000Z", "type": "response_item",
                         "payload": {"type": "message", "role": "user",
                                     "content": [{"type": "input_text", "text": text}]}})
        path = self.home / ".codex/sessions/2026/10/20" / f"rollout-2026-10-20T10-00-00-{sid}.jsonl"
        self.write_jsonl(path, recs, mtime)

    def write_handoff(self, key, task, goal, mtime):
        p = self.home / ".claude/handoffs" / key / f"{task}.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f"# {task}\n\n## 目标\n{goal}\n")
        os.utime(p, (mtime, mtime))
        return p

    # ── save：路径 ──
    def test_repo_key_survives_directory_rename(self):
        repo = self.git_repo("old-name", origin="git@GitHub.com:Acme/Widget.git")
        before = self.run_cli("path", "--task", "t1", cwd=repo).stdout
        repo.rename(self.tmp / "new-name")
        after = self.run_cli("path", "--task", "t1", cwd=self.tmp / "new-name").stdout
        self.assertEqual(self.field(before, "仓库键"), "github.com/acme/widget")
        self.assertEqual(self.field(before, "路径"), self.field(after, "路径"))
        # 同一远端的 https / ssh:// 写法得到同一个键
        for url in ("https://github.com/acme/widget", "ssh://git@github.com:22/acme/widget.git"):
            other = self.git_repo(f"clone-{abs(hash(url))}", origin=url)
            self.assertEqual(self.field(self.run_cli("path", "--task", "t1", cwd=other).stdout, "仓库键"),
                             "github.com/acme/widget")

    def test_repo_without_origin_uses_directory_name(self):
        repo = self.git_repo("lonely")
        out = self.run_cli("path", "--task", "x", cwd=repo).stdout
        self.assertEqual(self.field(out, "仓库键"), "local/lonely")

    def test_same_task_overwrites_same_file(self):
        repo = self.git_repo("proj", origin="git@gitlab.example.com:grp/proj.git", branch="task/fix-login")
        first = self.run_cli("path", cwd=repo).stdout
        self.assertEqual(self.field(first, "任务"), "fix-login")
        self.assertTrue(self.field(first, "已存在").startswith("否"))
        Path(self.field(first, "路径")).write_text("# fix-login\n\n## 目标\n修登录\n")
        second = self.run_cli("path", cwd=repo).stdout
        self.assertEqual(self.field(first, "路径"), self.field(second, "路径"))
        self.assertTrue(self.field(second, "已存在").startswith("是"))
        self.assertEqual(len(list((self.home / ".claude/handoffs").glob("**/*.md"))), 1)

    def test_main_branch_requires_task_name(self):
        repo = self.git_repo("proj", origin="git@gitlab.example.com:grp/proj.git", branch="main")
        r = self.run_cli("path", cwd=repo, ok=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--task", r.stderr)

    # ── resume：排序 ──
    def test_list_orders_current_repo_then_global_by_mtime(self):
        repo = self.git_repo("proj", origin="git@gitlab.example.com:grp/proj.git")
        now = time.time()
        self.write_handoff("gitlab.example.com/grp/proj", "t-older-1", "旧任务目标", now - 300)
        self.write_handoff("gitlab.example.com/grp/proj", "t-newer-1", "新任务目标", now - 100)
        self.write_handoff("github.com/x/other", "t-far-1", "别的仓库较早", now - 200)
        self.write_handoff("github.com/x/other", "t-near-1", "别的仓库最新", now - 50)
        out = self.run_cli("list", cwd=repo).stdout
        here, _, glob = out.partition("全局最近更新")
        self.assertLess(here.index("t-newer-1"), here.index("t-older-1"))
        self.assertIn("目标: 新任务目标", here)
        self.assertNotIn("t-far-1", here)
        self.assertLess(glob.index("t-near-1"), glob.index("t-far-1"))
        self.assertNotIn("t-older-1", glob)  # 当前仓库的不在全局区重复

    # ── find ──
    def test_find_by_old_directory_name_when_directory_is_gone(self):
        gone = self.tmp / "code" / "ghostdir-legacy"  # 从未创建：模拟已改名
        self.claude_session("11111111-1111-4111-8111-111111111111", gone,
                            ["<command-name>/clear</command-name>", "先说价值，数据构造为什么要做", "最后一条：合入"])
        out = self.run_cli("find", "ghostdir-legacy").stdout
        self.assertIn("[claude] 11111111-1111-4111-8111-111111111111", out)
        self.assertIn("（目录已不存在）", out)
        self.assertIn("首条: 先说价值", out)  # 注入的命令消息被跳过
        self.assertIn("末条: 最后一条：合入", out)
        self.assertIn("恢复: cd <改名后的新目录> && claude --resume 11111111-1111-4111-8111-111111111111", out)
        self.assertIn("跨目录查找", out)
        self.assertNotIn("工具输出不算用户消息", out)

    def test_find_suggests_renamed_directory_of_same_repo(self):
        new = self.git_repo("data-construction", origin="git@gitlab.example.com:qo/data-construction.git")
        gone = self.tmp / "data"
        sid = "22222222-2222-4222-8222-222222222222"
        recs = [{"type": "user", "cwd": str(c), "sessionId": sid, "timestamp": "2026-10-16T01:00:00.000Z",
                 "message": {"role": "user", "content": t}}
                for c, t in ((gone, "给 data 改个名"), (new, "改名后继续"))]
        self.write_jsonl(self.home / ".claude/projects/-tmp-data" / f"{sid}.jsonl", recs)
        out = self.run_cli("find", "改个名").stdout
        self.assertIn(f"cwd: {gone}  （目录已不存在）", out)
        self.assertIn("仓库: gitlab.example.com/qo/data-construction", out)
        self.assertIn(f"恢复: cd {new} && claude --resume {sid}", out)

    def test_find_claude_prefers_directory_matching_project_folder(self):
        main = self.git_repo("lab")
        wt = self.git_repo("lab--pilot")  # 会话中途进入的 worktree，Claude 把记录归到它名下
        (wt / "sub").mkdir()
        sid = "77777777-7777-4777-8777-777777777777"
        recs = [{"type": "user", "cwd": str(c), "sessionId": sid, "timestamp": "2026-10-27T01:00:00.000Z",
                 "message": {"role": "user", "content": t}}
                for c, t in ((main, "pilot 任务开始"), (wt, "进 worktree"), (wt / "sub", "在子目录里跑测试"))]
        project = "".join(c if c.isalnum() else "-" for c in str(wt))
        self.write_jsonl(self.home / ".claude/projects" / project / f"{sid}.jsonl", recs)
        out = self.run_cli("find", "pilot 任务").stdout
        self.assertIn(f"恢复: cd {wt} && claude --resume {sid}", out)

    def test_find_codex_by_keyword_and_origin(self):
        work = self.git_repo("widget", origin="git@github.com:acme/widget.git")
        sid = "01a17723-6a58-7422-b67a-9e3fdf296e67"
        self.codex_session(sid, work, ["写集的定义先明确好", "提成 issue"], origin="git@github.com:acme/widget.git")
        self.codex_session("01a17669-098f-77c0-871f-6e411107e143", work, ["子 agent 也提到写集"],
                           origin="git@github.com:acme/widget.git", subagent=True)
        by_kw = self.run_cli("find", "写集").stdout
        self.assertIn(f"[codex] {sid}", by_kw)
        self.assertIn(f"恢复: cd {work} && codex resume {sid}", by_kw)
        self.assertIn("首条: 写集的定义先明确好", by_kw)  # AGENTS.md 注入被跳过
        self.assertNotIn("01a17669", by_kw)  # 子 agent 线程不列出
        by_origin = self.run_cli("find", "acme/widget").stdout
        self.assertIn(f"[codex] {sid}", by_origin)

    def test_find_codex_gone_directory_hint(self):
        sid = "33333333-3333-4333-8333-333333333333"
        self.codex_session(sid, self.tmp / "vanished", ["老目录里的任务"])
        out = self.run_cli("find", "vanished").stdout
        self.assertIn(f"恢复: cd <改名后的新目录> && codex resume {sid}", out)
        self.assertIn("Use current directory", out)

    def test_find_existing_claude_directory_and_ordering(self):
        live = self.git_repo("live")
        now = time.time()
        self.claude_session("44444444-4444-4444-8444-444444444444", live, ["较早的会话 topic-x"], mtime=now - 500)
        self.claude_session("55555555-5555-4555-8555-555555555555", live, ["较新的会话 topic-x"], mtime=now - 10)
        out = self.run_cli("find", "topic-x").stdout
        self.assertIn(f"恢复: cd {live} && claude --resume 55555555-5555-4555-8555-555555555555", out)
        self.assertLess(out.index("55555555"), out.index("44444444"))
        self.assertIn("44444444", self.run_cli("find", "topic-x", "--limit", "5").stdout)
        self.assertNotIn("44444444", self.run_cli("find", "topic-x", "--limit", "1").stdout)

    def test_find_days_window_and_secret_redaction(self):
        live = self.git_repo("live")
        old = time.time() - 90 * 86400
        self.claude_session("66666666-6666-4666-8666-666666666666", live,
                            ["旧会话 key=sk-abcdefghijklmnop1234 结束"], mtime=old)
        self.assertIn("未找到", self.run_cli("find", "旧会话").stdout)
        out = self.run_cli("find", "旧会话", "--days", "0").stdout
        self.assertIn("66666666", out)
        self.assertNotIn("sk-abcdefghijklmnop1234", out)
        self.assertIn("***", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
