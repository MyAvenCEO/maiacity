#!/usr/bin/env node
// A newer version of one of our assets, proposed into the Maia City vault as an AIP by this Mac's agent (the device of
// avenMAIA Claude Code starts as its MCP server: `avendb-device agent claude`). The seed writes an asset into the vault
// once (src/lib/avendb/seed.js `unseeded`); every version after that goes in as a proposal the vault's owners accept.
// It finds the vault's entry of the asset, starts a proposal on it (`propose`, named v<n>), brings the version's recipe
// file onto that line with its record (`put_file`, the file beside it, as the seed's `assetOps` writes a version), and
// opens an AIP over the line (`aip_open`). An owner then puts it forward ("Propose it") and accepts it in the
// Proposals app (/app/aips/); the accept merges the line into main, and every page builds the new version from the
// vault (src/lib/assets/sources/avendb.js reads an entry's versions by avenDB's own numbers, no tags). Without --run
// it only says what it would do. A version with variants beyond its first is refused: an AIP lands its lines on main
// alone.
//
//   node scripts/propose-version.mjs machines/truck@2 [--run] [--device <path of avendb-device>]
//
// The agent device is the one ~/.claude.json starts as the `avendb` MCP server, else `--device` or AVENDB_DEVICE.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ f) => args.includes(f);
const option = (/** @type {string} */ f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const ref = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--device');
const m = /^([a-z]+)\/([a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/.exec(ref ?? '');
if (!m) {
	console.error('usage: node scripts/propose-version.mjs <group>/<id>@<version> [--run] [--device <avendb-device>]');
	process.exit(2);
}
const [, group, id, vs] = m;
const asset = `${group}/${id}`;
const v = Number(vs);

/** the agent device Claude Code starts as its `avendb` MCP server, as ~/.claude.json names it */
function device() {
	const named = option('--device') ?? process.env.AVENDB_DEVICE;
	if (named) return { command: named, args: ['agent', 'claude'] };
	try {
		const conf = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
		const s = conf.mcpServers?.avendb;
		if (s?.command) return { command: s.command, args: s.args ?? [] };
	} catch {
		// no Claude Code config here
	}
	throw new Error('no agent device: give --device <The OS app’s avendb-device>, or add it to Claude Code (claude mcp add --scope user avendb -- <avendb-device> agent claude)');
}

/** an MCP session with the agent device on its stdio: `call(tool, args)` answers its tool's text, read as JSON */
function session({ command, args }) {
	const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
	const waiting = new Map();
	let n = 0;
	createInterface({ input: child.stdout }).on('line', (line) => {
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		const w = waiting.get(msg.id);
		if (!w) return;
		waiting.delete(msg.id);
		if (msg.error) w.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
		else w.resolve(msg.result);
	});
	child.on('exit', (code) => {
		for (const w of waiting.values()) w.reject(new Error(`the agent device ended (${code})`));
		waiting.clear();
	});
	const send = (/** @type {string} */ method, /** @type {any} */ params) =>
		new Promise((resolve, reject) => {
			const at = ++n;
			waiting.set(at, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: at, method, params })}\n`);
		});
	return {
		async open() {
			await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'propose-version', version: '1' } });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
		},
		/** @param {string} name @param {any} a */
		async call(name, a) {
			const r = /** @type {any} */ (await send('tools/call', { name, arguments: a }));
			const text = (r?.content ?? []).map((/** @type {any} */ c) => c.text ?? '').join('');
			if (r?.isError) throw new Error(`${name}: ${text}`);
			let got;
			try {
				got = JSON.parse(text);
			} catch {
				return text;
			}
			// an op answers {ok} or why it was refused
			if (name === 'avendb_vaults') return got;
			if (got && typeof got === 'object' && 'ok' in got) return got.ok;
			throw new Error(`${name} ${a.op?.op ?? ''}: ${text.slice(0, 600)}`);
		},
		close: () => child.stdin.end()
	};
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
let made;
let note = '';
try {
	const seed = await server.ssrLoadModule('/src/lib/avendb/seed.js');
	made = await seed.versionOf(asset, v);
	const { assetAt } = await server.ssrLoadModule('/src/lib/assets/index.js');
	note = (await assetAt(`${asset}@${v}`))?.version?.note ?? '';
} finally {
	await server.close();
}
if (made.length > 1) {
	console.error(`${asset}@${v} has variants beyond its first (${made.slice(1).map((x) => x.label).join(', ')}): an AIP lands its lines on main alone, so they can't be proposed this way yet`);
	process.exit(1);
}
const [main] = made;
const card = main.value.card;
const dir = mkdtempSync(join(tmpdir(), 'propose-version-'));
const path = join(dir, `${main.label.replace(/[^a-z0-9@.-]+/gi, '_')}.js`);
writeFileSync(path, main.file.text);
const title = `${String(card.label).split(': ')[0]} v${v} (${asset}@${v})`;
const aipNote = [note, `Recipe ${card.recipe}, ${card.triangles?.toLocaleString?.('en') ?? '?'} triangles, made for box engine ${card.engine}.`].filter(Boolean).join('\n\n');
console.error(`${main.label}: recipe ${card.recipe.slice(0, 12)}…, ${main.file.text.length.toLocaleString('en')} characters (${path})`);
console.error(`AIP: ${title}`);
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: find the vault's entry of ${asset}, propose v${v} on it, put the file on that line, open the AIP.`);
	process.exit(0);
}

const agent = session(device());
try {
	await agent.open();
	const me = await agent.call('avendb_vaults', {});
	const city = (me.vaults ?? []).find((/** @type {any} */ x) => x.name === 'Maia City');
	if (!city) throw new Error(`this agent sees no Maia City: ${typeof me === 'string' ? me : JSON.stringify(me).slice(0, 400)}`);
	// the asset's entry: the recipe entry whose card is of it (an entry is one asset, by avenDB's id, not a ref tag),
	// leaving out what the seed marked deleted
	const found = await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['recipe'] }, select: ['card'] } });
	const rows = (found.rows ?? []).filter(
		(/** @type {any} */ r) => r.record?.card?.group === group && r.record?.card?.id === id && !(r.tags ?? []).includes('avendb:deleted')
	);
	if (rows.length !== 1) throw new Error(`Maia City holds ${rows.length} entries of ${asset} (${rows.map((/** @type {any} */ r) => r.entry).join(', ') || 'none'}): one is proposed to, so nothing was written`);
	const [row] = rows;
	const at = row.record?.card?.version ?? 0;
	if (at >= v) throw new Error(`Maia City's ${asset} is at v${at} already: nothing was written`);
	if (at !== v - 1) console.error(`note: Maia City's ${asset} is at v${at}, this proposes v${v}`);
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter(
		(/** @type {any} */ a) => !a.bare && ['idea', 'proposed'].includes(a.stage) && !a.outcome && (a.lines ?? []).some((/** @type {any} */ l) => l.entry === row.entry)
	);
	if (open.length && !flag('--again')) throw new Error(`an AIP over ${asset} is open already (${open.map((/** @type {any} */ a) => `${a.title} ${a.entry}`).join('; ')}): nothing was written (--again proposes all the same)`);
	const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: row.entry, name: `v${v}` } });
	if (!line) throw new Error('the proposal started no line');
	const put = await agent.call('avendb_run', { op: { op: 'put_file', entry: row.entry, line, value: main.value, schema: main.type, name: `${main.label}.js`, media: main.file.media }, path });
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note: aipNote, proposals: [{ entry: row.entry, line }] } });
	console.log(JSON.stringify({ vault: city.id, entry: row.entry, line, put, aip }, null, 2));
	console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
