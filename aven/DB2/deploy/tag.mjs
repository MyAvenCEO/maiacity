// The slim image's tag (PRODUCTION.md, "The slim image"): the first 16 hex digits of a SHA-256 over the box it is
// built in (its tag, sandbox/box/tag.mjs) and every file its build reads: peer.Dockerfile, its .dockerignore, this
// file, avenDB's Cargo.toml and Cargo.lock, every workspace member's sources, and aven/runtimes' file registry's.
// peer.Dockerfile.dockerignore and the named context `registry` admit the same files, and the image workflow (.github/workflows/avenpeer-image.yml) runs when any of them changes. The
// same inputs give the same tag, so an unchanged peer is never built again, and the release sees it didn't change.
//
// `node aven/DB2/deploy/tag.mjs` prints the tag, `--files` the files. Node's own modules only, so it runs on a bare
// runner.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxTag } from '../sandbox/box/tag.mjs';

const db2 = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const fixed = ['deploy/peer.Dockerfile', 'deploy/peer.Dockerfile.dockerignore', 'deploy/tag.mjs', 'Cargo.toml', 'Cargo.lock'];
// The workspace's members, read from Cargo.toml, so a new member is in the tag at once: one list, not two.
export function members() {
	const list = /^members\s*=\s*\[([^\]]*)\]/m.exec(readFileSync(join(db2, 'Cargo.toml'), 'utf8'));
	if (!list) throw new Error('aven/DB2/Cargo.toml has no members list');
	return [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// Cargo loads every workspace member to build any one of them, so the build context must admit each one. A member
// the .dockerignore leaves out fails here, by name, before Docker runs, not as a missing manifest inside the build.
export function unadmitted() {
	const admitted = new Set(
		readFileSync(join(db2, 'deploy/peer.Dockerfile.dockerignore'), 'utf8')
			.split('\n')
			.filter((line) => line.startsWith('!'))
			.map((line) => line.slice(1).trim()),
	);
	return members().filter((member) => !admitted.has(member));
}

// The members, whole, and aven/runtimes' file registry, which the Peer takes by path, from the named context `registry`
const whole = () => {
	const missing = unadmitted();
	if (missing.length) throw new Error(`peer.Dockerfile.dockerignore leaves out workspace members: ${missing.join(', ')}`);
	return [...members(), '../runtimes/registry'];
};
// what the .dockerignore leaves out wherever it is
const skipped = new Set(['target', 'node_modules', '.git', '.lake', 'runs', 'dist', 'deliverables']);

function walk(dir, out) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (skipped.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, out);
		else out.push(relative(db2, path));
	}
	return out;
}

// The build's inputs, sorted, relative to aven/DB2
export function peerFiles() {
	return [...new Set([...fixed, ...whole().flatMap((dir) => walk(join(db2, dir), []))])].sort();
}

// The box's tag first, then one line per file, its path and its content's SHA-256, hashed again
export function peerTag() {
	const lines = peerFiles().map((file) => `${file} ${createHash('sha256').update(readFileSync(join(db2, file))).digest('hex')}\n`);
	return createHash('sha256').update(`box ${boxTag()}\n${lines.join('')}`).digest('hex').slice(0, 16);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(process.argv.includes('--files') ? peerFiles().join('\n') : peerTag());
}
