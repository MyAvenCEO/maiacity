#!/usr/bin/env python3
"""Bounded GET-only Hetzner status/metrics probe; never prints provider payloads.

Uses the deployment project's existing token, only against the fixed HTTPS API.
Provider CPU/disk/network metrics do not establish guest RAM, filesystem free
space, journal durability, or application health.
https://docs.hetzner.cloud/reference/cloud#servers-get-metrics-for-a-server
"""
import datetime
import json
import math
import os
import re
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.hetzner.cloud/v1'
TARGET_IP = '188.245.31.46'
LIMIT = 2 * 1024 * 1024
SERIES = re.compile(r'^(cpu|disk\.[0-9]+\.(iops|bandwidth)\.(read|write)|network\.[0-9]+\.(pps|bandwidth)\.(in|out))$')
STATES = {'initializing', 'starting', 'running', 'stopping', 'off', 'deleting', 'rebuilding', 'migrating', 'unknown'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('redirect refused')


def reader(token):
    # Do not follow redirects carrying the bearer token, or use ambient proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(path, query):
        if not re.fullmatch(r'/servers(?:/[0-9]+/metrics)?', path):
            raise ValueError('endpoint refused')
        request = urllib.request.Request(BASE + path + '?' + urllib.parse.urlencode(query),
                                         headers={'Authorization': 'Bearer ' + token}, method='GET')
        with opener.open(request, timeout=12) as response:
            raw = response.read(LIMIT + 1)
            if len(raw) > LIMIT:
                raise ValueError('response too large')
            return json.loads(raw)
    return get


def summarize(series):
    result = {}
    for name, data in series.items():
        if not SERIES.fullmatch(name):
            continue
        values = []
        for pair in data.get('values', [])[:500]:
            try:
                timestamp, number = float(pair[0]), float(pair[1])
            except (ValueError, TypeError, IndexError):
                continue
            if math.isfinite(timestamp) and math.isfinite(number):
                values.append((timestamp, number))
        if values:
            values.sort()
            numbers = [value for _, value in values]
            result[name] = {'samples': len(values), 'last_timestamp': values[-1][0],
                            'last': values[-1][1], 'mean': sum(numbers) / len(numbers), 'max': max(numbers)}
    return result


def probe(get, now):
    matches = []
    for page in range(1, 6):
        listing = get('/servers', {'page': page, 'per_page': 50})
        matches.extend(server for server in listing.get('servers', [])
                       if (server.get('public_net', {}).get('ipv4') or {}).get('ip') == TARGET_IP)
        if not listing.get('meta', {}).get('pagination', {}).get('next_page'):
            break
    else:
        raise ValueError('pagination bound reached')
    if len(matches) != 1:
        raise ValueError('expected exactly one target')
    server = matches[0]
    identifier = server.get('id')
    if type(identifier) is not int or identifier <= 0:
        raise ValueError('invalid identifier')
    start = now - datetime.timedelta(hours=2)
    metrics = get(f'/servers/{identifier}/metrics', {
        'type': 'cpu,disk,network', 'start': start.isoformat(), 'end': now.isoformat(), 'step': 60})
    state = server.get('status')
    return {'complete': True, 'observed_at': now.isoformat(),
            'target': 'configured production host', 'state': state if state in STATES else 'unknown',
            'window_seconds': 7200, 'metrics': summarize(metrics.get('metrics', {}).get('time_series', {})),
            'limits': 'Provider metrics only; guest memory, free disk space and app health are not measured.'}


def main():
    token = os.environ.get('HCLOUD_TOKEN', '')
    if not token:
        print(json.dumps({'complete': False, 'error': 'provider token unavailable'}))
        return 1
    try:
        result = probe(reader(token), datetime.datetime.now(datetime.timezone.utc))
    except Exception:
        # Exceptions and response bodies may contain provider metadata. Keep all
        # failure output fixed and independent of the token or upstream payload.
        print(json.dumps({'complete': False, 'error': 'provider read failed; no application health conclusion'}))
        return 1
    print(json.dumps(result, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
