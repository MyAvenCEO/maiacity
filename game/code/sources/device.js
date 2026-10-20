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
 * Before it reads them, the device asks its peers for what they hold of Maia City, before anything else it syncs
 * (avendb's `bring` op): so it reads what the server holds, not what it held when it last synced. Rows are read off the
 * device only once one of its peers handed it all it holds of the vault (`reached`), or where none can be reached at
 * all (offline, which it then reads as it is). A device still bringing the vault after `BRING` (a first sync) is read
 * from the feed this time, while its bring goes on, so the next page reads it. A device that holds none of the vault,
 * or whose avenDB is older than the ops, is read from the feed too.
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

/** How many bytes a page asks its device for at a time, as the Library reads a file ($lib/avendb/files.js). */
const WINDOW = 4 << 20;

/**
 * The device the page holds open, set by its avenDB session ($lib/avendb/session.svelte.js): `run(op)`, which answers
 * `{ ok }` or `{ refused, why }`, and `read(root, size, from, to)`, a file's bytes. Null while none is open.
 * @type {{ run: (op: object) => Promise<any>, read: (root: string, size: number, from: number, to: number) => Promise<Uint8Array> } | null}
 */
let device = null;

/** each vault's bring, once a page holds a device: the answer, or null where it took longer than `BRING` @type {Map<string, Promise<any>>} */
let brought = new Map();

/** The device the page holds open now, or `null` to read the feed again; each vault is brought again once. */
export function useDevice(d) {
	device = d ?? null;
	brought = new Map();
}

/** The device the page holds open, if any. */
export const deviceOf = () => device;

/** `p`, or null once `ms` passed. @param {Promise<any>} p @param {number} ms */
function within(p, ms) {
	let t;
	const late = new Promise((done) => (t = setTimeout(() => done(null), ms)));
	return Promise.race([p.catch(() => null), late]).finally(() => clearTimeout(t));
}

/**
 * The rows of vault `vault`'s public code of kinds `kinds`, as the device the page holds reads them, in the feed's
 * shape (`/feed/code`), once it brought the vault from its peers (`BRING`); `null` where the feed is read instead: no
 * device is open, it is still bringing the vault, it holds none of its code, or it doesn't know the ops.
 * @param {string[]} kinds @param {{ vault?: string, wait?: number }} [o]
 * @returns {Promise<any[] | null>}
 */
export async function deviceRows(kinds, { vault = MAIA_CITY, wait = BRING } = {}) {
	const d = device;
	if (!d || !/^[0-9a-f]{64}$/.test(String(vault))) return null;
	if (!brought.has(vault)) brought.set(vault, d.run({ op: 'bring', vaults: [vault] }));
	const bring = await within(brought.get(vault), wait);
	// still bringing it, or a device whose avenDB knows no `bring` yet: the feed, this time
	if (!bring?.ok) return null;
	const got = await d.run({ op: 'code', vault, type: kinds }).catch(() => null);
	if (d !== device || !Array.isArray(got?.ok) || !got.ok.length) return null;
	return got.ok;
}

/**
 * File `file` of a row the device read (`{ root, size, len }`), whole, as bytes, read off the device a window at a
 * time: from its own store, or else fetched from a peer that may hand it over and kept. Null where no device is open,
 * it can't read it, or it takes longer than `wait` (the reader has asked the feed meanwhile, after `READ`).
 * @param {{ root: string, size: number, len: number }} file @param {{ wait?: number }} [o]
 * @returns {Promise<Uint8Array | null>}
 */
export async function deviceFile(file, { wait = READ } = {}) {
	const d = device;
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
