// The release record (PEERS.md §7, `Aven.ID.Release`): one per release of avenOS, written into its build as
// `/release.json` and published beside the release. It names the release's version and its order, the wire version it
// speaks, every file of avenOS's build with its SHA-256 and the build's hash over them (`osHash`: the files listed as
// `sha256sum` lists them, by path, hashed), and the SHA-256 of the Peer's binary per platform. `release.json` itself is
// not among the files. It carries no signature: who signs releases is A15's open question (PEERS.md, "The release
// record's signers"), and until it is answered a device checks a record's hashes only and says it is unsigned.
//
//   node aven/DB2/deploy/release.mjs DIR VERSION [PLATFORM=SHA256 ...]
//
// DIR is avenOS's build, unpacked; VERSION its dated version, the tag's (`@aven/os@26.10.31`, then 26.10.31v2, ...),
// which orders the records: the counter is the version's order (`order`); each PLATFORM=SHA256 the Peer's binary on
// that platform (linux/amd64=…). The wire version is the model's (db/spec/vectors/upgrades.json), which the Rust and
// the Peer-Light speak too. Node's own modules only, so it runs on a bare runner.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isHash = (s) => /^[0-9a-f]{64}$/.test(s);

// the wire version this build speaks: the model's, where the connection carries on
export function wireVersion() {
	const vectors = JSON.parse(readFileSync(join(here, '../db/spec/vectors/upgrades.json'), 'utf8'));
	const same = vectors.find((v) => v.expected.answer === null);
	return same.input.mine;
}

// a dated version's place among them: 26.10.31 is 2610310001, 26.10.31v2 2610310002, as `next` in avensandbox.yml
// numbers a day's releases
export function order(version) {
	const v = /^(\d{2})\.(\d{2})\.(\d{2})(?:v(\d+))?$/.exec(version);
	if (!v || Number(v[4] ?? 1) > 9999) throw new Error(`not a dated version: ${version}`);
	return Number(`${v[1]}${v[2]}${v[3]}`) * 10_000 + Number(v[4] ?? 1);
}

// paths compared by code point, as Lean's and Rust's strings are
const byPath = (a, b) => {
	const [x, y] = [[...a.path], [...b.path]];
	for (let i = 0; i < Math.min(x.length, y.length); i++)
		if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
	return x.length - y.length;
};

// `Aven.ID.Release.listing` and `osHash`
export const listing = (files) => [...files].sort(byPath).map((f) => `${f.sha256}  ${f.path}\n`).join('');
export const osHash = (files) => sha256(Buffer.from(listing(files), 'utf8'));

function walk(dir, root = dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, root, out);
		else out.push(`/${relative(root, path).split(sep).join('/')}`);
	}
	return out;
}

export function record(dir, version, counter, peer) {
	const files = walk(dir)
		.filter((path) => path !== '/release.json')
		.map((path) => ({ path, sha256: sha256(readFileSync(join(dir, path))) }))
		.sort(byPath);
	for (const [platform, hash] of Object.entries(peer))
		if (!platform || !isHash(hash)) throw new Error(`the Peer's hash for ${platform || '(no platform)'} is not a SHA-256: ${hash}`);
	if (!version) throw new Error('a release names its version');
	if (!Number.isSafeInteger(counter) || counter < 0) throw new Error(`the counter is not a number: ${counter}`);
	return { record: 'aven/release/1', version, counter, wire: wireVersion(), os: osHash(files), files, peer };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
	const [dir, version, ...platforms] = process.argv.slice(2);
	if (!dir || !version) {
		console.error('usage: node aven/DB2/deploy/release.mjs DIR VERSION [PLATFORM=SHA256 ...]');
		process.exit(2);
	}
	const peer = Object.fromEntries(platforms.map((p) => p.split('=')));
	const made = record(dir, version, order(version), peer);
	writeFileSync(join(dir, 'release.json'), `${JSON.stringify(made)}\n`);
	console.log(`release.json: avenOS ${made.version}, wire ${made.wire}, ${made.files.length} files, os ${made.os}`);
}
