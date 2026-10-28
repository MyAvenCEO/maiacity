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
//
// An entry Maia City wrote under "Manifest, v1" and then moved to v2 (AIP-38) is written under two schemas besides v3.
// avendb lens.rs `Lane::view` opens it writable through the lens from v2 only where v1 is spent on it (its record holds
// nothing the lens from v1 would still translate), and read-only otherwise, as every such entry did before the engine
// learnt that (2026-10-28). So before writing anything the run reads every actor through v3 and stops on any it may not
// write, naming them. Each draft it makes goes into a ledger (`--drafts <file>`, kept beside the run), keyed by query or
// actor id, so a run cut short is taken up again without drafting twice: it reuses each draft it finds there, its line
// read from the entry's history. A ledger may also be a run's log, its lines `query <id>: drafted as <entry>`.
//
// With `--skip-locked` it leaves those out instead (they stay v2, which pages read lifted) and proposes the rest; a
// later run, on an engine that opens them, moves them in an AIP of their own, which names only what it moves.
//
//   node scripts/propose-actors.mjs --run [--drafts <ledger.json | run.log>] [--skip-locked]
import { ACTOR_LENS, ACTOR_SCHEMA, ACTOR_TYPE, ACTOR_V3, MANIFEST_SCHEMA, MANIFEST_V1_SCHEMA, QUERY_SCHEMA, QUERY_TYPE, QUERY_V1, actorLens } from '../game/code/sources/actors.js';
import { ACTORS, QUERIES } from '../src/lib/avendb/actors.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { device, session } from './agent.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
/** the AIP's title, for `n` actors */
const titleOf = (n, q = QUERIES.length) => `Actors v3: each app and the queries it loads, in tiers (${n} actors, ${q} queries)`;
const title = titleOf(ACTORS.length);
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

/** a value with its object keys sorted: the vault hands a record's maps back in its own key order, not the repo's */
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const same = (a, b) => JSON.stringify(sorted(a ?? null)) === JSON.stringify(sorted(b ?? null));

/**
 * The drafts a run made, by key (`query:<id>`, `actor:<id>`) to entry, at `path`: a ledger this run keeps, or a run's
 * log to take its drafts from (`<kind> <id>: drafted as <entry>`). `put` keeps a new draft there at once, so a run cut
 * short leaves every draft it made named.
 */
function drafts(path) {
	const got = {};
	const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
	if (path.endsWith('.json')) Object.assign(got, text ? JSON.parse(text) : {});
	else for (const [, kind, id, entry] of text.matchAll(/^(query|actor) (\S+): drafted as ([0-9a-f]{64})$/gm)) got[`${kind}:${id}`] = entry;
	const keep = path.endsWith('.json') ? path : `${path}.drafts.json`;
	if (Object.keys(got).length) console.error(`${Object.keys(got).length} drafts of an earlier run named in ${path}`);
	return {
		got,
		put(key, entry) {
			got[key] = entry;
			mkdirSync(dirname(keep), { recursive: true });
			writeFileSync(keep, `${JSON.stringify(got, null, '\t')}\n`);
		}
	};
}

