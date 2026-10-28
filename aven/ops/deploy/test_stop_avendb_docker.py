"""Actual Docker checks, restricted to a disposable GitHub Linux runner.

No real avenDB process/data: the toy writer delays its acknowledged work until
released. This verifies Docker/lock/receipt integration, not Rust persistence.
"""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "deploy/stop-avendb.py"
NAME = "maia-city-avendb"
IMAGE = "python:3.12-alpine"
LABEL = "city.maia.delivery-fixture"
WRITER = r'''
import json,os,pathlib,signal,time
root=pathlib.Path('/data'); closing=False; started=int(time.time())
def write(name,value):
 with (root/name).open('w') as output:
  output.write(value);output.flush();os.fsync(output.fileno())
def stop(*_):
 global closing
 closing=True
signal.signal(signal.SIGTERM,stop)
write('health.json',json.dumps({'started':started,'ended':None}))
write('ready','ready')
while not closing: time.sleep(.02)
write('closing','accepted SIGTERM')
while not (root/'release').exists(): time.sleep(.02)
failed=os.environ.get('FIXTURE_FAILURE')=='1'
if not failed: write('accepted','durable fixture data')
write('health.json',json.dumps({'started':started,'ended':{'how':'error' if failed else 'stopped'}}))
fd=os.open(root,os.O_RDONLY);os.fsync(fd);os.close(fd)
raise SystemExit(7 if failed else 0)
'''


def docker(*args, timeout=20):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'docker {args[0]} failed: {result.stderr.strip()}')
    return result.stdout.strip()


