#!/usr/bin/env python3
"""Gate replacement on one owned, graceful close; never deploy or force-kill.

Caller holds root/.env.lock on --lock-fd through this command AND activation.
The detached close worker inherits that lock if the bounded observer disappears.
Only fixed-container metadata and its health marker are read, never its database.
"""
import argparse
import datetime
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time

CONTAINER = "maia-city-avendb"
ID = re.compile(r"[0-9a-f]{64}")
INSPECT = '{"id":{{json .Id}},"image":{{json .Image}},"started":{{json .State.StartedAt}},"restarts":{{json .RestartCount}},"running":{{json .State.Running}},"exit":{{json .State.ExitCode}},"oom":{{json .State.OOMKilled}},"mounts":{{json .Mounts}},"env":{{json .Config.Env}}}'


def docker(*args):
    done = subprocess.run(["docker", *args], capture_output=True, timeout=15)
    if done.returncode:
        raise RuntimeError(f"docker {args[0]} failed ({done.returncode}); no replacement permitted")
    if len(done.stdout) > 131072:
        raise RuntimeError("container metadata exceeds limit")
    return done.stdout


def inspect(identity):
    state = json.loads(docker("inspect", "--format", INSPECT, identity))
    if not ID.fullmatch(state.get("id", "")) or not isinstance(state.get("started"), str):
        raise RuntimeError("invalid container identity")
    return state


def current():
    # Do not rely on Docker's regex interpretation of its slash-prefixed names:
    # a false negative here would mistake an existing writer for first install.
    rows = docker("ps", "-a", "--no-trunc", "--format", "{{.ID}} {{.Names}}").decode().splitlines()
    ids = []
    for row in rows:
        parts = row.split()
        if len(parts) != 2 or not ID.fullmatch(parts[0]):
            raise RuntimeError("invalid container inventory")
        if parts[1].lstrip("/") == CONTAINER:
            ids.append(parts[0])
    if len(ids) > 1:
        raise RuntimeError("ambiguous avenDB container")
    return inspect(ids[0]) if ids else None


def verify_config(state):
    # Values stay in memory, never in receipts/logs. Credentials may rotate, but
    # a different shelf/bucket/seal is not a production upgrade of this device.
    config = json.loads(docker("compose", "-f", "docker-compose.yml", "-f", "docker-compose.prod.yml",
                               "config", "--format", "json", "avendb"))["services"]["avendb"]
    mounted = [m for m in state["mounts"] if m["Destination"] == "/data"]
    wanted = [m for m in config.get("volumes", []) if m.get("target") == "/data"]
    if (len(mounted) != 1 or len(wanted) != 1 or mounted[0]["Type"] != "bind"
            or wanted[0].get("type") != "bind" or mounted[0]["Source"] != wanted[0].get("source")
            or mounted[0].get("RW") is not True or wanted[0].get("read_only", False)):
        raise RuntimeError("avenDB /data mount changed; replacement refused")
    old = dict(item.split("=", 1) for item in state["env"])
    new = config.get("environment", {})
    for name in ("AVENDB_BUCKET", "AVENDB_BUCKET_ENDPOINT", "AVENDB_BUCKET_REGION", "AVENDB_BUCKET_SEAL", "AVENDB_DATA"):
        default = "/data" if name == "AVENDB_DATA" else ""
        if old.get(name, default) != new.get(name, default):
            raise RuntimeError(f"{name} changed; replacement refused")


def health(identity):
    data = docker("cp", f"{identity}:/data/health.json", "-")
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        files = archive.getmembers()
        if len(files) != 1 or not files[0].isfile() or files[0].size > 65536:
            raise RuntimeError("invalid health archive")
        stream = archive.extractfile(files[0])
        value = json.load(stream)
    started = value.get("started")
    if type(started) is not int or started <= 0:
        raise RuntimeError("invalid health start")
    ended = value.get("ended")
    if ended is not None and not isinstance(ended, dict):
        raise RuntimeError("invalid health close marker")
    return {"started": started, "ended": ended}


def instance(state):
    return {k: state[k] for k in ("id", "image", "started", "restarts")}


def key(target):
    digest = hashlib.sha256(json.dumps(target, sort_keys=True).encode()).hexdigest()[:20]
    return f"{target['id']}-{digest}.json"


def save(path, value):
    temporary = path.with_name(path.name + f".{os.getpid()}.tmp")
    with temporary.open("x") as output:
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def read(path):
    if path.is_symlink() or path.stat().st_size > 16384:
        raise RuntimeError("invalid close receipt")
    return json.loads(path.read_text())


