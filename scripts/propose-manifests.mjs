#!/usr/bin/env node
// The manifests the repo declares (src/lib/avendb/manifests.js, "Manifest, v2": the kernel, the dashboard, the
// Universe, Chat, the Studio, the asset libraries and each game, each a tree of Interests in tiers), proposed into the
// Maia City vault as ONE AIP by avenMAIA's agent (./agent.mjs: the Mac's, or a cloud session's), never written by the
// seed (Samuel 2026-10-19: every change to vault data goes to him as a proposal). A manifest Maia City holds already (by
// its id) gets a proposal line that sets it to the repo's (a v1 one moves to v2 so); a new one is a draft. Without
// --run it only says what it would do.
//
//   node scripts/propose-manifests.mjs [--run] [--device <path of avendb-device>] [--again]
//   node scripts/propose-manifests.mjs --owner <Maia City vault id>     the owner's op, printed
//
// A schema is never a draft: a new type's schema joins the vault's lane only by the vault's own create on main. So
// before the first v2 run an owner runs one op in avenDB's Query console (`--owner` prints it, and `--run` prints it
// and stops where the schema is missing): the schema "Manifest, v2". The Public share on type `manifest` that v1 made
// still lets a device not signed in read the manifests off the feed.
import { MANIFEST_SCHEMA, MANIFEST_V2 } from '../game/code/sources/manifests.js';
import { MANIFESTS } from '../src/lib/avendb/manifests.js';
import { device, session } from './agent.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const title = `Manifests v2: what each page wants, in tiers (${MANIFESTS.length})`;
/** the fields a v2 manifest holds, and those of v1 it drops */
const FIELDS = ['kind', 'v', 'id', 'title', 'note', 'routes', 'slots', 'tiers'];
const OLD = ['priority', 'parts'];

/** What an owner of vault `vault` runs once, as the vault: the v2 schema on main. */
const ownerOps = (vault) => [{ op: 'create', vault, type: 'schema', value: MANIFEST_V2, as: vault }];
if (option('--owner')) {
	if (!/^[0-9a-f]{64}$/.test(option('--owner'))) throw new Error('--owner takes the Maia City vault id (64 hex)');
	for (const op of ownerOps(option('--owner'))) console.log(JSON.stringify(op));
	process.exit(0);
}

const tiers = (m) => ['now', 'next', 'later', 'idle'].map((t) => `${t} ${(m.tiers?.[t] ?? []).length}`).join(', ');
for (const m of MANIFESTS) console.error(`${m.id}: ${m.title}, routes ${(m.routes ?? []).join(' ') || '(held by others)'}, ${tiers(m)}`);
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: one AIP ("${title}"), a draft of each manifest Maia City doesn't hold and a proposal line on each it holds otherwise, once an owner put the schema "${MANIFEST_SCHEMA}" on main (--owner).`);
	process.exit(0);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const agent = session(device(option('--device')), 'propose-manifests');
try {
	await agent.open();
	const city = await agent.city();
	const live = (rows) => (rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted'));
	// a schema is no row a query reads: the `schemas` op lists those of the vault's lane
	const { schemas } = await agent.call('avendb_ask', { op: { op: 'schemas', vault: city.id } });
	if (!(schemas ?? []).some((s) => s.title === MANIFEST_SCHEMA)) {
		console.error(`Maia City has no schema "${MANIFEST_SCHEMA}" yet, and a schema is never a draft: nothing was written. An owner runs this op once in avenDB's Query console, then this script again:`);
		for (const op of ownerOps(city.id)) console.log(JSON.stringify(op));
		process.exit(1);
	}
	const held = new Map(live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['manifest'] } } })).rows).map((r) => [r.record?.id, r]));
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	const proposals = [];
	let fresh = 0, changed = 0, kept = 0;
	for (const m of MANIFESTS) {
		const r = held.get(m.id);
		if (!r) {
			const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: 'manifest', tags: ['manifest', `manifest:${m.id}`], value: m, draft: true } });
			if (!made?.entry || !made?.line) throw new Error(`manifest ${m.id}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
			proposals.push({ entry: made.entry, line: made.line });
			fresh++;
			console.error(`manifest ${m.id}: drafted as ${made.entry}`);
			continue;
		}
		const sets = FIELDS.filter((f) => m[f] !== undefined && !same(r.record?.[f], m[f]));
		const unsets = OLD.filter((f) => r.record?.[f] !== undefined);
		if (!sets.length && !unsets.length) { kept++; continue; }
		const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: r.entry, name: 'manifest v2' } });
		if (!line) throw new Error(`the proposal on manifest ${m.id} (${r.entry}) started no line`);
		for (const f of sets) await agent.call('avendb_run', { op: { op: 'set', entry: r.entry, line, path: [f], value: m[f] } });
		for (const f of unsets) await agent.call('avendb_run', { op: { op: 'unset', entry: r.entry, line, path: [f] } });
		proposals.push({ entry: r.entry, line });
		changed++;
		console.error(`manifest ${m.id}: ${[...sets.map((f) => `set ${f}`), ...unsets.map((f) => `drop ${f}`)].join(', ')}, proposed on ${r.entry}`);
	}
	if (!proposals.length) {
		console.error('Maia City holds every manifest the repo declares, as it declares it: no AIP needed');
		process.exit(0);
	}
	const objective = [
		'import AvenDB.Objective',
		'open AvenDB.Objective',
		'',
		`/-- Maia City holds every manifest the repo declares (src/lib/avendb/manifests.js), as "${MANIFEST_SCHEMA}". -/`,
		`def manifests : Metric := metric "Manifests v2 in Maia City" (equals (reading "manifests") ${MANIFESTS.length})`,
		'',
		'def objective : List Metric := [manifests]',
		''
	].join('\n');
	const note = [
		'Sync v2, step P3 (docs/AVENDB_SYNC_V2.md; the audit "App manifests with progressive loading", Samuel 2026-10-26): each page\'s manifest becomes a tree of Interests in four tiers, what the screen shows now first, what the person opens next second, the rest of the screen later, offline copies idle. Slots ($room, $timeline, $asset, $original) come from the route or the selection; signals (viewport, playhead, camera, list) order a tier. Lean: avendb/spec/AvenDB/Interest.lean.',
		MANIFESTS.map((m) => `${m.id}: ${m.note}`).join('\n'),
		`${fresh} new, ${changed} moved to v2 or changed, ${kept} as they were.`
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'manifests', value: kept, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'manifests', value: MANIFESTS.length, note: 'with the proposals of this AIP' } });
	console.log(JSON.stringify({ vault: city.id, proposals, aip }, null, 2));
	console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
