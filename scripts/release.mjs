#!/usr/bin/env node
// THE SIGNED RELEASE — so a server someone broke into can't swap the site's code unseen (the stack consolidation's
// phase 2, Samuel 2026-10-20). Each deploy signs what it built: the BLAKE3 hash of every file of build/, its commit
// and its time, with the release key (ML-DSA-65, the key's secret only in the repo's Actions secrets, RELEASE_KEY).
// The signed list goes up with the site as /release.json. A check reads it back from the live site, holds it to the
// public key pinned below, and every file it names to its hash: a file changed, added in place of one, or a list
// signed by any other key fails it. The check runs after each deploy and every day (.github/workflows/release-check.yml),
// and on Samuel's Mac whenever the live release changes (scripts/watch-main.mjs).
//
//   node scripts/release.mjs sign [build]              sign build/ (RELEASE_KEY: the key's 32-byte seed, hex)
//   node scripts/release.mjs check [https://maia.city] [--sample N]
//                                                      the live site against its signed list (every file, or the pages
//                                                      and N of the hashed chunks)
//   node scripts/release.mjs key                       the key, once: its seed straight into the repo's Actions secrets
//                                                      (gh secret set RELEASE_KEY), its public key into this file
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { hashBytes } from '../game/hash.js';

/** the release key's public half (ML-DSA-65, hex): the only key a release may be signed with. Empty until the key is
 * made (`node scripts/release.mjs key`), and while it is, nothing is signed or checked. */
export const RELEASE_PUBLIC_KEY = '';

/** the file the signed list goes up as, beside the site; never in the list itself */
export const LIST = 'release.json';
/** what a list says it is, so no other signed text of this key can stand in for one */
const KIND = 'maia.city release v1';

/** every file under `dir`, by its path from there (with /), but the list */
function filesOf(dir) {
	/** @type {string[]} */
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

/** the bytes a list's signature covers: its fields in one order, so the same list always signs the same */
export const signedBytes = ({ commit, made, files }) =>
	utf8ToBytes(JSON.stringify({ kind: KIND, commit, made, files: Object.fromEntries(Object.keys(files).sort().map((f) => [f, files[f]])) }));

/** a list signed by the key of `seed`, for the files of `dir` @param {string} dir @param {Uint8Array} seed */
export function sign(dir, seed, commit = process.env.GITHUB_SHA ?? 'local', made = new Date().toISOString()) {
	const files = Object.fromEntries(filesOf(dir).map((f) => [f, hashBytes(readFileSync(join(dir, f)))]));
	const { secretKey, publicKey } = ml_dsa65.keygen(seed);
	const list = { commit, made, files };
	return { ...list, key: bytesToHex(publicKey), sig: bytesToHex(ml_dsa65.sign(signedBytes(list), secretKey)) };
}

/** whether `list` is signed by the key `pub` (hex) @param {any} list @param {string} pub */
export function signed(list, pub = RELEASE_PUBLIC_KEY) {
	if (!pub || !list || typeof list !== 'object' || list.key !== pub) return false;
	if (typeof list.commit !== 'string' || typeof list.made !== 'string' || !list.files || typeof list.files !== 'object') return false;
	try {
		return ml_dsa65.verify(hexToBytes(list.sig), signedBytes(list), hexToBytes(pub));
	} catch {
		return false;
	}
}

/** the files to check: all, or the pages and data (what names everything else) and `sample` of the hashed chunks */
export function toCheck(files, sample = Infinity) {
	const all = Object.keys(files).sort();
	const chunks = all.filter((f) => f.startsWith('_app/immutable/'));
	const rest = all.filter((f) => !f.startsWith('_app/immutable/'));
	if (sample >= chunks.length) return all;
	const picked = [...chunks].sort(() => Math.random() - 0.5).slice(0, sample);
	return [...rest, ...picked];
}

/** the live site at `site` against its signed list: what failed, by file (an empty list: it holds) */
export async function check(site, { sample = Infinity, pub = RELEASE_PUBLIC_KEY, get = fetch, at = 6 } = {}) {
	const res = await get(`${site}/${LIST}`, { cache: 'no-store' });
	if (!res.ok) return { list: null, failed: [`${LIST}: ${res.status}`] };
	const list = await res.json();
	if (!signed(list, pub)) return { list, failed: [`${LIST}: not signed by the release key`] };
	const names = toCheck(list.files, sample);
	/** @type {string[]} */
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
				else if (hashBytes(bytes) !== list.files[f]) failed.push(`${f}: not the bytes the release signed`);
			} catch (e) {
				failed.push(`${f}: ${e?.message ?? e}`);
			}
		}
	};
	await Promise.all(Array.from({ length: at }, worker));
	return { list, failed, checked: names.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [what, arg] = process.argv.slice(2);
	if (what === 'key') {
		// the seed goes straight into the repo's Actions secrets and is never printed or kept here; the public key
		// goes into this file, to be committed
		if (RELEASE_PUBLIC_KEY && !process.argv.includes('--new')) {
			console.error('a release key exists already: --new makes another (every list signed before stops holding)');
			process.exit(1);
		}
		const seed = randomBytes(32);
		execFileSync('gh', ['secret', 'set', 'RELEASE_KEY', '--repo', 'MyAvenCEO/maiacity'], { input: bytesToHex(seed), stdio: ['pipe', 'inherit', 'inherit'] });
		const pub = bytesToHex(ml_dsa65.keygen(seed).publicKey);
		const me = fileURLToPath(import.meta.url);
		writeFileSync(me, readFileSync(me, 'utf8').replace(/export const RELEASE_PUBLIC_KEY = '[0-9a-f]*';/, `export const RELEASE_PUBLIC_KEY = '${pub}';`));
		console.log('RELEASE_KEY is set in the repo\'s Actions secrets; commit scripts/release.mjs (its new public key)');
	} else if (what === 'sign') {
		const dir = arg ?? 'build';
		const seed = process.env.RELEASE_KEY ?? '';
		if (!seed || !RELEASE_PUBLIC_KEY) {
			console.log('::warning::no release key yet (RELEASE_KEY, RELEASE_PUBLIC_KEY): the build goes up unsigned');
			process.exit(0);
		}
		const list = sign(dir, hexToBytes(seed));
		if (list.key !== RELEASE_PUBLIC_KEY) {
			console.error('RELEASE_KEY is not the key RELEASE_PUBLIC_KEY names: nothing signed');
			process.exit(1);
		}
		writeFileSync(join(dir, LIST), JSON.stringify(list));
		console.log(`signed ${Object.keys(list.files).length} files of ${dir}/ for ${list.commit}`);
	} else if (what === 'check') {
		const site = (arg && !arg.startsWith('--') ? arg : 'https://maia.city').replace(/\/$/, '');
		const at = process.argv.indexOf('--sample');
		const sample = at > 0 ? Number(process.argv[at + 1]) : Infinity;
		if (!RELEASE_PUBLIC_KEY) {
			console.log('no release key yet: nothing to check');
			process.exit(0);
		}
		const { list, failed, checked } = await check(site, { sample });
		if (failed.length) {
			console.error(`${site} does NOT hold its signed release${list ? ` (${list.commit})` : ''}:\n  ${failed.slice(0, 50).join('\n  ')}`);
			process.exit(1);
		}
		console.log(`${site} holds its signed release ${list.commit} (${checked} files checked)`);
	} else {
		console.error('node scripts/release.mjs sign [build] | check [site] [--sample N] | key');
		process.exit(1);
	}
}
