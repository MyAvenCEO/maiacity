#!/usr/bin/env python3
"""Publish an extracted site without breaking chunks requested by open pages.

Only /_app/immutable is shared between releases. Its URLs are immutable: a
collision with different bytes aborts before switching current. The current and
four previous releases remain available for rollback. Assets remain at the same
public URLs for at least 30 days after their last retained-release reference, so
frequent deploys do not evict an open page. No account or avenDB storage is read.
"""
import argparse
import fcntl
import os
from pathlib import Path
import re
import shutil
import tempfile
import time

COMMIT = re.compile(r"[0-9a-f]{40}")
IMMUTABLE = Path("_app/immutable")
ASSET_DAYS = 30


def regular_files(folder):
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError(f"not a regular asset directory: {folder}")
    for directory, dirs, files in os.walk(folder, followlinks=False):
        for name in dirs:
            if (Path(directory) / name).is_symlink():
                raise ValueError("a release asset directory is a symlink")
        for name in files:
            path = Path(directory) / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("a release asset is not a regular file")
            yield path.relative_to(folder), path


def same(left, right):
    # Never trust matching timestamps/lengths for an immutable URL collision.
    with left.open("rb") as a, right.open("rb") as b:
        while True:
            chunk = a.read(1 << 20)
            if chunk != b.read(1 << 20):
                return False
            if not chunk:
                return True


def publish(site, commit, keep=5, *, now=None):
    if not COMMIT.fullmatch(commit) or keep < 2:
        raise ValueError("a full commit and at least two retained releases are required")
    now = time.time() if now is None else now
    site = Path(site).resolve()
    releases = site / "releases"
    release = releases / commit
    if release.is_symlink() or not release.is_dir() or not (release / "index.html").is_file():
        raise ValueError("the extracted release is missing")
    # CI cancellation can leave the remote publisher completing its work. Serialize
    # publishers on the host as well as in GitHub Actions.
    with (site / ".publish.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        candidates = sorted(
            (p for p in releases.iterdir() if COMMIT.fullmatch(p.name) and p.is_dir() and not p.is_symlink()),
            key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True,
        )
        retained = [release]
        current = site / "current"
        # A rollback to an older release must still keep the release it replaces.
        if current.is_symlink():
            previous = current.resolve()
            if previous in candidates and previous != release:
                retained.append(previous)
        retained.extend(p for p in candidates if p not in retained)
        retained = retained[:keep]
        available, wanted = {}, set()
        # Backfill even the outgoing fifth release on the first upgraded deploy:
        # pruning its rollback folder must not immediately break its open pages.
        for source in candidates:
            for relative, path in regular_files(source / IMMUTABLE):
                old = available.setdefault(relative, path)
                if old != path and not same(old, path):
                    raise ValueError(f"different bytes at immutable URL: {relative}")
                if source in retained:
                    wanted.add(relative)
        assets = site / "assets" / IMMUTABLE
        # Reject symlinks rather than accidentally publishing outside the asset root.
        for directory in [site / "assets", site / "assets/_app", assets]:
            if directory.is_symlink():
                raise ValueError("the shared asset directory is a symlink")
            directory.mkdir(exist_ok=True)
        existing = dict(regular_files(assets))
        for relative, path in available.items():
            if relative in existing and not same(path, existing[relative]):
                raise ValueError(f"different bytes already published at immutable URL: {relative}")
        # Complete, fsynced files become visible by an exclusive hard link. Requests
        # can never read a partial copy, and no existing immutable file is replaced.
        with tempfile.TemporaryDirectory(prefix=".publish-", dir=site) as temporary:
            temporary = Path(temporary)
            for number, (relative, source) in enumerate(available.items()):
                if relative in existing:
                    continue
                staged = temporary / str(number)
                with source.open("rb") as incoming, staged.open("xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing, 1 << 20)
                    outgoing.flush()
                    os.fsync(outgoing.fileno())
                staged.chmod(0o644)
                os.utime(staged, (now, now))
                destination = assets / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.link(staged, destination)
            # Asset mtime records its last retained-release reference, independently
            # of the five release folders. The URL and bytes never change.
            for relative in wanted:
                os.utime(assets / relative, (now, now))
            # Every retained asset is now reachable before any page names the new
            # release. The pointer switch is atomic on the site's filesystem.
            pointer = temporary / "current"
            pointer.symlink_to(Path("releases") / commit)
            os.replace(pointer, current)
        os.utime(release, (now, now))
        # Keep the same five-release rollback window. Asset cleanup is based on the
        # retained manifests above and a separate 30-day minimum asset window.
        for candidate in candidates:
            if candidate not in retained:
                shutil.rmtree(candidate)
        for relative, path in existing.items():
            if relative not in wanted and path.stat().st_mtime < now - ASSET_DAYS * 86400:
                path.unlink()
        return [p.name for p in retained]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path)
    parser.add_argument("commit")
    args = parser.parse_args()
    kept = publish(args.site, args.commit)
    print(f"live: releases/{args.commit} · {len(kept)} builds kept")
