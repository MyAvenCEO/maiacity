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
// the workspace's members, whole (Cargo.toml's members, and the fork store holds)
// and aven/runtimes' file registry, which the Peer takes by path, from the named context `registry`
const whole = ['core', 'db/core', 'store', 'id/core', 'peer/native', 'peer/light', '../runtimes/registry'];
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
	return [...new Set([...fixed, ...whole.flatMap((dir) => walk(join(db2, dir), []))])].sort();
}

// The box's tag first, then one line per file, its path and its content's SHA-256, hashed again
export function peerTag() {
	const lines = peerFiles().map((file) => `${file} ${createHash('sha256').update(readFileSync(join(db2, file))).digest('hex')}\n`);
	return createHash('sha256').update(`box ${boxTag()}\n${lines.join('')}`).digest('hex').slice(0, 16);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(process.argv.includes('--files') ? peerFiles().join('\n') : peerTag());
}
