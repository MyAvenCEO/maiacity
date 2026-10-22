#!/usr/bin/env node
// @ts-nocheck — plain JS
// The games' and worlds' assets configs (code/configs/<game>/assets: every asset a sandbox or a world draws, pinned to
// its avenDB entry and the heads of its version, Samuel 2026-10-22), proposed into the Maia City vault as one AIP by
// avenMAIA's agent (./agent.mjs: the Mac's, or a cloud session's). Each config Maia City holds no entry of yet becomes a
// draft config entry (`create`, `draft: true`, the record and tags the seed's top-up would have written: ref:<path>,
// game:<id>); each one it holds with other pins gets a proposal line (`propose`) with the repo's pins set on it (`set`
// at `data`). One AIP opens over the lines (`aip_open`) with its objective (every assets config holds the repo's pins),
// measured. An owner then accepts it in the Proposals app (/app/aips/), and the pages read the pins from Maia City.
// Without --run it only says what it would do.
//
//   node scripts/propose-assets.mjs [--run] [--again] [--device <path of avendb-device>]
import { ENTRIES } from '../code/index.js';
import { recordOf } from '../game/code/sources/avendb.js';
import { device, session } from './agent.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);

const configs = Object.values(ENTRIES)
	.filter((e) => e.type === 'config' && e.ref.endsWith('/assets'))
	.sort((a, b) => a.ref.localeCompare(b.ref));
const count = (e) => Object.keys(JSON.parse(e.files['config.json'])).length;
for (const e of configs) console.error(`${e.ref}: ${count(e)} assets pinned`);
const title = 'Assets of the sandboxes and worlds by their avenDB entries';
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: each of these Maia City lacks as a draft config entry, each it holds with other pins as a proposal, one AIP over them ("${title}").`);
	process.exit(0);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const agent = session(device(option('--device')), 'propose-assets');
try {
	await agent.open();
	const city = await agent.city();
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	const found = await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['config'] } } });
	const rows = (found.rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted'));
	const proposals = [];
	const name = `pins ${new Date().toISOString().slice(0, 10)}`;
	for (const e of configs) {
		const { type, tags, value } = recordOf(e);
		const held = rows.filter((r) => (r.tags ?? []).includes(`ref:${e.ref}`));
		if (held.length > 1) throw new Error(`Maia City holds ${held.length} entries of ${e.ref} (${held.map((r) => r.entry).join(', ')}): nothing more was written`);
		if (!held.length) {
			const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type, tags, value, draft: true } });
			if (!made?.entry || !made?.line) throw new Error(`${e.ref}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
			proposals.push({ entry: made.entry, line: made.line });
			console.error(`${e.ref}: drafted as ${made.entry}`);
			continue;
		}
		const [r] = held;
		if (same(r.record?.data, value.data)) {
			console.error(`${e.ref}: Maia City holds these pins already`);
			continue;
		}
		const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: r.entry, name } });
		if (!line) throw new Error(`the proposal on ${e.ref} (${r.entry}) started no line`);
		await agent.call('avendb_run', { op: { op: 'set', entry: r.entry, line, path: ['data'], value: value.data } });
		proposals.push({ entry: r.entry, line });
		console.error(`${e.ref}: proposed on ${r.entry}`);
	}
	if (!proposals.length) {
		console.error('Maia City holds every assets config with the repo’s pins already: no AIP needed');
		process.exit(0);
	}
	const objective = [
		'import AvenDB.Objective',
		'open AvenDB.Objective',
		'',
		'/-- Every game and world keeps its assets in Maia City as pins: an entry and the heads of a version (code/configs/<game>/assets). -/',
		`def configs : Metric := metric "Assets configs of Maia City holding the repo's pins" (equals (reading "configs") ${configs.length})`,
		'',
		'def objective : List Metric := [configs]',
		''
	].join('\n');
	const note = [
		'Every asset Sandbox 3 and 4, MaiaCity V1, the tired land and the factories draw, named by its avenDB entry and the heads of its version, never by an old group/id@v ref (Samuel 2026-10-22, "Shouldn’t sandboxes now rely solely on avenDB native asset ids?").',
		`Each pin names the version the world has always drawn: ${configs.map((e) => `${e.ref} (${count(e)})`).join(', ')}. Once accepted, a newer version reaches a world only by an AIP on its config.`
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'configs', value: configs.length - proposals.length, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'configs', value: configs.length, note: 'with the lines of this AIP' } });
	console.log(JSON.stringify({ vault: city.id, proposals, aip }, null, 2));
	console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
