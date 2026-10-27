#!/usr/bin/env node
// The actors the repo declares (src/lib/avendb/actors.js, "Actor, v3": the kernel, the dashboard, the Universe, Chat,
// the Studio, the asset libraries, each page and each game, each what its app loads, a tree of Interests in tiers),
// proposed into the Maia City vault as ONE AIP by avenMAIA's agent (./agent.mjs: the Mac's, or a cloud session's),
// never written by the seed (Samuel 2026-10-19: every change to vault data goes to him as a proposal). "Manifest, v2"
// evolves into "Actor, v3" (Samuel 2026-10-27): an entry Maia City holds already (by its id) keeps its id and its
// history and gets a proposal line with one v3 write that makes it the repo's; an id it holds none of is a draft of
// its own. No copies, nothing superseded or deleted. Without --run it only says what it would do.
//
//   node scripts/propose-actors.mjs [--run] [--device <path of avendb-device>] [--again]
//   node scripts/propose-actors.mjs --owner <Maia City vault id>     the owner's schema op, printed
//
// A schema or a lens is never a draft: it joins the vault's lane only by the vault's own create on main. So before the
// run an owner adds, in theOS (avenDB's Query console), the schema "Actor, v3" (`--owner` prints it) and the lens
// "Manifest, v2 to Actor, v3" that makes the two one schema in two versions; `--run` prints each op still missing,
// with the ids of the vault's own v2 and v3, and stops. The engine reads across the kind rename (manifest to actor)
// only once a lens joins the two (task K, `lens::Lane::fits`). A v1 manifest the vault still holds stops the run too:
// it reads in v3 only through a v1 to v2 to v3 chain, which a view does not walk (one lens hop).
//
// Each actor's part names a query entry (task C1: `{ query: {entry, version}, bind }`), so the same AIP drafts the query
// entries the actors name (src/lib/avendb/actors.js `QUERIES`, schema "Query, v1", entry type `query`), or proposes the
// repo's text on one Maia City holds already. "Query, v1" comes into the lane by the schemas AIP of task A2; until it
// is there, `--run` prints its op and stops.
import { ACTOR_LENS, ACTOR_SCHEMA, ACTOR_TYPE, ACTOR_V3, MANIFEST_SCHEMA, MANIFEST_V1_SCHEMA, QUERY_SCHEMA, QUERY_TYPE, QUERY_V1, actorLens } from '../game/code/sources/actors.js';
import { ACTORS, QUERIES } from '../src/lib/avendb/actors.js';
import { device, session } from './agent.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const title = `Actors v3: each app and the queries it loads, in tiers (${ACTORS.length} actors, ${QUERIES.length} queries)`;
/** the fields a v3 actor holds: `kind` and `v` too, so the stored record names v3 after the write */
const FIELDS = ['kind', 'v', 'id', 'title', 'note', 'routes', 'slots', 'interface', 'needs', 'code', 'loads'];

/** the fields a query entry holds */
const QUERY_FIELDS = ['kind', 'v', 'id', 'title', 'note', 'interface', 'where', 'window', 'order', 'follow'];

/** The v3 schema's create, as vault `vault`. */
const schemaOp = (vault) => ({ op: 'create', vault, type: 'schema', value: ACTOR_V3, as: vault });
/** The query schema's create, as vault `vault`, where task A2's AIP has not put one in yet. */
const querySchemaOp = (vault) => ({ op: 'create', vault, type: 'schema', value: QUERY_V1, as: vault });
/** The lens's create, as vault `vault`, from its v2 (`from`) to its v3 (`to`). */
const lensOp = (vault, from, to) => ({ op: 'create', vault, type: 'lens', value: actorLens(from, to), as: vault });
if (option('--owner')) {
	if (!/^[0-9a-f]{64}$/.test(option('--owner'))) throw new Error('--owner takes the Maia City vault id (64 hex)');
	console.log(JSON.stringify(schemaOp(option('--owner'))));
	console.error('Then --run, which prints the lens op with the ids of the vault\'s v2 and v3.');
	process.exit(0);
}

