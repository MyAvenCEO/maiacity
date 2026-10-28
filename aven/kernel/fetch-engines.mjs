#!/usr/bin/env node
// @ts-nocheck — plain JS, run by node and bun only (the site's dev server and build, the tests, by hand)
/*
 * THE FROZEN ENGINES' BYTES, BY HASH — a frozen engine (./sandbox/engines.json) is named by its BLAKE3 hash and size,
 * and git does not carry its file: each one is fetched where it is kept, checked against its hash, and written where
 * the site serves it, maia/site/static/engines/<kind>-v<n>.js (./engines.js pathOf), which .gitignore leaves out.
 *
 * Where an engine is kept is its entry's `kept`, `<commit>:<path>`: a commit of main in this public repository that
 * held the file at that path. Main is never rewritten, so the commit and the bytes in it stay. Each file is looked for,
 * in order, where the site serves it, in this machine's cache (~/.cache/maiacity/engines/<blake3>.js, shared by every
 * checkout), in this checkout's git history, and at raw.githubusercontent.com. Wherever the bytes come from, they are
 * taken only when they are the ones the hash names, so a source we do not trust can't hand us another engine.
 *
 *   node aven/kernel/fetch-engines.mjs          every frozen engine in place, or fail naming the one that is not
 *
 * The site's dev server and its build run this first (vite.config.ts), and the tests that read an engine's bytes take
 * them from `engineBytes`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '../../maia/content/game/hash.js';
import { ROOT, paths } from '../ops/paths.js';
import MANIFEST from './sandbox/engines.json' with { type: 'json' };
import { pathOf } from './engines.js';

/** the public repository the engines are kept in */
export const REPO = 'MyAvenCEO/maiacity';

/** where this machine keeps engines it has fetched, by hash, for every checkout of it */
export const CACHE = `${process.env.XDG_CACHE_HOME || `${homedir()}/.cache`}/maiacity/engines`;

/** where the site serves engine `v` of `kind` from, on disk @param {string} kind @param {number} v */
export const fileOf = (kind, v) => `${ROOT}${paths.static}${pathOf(kind, v)}`;

/** whether `bytes` are the engine's own: its size and its hash @param {Uint8Array | undefined} bytes */
const holds = (bytes, e) => !!bytes && bytes.length === e.bytes && hashBytes(bytes) === e.blake3;

const read = (file) => (existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined);

/** the engine's bytes from this checkout's git history, if it holds the commit */
function fromGit(kept) {
	try {
		return new Uint8Array(execFileSync('git', ['cat-file', 'blob', kept], { cwd: ROOT, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }));
	} catch {
		return undefined;
	}
}

/** the engine's bytes from the public repository, at the commit it is kept at */
async function fromGitHub(kept) {
	const at = kept.indexOf(':');
	const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${kept.slice(0, at)}/${kept.slice(at + 1)}`);
	return res.ok ? new Uint8Array(await res.arrayBuffer()) : undefined;
}

/** writes bytes so a reader never sees half a file */
function put(file, bytes) {
	mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
	writeFileSync(`${file}.part`, bytes);
	renameSync(`${file}.part`, file);
}

/**
 * Engine `v` of `kind` in place where the site serves it, and its bytes; throws naming it where no source holds them.
 * @param {string} kind @param {number} v @returns {Promise<Uint8Array>}
 */
export async function engineBytes(kind, v) {
	const e = (MANIFEST[kind] ?? []).find((x) => x.v === v);
	if (!e) throw new Error(`no ${kind} engine ${v} is frozen (aven/kernel/sandbox/engines.json)`);
	const served = fileOf(kind, v), cached = `${CACHE}/${e.blake3}.js`;
	let bytes = read(served);
	if (holds(bytes, e)) return bytes;
	for (const get of [() => read(cached), () => e.kept && fromGit(e.kept), () => e.kept && fromGitHub(e.kept).catch(() => undefined)]) {
		bytes = await get();
		if (!holds(bytes, e)) continue;
		if (!holds(read(cached), e)) put(cached, bytes);
		put(served, bytes);
		return bytes;
	}
	throw new Error(`${kind} engine ${v} (${e.blake3.slice(0, 16)}…) is not where it is kept (${e.kept ?? 'no kept place'}), nor in ${CACHE}`);
}

/** every frozen engine in place; how many had to be fetched */
export async function fetchEngines() {
	let fetched = 0;
	for (const [kind, list] of Object.entries(MANIFEST))
		for (const e of list) {
			if (holds(read(fileOf(kind, e.v)), e)) continue;
			await engineBytes(kind, e.v);
			fetched++;
		}
	return fetched;
}

/** the vite plugin: every frozen engine in place before the dev server or the build starts */
export const frozenEngines = () => ({
	name: 'frozen-engines',
	async config() {
		const n = await fetchEngines();
		if (n) console.log(`frozen engines: ${n} fetched by hash`);
	}
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const n = await fetchEngines();
	console.log(n ? `fetched ${n} frozen engines, each checked against its hash` : 'every frozen engine is in place');
}
