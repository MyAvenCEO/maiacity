// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THIS DEVICE'S avenDB AS THE SOURCE OF CODE (Samuel 2026-10-20: "all games and sandboxes should load always from local
 * avenDB! Also the asset viewers"). Once a page holds the person's avenDB open, the code it runs is read off the
 * device's own copy of the coop Maia City: the views, logic modules and configs (./avendb.js `loadCode`) and the asset
 * recipes ($lib/assets/vault.js). The feed of avenDB's server (./feed.js) is read only where no device is open (signed
 * out, the API), or where the device can't answer yet.
 *
 * The device checked every signed edit, every signature and rule, as it took it from its peers, so what it reads back
 * needs no proof (H2 is the feed's, ./feed.js `provenRows`). Its rows are the feed's to the letter (avendb's `code` op,
 * `world::public_entries`: the public entries of Maia City that its vault landed), so every reader takes them as it takes
 * the feed's, and runs only what everyone may read, as before.
 *
 * Local first (Samuel 2026-10-20: "everything should be offline / local first loading … ensure our whole app respects
 * this local first pattern"): what the device holds of Maia City is read at once, whether its peers can be reached or
 * not, and the device asks them for what they hold meanwhile (avendb's `bring` op, before anything else it syncs), so
 * the next page reads that; The OS's device keeps syncing anyway. Only a device that holds none of the vault yet (a
 * first sync) waits for its bring, up to `BRING`, and is read from the feed this time where it is still bringing it. A
 * device whose avenDB is older than the ops is read from the feed too. (Until 2026-10-20 every page waited for the
 * bring first, and a server that hung sent it to the feed, which hung as well: the village's live world never stood
 * while avenDB's server restarted.)
 *
 * A page of ours framed by another (the studio's world, /games/<world>/?film) opens no avenDB of its own: it reads its
 * parent's device (`deviceOf`), the same person's, on the same origin. A frame of another origin, or none, reads none.
 */
import { MAIA_CITY } from './anchor.js';

/**
 * How long a page waits for its device to bring Maia City from its peers before it reads the feed instead (ms): a
 * device that synced before brings what changed since in a moment; a new device takes longer the first time.
 */
export const BRING = 8000;

/**
 * How long a page waits for its device to read a recipe's file before it asks the feed for it too (ms): the device
 * reads on beside the feed, and the first to hand it over is read ($lib/assets/vault.js `eitherOf`), so a light copy
 * still bringing the file's pieces from its peers is never given up on.
 */
export const READ = 6000;

/**
 * How long a page waits for its device to read back what it holds of a vault (ms): a local read answers in a moment,
 * and one that doesn't (a device stuck) sends the page to the feed rather than leave it waiting.
 */
export const ANSWER = 5000;

/** How many bytes a page asks its device for at a time, as the Library reads a file ($lib/avendb/files.js). */
const WINDOW = 4 << 20;

/**
 * The device the page holds open, set by its avenDB session ($lib/avendb/session.svelte.js): `run(op)`, which answers
 * `{ ok }` or `{ refused, why }`, and `read(root, size, from, to)`, a file's bytes. Null while none is open.
 * @type {{ run: (op: object) => Promise<any>, read: (root: string, size: number, from: number, to: number) => Promise<Uint8Array> } | null}
 */
let device = null;

/** each device's bring of each vault, asked for once: the answer @type {WeakMap<object, Map<string, Promise<any>>>} */
let brought = new WeakMap();

/** where a page leaves its device for the pages it frames (`deviceOf`) */
const SHARED = Symbol.for('maiacity.avendb.device');

/** The device the page holds open now, or `null` to read the feed again; each vault is brought again once. */
export function useDevice(d) {
	device = d ?? null;
	brought = new WeakMap();
	if (typeof window !== 'undefined') /** @type {any} */ (window)[SHARED] = device;
}

/** The device the page holds open, else the one its parent page holds (a frame of ours, same origin), if any. */
export function deviceOf() {
	if (device || typeof window === 'undefined') return device;
	try {
		return window.parent !== window ? (/** @type {any} */ (window.parent)[SHARED] ?? null) : null;
	} catch {
		// a parent of another origin: none
		return null;
	}
}

/** device `d`'s bring of vault `vault`, asked for once @param {any} d @param {string} vault */
function bringOf(d, vault) {
	let of = brought.get(d);
	if (!of) brought.set(d, (of = new Map()));
	if (!of.has(vault)) of.set(vault, d.run({ op: 'bring', vaults: [vault] }));
	return of.get(vault);
}

/**
 * What the device the page reads (`deviceOf`) brought of vault `vault` from its peers, once it has: `{ ok: { new, peers,
 * reached } }` (how many edits were new), or null with no device. A page that read the device's rows at once reads them
 * again where it brought something new.
 * @param {string} [vault]
 */
export async function whenBrought(vault = MAIA_CITY) {
	const d = deviceOf();
	return d ? bringOf(d, vault).catch(() => null) : null;
}

/** `p`, or null once `ms` passed. @param {Promise<any>} p @param {number} ms */
function within(p, ms) {
	let t;
	const late = new Promise((done) => (t = setTimeout(() => done(null), ms)));
	return Promise.race([p.catch(() => null), late]).finally(() => clearTimeout(t));
}

/**
 * The rows of vault `vault`'s public code of kinds `kinds`, as the device the page holds (or its parent page) reads
 * them, in the feed's shape (`/feed/code`): at once where it holds the vault's code, its bring going on beside; where
 * it holds none yet, once it brought the vault from its peers (`BRING`). `null` where the feed is read instead: no
 * device is open, it holds none of the vault's code and is still bringing it, or it doesn't know the ops.
 * `wait` is how long it waits for the bring, `answer` how long for the device to read its rows back (`ANSWER`).
 * @param {string[]} kinds @param {{ vault?: string, wait?: number, answer?: number }} [o]
 * @returns {Promise<any[] | null>}
 */
export async function deviceRows(kinds, { vault = MAIA_CITY, wait = BRING, answer = ANSWER } = {}) {
	const d = deviceOf();
	if (!d || !/^[0-9a-f]{64}$/.test(String(vault))) return null;
	const bring = bringOf(d, vault);
	const code = async () => {
		const got = await within(d.run({ op: 'code', vault, type: kinds }), answer);
		return d === deviceOf() && Array.isArray(got?.ok) && got.ok.length ? got.ok : null;
	};
	const held = await code();
	if (held) return held;
	// none held yet: its bring first, then what it brought; still bringing it, or a device whose avenDB knows no
	// `bring` yet: the feed, this time
	if (!(await within(bring, wait))?.ok) return null;
	return code();
}

/**
 * File `file` of a row the device read (`{ root, size, len }`), whole, as bytes, read off the device a window at a
 * time: from its own store, or else fetched from a peer that may hand it over and kept. Null where no device is open,
 * it can't read it, or it takes longer than `wait` (the reader has asked the feed meanwhile, after `READ`).
 * @param {{ root: string, size: number, len: number }} file @param {{ wait?: number }} [o]
 * @returns {Promise<Uint8Array | null>}
 */
export async function deviceFile(file, { wait = READ } = {}) {
	const d = deviceOf();
	if (!d || typeof file?.len !== 'number') return null;
	const read = async () => {
		const out = new Uint8Array(file.len);
		for (let at = 0; at < file.len; ) {
			const got = await d.read(file.root, file.size, at, Math.min(file.len, at + WINDOW));
			if (!got?.length) throw new Error('the file ends early');
			out.set(got, at);
			at += got.length;
		}
		return out;
	};
	return within(read(), wait);
}
