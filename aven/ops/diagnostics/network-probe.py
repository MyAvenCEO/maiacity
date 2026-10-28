#!/usr/bin/env python3
"""Bounded server-side internet probe; no avenDB state or credentials are read.

Run with `python3 network-probe.py`. One run transfers at most 64 MiB down
and 16 MiB of random bytes up, plus three empty requests, to Cloudflare's
public test endpoints. Each request has a 15-second limit. JSON goes to stdout.
The script never benchmarks a server against its own listener.
"""

import datetime
import json
import os
import shutil
import subprocess
import tempfile
import uuid

MIB = 1024 * 1024
FIELDS = (
    "http_code", "http_version", "size_download", "size_upload",
    "time_namelookup", "time_connect", "time_appconnect",
    "time_starttransfer", "time_total", "speed_download", "speed_upload",
    "num_connects", "ssl_verify_result",
)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def probe(name, url, expected, upload=None):
    result = {"name": name, "started_utc": now(), "expected_bytes": expected}
    command = [
        "curl", "--silent", "--show-error", "--fail", "--connect-timeout", "5",
        "--max-time", "15", "--output", "/dev/null", "--write-out", "%{json}",
        "--header", "Cache-Control: no-cache", "--header", "Accept-Encoding: identity",
    ]
    if upload:
        command += ["--request", "POST", "--header", "Content-Type: application/octet-stream",
                    "--header", "Expect:", "--data-binary", "@" + upload]
    command += [url + ("&" if "?" in url else "?") + "audit=" + uuid.uuid4().hex]
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
        metrics = json.loads(done.stdout)
        result.update({key: metrics.get(key) for key in FIELDS})
        result.update(exit_code=done.returncode, error=done.stderr[:300])
        elapsed = result.get("time_total") or 0
        size = result.get("size_upload" if upload else "size_download") or 0
        result["complete"] = done.returncode == 0 and size == expected
        result["end_to_end_mbps"] = size * 8 / elapsed / 1e6 if elapsed and expected else None
        result["end_to_end_mib_s"] = size / elapsed / MIB if elapsed and expected else None
        if not upload and expected:
            body = elapsed - (result.get("time_starttransfer") or 0)
            result["body_transfer_seconds"] = body
            result["body_mbps"] = size * 8 / body / 1e6 if body > 0 else None
    except (subprocess.TimeoutExpired, OSError, ValueError) as error:
        result.update(complete=False, error=str(error)[:300])
    return result


def main():
    report = {
        "device": "production-server", "started_utc": now(),
        "method": "Sequential single-stream HTTP; no-cache; identity encoding; fresh connections; 15-second limit per request",
        "bounds": {"download_bytes": 64 * MIB, "upload_bytes": 16 * MIB, "empty_requests": 3},
        "source": "https://github.com/cloudflare/speedtest",
        "results": [],
    }
    if not shutil.which("curl"):
        report["error"] = "curl is not installed; no packages were installed by this probe"
    else:
        for index in range(3):
            report["results"].append(probe("empty-" + str(index + 1), "https://speed.cloudflare.com/__down?bytes=0", 0))
        report["results"].append(probe("download-64MiB", "https://speed.cloudflare.com/__down?bytes=67108864", 64 * MIB))
        # A private temporary file of synthetic random bytes; deleted on normal exit.
        with tempfile.NamedTemporaryFile(prefix="maia-network-synthetic-") as payload:
            payload.write(os.urandom(16 * MIB))
            payload.flush()
            report["results"].append(probe("upload-16MiB", "https://speed.cloudflare.com/__up", 16 * MIB, payload.name))
    report["finished_utc"] = now()
    print(json.dumps(report, indent=2))
    return 0 if len(report["results"]) == 5 and all(row["complete"] for row in report["results"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
