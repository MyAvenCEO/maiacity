#!/usr/bin/env node
// The manifests the repo declares (src/lib/avendb/manifests.js: the kernel, the dashboard, the Universe, the Studio and
// each game), proposed into the Maia City vault as ONE AIP by avenMAIA's agent (./agent.mjs: the Mac's, or a cloud
// session's), never written by the seed (Samuel 2026-10-19: every change to vault data goes to him as a proposal). Each
// manifest Maia City holds already (by its id) is left out; a changed one goes in by a later AIP. Without --run it only
// says what it would do.
//
//   node scripts/propose-manifests.mjs [--run] [--device <path of avendb-device>] [--again]
//   node scripts/propose-manifests.mjs --owner <Maia City vault id>     the owner's two ops, printed
//
// A schema is never a draft: a new type's schema joins the vault's lane only by the vault's own create on main. So the
// first time, an owner runs two ops in avenDB's Query console, one after the other, a share never running in a batch
// (`--owner` prints them, and `--run` prints them and stops where
// the schema is missing): the schema "Manifest, v1" and the Public share that lets a device not signed in read the
// manifests off the feed. Then `--run` drafts the manifests alone.
import { MANIFEST_SCHEMA, MANIFEST_V1 } from '../game/code/sources/manifests.js';
import { MANIFESTS } from '../src/lib/avendb/manifests.js';
import { device, session } from './agent.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const title = `Manifests: what each page syncs first (${MANIFESTS.length})`;

/** What an owner of vault `vault` runs once, as the vault, one op at a time: the manifests' schema on main, then their Public share. */
const ownerOps = (vault) => [
	{ op: 'create', vault, type: 'schema', value: MANIFEST_V1, as: vault },
	{ op: 'share', over: vault, who: 'everyone', level: 'Public', what: { type: ['manifest'] }, as: vault }
];
if (option('--owner')) {
	if (!/^[0-9a-f]{64}$/.test(option('--owner'))) throw new Error('--owner takes the Maia City vault id (64 hex)');
	for (const op of ownerOps(option('--owner'))) console.log(JSON.stringify(op));
	process.exit(0);
}

for (const m of MANIFESTS) console.error(`${m.id}: ${m.title}, routes ${(m.routes ?? []).join(' ') || '(held by others)'}, ${m.parts.length} parts, ${m.priority}`);
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: each manifest Maia City doesn't hold as a draft, one AIP over them ("${title}"), once an owner put the schema "${MANIFEST_SCHEMA}" on main (--owner).`);
	process.exit(0);
}

const agent = session(device(option('--device')), 'propose-manifests');
try {
	await agent.open();
	const city = await agent.city();
	const live = (rows) => (rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted'));
	// a schema is no row a query reads: the `schemas` op lists those of the vault's lane
	const { schemas } = await agent.call('avendb_ask', { op: { op: 'schemas', vault: city.id } });
	const hasSchema = (schemas ?? []).some((s) => s.title === MANIFEST_SCHEMA);
	const held = new Set(live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['manifest'] } } })).rows).map((r) => r.record?.id));
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	const proposals = [];
	const draft = async (op, label) => {
		const made = await agent.call('avendb_run', { op: { ...op, vault: city.id, draft: true } });
		if (!made?.entry || !made?.line) throw new Error(`${label}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
		proposals.push({ entry: made.entry, line: made.line });
		console.error(`${label}: drafted as ${made.entry}`);
	};
	if (!hasSchema) {
		console.error(`Maia City has no schema "${MANIFEST_SCHEMA}" yet, and a schema is never a draft: nothing was written. An owner runs these two ops once in avenDB's Query console, one at a time (the schema on main, then the manifests' Public share), then this script again:`);
		for (const op of ownerOps(city.id)) console.log(JSON.stringify(op));
		process.exit(1);
	}
	const fresh = MANIFESTS.filter((m) => !held.has(m.id));
	for (const m of fresh) await draft({ op: 'create', type: 'manifest', tags: ['manifest', `manifest:${m.id}`], value: m }, `manifest ${m.id}`);
	if (!proposals.length) {
		console.error('Maia City holds every manifest the repo declares already: no AIP needed');
		process.exit(0);
	}
	const objective = [
		'import AvenDB.Objective',
		'open AvenDB.Objective',
		'',
		`/-- Maia City holds every manifest the repo declares (src/lib/avendb/manifests.js). -/`,
		`def manifests : Metric := metric "Declared manifests in Maia City" (equals (reading "manifests") ${MANIFESTS.length})`,
		'',
		'def objective : List Metric := [manifests]',
		''
	].join('\n');
	const note = [
		'Smart sync (https://claude.ai/artifact/K6in2U7CFA1Mwpn2Kv2HQE): what each page syncs first, declared as manifests, a composite whose leaves are entries and queries of the vault. A device opened on a page brings what the manifests covering it hold, the kernel first, then what the page read before, then the rest of the vault in the background (game/code/sources/manifests.js).',
		MANIFESTS.map((m) => `${m.id}: ${m.note}`).join('\n'),
		`${fresh.length} of ${MANIFESTS.length} are new here.`
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'manifests', value: MANIFESTS.length - fresh.length, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'manifests', value: MANIFESTS.length, note: 'with the drafts of this AIP' } });
	console.log(JSON.stringify({ vault: city.id, proposals, aip }, null, 2));
	console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
