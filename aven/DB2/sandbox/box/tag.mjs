// The box's tag (SANDBOX.md, "The box"): the first 16 hex digits of a SHA-256 over every file the image's build reads,
// so every checkout runs exactly its own box. The same files make the build's context: the Dockerfile, deps.sh and
// .dockerignore, avenDB's Cargo.toml and Cargo.lock, and every crate's Cargo.toml. aven/DB2/.dockerignore admits the
// same files, and the image workflow (.github/workflows/avensandbox-image.yml) runs when any of them changes.
//
// `up.mjs` imports it; the workflows run it with node: `node aven/DB2/sandbox/box/tag.mjs` prints the tag, `--files`
// the files. Node's and bun's own modules only, so it runs on a bare runner.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const db2 = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
// aven/runtimes' file registry's manifest, which the Peers take by path, comes in as the named context `registry`
const fixed = ['sandbox/box/Dockerfile', 'sandbox/box/deps.sh', 'sandbox/box/tag.mjs', '.dockerignore', 'Cargo.toml', 'Cargo.lock',
	'../runtimes/registry/Cargo.toml'];
const whole = [];
// what .dockerignore leaves out wherever it is
const skipped = new Set(['target', 'node_modules', '.git', '.lake', 'runs', 'dist', 'deliverables']);

function walk(dir, keep, out) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (skipped.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, keep, out);
		else if (keep(path)) out.push(relative(db2, path));
	}
	return out;
}

// The build's inputs, sorted, relative to aven/DB2
export function boxFiles() {
	const manifests = walk(db2, (path) => path.endsWith('/Cargo.toml'), []);
	const sources = whole.flatMap((dir) => walk(join(db2, dir), () => true, []));
	return [...new Set([...fixed, ...manifests, ...sources])].sort();
}

// One line per file, its path and its content's SHA-256, hashed again
export function boxTag() {
	const lines = boxFiles().map((file) => `${file} ${createHash('sha256').update(readFileSync(join(db2, file))).digest('hex')}\n`);
	return createHash('sha256').update(lines.join('')).digest('hex').slice(0, 16);
}

// The tools alone, the Dockerfile's hash: a box whose crates are older than the checkout's still has the right tools,
// and the build folder compiles what changed (up.mjs, when the checkout's own box isn't published yet)
export function toolsTag() {
	return createHash('sha256').update(readFileSync(join(db2, 'sandbox/box/Dockerfile'))).digest('hex').slice(0, 16);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(process.argv.includes('--files') ? boxFiles().join('\n') : process.argv.includes('--tools') ? toolsTag() : boxTag());
}