def lock(root, fd):
    # Validate the inherited descriptor, then retain/reassert the same open-file
    # lock; opening a different descriptor would not survive with the caller.
    expected = (root / ".env.lock").stat()
    actual = os.fstat(fd)
    if (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino):
        raise RuntimeError("caller must retain the existing .env.lock descriptor")
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def verify(target, started):
    state = current()
    if state is None or instance(state) != target:
        raise RuntimeError("container instance changed during close")
    marker = health(target["id"])
    if state["running"] is not False or state["exit"] != 0 or state["oom"] is not False:
        raise RuntimeError("container did not exit cleanly")
    if marker["started"] != started or (marker["ended"] or {}).get("how") != "stopped":
        raise RuntimeError("matching normal-close marker is missing")


def worker(root, fd, operation):
    lock(root, fd)
    path = root / ".avendb-stop" / operation
    receipt = read(path)
    try:
        target = receipt["target"]
        state = current()
        if state is None or instance(state) != target or state["running"] is not True:
            raise RuntimeError("container changed before graceful stop")
        # Intentionally no timeout: an observer's budget cannot cancel a fence.
        result = subprocess.run(["docker", "stop", "--signal=SIGTERM", "--timeout=-1", target["id"]],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode:
            raise RuntimeError(f"graceful stop failed ({result.returncode})")
        verify(target, receipt["health_started"])
        receipt["status"] = "succeeded"
    except Exception as error:
        receipt["status"] = "failed"
        receipt["error"] = str(error)
    save(path, receipt)


def gate(root, fd, wait, verify_only=False):
    lock(root, fd)
    folder = root / ".avendb-stop"
    if folder.is_symlink():
        raise RuntimeError("close state cannot be a symlink")
    folder.mkdir(mode=0o700, exist_ok=True)
    state = current()
    if state is None:
        print("No existing avenDB container; no close obligation.")
        return
    verify_config(state)
    target = instance(state)
    path = folder / key(target)
    if path.exists():
        receipt = read(path)
        if receipt.get("target") != target:
            raise RuntimeError("close receipt belongs to another instance")
    else:
        if verify_only:
            raise RuntimeError("activation requires the matching close receipt")
        if state["running"] is not True:
            raise RuntimeError("stopped container has no verified close receipt")
        marker = health(target["id"])
        container_start = datetime.datetime.fromisoformat(target["started"].replace("Z", "+00:00")).timestamp()
        if marker["ended"] is not None or marker["started"] < int(container_start):
            raise RuntimeError("health does not identify the current running instance")
        receipt = {"version": 1, "target": target, "health_started": marker["started"], "status": "pending"}
        save(path, receipt)
        try:
            # No database, credentials or activation command goes to this child.
            # All stdio is detached, and the caller's lock descriptor is retained.
            subprocess.Popen([sys.executable, str(Path(__file__).resolve()), str(root), "--lock-fd", str(fd), "--worker", path.name],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True, pass_fds=(fd,))
        except Exception:
            receipt.update(status="failed", error="close owner could not start")
            save(path, receipt)
            raise RuntimeError(receipt["error"])
    deadline = time.monotonic() + wait
    while True:
        receipt = read(path)
        if receipt.get("status") == "succeeded":
            verify(target, receipt["health_started"])
            print(f"Verified graceful close: {path.name}")
            return
        if receipt.get("status") != "pending":
            raise RuntimeError(f"close failed; retained receipt {path.name}: {receipt.get('error', 'invalid receipt')}")
        if verify_only:
            raise RuntimeError("activation requires completed close")
        if time.monotonic() >= deadline:
            raise RuntimeError(f"close still owned; monitor budget expired; no activation permitted; receipt {path.name}")
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--lock-fd", type=int, required=True)
    parser.add_argument("--wait", type=float, default=300)
    parser.add_argument("--verify-only", action="store_true", help="recheck the successful receipt and proposed configuration before activation")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 0 < args.wait <= 300 or args.lock_fd < 3:
        parser.error("wait must be in (0, 300], lock fd must be >=3")
    root = args.root.resolve()
    os.chdir(root)
    try:
        if args.worker:
            if not re.fullmatch(r"[0-9a-f]{64}-[0-9a-f]{20}\.json", args.worker):
                raise RuntimeError("invalid operation")
            worker(root, args.lock_fd, args.worker)
        else:
            gate(root, args.lock_fd, args.wait, args.verify_only)
    except Exception as error:
        print(f"avenDB close gate: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
