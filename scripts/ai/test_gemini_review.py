"""Black-box integration tests for the Gemini review command.

Run with: python3 -m unittest discover -s scripts/ai -p 'test_*.py' -v
Only gemini-api is replaced; the real review command runs in a subprocess.
"""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[2]
COMMAND = ROOT / "scripts/ai/gemini_review.py"
CONTEXT_PATH = "backend/src/domain/progression/comparability.policy.ts"
FAKE_KEY = "test-only-gemini-key-do-not-disclose"
PROVIDER_SECRET = "test-provider-private-message-do-not-disclose"

FAKE_CLI = textwrap.dedent(r'''\
#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys
import time

request = sys.stdin.read()
capture = os.environ.get("TEST_AI_CAPTURE")
if capture:
    Path(capture).write_text(json.dumps({"argv": sys.argv[1:], "stdin": request}))
mode = os.environ.get("TEST_AI_FAKE_MODE", "normal")
if mode == "timeout":
    time.sleep(3)
if mode == "auth":
    sys.stderr.write("provider error: " + os.environ["GEMINI_API_KEY"] + " " + os.environ["TEST_AI_PROVIDER_SECRET"])
    sys.exit(3)
if mode == "usage":
    sys.stderr.write("provider usage error")
    sys.exit(2)
if mode == "runtime":
    sys.stderr.write("provider failed")
    sys.exit(1)
report = {
    "summary": "Review completed against the supplied context.",
    "verdict": "pass",
    "findings": [],
    "checks": ["Compared the supplied policy with the requested task."],
    "limitations": ["Only the supplied file was reviewed."],
}
if mode in ("findings", "outside_context", "boolean_line", "nonexistent_line"):
    report["verdict"] = "concerns"
    report["findings"] = [{
        "severity": "medium",
        "file": "backend/src/domain/progression/comparability.policy.ts",
        "line": 1,
        "description": "Example finding from a test provider.",
        "recommendation": "Inspect this case.",
    }]
    if mode == "outside_context":
        report["findings"][0]["file"] = "scripts/ai/test_gemini_review.py"
    if mode == "boolean_line":
        report["findings"][0]["line"] = True
    if mode == "nonexistent_line":
        report["findings"][0]["line"] = 1000000000
if mode == "bad_nested_field":
    report["findings"] = [{
        "severity": "medium", "file": "example.ts", "line": "first",
        "description": "Example", "recommendation": "Inspect",
    }]
if mode == "bad_line":
    report["findings"] = [{
        "severity": "medium", "file": "example.ts", "line": 0,
        "description": "Example", "recommendation": "Inspect",
    }]
if mode == "bad_checks":
    report["checks"] = [42]
if mode == "bad_verdict":
    report["verdict"] = "approved"
if mode == "missing_field":
    del report["limitations"]
if mode == "invalid_json":
    sys.stdout.write("not a JSON response")
    sys.exit(0)
response = {
    "id": "test", "status": "completed",
    "outputs": [{"type": "text", "text": json.dumps(report)}],
}
if mode == "incomplete":
    response["status"] = "incomplete"
if mode == "invalid_report_json":
    response["outputs"][0]["text"] = "not a JSON report"
if mode == "empty_outputs":
    response["outputs"] = []
sys.stdout.write(json.dumps(response))
''').lstrip("\\\n")


