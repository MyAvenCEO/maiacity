// @ts-nocheck — plain JS, run by Bun in a terminal
/*
 * SANDBOX 8'S PINNED BUILD — Constructible City (github.com/MyAvenCEO/constructible-city-3d-prototype) is made in its
 * own repository, and this app holds none of its code: it runs one build of it, a JavaScript module the Maia City vault
 * keeps as a file entry, pinned here by the BLAKE3 hash of its bytes (./build.json). The page brings it from the
 * person's own avenDB device and runs it only when its bytes hash to the pin (./pinned.js).
 *
 *   bun src/lib/sandbox-8/build.mjs <upstream checkout> [--out <folder>]
 *
 * It takes the upstream's browser client at the commit ./build.json names (a checkout at another commit, or with
 * changes, is refused), applies the app's fit of it (./fit.patch: the client mounts into a root it is given and comes
 * down again, its stylesheet scoped to .cc-city), and builds it as the upstream's own build does (apps/web/build.mjs):
 * the simulation worker bundled on its own and carried as a string, the client (Preact and three.js, at the versions
 * this app's package.json pins) bundled with its stylesheet into one module that exports `mountCity(root, host)`,
 * `host` what the page lends it: the app's render core and screen slots. Then it
 * writes the module to --out (the system's temporary folder by default) and its size and BLAKE3 into ./build.json.
 * The same commit, fit and Bun give the same bytes. A new build reaches the vault only by an AIP
 * (scripts/propose-code.mjs --from <that folder>, its package `sandbox-8` in src/lib/code/packages.json).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const HERE = import.meta.dir;
const PIN = join(HERE, 'build.json');
const CODE = join(HERE, '../code/packages.json');
const pin = JSON.parse(readFileSync(PIN, 'utf8'));

const args = process.argv.slice(2);
const from = args[0] && resolve(args[0]);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : join(tmpdir(), 'maiacity-code'));
if (!from || !existsSync(join(from, 'apps/web/src/main.tsx'))) {
	console.error('usage: bun src/lib/sandbox-8/build.mjs <constructible-city checkout> [--out <folder>]');
	process.exit(1);
}
const git = (...a) => execFileSync('git', ['-C', from, ...a], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
if (commit !== pin.commit) throw new Error(`${from} is at ${commit.slice(0, 7)}, the pin names ${pin.commit.slice(0, 7)}: check out that commit, or change ./build.json's commit first`);
if (git('status', '--porcelain', '--', 'apps/web', 'packages')) throw new Error(`${from} has changes in apps/web or packages, which ${commit.slice(0, 7)} does not name`);

// the upstream's client and packages, fitted, in a folder under this app's node_modules, so that three and Preact
// resolve to the app's own
const work = mkdtempSync(join(HERE, '../../../node_modules/.sandbox-8-'));
try {
	for (const part of ['apps/web', 'packages', 'tsconfig.json']) cpSync(join(from, part), join(work, part), { recursive: true });
	execFileSync('git', ['apply', '--whitespace=nowarn', join(HERE, 'fit.patch')], { cwd: work });

	/** `@cc/<name>` as the upstream's tsconfig maps it: the package's entry */
	const packages = {
		name: 'cc-packages',
		setup(build) {
			build.onResolve({ filter: /^@cc\/[a-z0-9-]+$/ }, ({ path }) => ({ path: join(work, 'packages', path.slice(4), 'src/index.ts') }));
		}
	};
	const common = { target: 'browser', minify: true, plugins: [packages], define: { 'process.env.NODE_ENV': '"production"' }, jsx: { runtime: 'automatic', importSource: 'preact', development: false } };
	const built = async (o) => {
		const r = await Bun.build({ ...common, ...o, define: { ...common.define, ...o.define } });
		if (!r.success) throw new AggregateError(r.logs, 'the build failed');
		return r.outputs[0].text();
	};
	const worker = await built({ entrypoints: [join(work, 'apps/web/src/worker/sim-worker.ts')], format: 'iife' });
	const css = readFileSync(join(work, 'apps/web/src/styles.css'), 'utf8');
	const entry = join(work, 'apps/web/src/sandbox-8.ts');
	writeFileSync(
		entry,
		`import { mountCity as mount } from './main.tsx';
import type { Host } from './host.ts';
const CSS = ${JSON.stringify(css)};
/** Constructible City mounted into \`root\` with what the page lends it (\`host\`), its stylesheet in the page once:
 *  what takes it down again. */
export function mountCity(root: HTMLElement, host: Host): () => void {
  if (!document.getElementById('cc-city-style')) {
    const style = document.createElement('style');
    style.id = 'cc-city-style';
    style.textContent = CSS;
    document.head.append(style);
  }
  return mount(root, host);
}
`
	);
	const module = await built({
		entrypoints: [entry],
		format: 'esm',
		define: { __WORKER_SOURCE__: JSON.stringify(worker), __REMOTE__: 'false', __BUILD_TIME__: JSON.stringify(git('show', '-s', '--format=%cI', commit)) }
	});
	const bytes = new TextEncoder().encode(module);
	const hash = bytesToHex(blake3(bytes));
	const name = `constructible-city-${commit.slice(0, 7)}.js`;
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, name), bytes);
	writeFileSync(join(out, hash), bytes);
	pin.file = { name, size: bytes.length, blake3: hash };
	pin.bun = Bun.version;
	writeFileSync(PIN, `${JSON.stringify(pin, null, '\t')}\n`);
	// the code package the vault keeps it as (scripts/propose-code.mjs)
	const code = JSON.parse(readFileSync(CODE, 'utf8'));
	const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
	const files = [{ name, os: 'web', arch: 'any', source: `${pin.upstream}@${commit}`, size: bytes.length, sha256, blake3: hash }];
	const entryOf = { id: 'sandbox-8', label: 'Constructible City', task: "Sandbox 8's game", version: commit.slice(0, 7), note: `The browser client of ${pin.upstream} at ${commit.slice(0, 7)}, with the app's fit (src/lib/sandbox-8/fit.patch), built by src/lib/sandbox-8/build.mjs with Bun ${Bun.version}. The Sandbox 8 page runs it only when its bytes hash to its pin.`, files };
	code.packages = [...code.packages.filter((p) => p.id !== 'sandbox-8'), entryOf];
	writeFileSync(CODE, `${JSON.stringify(code, null, '\t')}\n`);
	console.log(`built ${name}: ${(bytes.length / 1e6).toFixed(2)} MB, BLAKE3 ${hash}, in ${out}`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
