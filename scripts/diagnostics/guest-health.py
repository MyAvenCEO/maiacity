#!/usr/bin/env python3
"""Read-only, bounded production guest health; stdout is allowlisted JSON only."""
import datetime
import json
import math
import os
from pathlib import Path
import re
import subprocess

NAMES = ['maia-city-avendb', 'maia-city-api', 'maia-city-db', 'maia-city-caddy']
MEM = {'MemTotal', 'MemAvailable', 'MemFree', 'Cached', 'Buffers', 'SwapTotal', 'SwapFree', 'SwapCached', 'Dirty', 'Writeback'}
VM = {'pswpin', 'pswpout', 'pgmajfault', 'oom_kill'}
MEMORY = {'rss', 'rss_peak', 'container', 'container_peak', 'limit', 'oom_kills', 'machine', 'machine_free'}


def run(argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=8, check=True)
    if len(result.stdout) > 1024 * 1024:
        raise ValueError('too much output')
    return result.stdout


def numbers(text, keys):
    out = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[0].rstrip(':') in keys and fields[1].isdigit():
            out[fields[0].rstrip(':')] = int(fields[1])
    return out


def numeric_fields(obj, keys):
    return {key: value for key in keys if type(value := obj.get(key)) in (int, float)
            and math.isfinite(value)}


def safe_health(data):
    before = data.get('before') or {}
    how = (before.get('ended') or {}).get('how')
    return {**numeric_fields(data, {'started', 'up'}),
            'panic_recorded': data.get('panic') is not None,
            'starts': numeric_fields(data.get('starts') or {}, {'hour'}),
            'memory': numeric_fields(data.get('memory') or {}, MEMORY),
            'before': {**numeric_fields(before, {'started', 'seen'}),
                       'ended': how if how in ('stopped', 'error', 'killed') else 'unknown',
                       'memory': numeric_fields(before.get('memory') or {}, MEMORY)},
            'backups': {**numeric_fields(data.get('backups') or {}, {'checked_at', 'vaults', 'not_whole'}),
                        'whole': (value if type(value := (data.get('backups') or {}).get('whole')) is bool else None)}}


def docker_state(text):
    data = json.loads(text)
    state = data.get('state') or {}
    status = state.get('Status')
    revision = data.get('revision')
    image = data.get('image')
    return {**numeric_fields(data, {'restarts'}),
            'status': status if status in ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead') else 'unknown',
            'running': state.get('Running') is True, 'oom_killed': state.get('OOMKilled') is True,
            **numeric_fields(state, {'ExitCode', 'Pid'}),
            'revision': revision if isinstance(revision, str) and re.fullmatch('[a-f0-9]{40}', revision) else None,
            'image': image if isinstance(image, str) and re.fullmatch('sha256:[a-f0-9]{64}', image) else None}


def stats(text):
    out = {}
    for line in text.splitlines():
        data = json.loads(line)
        if data.get('Name') not in NAMES:
            continue
        # Docker's formatted numeric resources; never names outside our four containers.
        out[data['Name']] = {key: value for key in ('CPUPerc', 'MemUsage', 'MemPerc', 'BlockIO', 'NetIO', 'PIDs')
                            if isinstance(value := data.get(key), str)
                            and re.fullmatch(r'[0-9. %/kMGTPEiB]+', value)}
    return out


def main():
    result = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'errors': []}
    def collect(name, action):
        try:
            result[name] = action()
        except Exception:
            result['errors'].append(name)  # Never emit command stderr, paths, or exceptions.
    collect('load_1_5_15', lambda: list(os.getloadavg()))
    collect('memory_kib', lambda: numbers(Path('/proc/meminfo').read_text(), MEM))
    collect('vm_counters', lambda: numbers(Path('/proc/vmstat').read_text(), VM))
    for label, path in [('root', '/'), ('application', '/opt/maia-city')]:
        def space(path=path):
            values = os.statvfs(path)
            return {'total_bytes': values.f_blocks * values.f_frsize,
                    'available_bytes': values.f_bavail * values.f_frsize,
                    'inodes': values.f_files, 'free_inodes': values.f_favail}
        collect(label + '_filesystem', space)
    def vmstat():
        lines = run(['vmstat', '-w', '1', '3']).splitlines()
        rows = [[int(value) for value in line.split()] for line in lines if re.fullmatch(r'[ 0-9]+', line)]
        return {'columns': ['r', 'b', 'swpd', 'free', 'buff', 'cache', 'si', 'so', 'bi', 'bo', 'in', 'cs', 'us', 'sy', 'id', 'wa', 'st', 'gu'],
                'samples': rows[:3], 'first_sample_since_boot': True}
    collect('vmstat', vmstat)
    for name in NAMES:
        fmt = '{"state":{{json .State}},"restarts":{{.RestartCount}},"image":{{json .Image}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'
        collect(name, lambda name=name: docker_state(run(['docker', 'inspect', '--format', fmt, name])))
    collect('container_stats', lambda: stats(run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *NAMES])))
    collect('avendb_health', lambda: safe_health(json.loads(run(['docker', 'exec', 'maia-city-caddy',
                            'wget', '-T', '5', '-qO-', 'http://avendb:3351/feed/health']))))
    print(json.dumps(result, allow_nan=False))


if __name__ == '__main__':
    main()
