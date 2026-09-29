// Build the site as a pinned film build: vite build, then a hash of every file it wrote, and build/film-build.json
// ({ commit, hash, built }) so film mode knows which build it is (__film.build) — then a tar of it all to store in
// the vault (see site.mjs for how the worker gets it back).
//
//   node scripts/film/world/build.mjs [--skip-build] [--out build]
//
// A build from a checkout with uncommitted changes is refused: its commit would not say what it is.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'build');
const git = (/** @type {string[]} */ a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
if (git(['status', '--porcelain', '--untracked-files=no']) && !args.includes('--dirty')) throw new Error('uncommitted changes: commit first (or --dirty for a build that is never stored)');
const commit = git(['rev-parse', 'HEAD']);
if (!args.includes('--skip-build')) execFileSync('npx', ['vite', 'build'], { stdio: 'inherit' });

/** every file under dir, sorted, as paths relative to it */
const files = (/** @type {string} */ dir) => {
	/** @type {string[]} */
	const all = [];
	const walk = (/** @type {string} */ d) => {
		for (const e of readdirSync(d)) {
			const p = join(d, e);
			if (statSync(p).isDirectory()) walk(p);
			else all.push(relative(dir, p));
		}
	};
	walk(dir);
	return all.filter((f) => f !== 'film-build.json').sort();
};
const h = createHash('sha256');
for (const f of files(out)) h.update(f).update('\0').update(readFileSync(join(out, f))).update('\0');
const hash = h.digest('hex');
writeFileSync(join(out, 'film-build.json'), JSON.stringify({ commit, hash, built: new Date().toISOString() }, null, 2));
mkdirSync('studio/builds', { recursive: true });
const tar = resolve('studio/builds', `site-${hash.slice(0, 16)}.tar`);
execFileSync('tar', ['-cf', tar, '-C', out, '.']);
console.log(`build ${commit.slice(0, 9)} · ${hash.slice(0, 16)} → ${tar}\nstore it: bun media add ${relative(process.cwd(), tar)}  (its hash is the build's file)`);
