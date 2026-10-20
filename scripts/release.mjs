#!/usr/bin/env node
// @ts-nocheck — plain JS, kept loose on purpose
// THE RELEASE MAIA CITY ACCEPTS — so a server someone broke into can't swap the site's code unseen (the stack
// consolidation's phase 2, Samuel 2026-10-20). No key of its own: Maia City's owners sign each release as they sign any
// AIP, with the keys they have (Samuel 16:43 "reuse the Maia City COOP as master owner", "I don't want to handle
// another key").
//
// 1. Each deploy writes /release.json beside the site: its commit and the BLAKE3 hash of every file it built. It is a
//    claim, nothing more: whoever holds the server can write another.
// 2. This Mac (scripts/watch-main.mjs) is the witness. When the live site names a commit Maia City hasn't accepted, it
//    builds that commit of main itself (the build is the same, byte for byte, wherever it runs: vite.config.ts names
//    it by its commit, not its time), fetches every file the live site serves, and only when all of them are the bytes
//    it built does it propose the list into Maia City (avenMAIA, a Suggester: a draft file entry `maia.city release`
//    and an AIP over it, or the open one brought up to date). An owner accepts it in The OS, with Touch ID or a passkey.
// 3. When the live site names the commit Maia City accepted, the witness holds every file it serves to the accepted
//    list. A file that differs, a commit main doesn't hold, or an older release served again is said in its log and a
//    notification.
//
//   node scripts/release.mjs list [build]              the deploy's list, into build/release.json
//   node scripts/release.mjs witness [--run] [--site https://maia.city] [--device <avendb-device>]
//                                                      the witness, once (without --run it proposes nothing)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '../game/hash.js';

/** the file the list goes up as, beside the site; never in the list itself */
export const LIST = 'release.json';
/** what a list says it is */
export const KIND = 'maia.city release v1';
/** the tag of Maia City's one release entry, and its AIP's title */
export const TAG = 'release:maia.city';
export const TITLE = 'maia.city release';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** every file under `dir`, by its path from there (with /), but the list */
function filesOf(dir) {
	const out = [];
	const walk = (d) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.isFile()) out.push(relative(dir, p).split(sep).join('/'));
		}
	};
	walk(dir);
	return out.filter((f) => f !== LIST).sort();
}

/** the list of the site built in `dir` from `commit` */
export function listOf(dir, commit) {
	return { kind: KIND, commit, files: Object.fromEntries(filesOf(dir).map((f) => [f, hashBytes(readFileSync(join(dir, f)))])) };
}

/** whether `list` is a release list at all (what the site or the vault hands over is read, never trusted) */
export const isList = (list) =>
	!!list && list.kind === KIND && /^[0-9a-f]{40}$/.test(list.commit ?? '') && !!list.files && typeof list.files === 'object' && Object.values(list.files).every((h) => /^[0-9a-f]{64}$/.test(h));

/** where `got` (the live site's own list) and `want` (a list we trust) name different files */
export function unlike(got, want) {
	const out = [];
	for (const f of Object.keys(want.files)) if (!(f in got.files)) out.push(`${f}: missing from the site's list`);
	for (const f of Object.keys(got.files)) if (!(f in want.files)) out.push(`${f}: on the site, not in the release`);
	return out;
}

/** every file of `want` as `site` serves it, held to its hash: what failed, by file (an empty list: it holds) */
export async function served(site, want, { get = fetch, at = 6 } = {}) {
	const names = Object.keys(want.files).sort();
	const failed = [];
	let next = 0;
	const worker = async () => {
		while (next < names.length) {
			const f = names[next++];
			// a page is served at its folder (`docs/index.html` at /docs/), a file at its own path
			const url = `${site}/${f.replace(/(^|\/)index\.html$/, '$1')}`;
			try {
				const r = await get(url, { cache: 'no-store' });
				const bytes = new Uint8Array(await r.arrayBuffer());
				if (!r.ok) failed.push(`${f}: ${r.status}`);
				else if (hashBytes(bytes) !== want.files[f]) failed.push(`${f}: not the bytes of the release`);
			} catch (e) {
				failed.push(`${f}: ${e?.message ?? e}`);
			}
		}
	};
	await Promise.all(Array.from({ length: at }, worker));
	return failed;
}

/**
 * what the witness does about the live site's list `live`, given the release Maia City accepted (or null) and how the
 * two commits stand on main (`onMain(c)`: main holds c; `before(a, b)`: a is an older commit of b's history)
 * @returns {{ do: 'hold' | 'build' | 'alert', why?: string }}
 */
