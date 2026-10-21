#!/usr/bin/env node
// New assets of ours, proposed into the Maia City vault as ONE AIP by an agent of avenMAIA, never written by the seed
// (Samuel 2026-10-19: every change to vault data goes to him as a proposal). Each asset is drafted as its recipe entry
// (`create` with `draft: true`, the record, tags and file the seed would write: src/lib/avendb/seed.js `versionOf`), so
// it shows nowhere on the vault's main line until an owner accepts the AIP in the Proposals app (/app/aips/); then it
// carries its `ref:` tag, and the seed's top-up finds it held and writes nothing. Accept the AIP before the PR that
// adds the assets merges, or the seed's top-up writes them itself. An asset the vault holds already, or one whose repo
// history is more than one version with one recipe, is refused (a newer version goes in by scripts/propose-version.mjs).
// Without --run it only says what it would do.
//
//   node scripts/propose-new.mjs <group>/<id>@<v> [...] --title "<the AIP's title>" [--note "<why>"] [--run]
//        [--device <path of avendb-device>]
//
// The agent is the Mac's (`avendb` in ~/.claude.json, `--device` or AVENDB_DEVICE), or in a cloud session the repo's
// (scripts/avendb-cloud.sh, with AVENDB_AGENT_KEY).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ f) => args.includes(f);
const option = (/** @type {string} */ f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const OPTIONS = ['--title', '--note', '--device'];
const refs = args.filter((a, i) => !a.startsWith('--') && !OPTIONS.includes(args[i - 1] ?? ''));
const title = option('--title');
const parsed = refs.map((r) => /^([a-z]+)\/([a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/.exec(r));
if (!refs.length || parsed.some((m) => !m) || !title) {
	console.error('usage: node scripts/propose-new.mjs <group>/<id>@<v> [...] --title "<the AIP\'s title>" [--note "<why>"] [--run] [--device <avendb-device>]');
	process.exit(2);
}
const assets = parsed.map((m) => ({ group: /** @type {string[]} */ (m)[1], id: /** @type {string[]} */ (m)[2], v: Number(/** @type {string[]} */ (m)[3]) }));

/** the agent: the Mac's, as Claude Code starts it, or in a cloud session the repo's */
function device() {
	const named = option('--device') ?? process.env.AVENDB_DEVICE;
	if (named) return { command: named, args: ['agent', 'claude'] };
	if (process.env.CLAUDE_CODE_REMOTE === 'true' && process.env.AVENDB_AGENT_KEY) return { command: 'sh', args: ['scripts/avendb-cloud.sh'] };
	try {
		const conf = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
		const s = conf.mcpServers?.avendb;
		if (s?.command) return { command: s.command, args: s.args ?? [] };
	} catch {
		// no Claude Code config here
	}
	throw new Error('no agent device: give --device <theOS app’s avendb-device>, or add it to Claude Code (claude mcp add --scope user avendb -- <avendb-device> agent claude)');
}

/** an MCP session with the agent on its stdio: `call(tool, args)` answers its tool's text, read as JSON */
function session({ command, args: argv }) {
	const child = spawn(command, argv, { stdio: ['pipe', 'pipe', 'inherit'] });
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
		for (const w of waiting.values()) w.reject(new Error(`the agent ended (${code})`));
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
			await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'propose-new', version: '1' } });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
		},
		/** @param {string} name @param {any} a */
		async call(name, a) {
			for (let i = 0; ; i++) {
				const r = /** @type {any} */ (await send('tools/call', { name, arguments: a }));
				const text = (r?.content ?? []).map((/** @type {any} */ c) => c.text ?? '').join('');
				// a vault's first pull runs to its end; a call meanwhile is answered so, and asked again
				if (/still bringing/i.test(text) && i < 30) {
					console.error(`${name}: avenDB is still bringing the vault, asking again`);
					await new Promise((ok) => setTimeout(ok, 6000));
					continue;
				}
				if (r?.isError) throw new Error(`${name}: ${text}`);
				let got;
				try {
					got = JSON.parse(text);
				} catch {
					return text;
				}
				if (name === 'avendb_vaults') return got;
				if (got && typeof got === 'object' && 'ok' in got) return got.ok;
				throw new Error(`${name} ${a.op?.op ?? ''}: ${text.slice(0, 600)}`);
			}
		},
		close: () => child.stdin.end()
	};
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
/** @type {any[]} */
const made = [];
try {
	const seed = await server.ssrLoadModule('/src/lib/avendb/seed.js');
	const held = seed.assetsOf();
	for (const a of assets) {
		const versions = held[`${a.group}/${a.id}`] ?? [];
		if (versions.length !== 1 || versions[0].length !== 1) throw new Error(`${a.group}/${a.id}: the repo holds ${versions.length} versions of it (${versions.flat().join(', ')}); only an asset of one version with one recipe is proposed new`);
		const [main] = await seed.versionOf(`${a.group}/${a.id}`, a.v);
		made.push({ ...a, ...main });
	}
} finally {
	await server.close();
}
const dir = mkdtempSync(join(tmpdir(), 'propose-new-'));
for (const m of made) {
	m.path = join(dir, `${m.label.replace(/[^a-z0-9@.-]+/gi, '_')}.js`);
	writeFileSync(m.path, m.file.text);
	const c = m.value.card;
	console.error(`${m.label}: recipe ${c.recipe.slice(0, 12)}…, ${c.triangles?.toLocaleString?.('en') ?? '?'} triangles, box engine ${c.engine}, tags ${m.tags.join(' ')}`);
}
console.error(`AIP: ${title}`);
if (!flag('--run')) {
	console.error('Without --run nothing is written. With it: draft each as a recipe entry of Maia City with its file, open one AIP over the drafts, put it forward.');
	process.exit(0);
}

