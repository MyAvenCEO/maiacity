#!/usr/bin/env node
// The manifests the repo declares (src/lib/avendb/manifests.js, "Manifest, v2": the kernel, the dashboard, the
// Universe, Chat, the Studio, the asset libraries and each game, each a tree of Interests in tiers), proposed into the
// Maia City vault as ONE AIP by avenMAIA's agent (./agent.mjs: the Mac's, or a cloud session's), never written by the
// seed (Samuel 2026-10-19: every change to vault data goes to him as a proposal). A manifest Maia City holds already (by
// its id) gets a proposal line that sets it to the repo's in one write through v2 (a v1 one moves to v2 so, through
// the lens); a new one is a draft. Without --run it only says what it would do.
//
//   node scripts/propose-manifests.mjs [--run] [--device <path of avendb-device>] [--again]
//   node scripts/propose-manifests.mjs --owner <Maia City vault id>     the owner's schema op, printed
//
// A schema or a lens is never a draft: it joins the vault's lane only by the vault's own create on main. So before the
// first v2 run an owner runs, in avenDB's Query console, the schema "Manifest, v2" (`--owner` prints it) and the lens
// "Manifest, v1 to v2" that makes v1 and v2 one schema in two versions; `--run` prints each op still missing, with the
// ids of the vault's own v1 and v2, and stops. The Public share on type `manifest` that v1 made still lets a device not
// signed in read the manifests off the feed.
import { MANIFEST_LENS, MANIFEST_SCHEMA, MANIFEST_V1_SCHEMA, MANIFEST_V2, manifestLens } from '../game/code/sources/manifests.js';
import { MANIFESTS } from '../src/lib/avendb/manifests.js';
import { device, session } from './agent.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const title = `Manifests v2: what each page wants, in tiers (${MANIFESTS.length})`;
/** the fields a v2 manifest holds */
const FIELDS = ['kind', 'v', 'id', 'title', 'note', 'routes', 'slots', 'tiers'];

/** The v2 schema's create, as vault `vault`. */
const schemaOp = (vault) => ({ op: 'create', vault, type: 'schema', value: MANIFEST_V2, as: vault });
/** The lens's create, as vault `vault`, from its v1 (`from`) to its v2 (`to`). */
const lensOp = (vault, from, to) => ({ op: 'create', vault, type: 'lens', value: manifestLens(from, to), as: vault });
if (option('--owner')) {
	if (!/^[0-9a-f]{64}$/.test(option('--owner'))) throw new Error('--owner takes the Maia City vault id (64 hex)');
	console.log(JSON.stringify(schemaOp(option('--owner'))));
	console.error('Then --run, which prints the lens op with the ids of the vault\'s v1 and v2.');
	process.exit(0);
}

const tiers = (m) => ['now', 'next', 'later', 'idle'].map((t) => `${t} ${(m.tiers?.[t] ?? []).length}`).join(', ');
for (const m of MANIFESTS) console.error(`${m.id}: ${m.title}, routes ${(m.routes ?? []).join(' ') || '(held by others)'}, ${tiers(m)}`);
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: one AIP ("${title}"), a draft of each manifest Maia City doesn't hold and a proposal line on each it holds otherwise, once an owner put the schema "${MANIFEST_SCHEMA}" and the lens "${MANIFEST_LENS}" on main.`);
	process.exit(0);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const agent = session(device(option('--device')), 'propose-manifests');
try {
	await agent.open();
	const city = await agent.city();
	const live = (rows) => (rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted'));
	// a schema or a lens is no row a query reads: the `schemas` op lists those of the vault's lane
	const lane = await agent.call('avendb_ask', { op: { op: 'schemas', vault: city.id } });
	const v1 = (lane.schemas ?? []).find((s) => s.title === MANIFEST_V1_SCHEMA);
	const v2 = (lane.schemas ?? []).find((s) => s.title === MANIFEST_SCHEMA && s.json === MANIFEST_V2);
	const joined = v1 && v2 && (lane.lenses ?? []).some((l) => l.title === MANIFEST_LENS && l.from === v1.id && l.to === v2.id);
	const missing = [...(v2 ? [] : [schemaOp(city.id)]), ...(v1 && v2 && !joined ? [lensOp(city.id, v1.id, v2.id)] : [])];
	if (missing.length) {
		const what = v2 ? `the lens "${MANIFEST_LENS}"` : `the schema "${MANIFEST_SCHEMA}"`;
		console.error(`Maia City has no ${what} yet, and a schema or a lens is never a draft: nothing was written. An owner runs this op once in avenDB's Query console, then this script again:`);
		for (const op of missing) console.log(JSON.stringify(op));
		process.exit(1);
	}
	// every write names v2, so a v1 manifest moves through the lens and a new one is written in v2
	const schema = v2.id;
	const held = new Map(live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, schema, where: { type: ['manifest'] } } })).rows).map((r) => [r.record?.id, r]));
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	const proposals = [];
	let fresh = 0, changed = 0, kept = 0;
	for (const m of MANIFESTS) {
		const r = held.get(m.id);
		if (!r) {
			const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: 'manifest', schema, tags: ['manifest', `manifest:${m.id}`], value: m, draft: true } });
			if (!made?.entry || !made?.line) throw new Error(`manifest ${m.id}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
			proposals.push({ entry: made.entry, line: made.line });
			fresh++;
			console.error(`manifest ${m.id}: drafted as ${made.entry}`);
			continue;
		}
		// read through v2, a v1 manifest shows v 2 and empty tiers: the sets that make it the repo's
		const sets = FIELDS.filter((f) => m[f] !== undefined && !same(r.record?.[f], m[f]));
		if (!sets.length) { kept++; continue; }
		const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: r.entry, name: 'manifest v2' } });
		if (!line) throw new Error(`the proposal on manifest ${m.id} (${r.entry}) started no line`);
		// one write: a record between v1 and v2 fits neither, so its sets go in one batch
		await agent.call('avendb_run', { op: { op: 'batch', ops: sets.map((f) => ({ op: 'set', entry: r.entry, line, schema, path: [f], value: m[f] })) } });
		proposals.push({ entry: r.entry, line });
		changed++;
		console.error(`manifest ${m.id}: ${sets.map((f) => `set ${f}`).join(', ')}, proposed on ${r.entry}`);
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
		'Sync v2, step P3 (doc:docs/avendb, section 12; the audit "App manifests with progressive loading", Samuel 2026-10-26): each page\'s manifest becomes a tree of Interests in four tiers, what the screen shows now first, what the person opens next second, the rest of the screen later, offline copies idle. Slots ($room, $timeline, $asset, $original) come from the route or the selection; signals (viewport, playhead, camera, list) order a tier. Lean: avendb/spec/AvenDB/Interest.lean.',
		MANIFESTS.map((m) => `${m.id}: ${m.note}`).join('\n'),
		`${fresh} new, ${changed} moved to v2 or changed, ${kept} as they were.`
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'manifests', value: kept, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'manifests', value: MANIFESTS.length, note: 'with the proposals of this AIP' } });
	// straight to Proposed (Samuel 2026-10-26): it holds its objective, so it is promoted at once, ready for an Accept
	const promoted = await agent.call('avendb_run', { op: { op: 'aip_promote', entry: aip.entry } })
		.catch((e) => { console.error(`not promoted (${e.message}): an owner puts it forward ("Propose it")`); return null; });
	console.log(JSON.stringify({ vault: city.id, proposals, aip, promoted }, null, 2));
	console.error(`Proposed. An owner accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
