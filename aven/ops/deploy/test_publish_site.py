"""Disposable deploy tests; CADDY=/path/to/caddy also exercises the actual site route."""
import importlib.util
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("publisher", HERE / "publish-site.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class Publishing(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="site-publish-")
        self.addCleanup(self.temporary.cleanup)
        self.site = Path(self.temporary.name)
        (self.site / "releases").mkdir()

    def release(self, number, assets=None):
        commit = f"{number:040x}"
        release = self.site / "releases" / commit
        (release / publisher.IMMUTABLE).mkdir(parents=True)
        (release / "index.html").write_text(f"page {number}")
        (release / "404.html").write_text("not found")
        assets = assets or {f"nodes/{number}.hash-{number}.js": f"export default {number};"}
        for name, content in assets.items():
            file = release / publisher.IMMUTABLE / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(content)
        return commit

    def asset(self, name):
        return self.site / "assets" / publisher.IMMUTABLE / name

    def test_backfills_previous_page_before_switch_and_preserves_rollback(self):
        first = self.release(1)
        (self.site / "current").symlink_to(Path("releases") / first)
        second = self.release(2)
        replace = os.replace
        def switch(source, destination):
            self.assertEqual((self.site / "current/index.html").read_text(), "page 1")
            self.assertEqual(self.asset("nodes/1.hash-1.js").read_text(), "export default 1;")
            self.assertTrue(self.asset("nodes/2.hash-2.js").is_file())
            replace(source, destination)
        with patch.object(publisher.os, "replace", side_effect=switch):
            publisher.publish(self.site, second)
        self.assertEqual((self.site / "current/index.html").read_text(), "page 2")
        publisher.publish(self.site, first)
        self.assertEqual((self.site / "current/index.html").read_text(), "page 1")
        self.assertTrue(self.asset("nodes/2.hash-2.js").is_file())

    def test_five_releases_and_thirty_day_assets_have_independent_cleanup(self):
        commits = []
        for number in range(1, 7):
            commit = self.release(number, {f"nodes/{number}.js": str(number), "chunks/shared.hash.js": "same bytes"})
            publisher.publish(self.site, commit, now=1_700_000_000 + number)
            commits.append(commit)
        self.assertEqual(len(list((self.site / "releases").iterdir())), 5)
        self.assertFalse((self.site / "releases" / commits[0]).exists())
        # Six rapid releases must not break a page opened with the first one.
        self.assertTrue(self.asset("nodes/1.js").exists())
        publisher.publish(self.site, commits[-1], now=1_700_000_000 + 29 * 86400)
        self.assertTrue(self.asset("nodes/1.js").exists())
        publisher.publish(self.site, commits[-1], now=1_700_000_000 + 31 * 86400)
        self.assertFalse(self.asset("nodes/1.js").exists())
        for number in range(2, 7):
            self.assertEqual(self.asset(f"nodes/{number}.js").read_text(), str(number))
        self.assertEqual(self.asset("chunks/shared.hash.js").read_text(), "same bytes")

    def test_first_upgrade_backfills_the_release_about_to_leave_rollback_window(self):
        commits = [self.release(number) for number in range(1, 7)]
        (self.site / "current").symlink_to(Path("releases") / commits[-2])
        publisher.publish(self.site, commits[-1])
        self.assertFalse((self.site / "releases" / commits[0]).exists())
        self.assertEqual(self.asset("nodes/1.hash-1.js").read_text(), "export default 1;")

    def test_collision_or_copy_failure_does_not_switch_or_prune(self):
        first = self.release(1, {"same.hash.js": "old"})
        publisher.publish(self.site, first)
        collision = self.release(2, {"same.hash.js": "bad"})
        with self.assertRaisesRegex(ValueError, "different bytes"):
            publisher.publish(self.site, collision)
        self.assertEqual((self.site / "current").resolve().name, first)
        self.assertEqual(self.asset("same.hash.js").read_text(), "old")
        shutil.rmtree(self.site / "releases" / collision)
        second = self.release(2)
        with patch.object(publisher.os, "link", side_effect=OSError("interrupted publication")):
            with self.assertRaisesRegex(OSError, "interrupted"):
                publisher.publish(self.site, second)
        self.assertEqual((self.site / "current").resolve().name, first)
        self.assertTrue((self.site / "releases" / first).is_dir())
        publisher.publish(self.site, second)
        self.assertEqual((self.site / "current").resolve().name, second)

    def test_only_immutable_files_are_published_and_symlinks_are_rejected(self):
        first = self.release(1)
        release = self.site / "releases" / first
        (release / "release.json").write_text("release inventory")
        (release / publisher.IMMUTABLE / "escape.js").symlink_to(release / "release.json")
        with self.assertRaisesRegex(ValueError, "not a regular file"):
            publisher.publish(self.site, first)
        self.assertFalse((self.site / "current").exists())
        (release / publisher.IMMUTABLE / "escape.js").unlink()
        publisher.publish(self.site, first)
        self.assertFalse((self.site / "assets/release.json").exists())
        self.assertFalse((self.site / "assets/index.html").exists())

    def test_caddy_activation_validates_retries_failures_and_skips_unchanged_routes(self):
        workflow = (HERE.parent / ".github/workflows/deploy.yml").read_text()
        body = workflow.split("<<'SH'\n", 1)[1].split("\n          SH", 1)[0]
        body = "\n".join(line.removeprefix("          ") for line in body.splitlines())
        host = self.site / "host"
        (host / "deploy").mkdir(parents=True)
        (host / "site").mkdir()
        config = host / "deploy/Caddyfile"
        config.write_text("old config")
        commit = "a" * 40
        candidate = host / "site" / f".Caddyfile-{commit}"
        applied = host / "site/.caddy-applied"
        commands = host / "commands"
        binary = host / "bin"
        binary.mkdir()
        docker = binary / "docker"
        docker.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n[ "${FAIL:-}" != "$4" ]\n')
        docker.chmod(0o755)
        def run(fail=""):
            candidate.write_text("new config")
            env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}", "CALLS": str(commands), "FAIL": fail}
            return subprocess.run(["bash", "-s", "--", str(host), commit], input=body, text=True, env=env, capture_output=True, timeout=5)
        self.assertNotEqual(run("validate").returncode, 0)
        self.assertEqual(config.read_text(), "old config")
        self.assertFalse(applied.exists())
        self.assertNotEqual(run("reload").returncode, 0)
        self.assertFalse(applied.exists())
        self.assertEqual(run().returncode, 0)
        self.assertEqual(config.read_text(), "new config")
        self.assertTrue(applied.is_file())
        previous_calls = commands.read_text()
        self.assertEqual(run().returncode, 0)
        self.assertEqual(commands.read_text(), previous_calls, "unchanged routes must not reconnect relay peers")
        self.assertFalse(candidate.exists())

    @unittest.skipUnless(os.environ.get("CADDY"), "set CADDY to run the actual HTTP routing fixture")
    def test_caddy_serves_old_open_page_chunks_after_deploy_without_exposing_releases(self):
        first = self.release(1)
        (self.site / "current").symlink_to(Path("releases") / first)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        source = (HERE / "Caddyfile").read_text()
        def block(marker):
            lines = source.splitlines()
            start = next(i for i, line in enumerate(lines) if line.startswith(marker))
            depth = 0
            for end in range(start, len(lines)):
                depth += lines[end].count("{") - lines[end].count("}")
                if depth == 0:
                    return "\n".join(lines[start:end + 1])
            raise AssertionError("unclosed Caddy block")
        route = block("{$SITE_ADDRESS:maia.city} {")
        route = route.replace("{$SITE_ADDRESS:maia.city}", f"http://127.0.0.1:{port}")
        route = route.replace("/srv/site", str(self.site))
        config = self.site / "Caddyfile"
        config.write_text("{\n admin off\n auto_https off\n}\n" + block("(walls) {") + "\n" + route)
        log = (self.site / "caddy.log").open("w+")
        self.addCleanup(log.close)
        process = subprocess.Popen([os.environ["CADDY"], "run", "--config", str(config), "--adapter", "caddyfile"], stdout=log, stderr=log)
        def stop():
            process.terminate()
            process.wait(timeout=5)
        self.addCleanup(stop)
        base = f"http://127.0.0.1:{port}"
        def get(path):
            with urllib.request.urlopen(base + path, timeout=2) as reply:
                return reply.read(), reply.headers
        for _ in range(100):
            try:
                get("/")
                break
            except (OSError, urllib.error.URLError):
                if process.poll() is not None:
                    log.seek(0)
                    self.fail(log.read())
                time.sleep(0.02)
        # New routing is safe even before the first publisher has backfilled assets.
        old_url = "/_app/immutable/nodes/1.hash-1.js"
        self.assertEqual(get(old_url)[0], b"export default 1;")
        second = self.release(2)
        publisher.publish(self.site, second)
        page, page_headers = get("/")
        self.assertEqual(page, b"page 2")
        self.assertIn("must-revalidate", page_headers["Cache-Control"])
        old_bytes, headers = get(old_url)
        self.assertEqual(old_bytes, b"export default 1;")
        self.assertIn("immutable", headers["Cache-Control"])
        self.assertIn("javascript", headers["Content-Type"])
        with self.assertRaises(urllib.error.HTTPError) as missing:
            get("/_app/immutable/not-yet-published.js")
        self.assertEqual(missing.exception.code, 404)
        self.assertEqual(missing.exception.headers["Cache-Control"], "no-store")
        self.assertEqual(get("/_app/immutable/nodes/2.hash-2.js")[0], b"export default 2;")
        for private in [f"/releases/{first}/index.html", "/assets/_app/immutable/nodes/1.hash-1.js", "/.publish.lock"]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                get(private)
            self.assertEqual(error.exception.code, 404)
        publisher.publish(self.site, first)
        self.assertEqual(get("/")[0], b"page 1")
        self.assertEqual(get("/_app/immutable/nodes/2.hash-2.js")[0], b"export default 2;")


if __name__ == "__main__":
    unittest.main()
