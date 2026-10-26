// WRITTEN FROM avenDB's ENGINE, NOT BY HAND: avendb/crates/avendb/src/engine.rs `READS` and `ASKS`.
// `AVENDB_WRITE_OPS=1 cargo test -p avendb --test op_names` (in avendb/) writes it again; CI fails where it differs.

/** The ops that only read what the device holds, and `api_pass`, which signs a pass and keeps nothing. */
export const READS = [
	'entry_views',
	'query',
	'touched',
	'objective_check',
	'get',
	'pin',
	'history',
	'room',
	'schemas',
	'aips',
	'aip',
	'aip_records',
	'groups',
	'cap_groups',
	'kinds',
	'world',
	'world_summary',
	'jobs',
	'database',
	'note',
	'log',
	'read_file',
	'creatable',
	'taggable',
	'limits',
	'perf',
	'requests',
	'code',
	'posts',
	'bring',
	'interest',
	'demand',
	'find',
	'synced',
	'network',
	'measure_peer_policy',
	'measure_peer_visibility',
	'observe_query_emission',
	'api_pass'
];

/** The ops that change nothing but ask what changes would do, by dry runs: `may`, and `shares`. */
export const ASKS = [
	'may',
	'shares'
];