def string_leaves(value):
    if isinstance(value, str):
        yield value
        # Providers accept both structured input and JSON encoded text input.
        try:
            decoded = json.loads(value)
        except (ValueError, TypeError):
            return
        if isinstance(decoded, (dict, list)):
            yield from string_leaves(decoded)
    elif isinstance(value, dict):
        for nested in value.values():
            yield from string_leaves(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from string_leaves(nested)


def contains_key(value, key):
    if isinstance(value, dict):
        return key in value or any(contains_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(contains_key(item, key) for item in value)
    return False


class GeminiReviewIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gemini-review-tests-")
        self.addCleanup(self.temp.cleanup)
        self.temp_path = Path(self.temp.name)
        executable = self.temp_path / "gemini-api"
        executable.write_text(FAKE_CLI, encoding="utf-8")
        executable.chmod(0o700)
        self.capture = self.temp_path / "capture.json"
        self.env = os.environ.copy()
        for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"):
            self.env.pop(name, None)
        self.env.update({
            "PATH": str(self.temp_path) + os.pathsep + os.defpath,
            "GEMINI_API_KEY": FAKE_KEY,
            "TEST_AI_PROVIDER_SECRET": PROVIDER_SECRET,
            "TEST_AI_CAPTURE": str(self.capture),
            "TEST_AI_FAKE_MODE": "normal",
        })

    def run_review(self, *extra, role="math", mode="normal", key=True, files=None, env=None):
        environment = self.env.copy()
        environment["TEST_AI_FAKE_MODE"] = mode
        if not key:
            environment.pop("GEMINI_API_KEY", None)
        if env:
            environment.update(env)
        args = [sys.executable, str(COMMAND), "--role", role,
                "--task", "Review the supplied policy and explain any concerns."]
        for path in ([CONTEXT_PATH] if files is None else files):
            args.extend(["--file", path])
        return subprocess.run(args + list(extra), cwd=self.temp_path, env=environment,
                              capture_output=True, text=True, timeout=10, check=False)

    def assert_code(self, process, code):
        self.assertEqual(process.returncode, code,
                         "stdout={!r}\nstderr={!r}".format(process.stdout, process.stderr))

    def read_envelope(self, process, code=0):
        self.assert_code(process, code)
        return json.loads(process.stdout)

    def assert_context(self, envelope, paths=None):
        expected_paths = [CONTEXT_PATH] if paths is None else paths
        self.assertEqual([item["path"] for item in envelope["context"]], expected_paths)
        for item in envelope["context"]:
            content = (ROOT / item["path"]).read_bytes()
            self.assertEqual(item["sha256"], hashlib.sha256(content).hexdigest())
            self.assertEqual(item["bytes"], len(content))

    def repository_fixture(self):
        temporary = tempfile.TemporaryDirectory(
            prefix=".gemini-review-fixtures-", dir=ROOT / "scripts/ai")
        self.addCleanup(temporary.cleanup)
        return Path(temporary.name)

    def relative_path(self, path):
        return path.relative_to(ROOT).as_posix()

    def test_both_roles_return_valid_envelopes(self):
        for role in ("math", "technical"):
            with self.subTest(role=role):
                result = self.read_envelope(self.run_review(role=role))
                self.assertEqual(result["role"], role)
                self.assertIsInstance(result["model"], str)
                self.assertTrue(result["model"])
                self.assertEqual(result["report"]["verdict"], "pass")
                self.assertEqual(result["report"]["findings"], [])
                self.assert_context(result)

    def test_dry_run_needs_neither_key_nor_cli(self):
        result = self.read_envelope(self.run_review(
            "--dry-run", key=False, env={"PATH": "/nonexistent-gemini-test-path"}))
        self.assertEqual(result["role"], "math")
        self.assertTrue(result["model"])
        self.assert_context(result)
        self.assertIn("request", result)
        self.assertFalse(self.capture.exists())

    def test_provider_receives_generate_body_and_structured_schema(self):
        self.assert_code(self.run_review(), 0)
        captured = json.loads(self.capture.read_text(encoding="utf-8"))
        self.assertEqual(captured["argv"], ["generate", "--body", "@-", "--output-format", "json"])
        request = json.loads(captured["stdin"])
        self.assertIs(request["store"], False)
        self.assertIn("response_format", request)
        self.assertTrue(contains_key(request["response_format"], "schema"))
        text = "\n".join(string_leaves(request))
        self.assertIn(CONTEXT_PATH, text)
        self.assertIn((ROOT / CONTEXT_PATH).read_text(encoding="utf-8"), text)
        self.assertNotIn(FAKE_KEY, captured["stdin"])

    def test_repeated_files_are_explicit_context(self):
        paths = [CONTEXT_PATH, "scripts/ai/test_gemini_review.py"]
        result = self.read_envelope(self.run_review("--dry-run", files=paths, key=False))
        self.assert_context(result, paths)

    def test_usage_errors(self):
        for kwargs in ({"role": "unknown"}, {"files": []}):
            with self.subTest(kwargs=kwargs):
                self.assert_code(self.run_review(**kwargs), 2)
        self.assert_code(self.run_review("--timeout", "-1"), 2)

    def test_missing_key(self):
        self.assert_code(self.run_review(key=False), 3)
        self.assertFalse(self.capture.exists())

    def test_missing_external_executable(self):
        self.assert_code(self.run_review(env={"PATH": "/nonexistent-gemini-test-path"}), 4)

    def test_invalid_context(self):
        outside = self.temp_path / "outside.txt"
        outside.write_text("outside repository", encoding="utf-8")
        paths = ["does-not-exist-gemini-test.ts", str(outside),
                 "../../outside.txt", ".env", "backend/.env", ".env.production"]
        for path in paths:
            with self.subTest(path=path):
                self.assert_code(self.run_review(files=[path]), 5)
        self.assertFalse(self.capture.exists())

    def test_auth_errors_suppress_provider_secrets(self):
        process = self.run_review(mode="auth")
        self.assert_code(process, 3)
        for secret in (FAKE_KEY, PROVIDER_SECRET):
            self.assertNotIn(secret, process.stdout + process.stderr)

    def test_nul_context_is_rejected_before_provider_call(self):
        binary = self.repository_fixture() / "binary.txt"
        binary.write_bytes(b"printable prefix\x00binary suffix")
        self.assert_code(self.run_review(files=[self.relative_path(binary)]), 5)
        self.assertFalse(self.capture.exists())

    def test_total_context_limit_applies_across_files(self):
        folder = self.repository_fixture()
        paths = [folder / "first.txt", folder / "second.txt"]
        for path in paths:
            path.write_bytes(b"x" * (130 * 1024))
        self.assert_code(self.run_review(files=[self.relative_path(path) for path in paths]), 5)
        self.assertFalse(self.capture.exists())

    def test_exact_context_size_limit_is_accepted(self):
        context = self.repository_fixture() / "exact.txt"
        context.write_bytes(b"x" * (256 * 1024))
        paths = [self.relative_path(context)]
        result = self.read_envelope(self.run_review("--dry-run", files=paths, key=False))
        self.assert_context(result, paths)

    def test_symlink_to_secret_context_is_rejected(self):
        folder = self.repository_fixture()
        secret = folder / ".env"
        secret.write_text("TEST_ONLY_SECRET=fixture-value\n", encoding="utf-8")
        alias = folder / "innocent.txt"
        alias.symlink_to(secret)
        self.assert_code(self.run_review(files=[self.relative_path(alias)]), 5)
        self.assertFalse(self.capture.exists())

    def test_existing_sensitive_paths_are_rejected_in_dry_run(self):
        folder = self.repository_fixture()
        for name in (".env", ".env.production", ".env.production.txt",
                     ".aws/credentials", ".aws/config.json"):
            with self.subTest(name=name):
                context = folder / name
                context.parent.mkdir(parents=True, exist_ok=True)
                context.write_text("TEST_ONLY=innocuous-fixture\n", encoding="utf-8")
                process = self.run_review("--dry-run", key=False,
                                          files=[self.relative_path(context)])
                self.assert_code(process, 5)
                self.assertFalse(self.capture.exists())

    def test_codex_templates_are_allowed_explicit_context(self):
        paths = ["scripts/ai/codex/config.toml", "scripts/ai/codex/worker.toml",
                 "scripts/ai/codex/explorer.toml"]
        result = self.read_envelope(self.run_review("--dry-run", key=False, files=paths))
        self.assert_context(result, paths)
        self.assertFalse(self.capture.exists())

    def test_provider_usage_is_runtime_error(self):
        self.assert_code(self.run_review(mode="usage"), 6)

    def test_provider_runtime_error(self):
        self.assert_code(self.run_review(mode="runtime"), 6)

    def test_malformed_and_incomplete_responses(self):
        modes = ("invalid_json", "invalid_report_json", "empty_outputs", "incomplete",
                 "bad_nested_field", "bad_line", "bad_checks", "bad_verdict", "missing_field",
                 "outside_context", "boolean_line", "nonexistent_line")
        for mode in modes:
            with self.subTest(mode=mode):
                self.assert_code(self.run_review(mode=mode), 7)

    def test_timeout(self):
        self.assert_code(self.run_review("--timeout", "0.05", mode="timeout"), 8)

    def test_existing_output_is_not_overwritten(self):
        output = self.temp_path / "existing.json"
        original = b"existing result must survive\n"
        output.write_bytes(original)
        self.assert_code(self.run_review("--output", str(output)), 9)
        self.assertEqual(output.read_bytes(), original)

    def test_output_write_failure(self):
        self.assert_code(self.run_review("--output", str(self.temp_path)), 9)

    def test_successful_output_matches_stdout(self):
        output = self.temp_path / "review.json"
        result = self.read_envelope(self.run_review("--output", str(output)))
        self.assertEqual(json.loads(output.read_text(encoding="utf-8")), result)

    def test_findings_only_change_exit_code_when_requested(self):
        self.read_envelope(self.run_review(mode="findings"))
        result = self.read_envelope(self.run_review("--fail-on-findings", mode="findings"), code=10)
        self.assertEqual(len(result["report"]["findings"]), 1)
        self.read_envelope(self.run_review("--fail-on-findings"))


class CodexInstallerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location(
            "gemini_review_test_installer", ROOT / "scripts/ai/install_codex.py")
        cls.installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.installer)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="codex-installer-tests-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def snapshot(self):
        return {
            path.relative_to(self.root).as_posix(): (path.read_bytes() if path.is_file() else None)
            for path in self.root.rglob("*")
        }

    def test_fresh_install_copies_all_three_valid_toml_files(self):
        self.installer.install(root=self.root)
        templates = {
            ".codex/config.toml": "config.toml",
            ".codex/agents/worker.toml": "worker.toml",
            ".codex/agents/explorer.toml": "explorer.toml",
        }
        for destination, template in templates.items():
            with self.subTest(destination=destination):
                installed = self.root / destination
                self.assertEqual(installed.read_bytes(),
                                 (ROOT / "scripts/ai/codex" / template).read_bytes())
                self.assertIsInstance(tomllib.loads(installed.read_text(encoding="utf-8")), dict)

    def test_install_is_idempotent(self):
        self.installer.install(root=self.root)
        original = self.snapshot()
        self.installer.install(root=self.root)
        self.assertEqual(self.snapshot(), original)

    def test_parent_file_conflict_is_rejected_before_any_write(self):
        for check in (True, False):
            with self.subTest(check=check):
                root = self.root / ("check" if check else "install")
                conflict = root / ".codex/agents"
                conflict.parent.mkdir(parents=True)
                original = b"existing regular file must survive\n"
                conflict.write_bytes(original)
                with self.assertRaises((ValueError, OSError)):
                    self.installer.install(root=root, check=check)
                self.assertEqual(conflict.read_bytes(), original)
                self.assertFalse((root / ".codex/config.toml").exists())

    def test_preflight_conflict_preserves_everything_without_partial_install(self):
        conflict = self.root / ".codex/agents/explorer.toml"
        conflict.parent.mkdir(parents=True)
        conflict.write_text('existing = "user-owned configuration"\n', encoding="utf-8")
        (self.root / "existing.txt").write_bytes(b"preserve this file\n")
        original = self.snapshot()
        with self.assertRaises(ValueError):
            self.installer.install(root=self.root)
        self.assertEqual(self.snapshot(), original)
        self.assertFalse((self.root / ".codex/config.toml").exists())
        self.assertFalse((self.root / ".codex/agents/worker.toml").exists())


if __name__ == "__main__":
    unittest.main()