const agent = session(device(option('--device')), 'propose-actors');
/** Set a reused draft's fields `fields` to the repo's `want` on its line, where they differ, through `schema`. */
const redraft = async ({ entry, line }, want, fields, schema) => {
	const now = await agent.call('avendb_ask', { op: { op: 'get', entry, line, schema } });
	const sets = fields.filter((f) => want[f] !== undefined && !same(now?.record?.[f], want[f]));
	if (sets.length) await agent.call('avendb_run', { op: { op: 'batch', ops: sets.map((f) => ({ op: 'set', entry, line, schema, path: [f], value: want[f] })) } });
};
try {
	await agent.open();
	const city = await agent.city();
	const live = (rows) => (rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted'));
	// as stored, any version, for the count; what may be written is read through v3 below
	const stored = live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: [ACTOR_TYPE] } } })).rows);
	console.error(`Maia City holds ${stored.length} actors: ${stored.filter((r) => r.record?.loads).length} moved to v3, ${stored.filter((r) => !r.record?.loads && r.record?.v === 2).length} v2, ${stored.filter((r) => !r.record?.loads && r.record?.v !== 2).length} v1.`);
	// a schema or a lens is no row a query reads: the `schemas` op lists those of the vault's lane
	const lane = await agent.call('avendb_ask', { op: { op: 'schemas', vault: city.id } });
	const v2 = (lane.schemas ?? []).find((s) => s.title === MANIFEST_SCHEMA);
	const v3 = (lane.schemas ?? []).find((s) => s.title === ACTOR_SCHEMA && s.json === ACTOR_V3);
	// the lane reads through the lens with the smallest id where several join v2 and v3 (lens.rs Lane::view; a lens's id
	// is its blob's hash), and only the repo's moves kind, v and tiers in one write that v3 reads whole
	const ours = v2 && v3 && actorLens(v2.id, v3.id);
	const joining = (lane.lenses ?? []).filter((l) => [l.from, l.to].sort().join() === [v2?.id, v3?.id].sort().join()).sort((a, b) => (a.id < b.id ? -1 : 1));
	const joined = v2 && v3 && joining.some((l) => l.json === ours);
	if (joined && joining[0].json !== ours) {
		console.error(`Maia City reads v2 through v3 by the lens ${joining[0].id}, not the repo's "${ACTOR_LENS}" (${joining.find((l) => l.json === ours).id}), whose id is larger: nothing was written.`);
		process.exit(1);
	}
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
	// an actor once written under v1 and then v2 opens read-only through v3 (one lens hop): stop before any write
	const locked = [...held.values()].filter((r) => r.readOnly && ACTORS.some((a) => a.id === r.record?.id));
	if (locked.length) {
		const skipping = flag('--skip-locked');
		console.error(`${locked.length} actors open read-only through "${ACTOR_SCHEMA}": they were written under "${MANIFEST_V1_SCHEMA}" and "${MANIFEST_SCHEMA}", and a view joins one other schema, not a chain of lenses (lens.rs Lane::view). ${skipping ? 'Left out (--skip-locked):' : 'Nothing was written (--skip-locked proposes the rest):'}`);
		for (const r of locked) console.error(`  ${r.record?.id} ${r.entry}`);
		if (!skipping) process.exit(1);
	}
	const skipped = new Set(locked.map((r) => r.record?.id));
	// what this run writes: the actors and query entries Maia City doesn't hold as the repo declares them (an AIP after
	// one that moved the rest names only what it moves: the 14 actors once v1 was spent on them, 2026-10-28)
	const setsOf = (a, r) => FIELDS.filter((f) => a[f] !== undefined && (!was.get(r.entry)?.loads || !same(r.record?.[f], a[f])));
	const heldQueries = new Map(live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, schema: qv1.id, where: { type: [QUERY_TYPE] } } })).rows).map((r) => [r.record?.id, r]));
	const pendingQuery = (q) => !heldQueries.has(q.id) || QUERY_FIELDS.some((f) => q[f] !== undefined && !same(heldQueries.get(q.id).record?.[f], q[f]));
	const moving = ACTORS.filter((a) => !skipped.has(a.id) && (!held.has(a.id) || setsOf(a, held.get(a.id)).length));
	const queries = QUERIES.filter(pendingQuery);
	const title = titleOf(moving.length, queries.length);
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	// every actor write, asked before any is made (`may`: a dry run the rules judge as they would the write). A v3 write
	// whose record neither schema reads (a lens that moves kind, v and tiers apart) is refused here, with no record
	// written. Each actor's write goes on a line of its own: the empty "actor v3" line a refused run left, else a new one
	// (a proposal's start writes no record), so a run refused here and run again starts no line twice.
	/** the "actor v3" line on entry `entry` that holds no write but its start, where a run left one */
	const emptyLine = async (entry) => {
		const edits = (await agent.call('avendb_ask', { op: { op: 'history', entry } }))?.edits ?? [];
		const start = edits.find((e) => e.kind === 'propose' && e.name === 'actor v3' && !edits.some((x) => x.line === e.line && x.kind !== 'propose'));
		return start?.line ?? null;
	};
	const writes = [];
	for (const a of moving.filter((a) => held.has(a.id))) {
		const r = held.get(a.id);
		const sets = setsOf(a, r);
		if (!sets.length) continue;
		let line = await emptyLine(r.entry);
		const again = Boolean(line);
		if (!line) line = (await agent.call('avendb_run', { op: { op: 'propose', entry: r.entry, name: 'actor v3' } }))?.line;
		if (!line) throw new Error(`the proposal on actor ${a.id} (${r.entry}) started no line`);
		// one write: a record between v2 and v3 fits neither, so its sets go in one batch
		writes.push({ a, r, line, again, sets, op: { op: 'batch', ops: sets.map((f) => ({ op: 'set', entry: r.entry, line, schema, path: [f], value: a[f] })) } });
	}
	const drafted = moving.filter((a) => !held.has(a.id)).map((a) => ({ a, op: { op: 'create', vault: city.id, type: ACTOR_TYPE, schema, tags: ['actor', `actor:${a.id}`], value: a, draft: true } }));
	const asked = [...writes, ...drafted];
	const verdicts = asked.length ? await agent.call('avendb_ask', { op: { op: 'may', ops: asked.map((w) => w.op) } }) : [];
	const refused = asked.map((w, i) => [w.a.id, verdicts?.[i]]).filter(([, v]) => v !== true && !v?.approve);
	if (refused.length) {
		console.error(`${refused.length} of ${asked.length} actor writes would be refused: no record was written (the "actor v3" lines started are empty, and the next run takes them up).`);
		for (const [id, v] of refused) console.error(`  ${id}: ${JSON.stringify(v)}`);
		process.exit(1);
	}
	console.error(`${asked.length} actor writes asked first (may): each would be made (${writes.filter((w) => w.again).length} on the empty line a run left).`);
	const ledger = drafts(option('--drafts') ?? join(homedir(), '.cache', 'maiacity', `propose-actors-${city.id.slice(0, 16)}.json`));
	/** the draft `key` names in the ledger, with its line from the entry's history; none if the entry is gone */
	const reuse = async (key) => {
		const entry = ledger.got[key];
		if (!entry) return null;
		const h = await agent.call('avendb_ask', { op: { op: 'history', entry } }).catch(() => null);
		const first = (h?.edits ?? []).find((e) => e.kind === 'draft');
		return first?.line ? { entry, line: first.line } : null;
	};
	const proposals = [];
	let fresh = 0, moved = 0;
	// the query entries first: an actor names them
	for (const q of QUERIES) {
		const r = heldQueries.get(q.id);
		if (!r) {
			const again = await reuse(`query:${q.id}`);
			if (again) {
				await redraft(again, q, QUERY_FIELDS, qv1.id);
				proposals.push(again);
				fresh++;
				console.error(`query ${q.id}: its draft ${again.entry} again`);
				continue;
			}
			const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: QUERY_TYPE, schema: qv1.id, tags: ['query', `query:${q.id}`], value: q, draft: true } });
			if (!made?.entry || !made?.line) throw new Error(`query ${q.id}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
			ledger.put(`query:${q.id}`, made.entry);
			proposals.push({ entry: made.entry, line: made.line });
			fresh++;
			console.error(`query ${q.id}: drafted as ${made.entry}`);
			continue;
		}
		const sets = QUERY_FIELDS.filter((f) => q[f] !== undefined && !same(r.record?.[f], q[f]));
		if (!sets.length) continue;
		const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: r.entry, name: 'query v1' } });
		if (!line) throw new Error(`the proposal on query ${q.id} (${r.entry}) started no line`);
		await agent.call('avendb_run', { op: { op: 'batch', ops: sets.map((f) => ({ op: 'set', entry: r.entry, line, schema: qv1.id, path: [f], value: q[f] })) } });
		proposals.push({ entry: r.entry, line });
		moved++;
		console.error(`query ${q.id}: ${sets.map((f) => `set ${f}`).join(', ')}, proposed on ${r.entry}`);
	}
	for (const a of moving) {
		const r = held.get(a.id);
		if (!r) {
			const again = await reuse(`actor:${a.id}`);
			if (again) {
				await redraft(again, a, FIELDS, schema);
				proposals.push(again);
				fresh++;
				console.error(`actor ${a.id}: its draft ${again.entry} again`);
				continue;
			}
			const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: ACTOR_TYPE, schema, tags: ['actor', `actor:${a.id}`], value: a, draft: true } });
			if (!made?.entry || !made?.line) throw new Error(`actor ${a.id}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
			ledger.put(`actor:${a.id}`, made.entry);
			proposals.push({ entry: made.entry, line: made.line });
			fresh++;
			console.error(`actor ${a.id}: drafted as ${made.entry}`);
			continue;
		}
		const w = writes.find((w) => w.a === a);
		if (!w) continue;
		await agent.call('avendb_run', { op: w.op });
		proposals.push({ entry: r.entry, line: w.line });
		moved++;
		console.error(`actor ${a.id}: ${!was.get(r.entry)?.loads ? 'v2 to v3, ' : ''}${w.sets.map((f) => `set ${f}`).join(', ')}, proposed on ${r.entry}`);
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
		`def actors : Metric := metric "Actors v3 and their queries in Maia City" (equals (reading "actors") ${ACTORS.length - skipped.size + QUERIES.length})`,
		'',
		'def objective : List Metric := [actors]',
		''
	].join('\n');
	const note = [
		'One query engine, tasks M and C1 (Samuel 2026-10-27: "Actor" means one thing everywhere, and an app is an actor): each page\'s manifest becomes its app\'s actor. "Manifest, v2" evolves into "Actor, v3" through one lens: the same entries, ids and history, each with one v3 write; no copies, nothing superseded. v3 renames the kind to actor and tiers to loads (a held part names `actor`), and adds the actor\'s interface (no methods: these actors only load) and code. Each part names a query entry ("Query, v1", an actor of one read method) by its address, its params bound to the actor\'s slots. Every route loads exactly what it loaded before: a golden test compiles each route\'s Interests from the manifests and from the actors and their queries (game/code/sources/actors.test.js). Lean: avendb/spec/AvenDB/Interest.lean, Address.lean.',
		queries.map((q) => `${q.id}: ${JSON.stringify(q.where)}${q.window ? `, newest ${q.window.limit}` : q.order?.[1] === 'asc' ? ', oldest first' : ''}${q.follow ? `, follow ${q.follow}` : ''}`).join('\n'),
		moving.map((a) => `${a.id}: ${a.note}`).join('\n'),
		...(skipped.size ? [`Not in this AIP: ${[...skipped].join(', ')}. Each was written under "${MANIFEST_V1_SCHEMA}" and "${MANIFEST_SCHEMA}", so it opens read-only through v3 until the engine reads through a chain of lenses; it stays v2, which pages read lifted, and moves by an AIP of its own.`] : []),
		`${fresh} new, ${moved} moved to v3 or changed; the other ${ACTORS.length - skipped.size + QUERIES.length - moving.length - queries.length} Maia City holds as declared.`
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'actors', value: ACTORS.length - skipped.size + QUERIES.length - moving.length - queries.length, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'actors', value: ACTORS.length - skipped.size + QUERIES.length, note: 'with the proposals of this AIP' } });
	// straight to Proposed (Samuel 2026-10-26): it holds its objective, so it is promoted at once, ready for an Accept
	const promoted = await agent.call('avendb_run', { op: { op: 'aip_promote', entry: aip.entry } })
		.catch((e) => { console.error(`not promoted (${e.message}): an owner puts it forward ("Propose it")`); return null; });
	console.log(JSON.stringify({ vault: city.id, proposals, aip, promoted }, null, 2));
	console.error(`Proposed. An owner accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
