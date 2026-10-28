import datetime
import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch
import io
import contextlib

spec = importlib.util.spec_from_file_location('health', pathlib.Path(__file__).with_name('provider-health.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
NOW = datetime.datetime(2026, 10, 23, tzinfo=datetime.timezone.utc)


class ProviderHealth(unittest.TestCase):
    def test_exact_target_and_allowlisted_numeric_output(self):
        calls = []
        def get(path, query):
            calls.append((path, query))
            if path == '/servers':
                return {'servers': [{'id': 7, 'name': 'SECRET', 'status': 'running',
                                     'public_net': {'ipv4': {'ip': health.TARGET_IP}}},
                                    {'id': 8, 'status': 'off', 'public_net': {'ipv4': {'ip': 'other'}}}]}
            return {'metrics': {'time_series': {'cpu': {'values': [[2, '5'], [1, '3'], [3, 'NaN']]},
                    'disk.0.iops.read': {'values': [[1, '2']]},
                    'network.0.bandwidth.out': {'values': [[1, '12']]},
                    'SECRET': {'values': [[1, '99']]}}}}
        result = health.probe(get, NOW)
        self.assertEqual([path for path, _ in calls], ['/servers', '/servers/7/metrics'])
        self.assertEqual(result['metrics']['cpu'], {'samples': 2, 'last_timestamp': 2, 'last': 5, 'mean': 4, 'max': 5})
        encoded = json.dumps(result)
        for secret in ['SECRET', health.TARGET_IP, 'public_net']:
            self.assertNotIn(secret, encoded)

    def test_missing_or_ambiguous_target_refused(self):
        server = {'id': 7, 'public_net': {'ipv4': {'ip': health.TARGET_IP}}}
        for servers in [[], [server, server]]:
            with self.assertRaises(ValueError):
                health.probe(lambda *_: {'servers': servers}, NOW)

    def test_pagination_is_bounded(self):
        calls = []
        def get(*args):
            calls.append(args)
            return {'servers': [], 'meta': {'pagination': {'next_page': 99}}}
        with self.assertRaises(ValueError):
            health.probe(get, NOW)
        self.assertEqual(len(calls), 5)

    def test_requests_are_get_only_on_fixed_api(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, size): return b'{}'
        class Opener:
            def open(self, request, timeout):
                self.request = request
                return Response()
        opener = Opener()
        with patch.object(health.urllib.request, 'build_opener', return_value=opener):
            get = health.reader('test-token')
            get('/servers', {'page': 1})
            self.assertEqual(opener.request.get_method(), 'GET')
            self.assertTrue(opener.request.full_url.startswith(health.BASE + '/servers?'))
            for path in ['/servers/7/actions/reboot', 'https://evil.invalid', '/servers/7']:
                with self.assertRaises(ValueError): get(path, {})
        with self.assertRaises(ValueError):
            health.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.invalid')

    def test_failure_never_prints_secret_or_exception(self):
        output = io.StringIO()
        with patch.dict(health.os.environ, {'HCLOUD_TOKEN': 'sensitive-token'}), \
             patch.object(health, 'reader', side_effect=RuntimeError('sensitive-token')), \
             contextlib.redirect_stdout(output):
            self.assertEqual(health.main(), 1)
        self.assertNotIn('sensitive-token', output.getvalue())
        self.assertFalse(json.loads(output.getvalue())['complete'])


if __name__ == '__main__':
    unittest.main()
