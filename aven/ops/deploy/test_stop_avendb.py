"""Process-level close-gate tests; Docker and SSH are disposable local stand-ins."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "deploy/stop-avendb.py"
DOCKER = r'''#!/usr/bin/env python3
import io,json,os,pathlib,sys,tarfile,time
root=pathlib.Path(os.environ['FAKE_ROOT']); args=sys.argv[1:]
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\n')
s=json.loads((root/'state.json').read_text())
if args[0]=='ps':
 if s.get('inventory_error'): sys.exit(6)
 if s.get('present',True): print(s['id']+' '+s.get('name','maia-city-avendb'))
 print('e'*64+' maia-city-avendb-backup')
elif args[0]=='inspect':
 print(json.dumps({k:s[k] for k in ('id','image','started','restarts','running','exit','oom','mounts','env')}))
elif args[0]=='cp':
 raw=json.dumps(s['health']).encode(); out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w') as archive:
  item=tarfile.TarInfo('health.json');item.size=len(raw);archive.addfile(item,io.BytesIO(raw))
 sys.stdout.buffer.write(out.getvalue())
elif args[0]=='stop':
 (root/'stopping').write_text('yes')
 while s.get('hold') and not (root/'release').exists(): time.sleep(0.02)
 time.sleep(s.get('delay',0))
 behavior=s.get('behavior','ok')
 if behavior=='fail': sys.exit(7)
 s['running']=False;s['exit']=0;s['health']['ended']={'how':'stopped'}
 if behavior=='oom': s['oom']=True
 if behavior=='nonzero': s['exit']=137
 if behavior=='marker-error': s['health']['ended']={'how':'error'}
 if behavior=='marker-missing': s['health']['ended']=None
 if behavior=='marker-stale': s['health']['started']-=1
 if behavior=='replaced': s['id']='c'*64
 if behavior=='restarted': s['started']='2026-10-23T18:00:01Z';s['restarts']+=1
 (root/'state.json').write_text(json.dumps(s))
elif args[0]=='compose' and 'config' in args:
 env={}
 if (root/'.env').exists(): env=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line)
 names=('AVENDB_BUCKET','AVENDB_BUCKET_ENDPOINT','AVENDB_BUCKET_REGION','AVENDB_BUCKET_SEAL')
 defaults={'AVENDB_BUCKET':'retained','AVENDB_BUCKET_ENDPOINT':'https://example.test','AVENDB_BUCKET_REGION':'test','AVENDB_BUCKET_SEAL':'synthetic'}
 values={k:env.get(k,defaults[k]) for k in names};values.update(s.get('config_env',{}))
 print(json.dumps({'services':{'avendb':{'volumes':[{'type':'bind','source':s.get('config_mount',env.get('AVENDB_DATA_PATH','/same/data')),'target':'/data'}],'environment':values}}}))
elif args[0]=='login': sys.stdin.read()
elif args[0] in ('pull','compose','logout','image'): pass
else: sys.exit(9)
'''
SSH = '''#!/usr/bin/env python3
import subprocess,sys
raise SystemExit(subprocess.call(['bash','-e','-c',sys.argv[-1]],stdin=sys.stdin))
'''

# The production host uses GNU sed; this stand-in handles only the existing
# deletion expressions, so the actual Linux workflow shell can run on macOS.
SED = r'''#!/usr/bin/env python3
import pathlib,re,sys
assert sys.argv[1]=='-i'
patterns=[]
for expr in sys.argv[2].split(';'):
 expr=expr.strip(); assert expr.startswith('/') and expr.endswith('/d')
 patterns.append(re.compile(expr[1:-2]))
p=pathlib.Path(sys.argv[3]); p.write_text(''.join(line for line in p.read_text().splitlines(keepends=True) if not any(x.search(line) for x in patterns)))
'''
FLOCK = '''#!/usr/bin/env python3
import fcntl,sys
try: fcntl.flock(int(sys.argv[-1]),fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: sys.exit(1)
'''
SCP = '''#!/usr/bin/env python3
import shutil,sys
shutil.copyfile(sys.argv[1],sys.argv[2].removeprefix('prod:'))
'''


def block(path, step):
    lines = (ROOT / path).read_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == f"- name: {step}")
    begin = next(i for i in range(start, len(lines)) if lines[i].strip() == "run: |") + 1
    end = next((i for i in range(begin, len(lines)) if lines[i] and not lines[i].startswith("          ")), len(lines))
    return textwrap.dedent("\n".join(lines[begin:end]))


class Closing(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="avendb-close-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "bin").mkdir()
        for name, source in (("docker", DOCKER), ("ssh", SSH), ("flock", FLOCK), ("sed", SED), ("scp", SCP)):
            path = self.root / "bin" / name
            path.write_text(source)
            path.chmod(0o755)
        self.state = {"id": "a" * 64, "image": "sha256:" + "b" * 64, "started": "2026-10-23T18:00:00Z", "restarts": 0,
                      "mounts": [{"Type":"bind", "Source":"/same/data", "Destination":"/data", "RW":True}],
                      "env": ["AVENDB_BUCKET=retained", "AVENDB_BUCKET_ENDPOINT=https://example.test", "AVENDB_BUCKET_REGION=test", "AVENDB_BUCKET_SEAL=synthetic", "AVENDB_DATA=/data"],
                      "running": True, "exit": 0, "oom": False, "health": {"started": 1792778400, "ended": None}}
        self.save()
        (self.root / ".env.lock").touch()
        self.addCleanup(self.release_owner)
        self.env = {**os.environ, "PATH": str(self.root / "bin") + os.pathsep + os.environ['PATH'], "FAKE_ROOT": str(self.root)}

    def release_owner(self):
        (self.root/'release').touch()
        # A failed assertion must not strand a disposable detached fixture.
        if self.state.get('hold') and list((self.root/'.avendb-stop').glob('*.json')):
            self.until(self.terminal)

    def save(self):
        (self.root / "state.json").write_text(json.dumps(self.state))

    def start(self, wait=5, verify_only=False, lock_fd=None):
        fd = lock_fd if lock_fd is not None else os.open(self.root / ".env.lock", os.O_RDWR)
        try:
            return subprocess.Popen([sys.executable, str(GATE), str(self.root), "--lock-fd", str(fd), "--wait", str(wait)] + (["--verify-only"] if verify_only else []),
                                    pass_fds=(fd,), env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        finally:
            if lock_fd is None:
                os.close(fd)

    def run_gate(self, wait=5, verify_only=False, lock_fd=None):
        process = self.start(wait, verify_only, lock_fd)
        out, err = process.communicate(timeout=20)
        return process.returncode, out.decode(), err.decode()

    def until(self, condition):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if condition(): return
            time.sleep(0.02)
        self.fail("owned fixture did not finish")

    def terminal(self):
        paths = list((self.root / ".avendb-stop").glob("*.json"))
        return bool(paths and json.loads(paths[0].read_text())["status"] != "pending")

    def calls(self):
        path = self.root / "calls"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def lock_held(self):
        with (self.root / ".env.lock").open() as lock:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_docker_fixture_discovery_cannot_bypass_disposable_runner_gate(self):
        spec=importlib.util.spec_from_file_location('docker_fixture',ROOT/'deploy/test_stop_avendb_docker.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with patch.dict(os.environ,{},clear=True),patch.object(module,'docker') as docker:
            with self.assertRaisesRegex(RuntimeError,'disposable GitHub'):
                module.DockerClosing.setUpClass()
            docker.assert_not_called()

    def test_success_and_repeat_use_one_exact_instance_stop(self):
        self.assertEqual(self.run_gate()[0], 0)
        self.assertEqual(self.run_gate()[0], 0)
        stops = [c for c in self.calls() if c[0] == 'stop']
        self.assertEqual(stops, [['stop', '--signal=SIGTERM', '--timeout=-1', 'a' * 64]])
        self.assertFalse(any(c[0] in ('kill', 'restart') for c in self.calls()))

    def test_monitor_timeout_keeps_owner_and_lock_then_resumes(self):
        self.state['hold'] = True; self.save()
        code, _, error = self.run_gate(0.05)
        self.assertNotEqual(code, 0); self.assertIn('budget expired', error)
        self.lock_held()
        self.assertNotEqual(self.run_gate()[0], 0)
        self.release_owner()
        self.assertEqual(self.run_gate()[0], 0)
        self.assertEqual(len([c for c in self.calls() if c[0] == 'stop']), 1)

    def test_cancelled_monitor_does_not_cancel_close_owner(self):
        self.state['hold'] = True; self.save()
        process = self.start()
        self.until(lambda: (self.root / 'stopping').exists())
        process.terminate(); process.communicate(timeout=3)
        self.lock_held()
        self.release_owner()
        self.assertEqual(self.run_gate()[0], 0)
        self.assertEqual(len([c for c in self.calls() if c[0] == 'stop']), 1)

    def test_failed_close_is_terminal_and_never_retried_as_success(self):
        self.state['behavior'] = 'fail'; self.save()
        self.assertNotEqual(self.run_gate()[0], 0)
        self.assertNotEqual(self.run_gate()[0], 0)
        self.assertEqual(len([c for c in self.calls() if c[0] == 'stop']), 1)

    def test_exit_oom_marker_and_generation_failures_are_closed(self):
        for behavior in ('oom', 'nonzero', 'marker-error', 'marker-missing', 'marker-stale', 'replaced', 'restarted'):
            with self.subTest(behavior=behavior):
                # Each independent case has its own receipt generation.
                self.state['id'] = f'{len(self.calls()) + 1:064x}'
                self.state['behavior'] = behavior; self.save()
                self.assertNotEqual(self.run_gate()[0], 0)
        self.assertFalse(any(c[0] in ('kill', 'restart') for c in self.calls()))

    def test_stale_initial_marker_or_unverified_stopped_process_is_refused(self):
        self.state['health']['ended'] = {'how': 'stopped'}; self.save()
        self.assertNotEqual(self.run_gate()[0], 0)
        self.state['health']['ended'] = None; self.state['running'] = False; self.save()
        self.assertNotEqual(self.run_gate()[0], 0)
        self.assertFalse(any(c[0] == 'stop' for c in self.calls()))

    def test_first_provision_has_no_existing_owner(self):
        self.state['present'] = False; self.save()
        self.assertEqual(self.run_gate()[0], 0)
        self.assertEqual([c[0] for c in self.calls()], ['ps'])

    def test_inventory_matches_exact_name_with_or_without_leading_slash(self):
        self.state['name'] = '/maia-city-avendb'; self.save()
        self.assertEqual(self.run_gate()[0], 0)
        self.assertEqual(len([c for c in self.calls() if c[0] == 'stop']), 1)

    def test_daemon_inventory_failure_is_not_first_install(self):
        self.state['inventory_error'] = True; self.save()
        self.assertNotEqual(self.run_gate()[0], 0)
        self.assertFalse(any(c[0] == 'stop' for c in self.calls()))

    def test_changed_mount_and_bucket_identity_refuse_before_stop(self):
        for name in ('AVENDB_BUCKET','AVENDB_BUCKET_ENDPOINT','AVENDB_BUCKET_REGION','AVENDB_BUCKET_SEAL','AVENDB_DATA'):
            with self.subTest(name=name):
                self.state['config_env'] = {name:'different'}; self.save()
                self.assertNotEqual(self.run_gate()[0], 0)
        self.state.pop('config_env'); self.state['config_mount']='/different'; self.save()
        self.assertNotEqual(self.run_gate()[0], 0)
        self.assertFalse(any(c[0] == 'stop' for c in self.calls()))

    def test_verify_only_requires_receipt_and_rechecks_proposed_configuration(self):
        # Like the deployment shell, retain ONE open-file lock through close,
        # configuration changes and final verification. A new descriptor can
        # race the detached worker exiting after publishing its receipt.
        with (self.root / '.env.lock').open('r+') as owner:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fd = owner.fileno()
            self.assertNotEqual(self.run_gate(verify_only=True, lock_fd=fd)[0], 0)
            self.assertFalse(any(c[0] == 'stop' for c in self.calls()))
            code, _, error = self.run_gate(lock_fd=fd)
            self.assertEqual(code, 0, error)
            self.lock_held()
            code, _, error = self.run_gate(verify_only=True, lock_fd=fd)
            self.assertEqual(code, 0, error)
            self.state=json.loads((self.root/'state.json').read_text())
            self.state['config_env']={'AVENDB_BUCKET_SEAL':'different'}; self.save()
            code, _, error = self.run_gate(verify_only=True, lock_fd=fd)
            self.assertNotEqual(code, 0)
            self.assertIn('AVENDB_BUCKET_SEAL changed', error)

    def workflow(self, fail=False, changed_seal=False):
        sha = 'd' * 40
        (self.root / 'deploy').mkdir(exist_ok=True)
        (self.root / 'deploy' / f'stop-avendb-{sha}.py').write_bytes(GATE.read_bytes())
        (self.root / '.env').write_text('AVENDB_IMAGE=old\nAVENDB_DATA_PATH=/same/data\nAVENDB_BUCKET=retained\n')
        if fail: self.state['behavior'] = 'fail'; self.save()
        env = {**self.env, 'GITHUB_SHA': sha, 'APP_DIR': str(self.root), 'IMAGE': 'registry/test:' + sha,
               'GHCR_TOKEN': 'synthetic', 'ACTOR': 'fixture', 'BUCKET_ACCESS_KEY': 'synthetic', 'BUCKET_SECRET_KEY': 'synthetic',
               'BUCKET_SEAL': 'different' if changed_seal else 'synthetic', 'BUCKET': 'retained', 'S3_ENDPOINT': 'https://example.test', 'S3_REGION': 'test', 'SNAPSHOTS': 'test'}
        return subprocess.run(['bash', '-e', '-c', block('.github/workflows/avendb.yml', 'Roll out the new image')], env=env, capture_output=True, timeout=10)

    def test_actual_server_shell_gates_config_and_activation(self):
        done = self.workflow()
        self.assertEqual(done.returncode, 0, done.stderr.decode())
        calls = self.calls(); stop = next(i for i, c in enumerate(calls) if c[0] == 'stop')
        up = next(i for i, c in enumerate(calls) if c[0] == 'compose' and 'up' in c)
        self.assertLess(stop, up)
        self.assertIn('AVENDB_DATA_PATH=/same/data', (self.root / '.env').read_text())

    def test_actual_server_shell_failure_never_changes_config_or_activates(self):
        done = self.workflow(fail=True)
        self.assertNotEqual(done.returncode, 0)
        self.assertEqual((self.root / '.env').read_text(), 'AVENDB_IMAGE=old\nAVENDB_DATA_PATH=/same/data\nAVENDB_BUCKET=retained\n')
        self.assertFalse(any(c[0] == 'compose' and 'up' in c for c in self.calls()))

    def test_actual_server_shell_refuses_new_seal_after_close(self):
        done = self.workflow(changed_seal=True)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn('AVENDB_BUCKET_SEAL changed', done.stderr.decode())
        self.assertTrue(any(c[0] == 'stop' for c in self.calls()))
        self.assertFalse(any(c[0] == 'compose' and 'up' in c for c in self.calls()))

    def test_api_config_activation_waits_for_owned_close_lock(self):
        self.state['hold'] = True; self.save()
        self.assertNotEqual(self.run_gate(0.05)[0],0)
        self.lock_held()
        (self.root/'deploy').mkdir(exist_ok=True)
        for name in ('docker-compose.yml','docker-compose.prod.yml','deploy/Caddyfile','deploy/backup.sh'):
            (self.root/name).write_text('previous')
        env={**self.env,'APP_DIR':str(self.root),'GITHUB_SHA':'f'*40}
        done=subprocess.run(['bash','-e','-c',block('.github/workflows/api.yml','Copy the compose files')],
                            env=env,cwd=ROOT,capture_output=True,timeout=5)
        self.assertNotEqual(done.returncode,0)
        for name in ('docker-compose.yml','docker-compose.prod.yml','deploy/Caddyfile','deploy/backup.sh'):
            self.assertEqual((self.root/name).read_text(),'previous')
        self.release_owner()

    def test_actual_api_shell_cannot_recreate_or_remove_avendb(self):
        env = {**self.env, 'APP_DIR': str(self.root), 'GHCR_TOKEN': 'synthetic', 'ACTOR': 'fixture'}
        done = subprocess.run(['bash', '-e', '-c', block('.github/workflows/api.yml', 'Update the containers')], env=env, capture_output=True, timeout=5)
        self.assertEqual(done.returncode, 0, done.stderr.decode())
        for call in [c for c in self.calls() if c[0] == 'compose' and ('up' in c or 'pull' in c)]:
            self.assertEqual(call[-3:], ['db', 'api', 'caddy'])
            self.assertNotIn('--remove-orphans', call)
            if 'up' in call: self.assertIn('--no-deps',call)
        self.assertFalse(any(c[0] in ('stop','kill','restart') for c in self.calls()))


if __name__ == '__main__':
    unittest.main()