const agent = session(device());
try {
	await agent.open();
	const me = await agent.call('avendb_vaults', {});
	const city = (me.vaults ?? []).find((/** @type {any} */ x) => x.name === 'Maia City');
	if (!city) throw new Error(`this agent sees no Maia City: ${typeof me === 'string' ? me : JSON.stringify(me).slice(0, 400)}`);
	const found = await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['recipe'] }, select: ['card'] } });
	const clash = (found.rows ?? []).filter((/** @type {any} */ r) => made.some((m) => r.record?.card?.group === m.group && r.record?.card?.id === m.id));
	if (clash.length) throw new Error(`Maia City holds ${clash.map((/** @type {any} */ r) => `${r.record.card.group}/${r.record.card.id} (${r.entry})`).join(', ')} already: nothing was written`);
	const proposals = [];
	for (const m of made) {
		const op = { op: 'create', vault: city.id, type: m.type, tags: m.tags, schema: m.type, value: m.value, draft: true, file: { name: `${m.label}.js`, media: m.file.media } };
		const { entry, line } = await agent.call('avendb_run', { op, path: m.path });
		if (!entry || !line) throw new Error(`${m.label}: the draft started no line`);
		console.error(`${m.label}: drafted as ${entry}`);
		proposals.push({ entry, line });
	}
	const note = [
		option('--note') ?? '',
		made.map((m) => `${m.label}: recipe ${m.value.card.recipe}, ${m.value.card.triangles?.toLocaleString?.('en') ?? '?'} triangles, made for box engine ${m.value.card.engine}.`).join('\n')
	].filter(Boolean).join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals } });
	let promoted = null;
	try {
		promoted = await agent.call('avendb_run', { op: { op: 'aip_promote', entry: aip.entry } });
	} catch (e) {
		console.error(`not put forward: ${/** @type {Error} */ (e).message.slice(0, 400)}`);
	}
	console.log(JSON.stringify({ vault: city.id, aip, promoted, proposals }, null, 2));
	console.error(`Opened. An owner accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
