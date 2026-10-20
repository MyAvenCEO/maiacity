// The site's media as everyone reads them: each file of the media manifest (src/lib/media/manifest.json) by its hash
// from api.maia.city/vault/files/<hash>, which avenDB's feed answers (deploy/Caddyfile; the old media vault's gateway
// retired, #1112). Each is read by ranges, a window at a time as a player reads a film, and hashed (BLAKE3): it must
// come back whole and its own, from avenDB (`x-served-by: avenDB`). A picture is asked whole too, as a page's <img>
// asks it, a sound or a film a range from its middle, as a player seeking asks. It lists apart those Maia City keeps
// private (404: its feed holds only what everyone may read, so they are no failure, as long as a page can read the
// 404), and asks once what a browser asks before a range (its CORS preflight).
//
//   bun scripts/site-media-check.mjs   check them all, list what failed, and fail if any did
//
// MEDIA_BASE points it at another address than https://api.maia.city/vault/files, MEDIA_MANIFEST at another manifest.
import { appendFileSync, readFileSync } from 'node:fs';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const ROOT = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(process.env.MEDIA_MANIFEST ?? `${ROOT}src/lib/media/manifest.json`, 'utf8'));
const BASE = process.env.MEDIA_BASE ?? 'https://api.maia.city/vault/files';
/** The most bytes one range asks: avenDB's feed answers at most 8 MiB at once. */
const WINDOW = 8 << 20;
/** How many files are read at once. */
const AT_ONCE = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A GET of `url` with `headers`, tried three times where the network or the server (5xx) fails. */
async function get(url, headers = {}) {
	for (let tries = 1; ; tries++) {
		try {
			const res = await fetch(url, { headers });
			if (res.status < 500 || tries === 3) return res;
		} catch (e) {
			if (tries === 3) throw e;
		}
		await sleep(1000 * tries);
	}
}

/** What avenDB's feed answers for a file Maia City keeps private: it has no such medium. */
class Private extends Error {}

/** Bytes `at` to `to` (past its last) of `url`: they and the file's length its Content-Range names. */
async function range(url, at, to) {
	const res = await get(url, { range: `bytes=${at}-${to - 1}` });
	// a page can read the refusal only with Access-Control-Allow-Origin: else it sees a failed load (deploy/Caddyfile)
	if (res.status === 404) throw new Private(res.headers.get('access-control-allow-origin') ? '' : 'no page can read its 404');
	if (res.status !== 206) throw new Error(`answered ${res.status} for bytes ${at}-${to - 1}`);
	if (res.headers.get('x-served-by') !== 'avenDB') throw new Error(`bytes ${at}-${to - 1} came from another server than avenDB`);
	const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
	if (!part || Number(part[1]) !== at) throw new Error(`named ${res.headers.get('content-range')} for bytes ${at}-${to - 1}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (bytes.length !== Number(part[2]) - at + 1) throw new Error(`sent ${bytes.length} bytes for ${part[0]}`);
	return { bytes, len: Number(part[3]), type: res.headers.get('content-type') ?? '' };
}

/** File `hash` of the manifest, `mime`: its length, or it throws why not. */
async function check(hash, mime) {
	const url = `${BASE}/${hash}`;
	const first = await range(url, 0, WINDOW);
	if (first.type.split(';')[0] !== mime) throw new Error(`is ${first.type}, not ${mime}`);
	const hasher = blake3.create().update(first.bytes);
	for (let at = first.bytes.length; at < first.len; ) {
		const next = await range(url, at, Math.min(first.len, at + WINDOW));
		hasher.update(next.bytes);
		at += next.bytes.length;
	}
	const got = bytesToHex(hasher.digest());
	if (got !== hash) throw new Error(`hashes to ${got}`);
	if (mime.startsWith('image/')) {
		const whole = await get(url);
		const bytes = new Uint8Array(await whole.arrayBuffer());
		if (whole.status !== 200 || bytes.length !== first.len) throw new Error(`asked whole, answered ${whole.status} with ${bytes.length} bytes`);
	} else if (first.len > 200) {
		const mid = Math.floor(first.len / 2);
		const seek = await range(url, mid, mid + 100);
		if (seek.bytes.length !== 100) throw new Error('a range from its middle came back short');
	}
	return { len: first.len };
}

/** What a browser asks before it asks a range (its CORS preflight), of file `hash`: why not, or ''. */
async function preflight(hash) {
	const res = await fetch(`${BASE}/${hash}`, {
		method: 'OPTIONS',
		headers: { origin: 'https://maia.city', 'access-control-request-method': 'GET', 'access-control-request-headers': 'range' }
	});
	const allows = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(/\s*,\s*/);
	if (res.status >= 300) return `the preflight answered ${res.status}`;
	if (!res.headers.get('access-control-allow-origin')) return 'the preflight allows no origin';
	if (!allows.includes('range') && !allows.includes('*')) return 'the preflight doesn’t allow Range';
	return '';
}

const files = Object.entries(manifest);
const results = new Map();
let next = 0;
const started = Date.now();
await Promise.all(
	Array.from({ length: AT_ONCE }, async () => {
		while (next < files.length) {
			const [hash, { mime, title }] = files[next++];
			try {
				results.set(hash, { title, mime, ...(await check(hash, mime)) });
			} catch (e) {
				const why = e?.message ?? String(e);
				results.set(hash, { title, mime, ...(e instanceof Private ? { private: true, ...(why && { failed: why }) } : { failed: why }) });
			}
		}
	})
);
const flight = await preflight(files[0][0]).catch((e) => `the preflight failed: ${e?.message ?? e}`);

const all = [...results.values()];
const failed = [...results].filter(([, r]) => r.failed);
const kept = all.filter((r) => r.private && !r.failed);
const bytes = all.reduce((n, r) => n + (r.len ?? 0), 0);
const lines = [
	`## The site's media: ${files.length} files`,
	'',
	`- ${all.length - failed.length - kept.length} came back whole and their own from avenDB (${(bytes / 1e6).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)} s)`,
	`- ${kept.length} private in Maia City, so its feed holds none of them (404)`,
	`- ${failed.length} failed`,
	`- the browser's preflight before a range: ${flight || 'allowed'}`,
	...failed.map(([hash, r]) => `  - ${hash} (${r.title}, ${r.mime}): ${r.failed}`)
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
if (failed.length || flight) process.exit(1);
