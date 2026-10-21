#!/usr/bin/env bun
// @ts-nocheck — plain JS
// The code packages The OS runs beside its own code (src/lib/code/packages.json, Lean first), proposed into the Maia
// City vault as one AIP by avenMAIA's agent (./agent.mjs: the Mac's, or a cloud session's), so a Mac brings them from
// avenDB alone (avendb-device's lean.rs), as the speech models (./propose-models.mjs). Each file is fetched from where
// its publisher publishes it (`source`, https only) unless --from holds it already, and must hash to both its pins,
// SHA-256 and BLAKE3, before anything is written; each one Maia City doesn't hold yet becomes a draft file entry of
// Maia City (`create`, `draft: true`, the file beside it), tagged `package`, `package:<id>` and `blake3:<pin>`, and one
// AIP opens over the drafts (`aip_open`) with its objective (every pinned file in Maia City), measured. An owner then
// accepts it in the Proposals app (/app/aips/), and the files land in Maia City. Without --run it only says what it
// would do.
//
//   bun scripts/propose-code.mjs [--from <folder>] [--run] [--again] [--device <path of avendb-device>]
//
// --from is where the files are looked for, by hash or by name, and where a missing one is fetched to: a folder in the
// system's temporary folder unless given (never The OS's own folder, ~/Library/Application Support/city.maia.studio,
// which holds the Mac's keys and which the agent reads nothing in).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { device, session } from './agent.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const { packages } = JSON.parse(readFileSync(new URL('../src/lib/code/packages.json', import.meta.url), 'utf8'));
// the agent takes only absolute paths
const folder = resolve(option('--from') ?? join(tmpdir(), 'maiacity-code'));

/** what a file's bytes are, for the Library */
const mediaOf = (name) => (name.endsWith('.zst') ? 'application/zstd' : 'application/octet-stream');

/** the SHA-256 and BLAKE3 of the file at `path`, read in pieces (Lean's archive is 570 MB) */
async function hashesOf(path) {
	const [sha, b3] = [createHash('sha256'), blake3.create()];
	for await (const piece of createReadStream(path, { highWaterMark: 8 << 20 })) {
		sha.update(piece);
		b3.update(piece);
	}
	return { sha256: sha.digest('hex'), blake3: bytesToHex(b3.digest()) };
}

/** file `f` here, of its pinned size: by its hash or its name in `folder`, else fetched there from its source */
function pathOf(f) {
	for (const p of [join(folder, f.blake3), join(folder, f.name)]) if (existsSync(p) && statSync(p).size === f.size) return p;
	if (!f.source.startsWith('https://')) throw new Error(`${f.name} is not in ${folder}, and its source isn't an https address: nothing was written`);
	mkdirSync(folder, { recursive: true });
	const path = join(folder, f.name);
	console.error(`${f.name}: fetching ${(f.size / 1e6).toFixed(0)} MB from ${f.source}`);
	const got = spawnSync('curl', ['--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https', '-o', `${path}.part`, f.source], { stdio: ['ignore', 'inherit', 'inherit'] });
	if (got.status !== 0) throw new Error(`${f.name}: curl failed (${got.status ?? got.signal}): nothing was written`);
	renameSync(`${path}.part`, path);
	return path;
}

// every pinned file, here and checked against both its pins before anything is written
const files = [];
for (const p of packages) {
	for (const f of p.files) {
		const path = pathOf(f);
		const got = await hashesOf(path);
		if (got.sha256 !== f.sha256 || got.blake3 !== f.blake3) throw new Error(`${path} hashes to SHA-256 ${got.sha256}, BLAKE3 ${got.blake3}, not ${f.name}'s pins: nothing was written`);
		files.push({ pack: p, file: f, path });
		console.error(`${p.id}/${f.name}: ${(f.size / 1e6).toFixed(0)} MB, SHA-256 ${f.sha256.slice(0, 12)}… and BLAKE3 ${f.blake3.slice(0, 12)}… as pinned (${path})`);
	}
}
const title = `Code packages: ${packages.map((p) => `${p.label} ${p.version}`).join(' and ')}`;
if (!flag('--run')) {
	console.error(`Without --run nothing is written. With it: each file Maia City doesn't hold yet as a draft file entry, one AIP over them ("${title}").`);
	process.exit(0);
}

const agent = session(device(option('--device')), 'propose-code');
try {
	await agent.open();
	const city = await agent.city();
	// what Maia City holds already: its file entries tagged by a pin
	const found = await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['file'] } } });
	const held = new Set((found.rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted')).flatMap((r) => r.tags ?? []));
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === title && !a.outcome);
	if (open.length && !flag('--again')) throw new Error(`"${title}" is open already (${open.map((a) => a.entry).join(', ')}): nothing was written (--again proposes all the same)`);
	const proposals = [];
	for (const { pack, file, path } of files) {
		if (held.has(`blake3:${file.blake3}`)) {
			console.error(`${pack.id}/${file.name}: Maia City holds it already`);
			continue;
		}
		const media = mediaOf(file.name);
		const tags = ['package', `package:${pack.id}`, `blake3:${file.blake3}`];
		const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: 'file', tags, value: { kind: 'file', title: file.name, media }, draft: true, file: { name: file.name, media } }, path });
		if (!made?.entry || !made?.line) throw new Error(`${file.name}: the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
		proposals.push({ entry: made.entry, line: made.line });
		console.error(`${pack.id}/${file.name}: drafted as ${made.entry}`);
	}
	if (!proposals.length) {
		console.error('Maia City holds every pinned file already: no AIP needed');
		process.exit(0);
	}
	const count = files.length;
	const objective = [
		`/-- Maia City holds every code package file The OS pins (src/lib/code/packages.json). -/`,
		`def files : Metric := metric "Pinned code package files in Maia City" (equals (reading "files") ${count})`,
		''
	].join('\n');
	const note = [
		`The code packages The OS runs on the Mac beside its own code, as Maia City's own files: ${packages.map((p) => `${p.label} ${p.version} (${p.task})`).join('; ')}. The OS brings them only from avenDB.`,
		`Each file is tagged with the BLAKE3 of its bytes and pinned by its publisher's SHA-256 too (src/lib/code/packages.json); The OS unpacks one only when its bytes hash to both. ${proposals.length} of ${count} are new here, ${(files.reduce((s, x) => s + x.file.size, 0) / 1e6).toFixed(0)} MB in all.`
	].join('\n\n');
	const aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title, note, proposals, objective } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'files', value: count - proposals.length, note: 'Maia City before this AIP' } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'files', value: count, note: 'with the drafts of this AIP, each hashed to its pins' } });
	console.log(JSON.stringify({ vault: city.id, proposals, aip }, null, 2));
	console.error(`Opened. An owner puts it forward ("Propose it") and accepts it in the Proposals app: /app/aips/?aip=${aip.entry}`);
} finally {
	agent.close();
}
