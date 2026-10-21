#!/usr/bin/env bun
// The speech models theOS runs (src/lib/models/models.json), proposed into the Maia City vault as one AIP by this Mac's
// agent (the device of avenMAIA Claude Code starts as its MCP server: `avendb-device agent claude`), so a Mac brings them
// from avenDB as every other asset file, not out of the legacy vault (vault/app/src/models.rs). Each file is hashed here
// first and must be the pinned file; each missing one becomes a draft file entry of Maia City (`create`, `draft: true`,
// the file beside it), tagged `model`, `model:<id>` and `blake3:<pin>`, and one AIP opens over the drafts (`aip_open`)
// with its objective (every pinned file in Maia City), measured. An owner then puts it forward ("Propose it") and accepts
// it in the Proposals app (/app/aips/), and the files land in Maia City. A file Maia City holds already (by its tag) is
// left as it is. Without --run it only says what it would do.
//
//   bun scripts/propose-models.mjs --from <folder> [--run] [--device <path of avendb-device>]
//
// The files are read from --from, a folder of them by hash or by name. The agent device reads no file inside theOS's
// own folder (~/Library/Application Support/city.maia.studio, which holds the Mac's keys), so copy its models/ out first
// (`cp -c` clones them on APFS, no extra disk). The agent device is the one ~/.claude.json starts as
// the `avendb` MCP server, else `--device` or AVENDB_DEVICE.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ f) => args.includes(f);
const option = (/** @type {string} */ f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const { models } = JSON.parse(readFileSync(new URL('../src/lib/models/models.json', import.meta.url), 'utf8'));
if (!option('--from')) throw new Error(`give --from <folder of the model files>: the agent reads nothing inside ${join(homedir(), 'Library/Application Support/city.maia.studio')}, so copy its models/ out first (cp -c)`);
// the agent takes only absolute paths
const folders = [resolve(/** @type {string} */ (option('--from')))];

/** what a file's bytes are, for the Library */
const mediaOf = (/** @type {string} */ name) => (name.endsWith('.txt') ? 'text/plain' : 'application/octet-stream');

/** the BLAKE3 of the file at `path`, read in pieces (the encoder is 654 MB) */
async function hashOf(/** @type {string} */ path) {
	const h = blake3.create();
	for await (const piece of createReadStream(path, { highWaterMark: 8 << 20 })) h.update(piece);
	return bytesToHex(h.digest());
}

/** model file `f` on this Mac: its path, by its hash or its name, of its pinned size */
function pathOf(/** @type {{ name: string, size: number, blake3: string }} */ f) {
	for (const dir of folders) for (const p of [join(dir, f.blake3), join(dir, f.name)]) if (existsSync(p) && statSync(p).size === f.size) return p;
	return null;
}

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
	throw new Error('no agent device: give --device <theOS app’s avendb-device>, or add it to Claude Code (claude mcp add --scope user avendb -- <avendb-device> agent claude)');
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
			await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'propose-models', version: '1' } });
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

// every pinned file, found here and checked against its pin before anything is written
const files = [];
for (const m of models) {
	for (const f of m.files) {
		const path = pathOf(f);
		if (!path) throw new Error(`${m.id}'s ${f.name} (${f.size.toLocaleString('en')} bytes) is not in ${folders.join(' or ')}: nothing was written`);
		const got = await hashOf(path);
		if (got !== f.blake3) throw new Error(`${path} hashes to ${got}, not ${f.name}'s pin ${f.blake3}: nothing was written`);
		files.push({ model: m, file: f, path });
		console.error(`${m.id}/${f.name}: ${(f.size / 1048576).toFixed(1)} MB, BLAKE3 ${f.blake3.slice(0, 12)}… as pinned (${path})`);
	}
}
const title = `Speech models: ${models.map((/** @type {any} */ m) => m.label).join(' and ')}`;
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: each file Maia City doesn't hold yet as a draft file entry, one AIP over them ("${title}").`);
	process.exit(0);
}

const agent = session(device());
try {
	await agent.open();
	const me = await agent.call('avendb_vaults', {});
	const city = (me.vaults ?? []).find((/** @type {any} */ x) => x.name === 'Maia City');
	if (!city) throw new Error(`this agent sees no Maia City: ${typeof me === 'string' ? me : JSON.stringify(me).slice(0, 400)}`);
	// what Maia City holds already: its file entries tagged by a pin
	const found = await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['file'] } } });
	const held = new Set((found.rows ?? []).filter((/** @type {any} */ r) => !(r.tags ?? []).includes('avendb:deleted')).flatMap((/** @type {any} */ r) => r.tags ?? []));
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((/** @type {any} */ a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((/** @type {any} */ a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	const proposals = [];
	for (const { model, file, path } of files) {
		if (held.has(`blake3:${file.blake3}`)) {
			console.error(`${model.id}/${file.name}: Maia City holds it already`);
			continue;
		}
		const media = mediaOf(file.name);
		const tags = ['model', `model:${model.id}`, `blake3:${file.blake3}`];
		const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: 'file', tags, value: { kind: 'file', title: file.name, media }, draft: true, file: { name: file.name, media } }, path });
		if (!made?.entry || !made?.line) throw new Error(`${file.name}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
		proposals.push({ entry: made.entry, line: made.line });
		console.error(`${model.id}/${file.name}: drafted as ${made.entry}`);
	}
	if (!proposals.length) {
		console.error('Maia City holds every pinned file already: no AIP needed');
		process.exit(0);
	}
	const count = files.length;
	const objective = [
		'import AvenDB.Objective',
		'open AvenDB.Objective',
		'',
		`/-- Maia City holds every speech model file theOS pins (src/lib/models/models.json). -/`,
		`def files : Metric := metric "Pinned model files in Maia City" (equals (reading "files") ${count})`,
		'',
		'def objective : List Metric := [files]',
		''
	].join('\n');
	const note = [
		`The speech models theOS runs on the Mac, as Maia City's own files: ${models.map((/** @type {any} */ m) => `${m.label} (${m.task}; ${m.version})`).join('; ')}.`,
		`Each file is tagged with the BLAKE3 of its bytes, which theOS pins (src/lib/models/models.json) and checks before it loads one; ${proposals.length} of ${count} are new here, ${(files.reduce((s, x) => s + x.file.size, 0) / 1048576).toFixed(0)} MB in all.`
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'files', value: count - proposals.length, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'files', value: count, note: 'with the drafts of this AIP, each hashed to its pin' } });
	console.log(JSON.stringify({ vault: city.id, proposals, aip }, null, 2));
	console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