const tiers = (a) => ['now', 'next', 'later', 'idle'].map((t) => `${t} ${(a.loads?.[t] ?? []).length}`).join(', ');
for (const a of ACTORS) console.error(`${a.id}: ${a.title}, routes ${(a.routes ?? []).join(' ') || '(held by others)'}, ${tiers(a)}`);
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: one AIP ("${title}"), a draft of each query entry and a v3 write on each actor Maia City holds (a draft of each it doesn't), once an owner put the schemas "${ACTOR_SCHEMA}" and "${QUERY_SCHEMA}" and the lens "${ACTOR_LENS}" on main.`);
	process.exit(0);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const agent = session(device(option('--device')), 'propose-actors');
try {
	await agent.open();
	const city = await agent.city();
	const live = (rows) => (rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted'));
	// as stored, any version: a v1 one needs the chain, and says so before anything is written
	const stored = live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: [ACTOR_TYPE] } } })).rows);
	const v1 = stored.filter((r) => r.record?.kind === 'manifest' && r.record?.v !== 2 && !r.record?.loads);
	console.error(`Maia City holds ${stored.length} actors: ${stored.filter((r) => r.record?.loads).length} moved to v3, ${stored.filter((r) => !r.record?.loads && r.record?.v === 2).length} v2, ${v1.length} v1.`);
	if (v1.length) {
		console.error(`v1 manifests (${v1.map((r) => r.record?.id).join(', ')}) read in v3 only through "${MANIFEST_V1_SCHEMA}" to "${MANIFEST_SCHEMA}" to "${ACTOR_SCHEMA}", two lens hops: nothing was written. Move them to v2 first (git history: scripts/propose-manifests.mjs).`);
		process.exit(1);
	}
	// a schema or a lens is no row a query reads: the `schemas` op lists those of the vault's lane
	const lane = await agent.call('avendb_ask', { op: { op: 'schemas', vault: city.id } });
	const v2 = (lane.schemas ?? []).find((s) => s.title === MANIFEST_SCHEMA);
	const v3 = (lane.schemas ?? []).find((s) => s.title === ACTOR_SCHEMA && s.json === ACTOR_V3);
	const joined = v2 && v3 && (lane.lenses ?? []).some((l) => l.title === ACTOR_LENS && l.from === v2.id && l.to === v3.id);
	const qv1 = (lane.schemas ?? []).find((s) => s.title === QUERY_SCHEMA);
	if (qv1 && qv1.json !== QUERY_V1) console.error(`Maia City's "${QUERY_SCHEMA}" is not the repo's: each query is written under the vault's, as it reads them`);
	const missing = [...(v3 ? [] : [schemaOp(city.id)]), ...(v2 && v3 && !joined ? [lensOp(city.id, v2.id, v3.id)] : []), ...(qv1 ? [] : [querySchemaOp(city.id)])];
	if (missing.length) {
		const what = [!v3 && `the schema "${ACTOR_SCHEMA}"`, v3 && !joined && `the lens "${ACTOR_LENS}"`, !qv1 && `the schema "${QUERY_SCHEMA}"`].filter(Boolean).join(' and ');
		console.error(`Maia City has no ${what} yet, and a schema or a lens is never a draft: nothing was written. An owner runs this op once in theOS (avenDB's Query console), then this script again:`);
		for (const op of missing) console.log(JSON.stringify(op));
		process.exit(1);
	}
	// every write names v3, so a v2 manifest moves through the lens, keeping its id and history
	const schema = v3.id;
	const held = new Map(live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, schema, where: { type: [ACTOR_TYPE] } } })).rows).map((r) => [r.record?.id, r]));
	const was = new Map(stored.map((r) => [r.entry, r.record]));
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	const proposals = [];
	let fresh = 0, moved = 0, kept = 0;
	// the query entries first: an actor names them
	const heldQueries = new Map(live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, schema: qv1.id, where: { type: [QUERY_TYPE] } } })).rows).map((r) => [r.record?.id, r]));
	for (const q of QUERIES) {
		const r = heldQueries.get(q.id);
		if (!r) {
			const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: QUERY_TYPE, schema: qv1.id, tags: ['query', `query:${q.id}`], value: q, draft: true } });
			if (!made?.entry || !made?.line) throw new Error(`query ${q.id}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
			proposals.push({ entry: made.entry, line: made.line });
			fresh++;
			console.error(`query ${q.id}: drafted as ${made.entry}`);
			continue;
		}
		const sets = QUERY_FIELDS.filter((f) => q[f] !== undefined && !same(r.record?.[f], q[f]));
		if (!sets.length) { kept++; continue; }
		const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: r.entry, name: 'query v1' } });
		if (!line) throw new Error(`the proposal on query ${q.id} (${r.entry}) started no line`);
		await agent.call('avendb_run', { op: { op: 'batch', ops: sets.map((f) => ({ op: 'set', entry: r.entry, line, schema: qv1.id, path: [f], value: q[f] })) } });
		proposals.push({ entry: r.entry, line });
		moved++;
		console.error(`query ${q.id}: ${sets.map((f) => `set ${f}`).join(', ')}, proposed on ${r.entry}`);
	}
	for (const a of ACTORS) {
		const r = held.get(a.id);
		if (!r) {
			const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: ACTOR_TYPE, schema, tags: ['actor', `actor:${a.id}`], value: a, draft: true } });
			if (!made?.entry || !made?.line) throw new Error(`actor ${a.id}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
			proposals.push({ entry: made.entry, line: made.line });
			fresh++;
			console.error(`actor ${a.id}: drafted as ${made.entry}`);
			continue;
		}
		// read through v3, a v2 manifest shows kind actor, v 3 and empty loads: one that stores no loads yet always gets
		// the write (a moved one may keep its stored kind and version: a lens edit keeps what it doesn't map)
		const v2Stored = !was.get(r.entry)?.loads;
		const sets = FIELDS.filter((f) => a[f] !== undefined && (v2Stored || !same(r.record?.[f], a[f])));
		if (!sets.length) { kept++; continue; }
		const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: r.entry, name: 'actor v3' } });
		if (!line) throw new Error(`the proposal on actor ${a.id} (${r.entry}) started no line`);
		// one write: a record between v2 and v3 fits neither, so its sets go in one batch
		await agent.call('avendb_run', { op: { op: 'batch', ops: sets.map((f) => ({ op: 'set', entry: r.entry, line, schema, path: [f], value: a[f] })) } });
		proposals.push({ entry: r.entry, line });
		moved++;
		console.error(`actor ${a.id}: ${v2Stored ? 'v2 to v3, ' : ''}${sets.map((f) => `set ${f}`).join(', ')}, proposed on ${r.entry}`);
	}
	if (!proposals.length) {
		console.error('Maia City holds every actor and query the repo declares, as it declares them: no AIP needed');
		process.exit(0);
	}
	const objective = [
		'import AvenDB.Objective',
		'open AvenDB.Objective',
		'',
		`/-- Maia City holds every actor and query entry the repo declares (src/lib/avendb/actors.js), as "${ACTOR_SCHEMA}" and "${QUERY_SCHEMA}". -/`,
		`def actors : Metric := metric "Actors v3 and their queries in Maia City" (equals (reading "actors") ${ACTORS.length + QUERIES.length})`,
		'',
		'def objective : List Metric := [actors]',
		''
	].join('\n');
	const note = [
		'One query engine, tasks M and C1 (Samuel 2026-10-27: "Actor" means one thing everywhere, and an app is an actor): each page\'s manifest becomes its app\'s actor. "Manifest, v2" evolves into "Actor, v3" through one lens: the same entries, ids and history, each with one v3 write; no copies, nothing superseded. v3 renames the kind to actor and tiers to loads (a held part names `actor`), and adds the actor\'s interface (no methods: these actors only load) and code. Each part names a query entry ("Query, v1", an actor of one read method) by its address, its params bound to the actor\'s slots. Every route loads exactly what it loaded before: a golden test compiles each route\'s Interests from the manifests and from the actors and their queries (game/code/sources/actors.test.js). Lean: avendb/spec/AvenDB/Interest.lean, Address.lean.',
		QUERIES.map((q) => `${q.id}: ${JSON.stringify(q.where)}${q.window ? `, newest ${q.window.limit}` : q.order?.[1] === 'asc' ? ', oldest first' : ''}${q.follow ? `, follow ${q.follow}` : ''}`).join('\n'),
		ACTORS.map((a) => `${a.id}: ${a.note}`).join('\n'),
		`${fresh} new, ${moved} moved to v3 or changed, ${kept} as they were.`
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'actors', value: kept, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'actors', value: ACTORS.length + QUERIES.length, note: 'with the proposals of this AIP' } });
	// straight to Proposed (Samuel 2026-10-26): it holds its objective, so it is promoted at once, ready for an Accept
	const promoted = await agent.call('avendb_run', { op: { op: 'aip_promote', entry: aip.entry } })
		.catch((e) => { console.error(`not promoted (${e.message}): an owner puts it forward ("Propose it")`); return null; });
	console.log(JSON.stringify({ vault: city.id, proposals, aip, promoted }, null, 2));
	console.error(`Proposed. An owner accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
