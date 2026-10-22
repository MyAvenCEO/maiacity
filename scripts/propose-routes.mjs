#!/usr/bin/env node
// @ts-nocheck — plain JS
// The games' addresses as the repo has them (game/games.js `route`; the sandboxes' moved to match their names on
// 2026-10-22, so Sandbox 3 is /app/games/sandbox-3/), proposed into the Maia City vault as one AIP by avenMAIA's agent
// (./agent.mjs: the Mac's, or a cloud session's): each `game` entry whose `route` is another gets a proposal line
// (`propose`) with the repo's set on it, and each game's manifest (`game-<id>`, src/lib/avendb/manifests.js) whose
// `routes` are others the same. One AIP opens over the lines (`aip_open`) with its objective (every game entry and
// manifest names the repo's address), measured. An owner then accepts it in the Proposals app (/app/aips/). Without
// --run it only says what it would do.
//
//   node scripts/propose-routes.mjs [--run] [--again] [--device <path of avendb-device>]
import { GAMES } from '../game/games.js';
import { gameManifest } from '../src/lib/avendb/manifests.js';
import { device, session } from './agent.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

for (const g of GAMES) console.error(`${g.id}: ${g.label} at ${g.route}`);
const title = 'The sandboxes’ addresses match their names';
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: each game entry and game manifest of Maia City naming another address gets a proposal, one AIP over them ("${title}").`);
	process.exit(0);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const agent = session(device(option('--device')), 'propose-routes');
try {
	await agent.open();
	const city = await agent.city();
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	const live = (rows) => (rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted'));
	const games = live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['game'] } } })).rows);
	const manifests = live((await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['manifest'] } } })).rows);
	const name = `routes ${new Date().toISOString().slice(0, 10)}`;
	const proposals = [];
	let total = 0;
	/** one line on entry `r` setting record field `field` to `value`, unless it holds that already */
	const line = async (r, field, value, label) => {
		total++;
		if (same(r.record?.[field], value)) return console.error(`${label}: Maia City holds ${JSON.stringify(value)} already`);
		const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: r.entry, name } });
		if (!line) throw new Error(`the proposal on ${label} (${r.entry}) started no line`);
		await agent.call('avendb_run', { op: { op: 'set', entry: r.entry, line, path: [field], value } });
		proposals.push({ entry: r.entry, line });
		console.error(`${label}: ${JSON.stringify(r.record?.[field])} -> ${JSON.stringify(value)}, proposed on ${r.entry}`);
	};
	for (const g of GAMES) {
		const held = games.filter((r) => r.record?.id === g.id);
		if (held.length > 1) throw new Error(`Maia City holds ${held.length} game entries of ${g.id}: nothing more was written`);
		if (held[0]) await line(held[0], 'route', g.route, `game ${g.id}`);
		const m = gameManifest(g);
		const mine = manifests.filter((r) => r.record?.id === m.id);
		if (mine.length > 1) throw new Error(`Maia City holds ${mine.length} manifests ${m.id}: nothing more was written`);
		if (mine[0]) await line(mine[0], 'routes', m.routes, `manifest ${m.id}`);
	}
	if (!proposals.length) {
		console.error('Maia City names every game’s address as the repo does already: no AIP needed');
		process.exit(0);
	}
	const objective = [
		'import AvenDB.Objective',
		'open AvenDB.Objective',
		'',
		'/-- Every game entry and game manifest of Maia City names the address the app has the game at (game/games.js). -/',
		`def routes : Metric := metric "Game entries and manifests naming the app's address" (equals (reading "routes") ${total})`,
		'',
		'def objective : List Metric := [routes]',
		''
	].join('\n');
	const note = [
		'The sandboxes’ addresses carry their names’ numbers now (Samuel 2026-10-22, "ensure that the sandbox slugs match their actual ui sandboxes"): Sandbox 3 at /app/games/sandbox-3/, Sandbox 4 at sandbox-4/, Sandbox 5 at sandbox-5/, Sandbox 6 at sandbox-6/ and Sandbox 7 at sandbox-7/. The game ids (sandbox-3 …) stay as they were: they matched the names already.',
		'This sets each game entry’s `route` and each game manifest’s `routes` to the new address, so the Worlds app and smart sync name the right page. Nothing else changes.'
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'routes', value: total - proposals.length, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'routes', value: total, note: 'with the lines of this AIP' } });
	console.log(JSON.stringify({ vault: city.id, proposals, aip }, null, 2));
	console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
