// @ts-nocheck — plain JS
import { expect, test } from 'bun:test';
import { keep, parse, routine, SOURCES, LEVELS } from './activity.js';

const all = { levels: new Set(LEVELS), sources: new Set(SOURCES.map(([id]) => id)), quiet: false, search: '' };

test('a log line reads into its time, level, target, spans, source and message, its colours dropped', () => {
	const r = parse(7, '\x1b[2m2026-10-21T11:35:15.934687Z\x1b[0m \x1b[34mDEBUG\x1b[0m \x1b[2mavendb_device\x1b[0m\x1b[2m:\x1b[0m call run');
	expect(r).toMatchObject({ n: 7, time: '2026-10-21T11:35:15.934687Z', level: 'DEBUG', target: 'avendb_device', source: 'avendb', message: 'call run', spans: '' });
	const s = parse(8, '2026-10-21T11:27:18.122956Z  WARN router.accept{me=4926d82c53 alpn="avendb/sync/1"}: noq_proto::connection: failed closing path err=LastOpenPath');
	expect(s).toMatchObject({ level: 'WARN', target: 'noq_proto::connection', source: 'network', message: 'failed closing path err=LastOpenPath' });
	expect(s.spans).toContain('router.accept');
	expect(parse(9, '2026-10-21T11:25:26Z  WARN webview: world: film: settled').message).toBe('world: film: settled');
	// not tracing's: a continuation
	expect(parse(10, '   at main.rs:12')).toMatchObject({ level: '', message: '   at main.rs:12' });
});

test('routine polls and store diagnostics hide where quiet, and a search keeps the lines with every word', () => {
	const rows = [
		parse(1, '2026-10-21T11:35:15Z DEBUG avendb_device: call run'),
		parse(2, '2026-10-21T11:35:15Z DEBUG avendb_device: call grant'),
		parse(3, '2026-10-21T11:05:31Z  INFO export{mode=Snapshot}: loro_internal::oplog::change_store::block_encode:   values: 360 bytes'),
		parse(4, '2026-10-21T11:05:27Z  WARN avendb_browser: the key move is asked about again')
	];
	expect(rows.map(routine)).toEqual([true, false, true, false]);
	expect(keep(rows, { ...all, quiet: true }).map((r) => r.n)).toEqual([2, 4]);
	expect(keep(rows, { ...all, search: 'KEY move' }).map((r) => r.n)).toEqual([4]);
	expect(keep(rows, { ...all, levels: new Set(['WARN']) }).map((r) => r.n)).toEqual([4]);
	expect(keep(rows, { ...all, sources: new Set(['store']) }).map((r) => r.n)).toEqual([3]);
});