export function plan(live, accepted, { onMain, before }) {
	if (!isList(live)) return { do: 'alert', why: `${LIST} is not a release list` };
	if (accepted && live.commit === accepted.commit) return { do: 'hold' };
	if (!onMain(live.commit)) return { do: 'alert', why: `the site names ${live.commit.slice(0, 7)}, a commit main doesn't hold` };
	if (accepted && before(live.commit, accepted.commit)) return { do: 'alert', why: `the site serves ${live.commit.slice(0, 7)}, older than the accepted ${accepted.commit.slice(0, 7)}` };
	return { do: 'build' };
}

/** this Mac's own build of `commit`, in a worktree of its own (.cargo/release-build), at the lowest priority */
function build(commit) {
	const dir = join(ROOT, '.cargo/release-build');
	const run = (cmd, args, cwd, timeout) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout, env: { ...process.env, GITHUB_SHA: '', BASE_PATH: '' } });
	if (!existsSync(join(dir, '.git'))) run('git', ['worktree', 'add', '--detach', dir, commit], ROOT, 120_000);
	else run('git', ['checkout', '--quiet', '--force', '--detach', commit], dir, 120_000);
	run('bun', ['install', '--frozen-lockfile'], dir, 600_000);
	run('nice', ['-n', '19', 'bun', '--bun', 'run', 'build'], dir, 1_800_000); // Vite on Bun, as the deploy builds it
	return listOf(join(dir, 'build'), commit);
}

/** whether a site build or a Rust build runs on this machine now: the witness waits for the next round */
function busy() {
	for (const p of ['vite build', 'tauri build', 'cargo build', 'cargo test', 'rustc']) {
		try {
			execFileSync('pgrep', ['-f', p], { stdio: 'ignore' });
			return p;
		} catch {}
	}
	return '';
}

function tell(msg) {
	console.error(msg);
	if (process.platform !== 'darwin') return;
	try {
		execFileSync('osascript', ['-e', `display notification ${JSON.stringify(msg.slice(0, 180))} with title "The OS"`], { timeout: 30_000 });
	} catch {}
}

/** Maia City's release: its entry, the accepted list on main (null before the first accept), and the open AIP */
async function releaseOf(agent, city) {
	const found = await agent.call('avendb_ask', { op: { op: 'query', vault: city.id, where: { type: ['file'] } } });
	const rows = (found.rows ?? []).filter((r) => (r.tags ?? []).includes(TAG) && !(r.tags ?? []).includes('avendb:deleted'));
	if (rows.length > 1) throw new Error(`Maia City holds ${rows.length} release entries (${rows.map((r) => r.entry).join(', ')})`);
	const entry = rows[0]?.entry ?? null;
	let accepted = null;
	if (entry) {
		const path = join(mkdtempSync(join(tmpdir(), 'release-')), LIST);
		await agent.call('avendb_read_file', { entry, path, overwrite: true });
		accepted = JSON.parse(readFileSync(path, 'utf8'));
		if (!isList(accepted)) throw new Error(`Maia City's release entry ${entry} holds no release list`);
	}
	const open = (await agent.call('avendb_ask', { op: { op: 'aips', vault: city.id } })).filter((a) => a.title === TITLE && !a.outcome && !a.bare);
	return { entry, accepted, open: open[0] ?? null };
}

const OBJECTIVE = [
	'/-- maia.city serves exactly what main builds at the commit it names: every file, byte for byte, as a Mac of Maia City built it. -/',
	'def matches : Metric := metric "Live site is this build" (equals (reading "matches") 1)',
	'/-- The release names the site\'s files. -/',
	'def files : Metric := metric "Files" (atLeast (reading "files") 1)',
	''
].join('\n');

/** the list proposed into Maia City: the open AIP brought up to it, or a new one */
async function propose(agent, city, release, list) {
	const path = join(mkdtempSync(join(tmpdir(), 'release-')), LIST);
	writeFileSync(path, JSON.stringify(list));
	const value = { kind: 'file', title: TITLE, media: 'application/json' };
	const note = 'maia.city as built from main, every file held by its BLAKE3 hash; the commit is the newest measure\'s. A Mac of Maia City built that commit itself and found every file the live site serves to be these bytes. Accepting it makes it the release the site is held to; while it waits, each newer deploy is witnessed and brought onto this same AIP.';
	let aip = release.open;
	if (aip) {
		// the open AIP, brought up to this commit on its own line (a file write on the line: the record stays)
		const line = aip.lines?.[0];
		if (!line) throw new Error(`the open release AIP ${aip.entry} has no line`);
		await agent.call('avendb_run', { op: { op: 'put_file', entry: line.entry, line: line.line, name: LIST, media: 'application/json' }, path });
	} else if (release.entry) {
		const { line } = await agent.call('avendb_run', { op: { op: 'propose', entry: release.entry, name: list.commit.slice(0, 12) } });
		await agent.call('avendb_run', { op: { op: 'put_file', entry: release.entry, line, name: LIST, media: 'application/json' }, path });
		aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title: TITLE, note, proposals: [{ entry: release.entry, line }], objective: OBJECTIVE } });
	} else {
		const made = await agent.call('avendb_run', { op: { op: 'create', vault: city.id, type: 'file', tags: [TAG], value, draft: true, file: { name: LIST, media: 'application/json' } }, path });
		if (!made?.entry || !made?.line) throw new Error(`the draft named no entry and line (${JSON.stringify(made).slice(0, 300)})`);
		aip = await agent.call('avendb_run', { op: { op: 'aip_open', vault: city.id, title: TITLE, note, proposals: [{ entry: made.entry, line: made.line }], objective: OBJECTIVE } });
	}
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'files', value: Object.keys(list.files).length, note: `commit ${list.commit}` } });
	await agent.call('avendb_run', { op: { op: 'aip_measure', entry: aip.entry, name: 'matches', value: 1, note: `every file maia.city serves is this Mac's build of ${list.commit}` } });
	try {
		await agent.call('avendb_run', { op: { op: 'aip_promote', entry: aip.entry } });
	} catch (e) {
		console.error(`not put forward: ${e.message.slice(0, 300)}`);
	}
	return aip;
}

