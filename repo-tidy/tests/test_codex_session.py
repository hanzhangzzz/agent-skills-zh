#!/usr/bin/env python3
"""回放共享后端、终端复用与任务目录，实际调用 hook 和快捷键入口。"""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class CodexSessionTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name).resolve()
        self.state = self.root / "state" / "session-cwd"
        self.state.mkdir(parents=True)
        self.jev = self.root / "jev-quality"
        self.week = self.root / "my-test-week"
        self.task = self.jev / "worktree"
        for directory in (self.jev, self.week, self.task):
            directory.mkdir(parents=True, exist_ok=True)
        self.processes = {
            "101": {"key": "JEV", "started": "start-101"},
            "202": {"key": "WEEK", "started": "start-202"},
        }
        self.parents = {}
        self.fixture = self.root / "processes.json"
        binaries = self.root / "bin"
        binaries.mkdir()
        self.fake_ps = binaries / "ps"
        self.save_processes()
        # 这些合成终端键不属于真实桌面；测试不得读取真实前台窗口作回退。
        fake_uname = binaries / "uname"
        fake_uname.write_text("#!/bin/sh\necho Linux\n")
        fake_uname.chmod(0o755)
        self.env = dict(os.environ, CLAUDE_HOME=str(self.root / "state"),
                        TMPDIR=str(self.root), TEST_PROCESSES=str(self.fixture),
                        PATH=str(binaries) + os.pathsep + os.environ["PATH"],
                        TERM_SESSION_ID="w0t0p0:JEV", ITERM_SESSION_ID="w0t0p0:JEV")
        for key in ("CODEX_THREAD_ID", "CODEX_SESSION_ID", "SESSION_KEY_CMD"):
            self.env.pop(key, None)

    def save_processes(self):
        self.fixture.write_text(json.dumps({"clients": self.processes, "parents": self.parents}))
        rows = "\n".join(pid + " " + row.get("tty", "ttys" + pid) + " /bin/codex"
                         for pid, row in self.processes.items())
        lines = ["#!/bin/sh", 'if [ "$1" = "-axo" ]; then',
                 "printf '%s\\n' " + shlex.quote(rows), "exit 0", "fi",
                 '[ "$1" = "eww" ] && shift', 'pid="$2"; field="$4"',
                 'case "$pid:$field" in']
        for pid, row in self.processes.items():
            values = {"command=": row.get("command", "/bin/codex") +
                      " TERM_SESSION_ID=w0t0p0:" + row["key"], "lstart=": row["started"]}
            for field, value in values.items():
                lines.append(shlex.quote(pid + ":" + field) +
                             ") printf '%s\\n' " + shlex.quote(value) + "; exit 0 ;; ")
        for pid, value in self.parents.items():
            if pid != "default":
                lines.append(shlex.quote(pid + ":ppid=,tty=,comm=") +
                             ") printf '%s\\n' " + shlex.quote(value) + "; exit 0 ;; ")
        lines.extend(['*:ppid=,tty=,comm=) printf \'%s\\n\' ' +
                      shlex.quote(self.parents.get("default", "")) + "; exit 0 ;;",
                      "esac", "exit 1"])
        self.fake_ps.write_text("\n".join(lines) + "\n")
        self.fake_ps.chmod(0o755)

    def run_script(self, name, *args, env=None, payload=None, check=True):
        return subprocess.run(["bash", str(SCRIPTS / name), *args],
                              input=json.dumps(payload) if payload is not None else None,
                              text=True, capture_output=True, env=env or self.env, check=check)

    def write(self, session, cwd):
        return self.run_script("session-cwd.sh", "--agent", "codex", payload={
            "session_id": session, "cwd": str(cwd), "hook_event_name": "UserPromptSubmit"})

    def bind_fixture(self, key, session, pid):
        (self.state / (key + ".codex")).write_text(json.dumps({
            "session_id": session, "pid": pid, "started": self.processes[str(pid)]["started"]}))

    def target(self, key):
        env = dict(self.env, SESSION_KEY_CMD="printf %s " + key, EDITOR_HERE_DRY="1")
        return self.run_script("editor-here.sh", env=env).stdout.strip()

    def test_shared_backend_does_not_overwrite_other_terminal(self):
        self.bind_fixture("JEV", "jev-session", 101)
        self.bind_fixture("WEEK", "week-session", 202)
        for _ in range(3):
            self.write("jev-session", self.jev)
            self.write("week-session", self.week)
            self.assertEqual(self.target("JEV"), str(self.jev))
            self.assertEqual(self.target("WEEK"), str(self.week))

    def test_codex_does_not_write_untrusted_terminal_or_tty_files(self):
        result = self.write("week-session", self.week)
        self.assertEqual(result.stdout, "")
        self.assertEqual((self.state / "codex-week-session").read_text().strip(), str(self.week))
        self.assertFalse((self.state / "JEV").exists())
        self.assertFalse(any(self.state.glob("tty-*")))

    def test_task_is_isolated_from_other_sessions_and_prompt_refresh(self):
        self.bind_fixture("JEV", "jev-session", 101)
        self.bind_fixture("WEEK", "week-session", 202)
        self.write("jev-session", self.jev)
        self.write("week-session", self.week)
        env = dict(self.env, CODEX_THREAD_ID="jev-session")
        self.run_script("task-here.sh", str(self.task), env=env)
        self.write("jev-session", self.jev)
        self.write("week-session", self.week)
        self.assertEqual(self.target("JEV"), str(self.task))
        self.assertEqual(self.target("WEEK"), str(self.week))
        self.assertEqual(self.run_script("task-here.sh", "--show", env=env).stdout.strip(), str(self.task))
        self.run_script("task-here.sh", "--clear", env=env)
        self.assertEqual(self.target("JEV"), str(self.jev))

    def test_bind_uses_explicit_terminal_and_validates_client(self):
        env = dict(self.env, CODEX_THREAD_ID="week-session")
        self.run_script("task-here.sh", "--bind", "WEEK", env=env)
        self.assertFalse((self.state / "JEV.codex").exists())
        binding = json.loads((self.state / "WEEK.codex").read_text())
        self.assertEqual(binding["session_id"], "week-session")
        self.assertEqual(binding["pid"], 202)
        result = self.run_script("task-here.sh", "--bind", "MISSING", env=env, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.state / "MISSING.codex").exists())

    def test_stale_binding_rejects_reused_pid(self):
        self.bind_fixture("JEV", "jev-session", 101)
        self.write("jev-session", self.jev)
        self.processes["101"]["started"] = "new-start-101"
        self.save_processes()
        result = subprocess.run(["python3", str(SCRIPTS / "codex-session.py"), "target", "JEV"],
                                env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 3)
        self.assertEqual(result.stdout, "")

    def test_unbound_codex_rejects_legacy_contaminated_state(self):
        (self.state / "JEV").write_text(str(self.week))
        result = subprocess.run(["python3", str(SCRIPTS / "codex-session.py"), "target", "JEV"],
                                env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 3)
        self.assertEqual(result.stdout, "")

    def test_ambiguous_client_and_closed_client_reject_legacy_state(self):
        self.bind_fixture("JEV", "jev-session", 101)
        (self.state / "JEV").write_text(str(self.week))
        self.processes["303"] = {"key": "JEV", "started": "start-303"}
        self.save_processes()
        command = ["python3", str(SCRIPTS / "codex-session.py"), "target", "JEV"]
        result = subprocess.run(command, env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 3)
        del self.processes["101"]
        del self.processes["303"]
        self.save_processes()
        result = subprocess.run(command, env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 3)

    def test_claude_claims_terminal_after_codex_client_exits(self):
        self.bind_fixture("JEV", "jev-session", 101)
        del self.processes["101"]
        self.save_processes()
        self.run_script("session-cwd.sh", payload={"cwd": str(self.task)})
        self.assertFalse((self.state / "JEV.codex").exists())
        self.assertEqual(self.target("JEV"), str(self.task))

    def test_managed_backend_cannot_bind_to_ancestor_terminal(self):
        self.processes["555"] = {"key": "JEV", "started": "server-start", "tty": "??",
                                 "command": "codex app-server --managed-daemon"}
        self.parents = {"default": "555 ?? /bin/bash", "555": "101 ?? /bin/codex"}
        self.save_processes()
        self.write("week-session", self.week)
        self.assertFalse((self.state / "JEV.codex").exists())
        self.assertFalse((self.state / "JEV").exists())

    def test_existing_no_argument_hook_detects_codex_backend(self):
        self.processes["555"] = {"key": "JEV", "started": "server-start", "tty": "??",
                                 "command": "codex app-server --managed-daemon"}
        self.parents = {"default": "555 ?? /bin/bash", "555": "101 ?? /bin/codex"}
        self.save_processes()
        self.run_script("session-cwd.sh", payload={"session_id": "week-session", "cwd": str(self.week)})
        self.assertEqual((self.state / "codex-week-session").read_text().strip(), str(self.week))
        self.assertFalse((self.state / "JEV").exists())

    def test_independent_backend_can_bind_its_own_terminal(self):
        self.parents = {"default": "101 ?? /bin/bash", "101": "1 ttys101 /bin/codex"}
        self.save_processes()
        self.write("jev-session", self.jev)
        self.assertEqual(self.target("JEV"), str(self.jev))
        self.assertEqual(json.loads((self.state / "JEV.codex").read_text())["session_id"], "jev-session")

    def test_legacy_cleanup_preserves_active_codex_binding_and_task(self):
        self.bind_fixture("JEV", "jev-session", 101)
        env = dict(self.env, CODEX_THREAD_ID="jev-session")
        self.run_script("task-here.sh", str(self.task), env=env)
        for name in ("JEV.codex", "codex-jev-session.task"):
            os.utime(self.state / name, (1, 1))
        legacy_env = dict(self.env, TERM_SESSION_ID="w0t0p0:OTHER", ITERM_SESSION_ID="w0t0p0:OTHER")
        self.run_script("session-cwd.sh", env=legacy_env, payload={"cwd": str(self.week)})
        self.assertEqual(self.target("JEV"), str(self.task))

    def test_invalid_hook_input_cannot_change_valid_record(self):
        self.write("jev-session", self.jev)
        for payload in ({"session_id": "../escape", "cwd": str(self.week)},
                        {"session_id": "jev-session", "cwd": "/no/such/dir"},
                        {"cwd": str(self.week)}):
            self.run_script("session-cwd.sh", "--agent", "codex", payload=payload)
        self.assertEqual((self.state / "codex-jev-session").read_text().strip(), str(self.jev))
        self.assertFalse((self.root / "escape").exists())


if __name__ == "__main__":
    unittest.main()
