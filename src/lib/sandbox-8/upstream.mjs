// @ts-nocheck — plain JS, run by Bun in a terminal
/*
 * SANDBOX 8 FROM ITS UPSTREAM — Constructible City (github.com/MyAvenCEO/constructible-city-3d-prototype) is made in its
 * own repository; this sandbox holds only what its browser game runs: the web client and the simulation packages it
 * loads, its stylesheet and its item models. The research, docs, server, command line and tests stay upstream.
 *
 *   bun src/lib/sandbox-8/upstream.mjs <upstream checkout>
 *
 * It follows every import from the game's two entries (the page and its simulation worker), type-only ones too, and
 * copies what they reach into ./cc at its upstream path, with one change: an import of a simulation package by its
 * name (`@cc/kernel`), and a `declare module '@cc/kernel'` that adds to that package's types, is made the relative path
 * of that package's entry, so the app needs no workspace for them.
 * ./upstream.json records the commit and the files. A copy replaces ./cc whole, so the app's fit of it (the commit
 * after a copy) is applied again on top, e.g. `git diff <fit>^ <fit> -- src/lib/sandbox-8/cc | git apply -3`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const HERE = import.meta.dir;
const CC = join(HERE, 'cc');
const MANIFEST = join(HERE, 'upstream.json');
const UPSTREAM = 'github.com/MyAvenCEO/constructible-city-3d-prototype';
/** what the game starts from: the page and its simulation worker */
const ENTRIES = ['apps/web/src/main.tsx', 'apps/web/src/worker/sim-worker.ts'];
/** what the client's build reads besides its code (apps/web/build.mjs inlines the stylesheet into the page) */
const EXTRA = ['apps/web/src/styles.css'];
/** the npm packages the game may import: the app provides them */
const NPM = /^(three|preact|@preact\/signals)(\/|$)/;
/** an import's specifier, each in its group 2: an import or export statement's `from '…'`, a bare `import '…'`, and
 *  `import('…')` in code and in types (strings and prose that only look like one are not read) */
const SPECIFIERS = [/^\s*(?:import|export)\b[^;]*?\bfrom\s*(['"])([^'"\n]+)\1/gm, /^\s*import\s*(['"])([^'"\n]+)\1/gm, /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g, /^\s*declare\s+module\s+(['"])([^'"\n]+)\1/gm];

const from = process.argv[2];
if (!from || !existsSync(join(from, 'packages/kernel'))) {
	console.error('usage: bun src/lib/sandbox-8/upstream.mjs <constructible-city checkout>');
	process.exit(1);
}
const git = (...args) => execFileSync('git', ['-C', from, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) console.warn(`warning: ${from} has uncommitted changes; ${commit.slice(0, 7)} does not name them`);

/** a simulation package's entry, by its name (each package.json's `exports`) */
const packageEntry = (name) => `packages/${name}/src/index.ts`;
/** where an import leads, as an upstream path, or null for an npm package */
function target(file, spec) {
	const pkg = /^@cc\/([a-z0-9-]+)$/.exec(spec);
	if (pkg) return packageEntry(pkg[1]);
	if (NPM.test(spec)) return null;
	if (!spec.startsWith('.')) throw new Error(`${file}: an import the app does not provide: ${spec}`);
	const base = join(dirname(file), spec);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (existsSync(join(from, candidate)) && !candidate.endsWith('/')) return candidate;
	throw new Error(`${file}: ${spec} is not there`);
}

const files = new Set();
const queue = [...ENTRIES];
while (queue.length) {
	const file = queue.pop();
	if (files.has(file)) continue;
	files.add(file);
	if (!/\.tsx?$/.test(file)) continue;
	const text = readFileSync(join(from, file), 'utf8');
	for (const pattern of SPECIFIERS)
		for (const [, , spec] of text.matchAll(pattern)) {
			const to = target(file, spec);
			if (to && !files.has(to)) queue.push(to);
		}
}
for (const extra of EXTRA) files.add(extra);
const list = [...files].sort();

rmSync(CC, { recursive: true, force: true });
for (const file of list) {
	mkdirSync(dirname(join(CC, file)), { recursive: true });
	let text = readFileSync(join(from, file), 'utf8');
	if (/\.tsx?$/.test(file))
		for (const pattern of SPECIFIERS)
			text = text.replace(pattern, (whole, quote, spec) => {
				const pkg = /^@cc\/([a-z0-9-]+)$/.exec(spec);
				if (!pkg) return whole;
				let rel = relative(dirname(file), packageEntry(pkg[1]));
				if (!rel.startsWith('.')) rel = `./${rel}`;
				return whole.slice(0, whole.lastIndexOf(spec) - 1) + `${quote}${rel}${quote}` + whole.slice(whole.lastIndexOf(spec) + spec.length + 1);
			});
	writeFileSync(join(CC, file), text);
}
writeFileSync(MANIFEST, JSON.stringify({ upstream: UPSTREAM, commit, entries: ENTRIES, files: list }, null, '\t') + '\n');
console.log(`copied ${list.length} files of ${UPSTREAM} at ${commit.slice(0, 7)} into ${CC}`);
