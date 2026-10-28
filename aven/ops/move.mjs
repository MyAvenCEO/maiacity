#!/usr/bin/env bun
// The stage 2 move, made once: the repo's folders into aven/, maia/ and theos/ by the one map (aven/ops/paths.json
// `moves`), every reference kept pointing at the same file. It goes before the one PR, together with `moves`.
//
//   bun aven/ops/move.mjs --plan          what --aliases and --move would change, by file and line; changes nothing
//   bun aven/ops/move.mjs --aliases       commit 1: each $lib import of a folder that leaves the site onto its new
//                                         alias (paths.json `after.aliases`, pointing at today's folders until the move)
//   bun aven/ops/move.mjs --move          commit 2: every folder to its new place, then every relative import and every
//                                         path written as text, and paths.json's places to `after`
//   bun aven/ops/move.mjs --check         the cut-over's search: fails on any old path still named in the tree
//   bun aven/ops/move.mjs --fix [<merge>] right after a merge (HEAD) of a branch started before the move, either way round:
//                                         the files it added moved too, and the old paths in the lines it wrote rewritten
//
// A reference is rewritten only when it names a file or folder the repo holds: imports (relative or $lib), Rust
// include_str! and Cargo paths, and every path in text (comments, docs, JSON, TOML, YAML, shell). A path relative to its
// file is kept relative; one written from the repo's root stays so. What only a person can move (path patterns in
// regular expressions, Dockerfiles' paths in the image, a folder named without a slash) --check finds and names.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const { dirname, join, normalize, relative } = posix;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MAP = 'aven/ops/paths.json';
const paths = JSON.parse(readFileSync(ROOT + MAP, 'utf8'));
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const listed = () => git('ls-files', '-z').split('\0').filter(Boolean);

// longest old prefix first; a rule ending in / moves a folder, any other one file
const RULES = Object.entries(paths.moves).sort((a, b) => b[0].length - a[0].length);
const BACK = RULES.map(([o, n]) => [n, o]).sort((a, b) => b[0].length - a[0].length);
function by(rules, p) {
	for (const [from, to] of rules) {
		if (from.endsWith('/') ? p.startsWith(from) : p === from) return to + p.slice(from.length);
		if (p + '/' === from) return to.slice(0, -1);
	}
	return p;
}
export const moved = (p) => by(RULES, p);
const unmoved = (p) => by(BACK, p);

// what is never rewritten: vault content and the frozen and generated files kept beside it, vendored and upstream
// copies, test vectors, lockfiles, evidence records; and this tool and its map, which name the old paths on purpose
const NEVER = [
	/^avendb\/vendor\//, /^static\/engines\//, /^code\//, /^avendb\/spec\/vectors\//,
	/^docs\/evidence\//, /(^|\/)(bun|Cargo)\.lock$/,
	/^src\/lib\/models\/models\.json$/, /^src\/lib\/sandbox\/engines\.json$/,
	/^api\/src\/migrations-list\.ts$/, /^aven\/ops\/(paths\.json|move\.mjs)$/
];
// what a person read and keeps as written, by the file before the move: a folder named in general (an adapted skill's
// own scripts/ or tests/, another project's src/, a crate's src/ and tests/), a name that is no path of ours (the store's
// OPFS folder avendb/<name>/, a vault's key game/<id>, a page's route stories/<id>, a module's own folder in a pattern),
// the made-up paths of a test of globs
const KEEP = {
	'.claude/agents/fp-poc-builder.md': ['tests/'],
	'.claude/skills/diff-review/methodology.md': ['src/'],
	'.claude/skills/factory-skill/SOURCE.md': ['scripts/'],
	'.claude/skills/machine-skill/README.md': ['scripts/'],
	'.claude/skills/machine-skill/SOURCE.md': ['scripts/'],
	'scripts/ci/gate.test.mjs': ['src/*.js', 'src/lib/x.js'],
	'scripts/devx/check.mjs': ['src/', 'tests/'],
	'src/lib/aven-city/index.ts': ['src/'],
	'src/lib/avendb/seed.js': ['game/'],
	'src/lib/avendb/Shell.svelte': ['stories/'],
	'src/lib/avendb/SparkCanvas.svelte': ['stories/'],
	'src/lib/avendb/Story.svelte': ['stories/'],
	'src/lib/assets/sources/avendb.test.js': ['sources/'],
	'avendb/crates/avendb-browser/js/store.worker.js': ['avendb/'],
	'src/lib/avendb/device/store.worker.js': ['avendb/']
};
// what a person rewrites right after --move, in the same commit: path patterns written as code (the test suites' and
// the checks' folders, a test's walk of the folders it reads), and names the tool reads two ways (avendb/ in src/lib/:
// the page's folder or avenDB's; code/ in it: the kernel's or the repo's code entries)
const HAND = {
	'scripts/ci/suites.json': ['src/', 'scripts/', 'src/lib/sandbox-7/'],
	'src/lib/assets/vault.test.js': ['scripts/'],
	'src/lib/assets/worlds.test.js': ['src/lib'],
	'src/lib/assets/sources/avendb.test.js': ['avendb/'],
	'src/lib/avendb/op-names.js': ['avendb/'],
	'src/lib/avendb/seed.js': ['code/']
};
// the files that run on the always-on peer's host or lay out its folder ($APP_DIR: the compose files beside deploy/ and
// site/): a path in them inside deploy/ is that folder's, which the release keeps as it is, so it stays as written
const HOST = /^(deploy\/(?!check-avendb\.test\.js$|OWNERSHIP\.md$)|docker-compose\.prod\.yml$)/;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|svgz|wasm|glb|bin|ttf|otf|woff2?|mp3|mp4|m4a|aac|wav|ogg|flac|mov|webm|pdf|zip|gz|tgz|zst|onnx|lock|der|p12|tsv)$/i;
const IGNORES = /(^|\/)\.(gitignore|dockerignore)$/;
const CODE = /\.(m?[jt]s|cjs|svelte|rs|py|sh)$/;