/** the witness, once */
async function witness({ site, run, named }) {
	const res = await fetch(`${site}/${LIST}`, { cache: 'no-store' });
	if (res.status === 404) return console.error(`${site} serves no ${LIST} yet: nothing to witness`);
	if (!res.ok) throw new Error(`${site}/${LIST}: ${res.status}`);
	const live = await res.json();
	const { device, session } = await import('./agent.mjs');
	const agent = session(device(named), 'release-witness');
	try {
		await agent.open();
		const city = await agent.city();
		const release = await releaseOf(agent, city);
		const git = (...a) => execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 120_000 }).trim();
		git('fetch', '--quiet', 'origin', 'main');
		const yes = (...a) => {
			try {
				git(...a);
				return true;
			} catch {
				return false;
			}
		};
		const next = plan(live, release.accepted, {
			onMain: (c) => yes('merge-base', '--is-ancestor', c, 'origin/main'),
			before: (a, b) => a !== b && yes('merge-base', '--is-ancestor', a, b)
		});
		if (next.do === 'alert') return tell(`maia.city is NOT a release Maia City accepted: ${next.why}`);
		const want = next.do === 'hold' ? release.accepted : null;
		if (want) {
			const failed = [...unlike(live, want), ...(await served(site, want))];
			if (failed.length) return tell(`maia.city is NOT the release Maia City accepted (${want.commit.slice(0, 7)}): ${failed.slice(0, 3).join('; ')}`);
			return console.error(`maia.city is the release Maia City accepted, ${want.commit.slice(0, 7)} (${Object.keys(want.files).length} files)`);
		}
		// the very first release is a draft until an owner accepts it, and a draft takes no newer file: it waits as it is
		if (release.open && !release.entry) return console.error(`maia.city serves ${live.commit.slice(0, 7)}; the first release waits for an owner's accept, then newer ones follow`);
		const seen = join(ROOT, '.cargo/release-witnessed');
		const open = release.open && existsSync(seen) && readFileSync(seen, 'utf8').trim() === live.commit;
		if (open) return console.error(`maia.city serves ${live.commit.slice(0, 7)}, proposed already and waiting for an owner's accept`);
		const other = busy();
		if (other) return console.error(`a build runs here (${other}): the witness builds ${live.commit.slice(0, 7)} next round`);
		console.error(`building ${live.commit.slice(0, 7)} to witness it`);
		const mine = build(live.commit);
		const failed = [...unlike(live, mine), ...(await served(site, mine))];
		if (failed.length) return tell(`maia.city does NOT serve what main builds at ${live.commit.slice(0, 7)}: ${failed.slice(0, 3).join('; ')}`);
		console.error(`maia.city is this Mac's own build of ${live.commit.slice(0, 7)}, all ${Object.keys(mine.files).length} files`);
		if (!run) return console.error('without --run nothing is proposed');
		const aip = await propose(agent, city, release, mine);
		writeFileSync(seen, live.commit);
		console.error(`proposed into Maia City for an owner's accept: /app/aips/?aip=${aip.entry}`);
	} finally {
		agent.close();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const option = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
	const [what, arg] = args;
	if (what === 'list') {
		const dir = arg ?? 'build';
		const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
		const list = listOf(dir, commit);
		writeFileSync(join(dir, LIST), JSON.stringify(list));
		console.log(`listed ${Object.keys(list.files).length} files of ${dir}/ for ${commit}`);
	} else if (what === 'witness') {
		mkdirSync(join(ROOT, '.cargo'), { recursive: true });
		await witness({ site: (option('--site') ?? 'https://maia.city').replace(/\/$/, ''), run: args.includes('--run'), named: option('--device') });
	} else {
		console.error('node scripts/release.mjs list [build] | witness [--run] [--site <url>] [--device <avendb-device>]');
		process.exit(1);
	}
}
