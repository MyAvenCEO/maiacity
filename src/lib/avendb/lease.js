/*
 * An unlocked device kept across a new load of the page, for a short while (Samuel's iPhone, 2026-10-27: every back
 * swipe that reached an entry of an earlier load, and every time iOS closed the app in the background, loaded the page
 * again, locked, and the passkey was asked again and again). After an unlock the page keeps a lease: the PRF output on
 * the device's salt that the unlock brought back (the device's `pad`), sealed with AES-GCM, and its passkey's id. A new
 * load within the lease opens the device by it (avendb-browser's `Device::open_leased`), with no ceremony.
 *
 * What it never keeps: the passkey's own PRF output, from which its keys come. The pad alone unmasks this device's
 * secret only, a device its vault can take out; a change only the vault's owners make still asks for the passkey.
 * The seal's key is a WebCrypto key that no script can read out (`extractable` false): kept in IndexedDB, where a
 * browser keeps such a key (WebKit wraps it with the Keychain), the one thing a page keeps there; where IndexedDB
 * isn't at hand, raw in the tab's sessionStorage, which a closed app forgets. The sealed lease is in localStorage,
 * nothing without the key. It ends `LIFE` after the page was last seen open, or at once when the person locks or
 * forgets the account here.
 */

/** How long a lease lasts after the page was last seen open (ms). */
export const LIFE = 30 * 60_000;
/** How often an open, visible page renews it (ms). */
export const RENEW = 60_000;

const LEASE = 'avendb:lease:v1';
const RAW_KEY = 'avendb:lease-key:v1';
const DB = 'avendb-lease';

const hex = (/** @type {Uint8Array} */ b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (/** @type {string} */ s) => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const HEX64 = /^[0-9a-f]{64}$/;

/** What the seal binds the pad to: the device, its passkey and the lease's end. */
const bound = (/** @type {{ device: string, passkey: string, until: number }} */ l) =>
	new TextEncoder().encode(`avenDB lease v1|${l.device}|${l.passkey}|${l.until}`);

/** The seal's key in IndexedDB: one record, a key no script reads out. `make` makes it where there is none.
 *  @param {IDBFactory} idb @param {boolean} make @returns {Promise<CryptoKey | null>} */
function storedKey(idb, make) {
	return new Promise((resolve, reject) => {
		const open = idb.open(DB, 1);
		open.onupgradeneeded = () => open.result.createObjectStore('key');
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const done = (/** @type {CryptoKey | null} */ key) => (db.close(), resolve(key));
			const get = db.transaction('key').objectStore('key').get('seal');
			get.onerror = () => (db.close(), reject(get.error));
			get.onsuccess = async () => {
				if (get.result || !make) return done(get.result ?? null);
				try {
					const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
					const put = db.transaction('key', 'readwrite').objectStore('key').put(key, 'seal');
					put.onsuccess = () => done(key);
					put.onerror = () => (db.close(), reject(put.error));
				} catch (e) {
					db.close();
					reject(e);
				}
			};
		};
	});
}

/** The seal's key in the tab's sessionStorage, raw, made where there is none and `make`.
 *  @param {Pick<Storage, 'getItem' | 'setItem'>} s @param {boolean} make @returns {Promise<CryptoKey | null>} */
async function sessionKey(s, make) {
	let raw = s.getItem(RAW_KEY);
	if (!raw || !HEX64.test(raw)) {
		if (!make) return null;
		raw = hex(crypto.getRandomValues(new Uint8Array(32)));
		s.setItem(RAW_KEY, raw);
	}
	return crypto.subtle.importKey('raw', unhex(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * The page's lease, over its browser's storage (injected for tests).
 * @param {{ local: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, session: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, idb?: () => IDBFactory | undefined, now?: () => number }} env
 */
export function createLease({ local, session, idb = () => undefined, now = () => Date.now() }) {
	/** What the open device's lease seals again as it renews: kept in memory only while it is open.
	 *  @type {{ pad: Uint8Array<ArrayBuffer>, device: string, passkey: string } | null} */
	let held = null;

	/** The seal's key, where one is kept or, `make`, made. */
	async function key(make = false) {
		const factory = (() => { try { return idb(); } catch { return undefined; } })();
		if (factory) {
			try {
				return await storedKey(factory, make);
			} catch {
				// a browser that keeps no IndexedDB here (a private window): the tab's sessionStorage instead
			}
		}
		try {
			return await sessionKey(session(), make);
		} catch {
			return null;
		}
	}

	/** Seals what `held` holds until `LIFE` from now. */
	async function seal() {
		const h = held;
		if (!h) return;
		const k = await key(true);
		if (!k || held !== h) return;
		const lease = { v: 1, device: h.device, passkey: h.passkey, until: now() + LIFE };
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bound(lease) }, k, h.pad));
		if (held !== h) return;
		try {
			local().setItem(LEASE, JSON.stringify({ ...lease, iv: hex(iv), sealed: hex(sealed) }));
		} catch {
			// no storage: no lease, and the next load asks for the passkey as before
		}
	}

	/** Ends the lease: the page locks or forgets the account here, or it ended. The seal's key stays, sealing
	 *  nothing. @returns {null} */
	function end() {
		held?.pad.fill(0);
		held = null;
		try {
			local().removeItem(LEASE);
		} catch {
			// nothing kept
		}
		return null;
	}

	return {
		/** The device whose id is `device`, of passkey `passkey` (its id in hex), opened by an unlock that brought back
		 *  `pad`: kept for `LIFE` from now, renewed by `renew`. @param {Uint8Array} pad @param {string} device @param {string} passkey */
		async keep(pad, device, passkey) {
			if (pad?.length !== 32 || !HEX64.test(device) || !HEX64.test(passkey)) return;
			held = { pad: pad.slice(), device, passkey };
			await seal().catch(() => {});
		},
		/** Its end pushed to `LIFE` from now, while the device it keeps is open. */
		renew() {
			return seal().catch(() => {});
		},
		/** The pad and passkey of the lease of device `device`, where one is kept and hasn't ended; else null. An ended,
		 *  broken or other device's lease is dropped. @param {string} device
		 *  @returns {Promise<{ pad: Uint8Array, passkey: string } | null>} */
		async take(device) {
			let lease;
			try {
				lease = JSON.parse(local().getItem(LEASE) ?? 'null');
			} catch {
				lease = null;
			}
			if (!lease) return null;
			const fits = lease.v === 1 && lease.device === device && HEX64.test(lease.passkey) && Number.isSafeInteger(lease.until)
				&& /^[0-9a-f]{24}$/.test(lease.iv) && /^[0-9a-f]{96}$/.test(lease.sealed);
			if (!fits || lease.until <= now() || lease.until > now() + LIFE) return end();
			const k = await key(false);
			if (!k) return end();
			try {
				const pad = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(lease.iv), additionalData: bound(lease) }, k, unhex(lease.sealed)));
				return pad.length === 32 ? { pad, passkey: lease.passkey } : end();
			} catch {
				return end();
			}
		},
		end,
		/** Whether a lease is kept now (sealed, unchecked). */
		kept() {
			try {
				return !!local().getItem(LEASE);
			} catch {
				return false;
			}
		}
	};
}

/** @type {ReturnType<typeof createLease> | undefined} */
let active;
/** The page's lease, or null outside a browser. */
export function lease() {
	if (typeof window === 'undefined') return null;
	return (active ??= createLease({ local: () => localStorage, session: () => sessionStorage, idb: () => indexedDB }));
}