/**
 * The tree as it was before the move: its files, every folder that holds one, and whether git ignores a place none of
 * them is in (`ignored`, by the tree's own ignore files unless given)
 */
function treeOf(files, ignored = null) {
	const set = new Set(files), dirs = new Set(['']);
	for (const f of files) for (let d = dirname(f); d !== '.' && !dirs.has(d); d = dirname(d)) dirs.add(d);
	const tree = { set, dirs };
	tree.ignored = ignored ?? ignoredIn(tree);
	return tree;
}
/**
 * Whether `p` is a place git ignores by its name (a build's folder, a cache, an .env) or in one, by the .gitignore files
 * of `tree` as they are on the disk, read as git reads them: a file's patterns hold under its folder, a deeper file's
 * after a higher one's, the last pattern that matches decides, and nothing in a folder git ignores comes back. What a
 * pattern with a wildcard ignores (each .mp4 under static/, all of /studio/) is a kind of file, no one place a name
 * points to.
 */
function ignoredIn(tree) {
	let rules;
	const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	const read = () => [...tree.set].filter((f) => /(^|\/)\.gitignore$/.test(f)).sort((a, b) => a.split('/').length - b.split('/').length).flatMap((f) => {
		const base = clean(dirname(f));
		return (textOf(f) ?? '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l && !l.startsWith('#')).map((l) => {
			const not = l.startsWith('!'), pat = l.slice(not ? 1 : 0).replace(/\/$/, '');
			const glob = esc(pat.replace(/^\//, '')).replace(/\*\*\//g, '\0').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\0/g, '(?:.*/)?');
			return { not, named: !/[*?[]/.test(pat), re: new RegExp('^' + (base ? esc(base) + '/' : '') + (pat.includes('/') ? '' : '(?:.*/)?') + glob + '$') };
		});
	});
	return (p) => {
		rules ??= read();
		const parts = p.split('/');
		for (let i = 1; i <= parts.length; i++) {
			const q = parts.slice(0, i).join('/');
			let last = null;
			for (const r of rules) if (r.re.test(q)) last = r;
			if (last && !last.not) return last.named;
		}
		return false;
	};
}
/**
 * The text of every frozen bundle the repo builds: each kernel engine as it freezes, each asset's recipe library. A name
 * in one of them is that bundle's bytes (a credit line of a recipe naming the file it came from), which a rebuild must
 * keep, so it stays as written, however old the place it names. The bundlers are read from where they are now.
 */
async function frozenTexts() {
	// the bundlers read tsconfig.json, which extends the one svelte-kit writes (`bun install` writes it too)
	if (!existsSync(ROOT + '.svelte-kit/tsconfig.json')) throw new Error('run `bunx svelte-kit sync` first: the bundlers read .svelte-kit/tsconfig.json');
	const at = (p) => ROOT + (existsSync(ROOT + p) ? p : moved(p));
	const { SOURCES, bundleOf } = await import(at('src/lib/sandbox/bundle.js'));
	const { bundleRecipes } = await import(at('src/lib/assets/box/plugin.js'));
	const parts = [];
	for (const kind of [...Object.keys(SOURCES), 'box']) parts.push((await bundleOf(kind)).code);
	parts.push(...Object.values((await bundleRecipes()).libraries));
	// each run of path characters in them, as the references are read (a trailing . or $ cut off too), and the text
	const runs = new Set(), text = parts.join('\n');
	for (const t of text.match(/[\w.\-@$+*%~/]+/g) ?? []) if (t.includes('/')) runs.add(t).add(t.replace(/[.$]+$/, ''));
	return { runs, text };
}
/**
 * Whether the name at `at` in `text` is a frozen bundle's: its run is in one, and so is what stands around it in its
 * string (up to the quotes, a line at most, 24 characters each way), as a minifier keeps a string's text as it is. The
 * same name in a comment beside it is no bundle's.
 */
function isFrozen(frozen, text, at, t) {
	if (!frozen?.runs.has(t)) return false;
	const start = text.lastIndexOf('\n', at - 1) + 1, nl = text.indexOf('\n', at), end = nl < 0 ? text.length : nl;
	let a = at, b = at + t.length;
	while (a > start && at - a < 24 && !/['"`]/.test(text[a - 1])) a--;
	while (b < end && b - at - t.length < 24 && !/['"`]/.test(text[b])) b++;
	// an import's name never reaches a bundle: the bundler reads the module it names instead
	if (a === at && /['"`]/.test(text[a - 1]) && /\b(from|import)\s*\(?\s*$/.test(text.slice(start, a - 1))) return false;
	return frozen.text.includes(text.slice(a, b));
}
const PROBE = ['.js', '.ts', '.mjs', '.svelte', '.json', '.svelte.js', '.svelte.ts', '/index.js', '/index.ts', '/index.mjs'];
const clean = (p) => (p === '.' ? '' : p.replace(/\/$/, ''));
function find(tree, p, { probe, strict, open }) {
	open &&= !p.endsWith('/');
	p = clean(normalize(p));
	if (p.startsWith('..')) return null;
	if (tree.set.has(p)) return { path: p, cut: '' };
	if (!strict && tree.dirs.has(p)) return { path: p, cut: '', dir: true };
	if (probe) for (const e of PROBE) if (tree.set.has(p + e)) return { path: p + e, cut: e };
	const star = p.indexOf('*');
	if (star >= 0) {
		const head = p.slice(0, star).replace(/[^/]*$/, '').replace(/\/$/, '');
		if (tree.dirs.has(head) && head.split('/').length >= (strict ? 2 : 1)) return { path: head, cut: '', dir: true, rest: p.slice(head.length) };
	}
	if (strict && tree.dirs.has(p) && p.split('/').length >= 2) return { path: p, cut: '', dir: true };
	// a name that goes on past a template's or a text's placeholder (static/engines/view-v${v}.js, …/engine-v<n>.js): the
	// folder whose files begin so, as the glob view-v*
	const head = dirname(p);
	if (open && head !== '.' && tree.dirs.has(head) && head.split('/').length >= (strict ? 2 : 1) && [...tree.set].some((f) => f.startsWith(p)))
		return { path: head, cut: '', dir: true, rest: p.slice(head.length), glob: p.slice(head.length) + '*' };
	// a place git ignores (avendb/target/, a build's or a cache's) in a folder of the tree, which the move takes with it
	let d = head;
	while (d !== '.' && !tree.dirs.has(d)) d = dirname(d);
	if (d !== '.' && tree.ignored(p)) return { path: d, cut: '', dir: true, rest: p.slice(d.length) };
	return null;
}
/** whether the move keeps the folder `d` whole: every file in it goes to the same place under moved(d) */
function whole(tree, d) {
	tree.whole ??= new Map();
	if (!tree.whole.has(d)) {
		const to = moved(d);
		tree.whole.set(d, [...tree.set].every((f) => !f.startsWith(d + '/') || moved(f) === to + f.slice(d.length)));
	}
	return tree.whole.get(d);
}
/**
 * Where the move takes the files the folder `head` holds, or those the glob `head` + `rest` names (src/lib/sandbox-*, a
 * folder's .ts files at any depth): the folder that takes the place of `head` for the most of them, under the same names,
 * and the share of them that goes there
 */
function placeOf(tree, head, rest = '') {
	tree.places ??= new Map();
	const key = head + '\0' + rest;
	if (!tree.places.has(key)) {
		const glob = rest && new RegExp('^' + rest.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '(?:.*/)?') + '(?:/|$)');
		const count = new Map();
		let n = 0;
		for (const f of tree.set) {
			const tail = f.slice(head.length);
			if (!f.startsWith(head + '/') || (glob && !glob.test(tail))) continue;
			const now = moved(f), there = now.endsWith(tail) ? now.slice(0, -tail.length) : null;
			count.set(there, (count.get(there) ?? 0) + 1);
			n++;
		}
		const [to, most] = [...count].sort((a, b) => b[1] - a[1])[0] ?? [moved(head), 0];
		tree.places.set(key, { to, share: n ? most / n : 1 });
	}
	return tree.places.get(key);
}
/**
 * The places a file finds from its own, by dots alone: new URL(T, import.meta.url) (T a string, or a template that
 * starts with the dots), join or resolve(import.meta.dir, T), Python's Path(__file__).parents[N], the shell's
 * "$(dirname "$0")/T", and Rust's Path::new(env!("CARGO_MANIFEST_DIR")).join(T), which is found from the crate's folder
 * (`base`). Each with the folder it names, from the file's.
 */
function anchors(file, text, crate = null) {
	const out = [], dots = String.raw`(\.{1,2}(?:\/\.\.)*\/?)`;
	const here = String.raw`(?:import\.meta\.(?:dir|dirname)|__dirname|dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)|fileURLToPath\(\s*new URL\(\s*(['"\`])\.\/?\1\s*,\s*import\.meta\.url\s*\)\s*\))`;
	const js = [
		new RegExp(String.raw`new URL\(\s*(['"\`])${dots}\1\s*,\s*import\.meta\.url\s*\)`, 'dg'),
		new RegExp(String.raw`new URL\(\s*\`${dots}\$\{[^\`]*\`\s*,\s*import\.meta\.url\s*\)`, 'dg'),
		new RegExp(String.raw`(?:join|resolve)\(\s*${here}\s*,\s*(['"\`])${dots}\2`, 'dg')
	];
	const write = (up) => (r) => r || (up.endsWith('/') ? './' : '.');
	if (/\.(m?[jt]s|cjs|svelte)$/.test(file)) for (const re of js) for (const m of text.matchAll(re)) {
		const [at] = m.indices[m.length - 1], up = m[m.length - 1];
		out.push({ at, from: up, up, write: write(up) });
	}
	if (file.endsWith('.rs') && crate) for (const m of text.matchAll(new RegExp(String.raw`env!\(\s*"CARGO_MANIFEST_DIR"\s*\)\s*\)\s*\.join\(\s*"${dots}"`, 'dg'))) {
		const [at] = m.indices[1], up = m[1];
		out.push({ at, from: up, up, base: crate, write: write(up) });
	}
	if (file.endsWith('.py')) for (const m of text.matchAll(/Path\(__file__\)(?:\.resolve\(\))?\.parents\[(\d+)\]/g)) {
		const at = m.index + m[0].length - m[1].length - 1;
		out.push({ at, from: m[1], up: Array(+m[1]).fill('..').join('/') || '.', py: true });
	}
	if (file.endsWith('.sh')) for (const m of text.matchAll(/\$\(dirname\s+"?\$0"?\)\/(\.\.(?:\/\.\.)*)/g)) {
		out.push({ at: m.index + m[0].length - m[1].length, from: m[1], up: m[1], write: (r) => r });
	}
	return out;
}
function crateOf(tree, file) {
	for (let d = dirname(file); d !== '.'; d = dirname(d)) if (tree.set.has(d + '/Cargo.toml')) return d;
	return null;
}
/** the line of `text` that holds the character at `i` */
const lineAt = (text, i) => text.slice(text.lastIndexOf('\n', i - 1) + 1, (text.indexOf('\n', i) + 1 || text.length + 1) - 1);
const ancestors = (d) => { const out = []; for (; d !== '.' && d !== ''; d = dirname(d)) out.push(d); return [...out, '']; };
const dotted = (p) => (p.startsWith('../') || p === '..' ? p : './' + p);
/** `to` as seen from the folder `from` ('' or '.' is the root), a trailing / kept */
const rel = (from, to) => (from === '.' || from === '' ? to : relative(from, to) + (to.endsWith('/') ? '/' : ''));

/**
 * The references in `text`, the file `file` of `tree`: every run of path characters that names a file or folder of the
 * tree, how it names it (`kind`: by an alias of `aliases`, from the file's folder, from the root, or bare) and the folder
 * it is read from (`found.base`). With `misses`, each run that reads as a path and names nothing in the tree goes there.
 */
function refsIn(file, text, tree, { aliases, aliasesOnly = false, misses = null }) {
	const refs = [], own = clean(dirname(file));
	const rust = file.endsWith('.rs'), cargoConf = /(^|\/)\.cargo\/config\.toml$/.test(file), js = /\.(m?[jt]s|cjs|svelte)$/.test(file);
	const crate = rust ? crateOf(tree, file) : null;
	// a shell script that goes to a folder of its own first (cd "$(dirname "$0")/..") reads its paths from there
	const cds = file.endsWith('.sh') ? anchors(file, text).map((a) => clean(normalize(join(own, a.up)))) : [];
	for (const m of text.matchAll(/[\w.\-@$+*%~/]+/g)) {
		let t = m[0], at = m.index;
		const before = text[m.index - 1] ?? '', next = text[m.index + t.length] ?? '';
		// a URL's own part (after a scheme's :, a page's # or an escape) is no path
		if (before === ':' || before === '#' || before === '\\' || t.startsWith('//')) continue;
		// a name that goes on past a placeholder: a template's ${…}, a text's <n> or {n}
		const open = next === '{' || next === '<';
		if (t.endsWith('$') && next === '{') t = t.slice(0, -1);
		// a folder at the tree's top named whole between a template's placeholders (`${ROOT}static${path}`) is a path's part
		const between = before === '}' && m[0].endsWith('$') && next === '{' && t !== '' && tree.dirs.has(t);
		t = t.replace(/\.+$/, '');
		// dots alone are a place only where a file finds one from its own (the anchors below)
		if ((!t.includes('/') && !between) || t === '/' || /^\.{1,2}(\/\.{1,2})*\/?$/.test(t)) continue;
		// a glob names its folder before its first *: '*/' ending a comment or '*180/Math.PI' is none
		if (t.includes('*') && t.indexOf('*') < t.indexOf('/')) continue;
		const quoted = /['"`]/.test(before);
		let found = null, kind;
		const alias = Object.keys(aliases).find((a) => t.startsWith(a + '/'));
		if (alias) {
			kind = 'alias';
			found = find(tree, aliases[alias] + t.slice(alias.length), { probe: true, open });
		} else {
			if (aliasesOnly) continue;
			// a shell's variable that holds a folder ($repo/avendb/vendor): the rest, read from the root as ${repo}/… is
			if (!js && !rust && /^\$\w+\//.test(t)) { const v = t.indexOf('/'); at += v; t = t.slice(v); }
			if (t.startsWith('./') || t.startsWith('../')) {
				kind = 'relative';
				const bases = [dirname(file), ...cds];
				if (crate) bases.push(crate);
				if (cargoConf) bases.push(dirname(dirname(file)));
				// a script, a doc or a config file may name a place from the repo's root with ./ too
				if (!js && !rust) bases.push('');
				for (const b of bases) if ((found = find(tree, join(b, t), { probe: quoted || js, open }))) { found.base = b; break; }
			} else if (crate && t.startsWith('/') && /CARGO_MANIFEST_DIR/.test(lineAt(text, m.index))) {
				// a path put after the crate's folder: concat!(env!("CARGO_MANIFEST_DIR"), "/../x"), format!("{}/x", …)
				kind = 'crate';
				found = find(tree, join(crate, t), { probe: false, open });
				if (found) found.base = crate;
			} else if (t.startsWith('/')) {
				kind = 'root';
				found = find(tree, t.slice(1), { strict: true, open });
				if (found) found.base = '';
			} else {
				kind = 'bare';
				for (const b of ancestors(dirname(file))) if ((found = find(tree, join(b, t), { probe: quoted && js, open }))) { found.base = b; break; }
			}
			if (found && HOST.test(file) && (found.path === 'deploy' || found.path.startsWith('deploy/'))) continue;
		}
		if (found) refs.push({ at, t, kind, found, quoted });
		else if (misses && kind) misses.push({ at, t, kind });
	}
	return refs;
}

/**
 * Every rewrite one file needs: `file` is where it sits before the move, `to` where it goes, `tree` the tree before.
 * @returns {{ at: number, from: string, to: string, why: string }[]}
 */
export function rewrites(file, to, text, tree, { aliasesOnly = false, frozen = null, fix = false } = {}) {
	const out = [];
	const after = paths.after ?? paths;
	const libNow = (paths.after ? paths.site : after.site) + '/lib';
	const finals = [['$lib', after.site + '/lib'], ...Object.entries(after.aliases)].sort((a, b) => b[1].length - a[1].length);
	// the aliases `text` was written with: today's, or $lib alone as it was before the move, for a branch's own lines (--fix)
	const nowAlias = fix ? { $lib: unmoved(after.site + '/lib') } : { $lib: libNow, ...paths.aliases };
	const js = /\.(m?[jt]s|cjs|svelte)$/.test(file), rust = file.endsWith('.rs'), crate = rust ? crateOf(tree, file) : null;
	if (IGNORES.test(file)) {
		if (aliasesOnly) return out;
		// an ignore file's patterns that name a place (git: one with a / before its end; docker: every one, from the
		// build's folder), each moved as its place moves, written from where the ignore file itself goes
		const docker = file.endsWith('.dockerignore'), base = dirname(file) === '.' ? '' : dirname(file);
		let at = 0;
		for (const line of text.split('\n')) {
			const m = /^(!?)(\/?)([^#\s!][^\s]*)$/.exec(line);
			if (m && (docker || m[2] || /\/./.test(m[3]))) {
				const full = join(base, m[3]), now = moved(full);
				const line_ = m[1] + m[2] + rel(dirname(to), now) + (m[3].endsWith('/') && !now.endsWith('/') ? '/' : '');
				if (now !== full && line_ !== line) out.push({ at, from: line, to: line_, why: 'ignore' });
			}
			at += line.length + 1;
		}
	}
	// an ignore file's comments are text like any other, read below; its patterns are moved above
	const prose = (at) => !IGNORES.test(file) || /^\s*#/.test(lineAt(text, at));
	const refs = refsIn(file, text, tree, { aliases: nowAlias, aliasesOnly }).filter((r) => prose(r.at)), own = clean(dirname(file));

	// the folder a name is read from, after the move: the root stays the root, the file's own folder goes with the
	// file, a folder the move keeps whole goes where it goes, and one it splits (src/lib/) goes where every name this file
	// reads from it went, when they all went to one place (plants/ and models/ read from src/lib/, into maia/content/)
	const split = new Map();
	for (const { kind, found } of refs) {
		const b = found.base;
		if (kind !== 'bare' || b === '' || b === own || whole(tree, b)) continue;
		const s = relative(b, clean(found.path)), now = clean(moved(found.path));
		const there = now === s ? '' : now.endsWith('/' + s) ? now.slice(0, -s.length - 1) : null;
		split.set(b, split.has(b) && split.get(b) !== there ? null : there);
	}
	const after_ = (b) => (b === '' ? '' : b === own ? clean(dirname(to)) : whole(tree, b) ? moved(b) : split.get(b) ?? null);

	// a place found from the file's own by dots alone: the same folder, seen from where the file goes
	if (!aliasesOnly && !HOST.test(file)) for (const a of anchors(file, text, crate)) {
		const d = clean(normalize(join(a.base ?? own, a.up)));
		if (d.startsWith('..')) continue;
		const there = after_(d), base = a.base ? after_(a.base) : clean(dirname(to));
		if (there == null || base == null) { out.push({ at: a.at, from: a.from, to: a.from, why: `SPLIT: ${a.from} names ${d}/, which the move splits` }); continue; }
		const r = relative(base, there);
		let written;
		if (a.py) {
			if (r && !/^\.\.(\/\.\.)*$/.test(r)) { out.push({ at: a.at, from: a.from, to: a.from, why: `NOT ABOVE: ${d}/ is not above ${to}` }); continue; }
			written = String(r ? r.split('/').length : 0);
		} else written = a.write(r) + (a.from.endsWith('/') && r && !r.endsWith('/') ? '/' : '');
		if (written !== a.from) out.push({ at: a.at, from: a.from, to: written, why: 'anchor' });
	}

	for (const { at, t, kind, found, quoted } of refs) {
		// a folder whose files the move sends to different places, or a glob, is named where nearly all of them go
		// (game/, but its engines.js; src/lib/sandbox-*, but sandbox-7's docs), marked so; else it has no one new name
		let target = moved(found.path);
		if (kind !== 'alias' && found.dir && (found.rest || !whole(tree, found.path))) {
			const { to, share } = placeOf(tree, found.path, found.glob ?? found.rest);
			if (to == null || share < 0.9) { out.push({ at, from: t, to: t, why: `SPLIT: what ${t} names goes to different places` }); continue; }
			if (share < 1) out.push({ at, from: t, to: t, why: 'split' });
			target = to;
		}
		// the same place after the move, written the way the reference was
		const next_ = target.slice(0, target.length - found.cut.length) + (found.rest ?? '');
		let written;
		if (kind === 'alias') {
			const [name, dir] = finals.find(([, d]) => next_ === d || next_.startsWith(d + '/')) ?? [];
			if (!name) { out.push({ at, from: t, to: t, why: 'NO ALIAS for ' + next_ }); continue; }
			written = name + next_.slice(dir.length);
			if (!fix && nowAlias[name] + next_.slice(dir.length) !== found.path.slice(0, found.path.length - found.cut.length) + (found.rest ?? '')) {
				out.push({ at, from: t, to: written, why: `ALIAS ${name} does not reach ${found.path} today` });
				continue;
			}
		} else if (kind === 'relative') {
			const base = clean(found.base) === own ? clean(dirname(to)) : after_(clean(found.base));
			if (base == null) { out.push({ at, from: t, to: t, why: `BASE SPLIT: read from ${found.base}/, which the move splits` }); continue; }
			if (clean(normalize(join(base, t))) === clean(next_ + found.cut)) continue;
			written = relative(base, next_) || '.';
			written = t.startsWith('./') || js || rust ? dotted(written) : written.startsWith('.') ? written : './' + written;
		} else if (kind === 'crate') {
			const base = after_(found.base);
			if (base == null) { out.push({ at, from: t, to: t, why: `BASE SPLIT: read from ${found.base}/, which the move splits` }); continue; }
			if (relative(found.base, clean(found.path)) === relative(base, clean(target))) continue;
			written = '/' + relative(base, next_);
		} else if (kind === 'root') {
			written = '/' + next_;
		} else {
			// a bare name is read from the file's folder or one above it: kept so while the folder it was read from goes
			// with the file (or is the root); else, in prose, written from the file's new folder if it is in it, or from
			// the root; in a string of code it may be no path at all (a route, a key), so a person decides
			const nb = after_(found.base), there = clean(dirname(to));
			if (nb != null && (nb === '' || there === nb || there.startsWith(nb + '/'))) {
				if (relative(found.base, clean(found.path)) === relative(nb, clean(target))) continue;
				written = nb === '' ? next_ : relative(nb, next_);
			} else if (!quoted || !CODE.test(file)) {
				written = next_.startsWith(there + '/') ? next_.slice(there.length + 1) : next_;
			} else {
				out.push({ at, from: t, to: t, why: nb == null ? `BASE SPLIT: read from ${found.base}/, which the move splits` : `NOT ABOVE: read from ${found.base}/, which goes to ${nb}/, not above ${to}` });
				continue;
			}
		}
		if (t.endsWith('/') && !written.endsWith('/')) written += '/';
		if (!t.endsWith('/') && written.endsWith('/') && !found.dir) written = written.replace(/\/$/, '');
		if (written === t) continue;
		// a name a frozen bundle holds stays as it is (isFrozen)
		if (isFrozen(frozen, text, at, t)) out.push({ at, from: t, to: t, why: 'frozen' });
		else out.push({ at, from: t, to: written, why: quoted && kind !== 'alias' ? kind + "'" : kind });
	}
	// what a person keeps as written goes as it is; what a person rewrites after the move is named so
	const kept = KEEP[file] ?? [], hand = HAND[file] ?? [];
	return out.filter((r) => !kept.includes(r.from)).map((r) => (hand.includes(r.from) ? { ...r, why: 'hand: ' + r.why } : r));
}

const asText = (buf) => (buf.length > 8 << 20 || buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8'));
const textOf = (path) => {
	if (BINARY.test(path)) return null;
	try { return asText(readFileSync(ROOT + path)); } catch { return null; }
};
/** the text of `path` at the commit `rev`, as textOf reads one on the disk */
const textAt = (rev, path) => {
	if (BINARY.test(path)) return null;
	try { return asText(execFileSync('git', ['show', `${rev}:${path}`], { cwd: ROOT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; }
};
function apply(text, list) {
	let out = '', last = 0;
	for (const r of [...list].sort((a, b) => a.at - b.at)) {
		if (r.at < last || r.from === r.to || /^([A-Z]{2}|hand: )/.test(r.why)) continue;
		out += text.slice(last, r.at) + r.to;
		last = r.at + r.from.length;
	}
	return out + text.slice(last);
}
/** every file's rewrites, each file where it sits before and after the move */
function planOf(entries, tree, opts) {
	const plan = [];
	for (const [file, to] of entries) {
		if (NEVER.some((r) => r.test(file))) continue;
		const text = textOf(file);
		if (text == null) continue;
		const list = rewrites(file, to, text, tree, opts);
		if (list.length) plan.push({ file, to, text, list });
	}
	return plan;
}
function show(plan) {
	let n = 0;
	for (const { file, to, text, list } of plan) {
		console.log(`\n${file}${to !== file ? `  ->  ${to}` : ''}`);
		for (const r of list) {
			const line = text.slice(0, r.at).split('\n').length;
			console.log(`  ${String(line).padStart(5)}  ${r.why.padEnd(8)}  ${r.from}  ->  ${r.to}`);
			n++;
		}
	}
	return n;
}

/** `src` to `dst`; into a folder there already (a rule moved a file or a sibling into it) by what it holds, one by one */
function put(src, dst) {
	if (!existsSync(dst)) { mkdirSync(dirname(dst), { recursive: true }); renameSync(src, dst); return; }
	if (!lstatSync(src).isDirectory() || !lstatSync(dst).isDirectory()) throw new Error(`${dst} is there already`);
	for (const name of readdirSync(src)) put(`${src}/${name}`, `${dst}/${name}`);
	rmdirSync(src);
}
/** the folders and files to their new places, folders whole (so what git ignores in them, builds and caches, goes too) */
function relocate(files) {
	for (const [from, to] of RULES) {
		const src = ROOT + from.replace(/\/$/, '');
		if (existsSync(src)) put(src, ROOT + to.replace(/\/$/, ''));
	}
	// the folders the move emptied
	const old = new Set(files.map((f) => f.split('/')[0]));
	for (const top of old) pruneEmpty(ROOT + top);
}
function pruneEmpty(dir) {
	if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
	for (const name of readdirSync(dir)) pruneEmpty(`${dir}/${name}`);
	if (!readdirSync(dir).length) rmdirSync(dir);
}

/**
 * The cut-over's search, in the tree after the move: each name that names nothing now and named a file or folder before
 * (read from where its file was, in the tree as it was), each alias import its alias does not reach, and what no
 * reference shows: a folder the move took away named alone (cd avendb, cwd: 'avendb', join(ROOT, 'avendb')), in a
 * regular expression (^avendb\/crates\/), in a list of folders (['src', 'game']) or in an ignore file.
 */
async function check() {
	const files = listed(), frozen = await frozenTexts();
	// the tree as it was ignores what the tree now ignores where it went: the move took each ignore pattern along
	const tree = treeOf(files), was = treeOf(files.map(unmoved), (p) => tree.ignored(moved(p)));
	const aliases = { $lib: paths.site + '/lib', ...paths.aliases }, before = { $lib: unmoved(paths.site + '/lib') };
	const gone = [...new Set(RULES.filter(([o]) => o.endsWith('/')).map(([o]) => o.split('/')[0]))].filter((top) => !tree.dirs.has(top)).join('|');
	const word = new RegExp(String.raw`(?:\b(?:cd|pushd)\s+(?:\.\.?\/)*|\b(?:cwd|current_dir|dir|root)\s*[:=(]\s*['"]|\bjoin\([^()\n]*?['"])(${gone})(?=['"\s;&|)]|$)|(?:^|[^\w.@$\\/-])(${gone})\\\/`, 'gm');
	const stale = [];
	for (const file of files) {
		const then = unmoved(file);
		if (NEVER.some((r) => r.test(then))) continue;
		const text = textOf(file);
		if (text == null) continue;
		const kept = KEEP[then] ?? [];
		const lineOf = (at) => text.slice(0, at).split('\n').length;
		const ignores = IGNORES.test(file);
		if (ignores) for (const m of text.matchAll(new RegExp(String.raw`^!?\/?(${gone})\/`, 'gm'))) stale.push(`${file}:${lineOf(m.index)}  names ${m[1]}/ (moved): ${lineAt(text, m.index)}`);
		const misses = [];
		refsIn(file, text, tree, { aliases, misses });
		const old = misses.length ? new Map(refsIn(then, text, was, { aliases: before }).map((r) => [r.at, r])) : new Map();
		for (const { at, t } of misses) {
			// what a person keeps as written, and a frozen bundle's name (isFrozen), are no old paths left; of an ignore
			// file, its comments are read so (its patterns above)
			if (kept.includes(t) || isFrozen(frozen, text, at, t) || (ignores && !/^\s*#/.test(lineAt(text, at)))) continue;
			if (old.has(at)) stale.push(`${file}:${lineOf(at)}  ${t}: named ${old.get(at).found.path}, which is ${moved(old.get(at).found.path)} now`);
		}
		if (ignores) continue;
		for (const m of text.matchAll(word)) {
			const top = m[1] ?? m[2];
			if (kept.some((k) => k.replace(/\/$/, '') === top) || (top === 'deploy' && HOST.test(then)) || (file.endsWith('.rs') && m[0].startsWith('join('))) continue;
			stale.push(`${file}:${lineOf(m.index)}  names ${top} (moved): ${lineAt(text, m.index).trim().slice(0, 160)}`);
		}
		// a list of folders to walk (['src', 'game']): two or more of its names, and half of them, the old folders
		if (!file.endsWith('.rs')) for (const m of text.matchAll(/\[\s*(?:(['"`])[\w./-]+\1\s*,\s*)+(['"`])[\w./-]+\2\s*,?\s*\]/g)) {
			const names = [...m[0].matchAll(/['"`]([\w./-]+)['"`]/g)].map((q) => q[1]);
			const tops = names.filter((q) => gone.split('|').includes(q) && !kept.includes(q));
			if (tops.length >= 2 && tops.length * 2 >= names.length) stale.push(`${file}:${lineOf(m.index)}  names ${tops.join(', ')} (moved): ${lineAt(text, m.index).trim().slice(0, 160)}`);
		}
	}
	for (const s of [...new Set(stale)]) console.log(s);
	console.log(stale.length ? `\n${stale.length} old paths left` : 'no old path is named anywhere');
	return stale.length ? 1 : 0;
}

/**
 * A branch that started before the move, right after `merge` (its commit that merged the move): each file the branch
 * added or changed since it parted from the goal's branch where the move puts it, and the old paths in the lines it
 * wrote rewritten as --move would have rewritten them, read in the branch's own tree before the merge. A line of the
 * merged file is rewritten only where it reads as the branch wrote it: the move's own lines are new already.
 */
async function fix(merge, tree) {
	if (git('status', '--porcelain').trim()) throw new Error('commit the merge first: --fix reads what the branch committed');
	let sides;
	try { sides = ['^1', '^2'].map((p) => git('rev-parse', '--verify', '--quiet', merge + p).trim()); }
	catch { throw new Error(`--fix [<merge>]: ${merge} is no merge; name the commit that merged the move into this branch`); }
	// mine = the side the move is still ahead of: its paths.json plans the move (`after`), or it has none yet. Either side
	// may be it: a branch merges the refactor branch, the refactor branch merges a branch, the move takes in newer work
	const ahead = (rev) => { const t = textAt(rev, MAP); return t == null || 'after' in JSON.parse(t); };
	const [mine, theirs] = ahead(sides[0]) ? sides : [sides[1], sides[0]];
	if (ahead(mine) === ahead(theirs))
		throw new Error(`--fix: both sides of ${merge} are ${ahead(mine) ? 'before' : 'after'} the move; it fixes a merge of one of each`);
	const fork = git('merge-base', mine, theirs).trim();
	const own = git('diff', '--name-only', '--no-renames', '--diff-filter=AM', fork, mine).split('\n').filter(Boolean);
	// the branch's tree before the merge ignores what the tree now ignores where it went
	const then = treeOf(git('ls-tree', '-r', '--name-only', mine).split('\n').filter(Boolean), (p) => tree.ignored(moved(p)));
	const frozen = await frozenTexts(), odd = [];
	let n = 0, changed = 0;
	for (const f of own) {
		const to = moved(f);
		// git keeps a file it can't place in a moved folder where the branch put it
		if (to !== f && existsSync(ROOT + f) && !existsSync(ROOT + to)) {
			mkdirSync(dirname(ROOT + to), { recursive: true });
			git('mv', f, to);
			console.log(`moved ${f} -> ${to}`);
		}
		if (NEVER.some((r) => r.test(f))) continue;
		const was = textAt(mine, f), now = textOf(to);
		if (was == null || now == null) continue;
		// each line of the branch's file that --move would rewrite, by its text, with the rewrites in it
		const lines = new Map();
		for (const r of rewrites(f, to, was, then, { frozen, fix: true })) {
			const start = was.lastIndexOf('\n', r.at - 1) + 1, line = lineAt(was, r.at);
			if (/^([A-Z]{2}|hand: )/.test(r.why)) odd.push(`  ${to}: ${r.from} (${r.why}) in: ${line.trim().slice(0, 120)}`);
			else if (r.from !== r.to) (lines.get(line) ?? lines.set(line, []).get(line)).push({ ...r, at: r.at - start });
		}
		if (!lines.size) continue;
		const out = now.split('\n').map((l, i) => {
			const list = lines.get(l);
			if (!list) return l;
			for (const r of list) console.log(`  ${to}:${i + 1}  ${r.why.padEnd(8)}  ${r.from}  ->  ${r.to}`), n++;
			return apply(l, list);
		}).join('\n');
		if (out !== now) writeFileSync(ROOT + to, out), changed++;
	}
	// a file of the branch alone in a folder the move emptied (scripts/, src/) has no place the map knows
	const tracked = listed(), ours = new Set(own.map((f) => (existsSync(ROOT + moved(f)) ? moved(f) : f)));
	for (const f of ours) {
		const top = f.split('/')[0];
		if (f.includes('/') && RULES.some(([from]) => from.startsWith(top + '/')) && !tracked.some((g) => g.startsWith(top + '/') && !ours.has(g)))
			odd.push(`  ${f}: NO PLACE: ${top}/ holds nothing else since the move; give it one by hand`);
	}
	console.log(`\n${n} references rewritten in ${changed} files`);
	if (odd.length) console.log(`${odd.length} a person decides, then --check:\n${odd.join('\n')}`);
	return odd.length ? 1 : 0;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const mode = args[0];
	if (mode === '--check') process.exit(await check());
	const files = listed();
	const tree = treeOf(files);
	if (mode === '--fix') process.exit(await fix(args[1] ?? 'HEAD', tree));
	if (!['--plan', '--aliases', '--move'].includes(mode)) {
		console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n'));
		process.exit(mode ? 1 : 0);
	}
	if (!paths.after) throw new Error(`${MAP} has no \`after\`: the move is made already`);
	const aliasesOnly = mode === '--aliases' || args.includes('--aliases');
	const entries = files.map((f) => [f, aliasesOnly ? f : moved(f)]);
	const frozen = await frozenTexts();
	const plan = planOf(entries, tree, { aliasesOnly, frozen });
	const n = show(plan);
	const odd = plan.flatMap((p) => p.list.filter((r) => /^[A-Z]{2}/.test(r.why)));
	console.log(`\n${n} references in ${plan.length} files${aliasesOnly ? ' ($lib imports only)' : ''}; ${files.filter((f) => moved(f) !== f).length} files move`);
	const hand = plan.flatMap((p) => p.list.filter((r) => r.why.startsWith('hand: ')).map((r) => `  ${p.to}: ${r.from}`));
	if (hand.length) console.log(`${hand.length} references a person rewrites right after --move (HAND):\n${hand.join('\n')}`);
	if (odd.length) { console.log(`${odd.length} references this tool can't place (above, in capitals): fix them first, or name them in KEEP or HAND`); process.exit(1); }
	if (mode === '--plan') process.exit(0);
	if (git('status', '--porcelain').trim()) throw new Error('commit or stash first: the move takes the tree as it is committed');
	if (mode === '--aliases') {
		for (const p of plan) writeFileSync(ROOT + p.file, apply(p.text, p.list));
		console.log('the $lib imports of the folders that leave the site now name their new aliases');
		process.exit(0);
	}
	const texts = plan.map((p) => [p.to, apply(p.text, p.list)]);
	relocate(files);
	for (const [to, text] of texts) writeFileSync(ROOT + to, text);
	const { after, ...rest } = paths;
	writeFileSync(ROOT + MAP, JSON.stringify({ ...rest, ...after, moves: paths.moves }, null, '\t') + '\n');
	git('add', '-A');
	// every file the repo held, at its new place and still tracked (an ignore pattern can hide a file that moved under it)
	const now = new Set(listed()), meant = new Set(files.map(moved)), lost = files.filter((f) => !now.has(moved(f)));
	if (lost.length || now.size !== files.length) {
		for (const f of lost) console.log(`not tracked after the move: ${f} -> ${moved(f)}`);
		for (const f of [...now].filter((f) => !meant.has(f))) console.log(`new after the move: ${f}`);
		console.log(`${files.length} files before, ${now.size} after: fix the ignore files, then git reset --hard and move again`);
		process.exit(1);
	}
	console.log(`moved ${files.filter((f) => moved(f) !== f).length} files; ${n} references rewritten; ${MAP} now names the new places`);
}
