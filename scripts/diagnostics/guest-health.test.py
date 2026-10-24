import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('guest', pathlib.Path(__file__).with_name('guest-health.py'))
guest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guest)

class GuestHealth(unittest.TestCase):
    def test_health_drops_panic_secrets_and_identifiers(self):
        out = guest.safe_health({'started': 1, 'up': 2, 'panic': {'message': 'SECRET'},
                                'memory': {'rss': 10, 'unknown': 'SECRET'},
                                'before': {'ended': {'how': 'killed', 'why': 'SECRET'}},
                                'backups': {'whole': False, 'not_whole': 3, 'vault': 'SECRET'}})
        self.assertNotIn('SECRET', json.dumps(out))
        self.assertTrue(out['panic_recorded'])
        self.assertEqual(out['before']['ended'], 'killed')
        self.assertEqual(out['memory'], {'rss': 10})

    def test_state_keeps_only_known_fields_and_hashes(self):
        out = guest.docker_state(json.dumps({'state': {'Status': 'running', 'Error': 'SECRET', 'Running': True},
                                            'revision': 'SECRET', 'image': 'sha256:' + 'a'*64, 'env': 'SECRET'}))
        self.assertNotIn('SECRET', json.dumps(out))
        self.assertIsNone(out['revision'])
        self.assertTrue(out['running'])

    def test_stats_ignore_other_containers_and_unexpected_text(self):
        lines = [dict(Name='maia-city-avendb', CPUPerc='25.1%', MemUsage='10MiB / 1GiB', NetIO='SECRET'),
                 dict(Name='SECRET', CPUPerc='100%')]
        out = guest.stats('\n'.join(map(json.dumps, lines)))
        self.assertEqual(out, {'maia-city-avendb': {'CPUPerc': '25.1%', 'MemUsage': '10MiB / 1GiB'}})

    def test_kernel_counters_are_numeric_allowlist_only(self):
        self.assertEqual(guest.numbers('MemFree: 10 kB\nSECRET: 99\nMemTotal: nope', guest.MEM), {'MemFree': 10})

if __name__ == '__main__': unittest.main()