def until(condition, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition(): return
        time.sleep(.05)
    raise AssertionError('disposable container did not reach expected state')


def require_disposable_runner():
    if not (sys.platform=='linux' and os.environ.get('GITHUB_ACTIONS')=='true'
            and os.environ.get('AVENDB_DISPOSABLE_DOCKER')=='1' and not os.environ.get('DOCKER_HOST')):
        raise RuntimeError('Only run on an explicitly disposable GitHub Linux Docker runner.')
    endpoint=json.loads(docker('context','inspect','--format','{{json .Endpoints.docker.Host}}'))
    if endpoint!='unix:///var/run/docker.sock':
        raise RuntimeError('Refusing a nonlocal/default Docker endpoint.')


class DockerClosing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Apply this gate under discovery/pytest too, not only direct execution.
        require_disposable_runner()
        # Never repurpose an existing fixed-name service, even on a test runner.
        names = docker('ps', '-a', '--format', '{{.Names}}').splitlines()
        if NAME in [name.lstrip('/') for name in names]:
            raise RuntimeError('existing avenDB container: refusing disposable fixture')
        docker('pull', IMAGE, timeout=120)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='avendb-docker-close-')
        self.root = Path(self.temp.name)
        self.token = uuid.uuid4().hex
        self.container = None
        self.monitors = []
        self.addCleanup(self.cleanup)
        (self.root/'data').mkdir()
        (self.root/'writer.py').write_text(WRITER)
        (self.root/'.env.lock').touch()
        # The production helper validates real compose output, not a substitute.
        (self.root/'docker-compose.yml').write_text(json.dumps({'services': {'avendb': {
            'image': IMAGE, 'environment': {'AVENDB_DATA': '/data'},
            'volumes': [{'type':'bind','source':str(self.root/'data'),'target':'/data'}]
        }}}))
        (self.root/'docker-compose.prod.yml').write_text('services: {}\n')

    def cleanup(self):
        (self.root/'data'/'release').touch()
        for monitor in self.monitors:
            if monitor.poll() is None: monitor.terminate()
            monitor.communicate(timeout=5)
        if self.container:
            # Cleanup may force only this exact, labelled toy container; never a
            # name lookup or production ID, and never as successful-close evidence.
            label = docker('inspect', '--format', '{{index .Config.Labels "'+LABEL+'"}}', self.container)
            if label != self.token:
                raise RuntimeError('fixture identity changed; refusing cleanup')
            docker('rm', '--force', self.container)
            receipts = list((self.root/'.avendb-stop').glob('*.json'))
            if receipts:
                until(lambda: json.loads(receipts[0].read_text())['status'] != 'pending')
        self.temp.cleanup()

    def spawn(self, failed=False):
        self.container = docker('run', '--detach', '--name', NAME, '--network', 'none',
            '--label', LABEL+'='+self.token,
            '--mount', 'type=bind,source='+str(self.root/'data')+',target=/data',
            '--mount', 'type=bind,source='+str(self.root/'writer.py')+',target=/writer.py,readonly',
            '--env', 'AVENDB_DATA=/data', '--env', 'FIXTURE_FAILURE='+('1' if failed else '0'),
            IMAGE, 'python3', '/writer.py')
        until(lambda: (self.root/'data'/'ready').exists())

    def gate(self, wait=20):
        fd = os.open(self.root/'.env.lock', os.O_RDWR)
        try:
            child = subprocess.Popen([sys.executable, str(GATE), str(self.root), '--lock-fd', str(fd), '--wait', str(wait)],
                pass_fds=(fd,), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.monitors.append(child)
            return child
        finally:
            os.close(fd)

    def locked(self):
        with (self.root/'.env.lock').open() as fd:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def finish(self):
        (self.root/'data'/'release').touch()
        until(lambda: any(json.loads(path.read_text())['status'] != 'pending' for path in (self.root/'.avendb-stop').glob('*.json')))
        # The receipt is published just before the detached owner exits.
        def unlocked():
            with (self.root/'.env.lock').open() as fd:
                try: fcntl.flock(fd,fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError: return False
            return True
        until(unlocked)

    def test_cancelled_observer_retains_lock_and_exceeds_default_stop_deadline(self):
        self.spawn()
        monitor = self.gate(wait=60)
        until(lambda: (self.root/'data'/'closing').exists())
        monitor.terminate(); monitor.communicate(timeout=5)
        self.locked()
        # Docker normally allows ten seconds on Linux. The actual stop here must
        # still be waiting, with the toy's accepted write deliberately unfinished.
        time.sleep(12)
        self.assertEqual(docker('inspect','--format','{{.State.Running}}',self.container),'true')
        self.assertFalse((self.root/'data'/'accepted').exists())
        self.locked()
        competitor = self.gate(); competitor.communicate(timeout=5)
        self.assertNotEqual(competitor.returncode,0)
        self.finish()
        resumed = self.gate(); _,error=resumed.communicate(timeout=20)
        self.assertEqual(resumed.returncode,0,error.decode())
        self.assertEqual((self.root/'data'/'accepted').read_text(),'durable fixture data')
        self.assertEqual(docker('inspect','--format','{{.State.ExitCode}} {{.State.OOMKilled}}',self.container),'0 false')

    def test_monitor_budget_leaves_real_stop_owned(self):
        self.spawn()
        monitor=self.gate(wait=.1); _,error=monitor.communicate(timeout=20)
        self.assertNotEqual(monitor.returncode,0)
        self.assertIn('budget expired',error.decode())
        until(lambda: (self.root/'data'/'closing').exists())
        self.locked(); self.finish()
        resumed=self.gate(); _,error=resumed.communicate(timeout=20)
        self.assertEqual(resumed.returncode,0,error.decode())

    def test_real_failed_exit_and_marker_never_authorize_replacement(self):
        self.spawn(failed=True)
        monitor=self.gate()
        until(lambda: (self.root/'data'/'closing').exists())
        (self.root/'data'/'release').touch()
        _,error=monitor.communicate(timeout=20)
        self.assertNotEqual(monitor.returncode,0,error.decode())
        repeated=self.gate(); repeated.communicate(timeout=20)
        self.assertNotEqual(repeated.returncode,0)
        self.assertEqual(docker('inspect','--format','{{.State.ExitCode}}',self.container),'7')
        self.assertFalse((self.root/'data'/'accepted').exists())


if __name__ == '__main__':
    unittest.main()
