/*
 * This tab's avenDB device, the one every page of the site shares: the person's account on this browser, loaded once,
 * unlocked once with their passkey, and kept open as long as the tab lives, so that leaving avenDB for another page of
 * the site and coming back, or opening a page of its own that reads it (the Proposals app's AIPs), asks for no second
 * unlock and runs no second device. Here alone the device's WebAssembly is loaded (./device/avendb_browser.js), its
 * shelf in the browser's private file system opened (./device/store.js) and what opens it again read (`meta`),
 * the device started (founding the person's vault, linking this browser to it, or unlocking it), every op sent to it
 * with the passkey's ceremony where its vault's owners approve it, and what it shows of its world read as it changes.
 * In the Mac app the device is the app's own, run natively beside it (./native.js): the page reaches it through the
 * app's bridge, and never runs a second one; each of its ceremonies runs in the app's sign-in sheet.
 * ./Account.svelte, avenDB's own page, sets the account up, signs in, links and forgets it through this one holder.
 *
 * A page that reads or changes the person's avenDB:
 *
 *   import { onMount } from 'svelte';
 *   import { session } from '$lib/avendb/session.svelte.js';
 *   import Unlock from '$lib/avendb/Unlock.svelte';
 *
 *   // loads this browser's device, or takes up the one this tab opened already, and never asks for the passkey; the
 *   // function it gives back is onMount's cleanup, which stops watching the device for this page
 *   onMount(() => session.boot());
 *
 *   {#if session.phase === 'open' && session.world}
 *     … session.world, and session.acting, the vault the person acts as …
 *   {:else}
 *     <Unlock />   (Unlock on this browser, set up or sign in on /app/avendb/, or why not)
 *   {/if}
 *
 *   const aips = await session.ask({ op: 'aips' });   // a read, as it is: { ok } or { refused, why }
 *   const done = await session.run('Promoting the AIP', { op: 'aip_promote', entry, as: session.acting });
 *   // a change, with the passkey's ceremony where it takes one: what it did, or null, with why in session.error
 *
 * The phase: `loading` until it knows; `new` where this browser holds no account (set one up or sign in on avenDB's
 * page); `closed` where it holds one, locked, which `unlock` opens in one ceremony; `open`; `broken` where the Mac
 * app's device didn't start, with why in `error`.
 */

import { native } from '$lib/native';
import { allowed, answer, reads, refs } from './ops.js';
import { acting as actingIn, plain } from './vaults.js';

/** The name of this browser's shelf in OPFS (./device/store.js). */
const STORE = 'avendb-browser';

/** Who asks for the passkey: the browser, or in the Mac app its sign-in sheet on maia.city ($lib/avendb/device/passkey.js). */
export const asks = native() ? 'a sign-in sheet asks for your passkey' : 'your browser asks for your passkey';

/** This device, as the person sees it, and the same at the start of a sentence. */
export const [here, Here] = native() ? ['this Mac', 'This Mac'] : ['this browser', 'This browser'];

/** The changes a vault's owners may have to approve, with the passkey: owners, devices, Owner shares, settings and
 *  new vaults (avendb/docs/ARCHITECTURE.md §8). */
const APPROVED = ['share', 'revoke', 'settings', 'found'];

/** @typedef {'loading' | 'new' | 'closed' | 'open' | 'broken'} Phase */
/**
 * How a start shows its steps (./steps.js, ./Signing.svelte): `step` marks one of the page's own as it begins, and
 * `device` hands over the function the device shows its own by, from when it starts on. A page that shows none starts
 * the device `QUIET`ly.
 * @typedef {{ step: (step: string) => void, device: () => (report: any) => void }} Steps
 */
/** @type {Steps} */
const QUIET = { step: () => {}, device: () => () => {} };

/** @type {any} the device's WebAssembly */
let avendb = null;
/** @type {any} in the Mac app, its device beside it (./native.js): null where the page runs the device; state, as
 *  pages read it to know whose device it is */
let mac = $state.raw(null);
/** @type {any} the page's store, its device's shelf in OPFS (./device/store.js) */
let store = null;

/** @type {Phase} */
let phase = $state('loading');
/** @type {any} the device once it runs: this browser's, or in the Mac app the bridge to the app's (`NativeDevice`) */
let device = $state.raw(null);
/** @type {any} what opens this browser's device again, as its shelf keeps it (avendb-browser's `Meta`): kept as a
 *  plain object, as it comes */
let meta = $state.raw(null);
/** what the device shows of its world (avendb-browser's `World::to_json`): kept whole, as it comes */
let world = $state.raw(/** @type {import('./vaults.js').WorldView | null} */ (null));
/** the vault the person looks at, picked in avenDB's nav pill (./Shell.svelte): their own until they pick another */
let vault = $state('');
/** what the page is doing for the person, and what went wrong last, where it shows them */
let doing = $state('');
let error = $state('');

/** The first load of this tab, under way or over: `boot` starts it once. @type {Promise<void> | null} */
let booting = null;
/** The unlock under way, which a second click joins rather than asking for the passkey twice.
 *  @type {Promise<void> | null} */
let unlocking = null;
/** How many pages hold the session now (`boot`): while one does and the device is open, what it holds is shown as it
 *  changes (`watch`). */
let holders = 0;
/** What stands for the watch under way, if any: a watch whose token is no longer this one stops after the change it
 *  waits for. @type {object | null} */
let watching = null;
/** The device the watch under way watches. @type {any} */
let watched = null;

const hex = (/** @type {Uint8Array} */ b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (/** @type {string} */ s) => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/**
 * Loads this tab's device, once: in the Mac app the app's, open already, to unlock, or none yet; in a browser its
 * WebAssembly, its shelf and what opens it again, if it holds an account. It never asks for the passkey. Each call
 * holds the session for the page that makes it, which sees what the device holds as it changes, and gives back the
 * function that lets go of it again: onMount's cleanup.
 * @returns {() => void}
 */
function boot() {
	if (typeof window === 'undefined') return () => {};
	void load();
	holders += 1;
	if (phase === 'open') watch();
	let gone = false;
	return () => {
		if (gone) return;
		gone = true;
		holders -= 1;
		if (!holders) watching = null;
	};
}

/** Loads this tab's device once, as `boot` does, without holding the session for a page: the app's way in waits for
 *  it to know whether this browser holds the person's account ($lib/app/entry.js). Never fails. */
function load() {
	if (typeof window === 'undefined') return Promise.resolve();
	booting ??= start();
	return booting;
}

async function start() {
	if (native()) {
		await openMac().catch((/** @type {Error} */ e) => {
			error = `The Mac app's avenDB didn't start: ${e?.message ?? e}`;
			phase = 'broken';
		});
		return;
	}
	try {
		const pkg = await import('./device/avendb_browser.js');
		await pkg.default();
		avendb = pkg;
		const stores = await import('./device/store.js');
		store = await stores.open(STORE);
		meta = (await avendb.storeMeta(store)) ?? null;
		phase = meta ? 'closed' : 'new';
	} catch (e) {
		error = `This browser can't be a device: ${/** @type {Error} */ (e).message}`;
		phase = 'new';
	}
}

/** In the Mac app: its device beside it, open already, to unlock, or none yet. The app runs avenDB natively, and
 *  the page never runs a second device beside it. */
async function openMac() {
	const bridge = await import('./native.js');
	const status = await bridge.status();
	mac = bridge;
	meta = status.meta ?? null;
	if (meta && status.device) running(new mac.NativeDevice(status.device));
	else phase = meta ? 'closed' : 'new';
}

/** In the Mac app: its device runs from here on, its folder keeping what opens it again. @param {any} info */
async function macOpened(info) {
	meta = (await mac.call('status')).meta;
	running(new mac.NativeDevice(info));
}

/**
 * In the Mac app: calls `name` with `args` on its device, which starts it, showing the steps of its start by
 * `shows` as the device reports them (`steps`) while the call is under way, and once more as it ends.
 * @param {(report: any) => void} shows @param {string} name @param {...unknown} args
 */
async function stepping(shows, name, ...args) {
	let going = true;
	const polling = (async () => {
		while (going) {
			const report = await mac.call('steps').catch(() => null);
			// the last start's, over, until this one's begins
			if (going && report && !report.over) shows(report);
			await new Promise((r) => setTimeout(r, 150));
		}
	})();
	try {
		return await mac.call(name, ...args);
	} finally {
		going = false;
		await polling;
		const report = await mac.call('steps').catch(() => null);
		if (report) shows(report);
	}
}

async function ceremonies(/** @type {string | undefined} */ id) {
	const passkey = await import('./device/passkey.js');
	return { passkey, ...passkey.ceremonies(avendb, id) };
}

/** A sign-in whose passkey roots no vault the other side holds: say which button sets one up, and mark it so (`code`
 *  'no-account'), for the app's way in to set one up instead. @param {Error} e */
const noAccount = (e) => {
	if (!/no vault of this passkey/.test(e.message)) throw e;
	const why = new Error(
		'This passkey has no account yet: set one up with “Use my maiaCITY passkey”, ' +
			'or pick the passkey you set yours up with.'
	);
	throw Object.assign(why, { code: 'no-account' });
};

/**
 * Founds the person's human vault, with the passkey they signed up to maiaCITY with, or with one made here if `fresh`:
 * the unlock, which is the passkey's pass for this new device, and one ceremony for the vault and this device in it,
 * which also claims the server if nobody has yet; one ceremony more to make the passkey. This device goes by `name`,
 * reaches avenDB's server `server` through its relay `relay`, and the vault gives the server a backup cap, keeping its
 * ciphertext, unless `backup` is off: then a relay cap, which lets their devices through and keeps nothing. `person`
 * names the passkey made. It shows its steps by `at`.
 * @param {boolean} fresh
 * @param {{ name: string, relay: string, server: string, backup: boolean, person: string }} how
 * @param {Steps} [at]
 */
async function found(fresh, { name, relay, server, backup, person }, { step, device: shown } = QUIET) {
	if (mac) {
		await macOpened(await stepping(shown(), 'found', name, relay, server, backup));
		return;
	}
	const { passkey, unlock, sign, held } = await ceremonies(undefined);
	if (fresh) step('make');
	const made = fresh ? await passkey.create(person || name) : null;
	if (made) held.id = made.id;
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const unlockNew = (/** @type {Uint8Array<ArrayBuffer>} */ challenge) => unlock(nonce, challenge);
	const shows = shown();
	const d = await avendb.Device.found(name, relay, server, made?.spki, unlockNew, sign, backup, shows, store);
	step('save');
	await started(d, nonce, held.id, { name, relay });
}

/**
 * Links this browser to the person's vault through `through`: the code another of their devices shows, or avenDB's
 * server's, which hands over their vault for their passkey alone. One ceremony, the unlock, which is the passkey's pass
 * for this new device and signs the edit that adds it to their vault too. This device goes by `name`, through relay
 * `relay`. It shows its steps by `at`.
 * @param {string} through @param {{ name: string, relay: string }} how @param {Steps} [at]
 */
async function link(through, { name, relay }, { step, device: shown } = QUIET) {
	if (mac) {
		await macOpened(await stepping(shown(), 'link', name, relay, through).catch(noAccount));
		return;
	}
	const { unlock, held } = await ceremonies(undefined);
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const unlockNew = (/** @type {Uint8Array<ArrayBuffer>} */ challenge) => unlock(nonce, challenge);
	const d = await avendb.Device.link(name, relay, through, unlockNew, shown(), store).catch(noAccount);
	step('save');
	await started(d, nonce, held.id, { name, relay });
}

/**
 * A sign-in to maiaCITY's API in the ceremony that unlocks this browser's account ($lib/app/entry.js): the API's
 * challenge, base64url, which the unlock is over, and what takes the ceremony's assertion, as the API takes a sign-in.
 * @typedef {{ challenge: string, finish: (assertion: object) => void }} Login
 */

/**
 * Opens the account this browser, or the app, holds, in the one ceremony of the passkey that unlocks it, only where it
 * is closed: it shows its steps by `at`, and a second call while it is under way joins it. With `login`, the same
 * ceremony signs the person in to the app too (in a browser: the Mac app signs in with its own key). A store another
 * tab holds open fails before the passkey is asked (`code` 'held'). A store of the device taken out of its vault, or
 * kept before avenDB started fresh, opens nothing: it is put aside, never deleted, the account is new here again, and
 * it fails saying so. Fails with why not.
 * @param {Steps} [at] @param {Login | null} [login]
 * @returns {Promise<void>}
 */
function unlock(at = QUIET, login = null) {
	if (phase !== 'closed') return unlocking ?? Promise.resolve();
	unlocking ??= (async () => {
		try {
			await opening(at, login);
		} catch (e) {
			if (!String(/** @type {Error} */ (e)?.message ?? e).includes('holds no vault this device belongs to')) throw e;
			await (mac ? mac.call('forget') : store.aside());
			[meta, phase] = [null, 'new'];
			throw new Error(
				`What ${here} kept holds no vault of yours: it was taken out of your vault, or kept before avenDB started fresh, so it is put aside. Sign in or set up your account again with your passkey.`
			);
		} finally {
			unlocking = null;
		}
	})();
	return unlocking;
}

/** Opens the device this browser, or the app, holds, in the unlock alone, over the API's challenge with `login`, whose
 *  assertion it hands over before the device opens: it marks its own steps with `step` and hands the device the
 *  function it shows its own by with `device`. @param {Steps} at @param {Login | null} login */
async function opening({ step, device: shown }, login) {
	if (mac) return macOpened(await stepping(shown(), 'open'));
	// the store first, so that a tab that can't open it never asks for the passkey: one tab at a time holds it
	await store.hold().catch(() => {
		const why = new Error(`avenDB is open in another tab of ${here}: it opens in one tab at a time`);
		throw Object.assign(why, { code: 'held' });
	});
	const { passkey, unlock } = await ceremonies(meta.credential);
	step('unlock');
	let unlocked;
	try {
		unlocked = await unlock(unhex(meta.nonce), login ? passkey.unbase64url(login.challenge) : undefined);
	} catch (e) {
		await store.release().catch(() => {});
		throw e;
	}
	login?.finish(signedIn(passkey, unlocked));
	running(await avendb.Device.open(unlocked, shown(), store));
}

/**
 * Ceremony `c` as maiaCITY's API takes a sign-in (WebAuthn's JSON, as @simplewebauthn/browser hands it over): its
 * assertion alone. Its PRF outputs, from which the device's keys come, never leave the page.
 * @param {any} passkey ./device/passkey.js @param {any} c
 */
const signedIn = (passkey, c) => ({
	id: c.id,
	rawId: c.id,
	type: 'public-key',
	response: {
		clientDataJSON: passkey.base64url(c.clientDataJSON),
		authenticatorData: passkey.base64url(c.authenticatorData),
		signature: passkey.base64url(c.signature)
	},
	clientExtensionResults: {}
});

/** The device runs from here on, its shelf keeping what opens it again, even should that fail: it can still show
 *  its code, for the person's next device to link through. @param {any} d @param {Uint8Array} nonce
 *  @param {string} credential @param {{ name: string, relay: string }} how */
async function started(d, nonce, credential, { name, relay }) {
	meta = { name, relay };
	running(d);
	meta = await d.keep(hex(nonce), credential);
}

/** Device `d` runs, for every page of the tab, and the pages holding it see what it holds. @param {any} d */
function running(d) {
	device = d;
	phase = 'open';
	if (holders) watch();
}

/** Shows what the device holds, then again each time it changes as its other devices sync with it, until it closes,
 *  another takes its place or no page holds the session any more. */
function watch() {
	const d = device;
	if (!d || (watching && watched === d)) return;
	const token = (watching = {});
	watched = d;
	const on = () => watching === token && device === d;
	(async () => {
		let [edits, keys] = await d.size();
		await refresh();
		while (on() && (await d.changed(edits, keys)) && on()) {
			[edits, keys] = await d.size();
			await refresh();
		}
	})().catch((/** @type {Error} */ e) => (error = `Showing what arrives failed: ${e.message}`));
}

/** Reads the device's world again, as it is now. */
async function refresh() {
	const d = device;
	if (!d) return;
	/** @type {import('./vaults.js').WorldView | null} */
	const w = answer(await send({ op: 'world' })) ?? null;
	if (d === device) world = w;
}

/**
 * Op `op` on the device: the one way a page reads or changes the database (./ops.js, avendb/docs/ARCHITECTURE.md
 * §8), on the page's own device and on the Mac app's alike. A change takes the passkey's ceremony, which the device
 * runs only where the vault's owners approve it (in the Mac app, in its sign-in sheet); asked first, the device says
 * whether it will, and what the page shows it doing says so. `read` hands over a file's bytes, for `put_file` and a
 * `create` that brings a file (./ops.js `brings`). The device's answer: `{ ok }`, or `{ refused, why }`.
 * @param {any} op @param {(at: number, n: number) => Promise<Uint8Array>} [read]
 */
async function send(op, read) {
	const d = device;
	if (!d) throw new Error('avenDB isn’t open on this page yet');
	if (reads(op)) return d.run(op);
	if (APPROVED.includes(op?.op) && doing) {
		const [verdict] = (await d.run({ op: 'may', ops: [op] }))?.ok ?? [];
		if (allowed(verdict) && verdict !== true) doing = `${doing}: ${asks} once`;
	}
	return d.run(op, mac ? undefined : (await ceremonies(meta.credential)).sign, read);
}

/**
 * Runs `work` as `what`, showing what it does and what went wrong: whether it went through.
 * @param {string} what @param {() => Promise<unknown>} work
 */
async function attempt(what, work) {
	[doing, error] = [what, ''];
	try {
		await work();
		return true;
	} catch (e) {
		error = plain(/** @type {Error} */ (e).message ?? String(e));
		return false;
	} finally {
		doing = '';
	}
}

/**
 * Runs `work` as `what`, then shows what changed: whether it went through.
 * @param {string} what @param {() => Promise<unknown>} work
 */
async function change(what, work) {
	const ok = await attempt(what, work);
	if (ok) await refresh();
	return ok;
}

/**
 * Runs op `op` as `what`, a change that brings file `file` (./ops.js `brings`), its length set in the op and its bytes
 * handed over a megabyte at a time, whatever its size: what it did, or `null` if it didn't go through.
 * @param {string} what @param {any} op @param {Blob} file
 */
async function bring(what, op, file) {
	/** @param {number} at @param {number} n */
	const read = async (at, n) => {
		if (file.size > 0) doing = `${what}: ${Math.floor((100 * at) / file.size)} %`;
		return new Uint8Array(await file.slice(at, at + n).arrayBuffer());
	};
	const sized = op.op === 'create' ? { ...op, file: { ...op.file, len: file.size } } : { ...op, len: file.size };
	let done = null;
	const ok = await change(what, async () => (done = answer(await send(sized, read))));
	return ok ? done : null;
}

/** Renames this device, its card's title, which the person's other devices show it by. @param {string} name */
async function rename(name) {
	if (!name || name === meta.name) return;
	await (mac ? mac.call('rename', name) : device.rename(name));
	meta = { ...meta, name };
}

/** Locks the account here again, as the person signs out of the app: the device lets go of its store, and the next
 *  unlock opens it again. In the Mac app its device runs on beside the app, which signs out of its own key alone. */
async function lock() {
	if (mac) return;
	const d = device;
	watching = null;
	[device, world, vault] = [null, null, ''];
	if (meta) phase = 'closed';
	await d?.close().catch(() => {});
}

/** Forgets the account here: the device lets go, and its shelf is put aside, never deleted, and a new one is in use,
 *  in the app's folder or in OPFS; the account is new here, and every page of the tab sees it so. */
async function forget() {
	await device?.close();
	watching = null;
	await (mac ? mac.call('forget') : store.aside());
	[device, meta, world, vault, phase] = [null, null, null, '', 'new'];
}

/** A QR code of `text`, as SVG, `size` pixels wide: drawn by the device's WebAssembly, or in the Mac app by the app.
 *  @param {string} text @param {number} size @returns {Promise<string>} */
const qr = async (text, size) => (mac ? mac.call('qrSvg', text, size) : avendb.qrSvg(text, size));

/** What the vaults' screens do, each acting for the vault it names (./Shell.svelte's `api`, beside what its page adds). */
const api = {
	/**
	 * Runs change op `op` as `what` (./ops.js, avendb/docs/ARCHITECTURE.md §8): an entry's change, a share, a
	 * revocation, a setting, new vaults, a mark, a name, acting for the vault the op names (`as`). What it did, or
	 * `null` if it didn't go through, with why shown.
	 * @param {string} what @param {object} op
	 */
	run: async (what, op) => {
		let done = null;
		const ok = await change(what, async () => (done = answer(await send(op))));
		return ok ? done : null;
	},
	/**
	 * Runs change ops `ops` one after another as `what`, each `"$n"` in one the entry op n created (./ops.js
	 * `refs`), then shows what changed once: their answers, or `null` where one didn't go through, the rest not run.
	 * @param {string} what @param {object[]} ops
	 */
	runAll: async (what, ops) => {
		/** @type {any[]} */
		const done = [];
		const ok = await change(what, async () => {
			for (const op of ops) done.push(answer(await send(refs(op, done))));
		});
		return ok ? done : null;
	},
	/**
	 * Runs op `op` as it is, a read or a change, as the studio's console and the screens' reads do: the device's
	 * answer, `{ ok }` or `{ refused, why }`.
	 * @param {object} op
	 */
	ask: (op) => send(op),
	/** Vault `vault`'s database as this device holds it, for the database studio. @param {string} vault */
	database: async (vault) => answer(await send({ op: 'database', vault })),
	/** The database's log: every signed edit this device holds, for the studio's History. */
	log: async () => answer(await send({ op: 'log' })),
	/** What the device does in the background, `{ running, ended }`, for the studio's Jobs. */
	jobs: async () => answer(await send({ op: 'jobs' })),
	/** A note's main line, its proposals and every edit of it, for its page. @param {string} entry */
	note: async (entry) => answer(await send({ op: 'note', entry })),
	/**
	 * Brings file `file` into vault `vault`, tagged `tags`, acting for `actor`: sealed onto this device's shelf a
	 * megabyte at a time, whatever its size, then an entry that brings it, which syncs as any edit does. What it
	 * made, `{ entry, root, size }`, or `null`.
	 * @param {string} actor @param {string} vault @param {File} file @param {string} media @param {string[]} tags
	 */
	putFile: (actor, vault, file, media, tags) =>
		bring(`Adding ${file.name}`, { op: 'put_file', vault, name: file.name, media, tags, as: actor }, file),
	/**
	 * Runs op `op` as `what`, bringing file `file` as `putFile` does, its length set in the op: a `create` whose entry
	 * and file are one edit (`file: { name?, media? }`), answering `{ entry, root, size }`, or a `put_file` into the
	 * entry it names (`entry`), one edit on its main line, answering `{ entry, edit, root, size }`. What it did, or
	 * `null` if it didn't go through.
	 * @param {string} what @param {object} op @param {Blob} file
	 */
	bring: (what, op, file) => bring(what, op, file),
	/**
	 * Bytes `from` to `to` of the file whose root is `root` and whose sealed size is `size`, from this device's
	 * store or fetched from a peer that may hand them over.
	 * @param {string} root @param {number} size @param {number} from @param {number} to
	 * @returns {Promise<Uint8Array>}
	 */
	readFile: async (root, size, from, to) => {
		const out = await send({ op: 'read_file', root, size, from, to });
		answer(out);
		return out.bytes;
	}
};

/** This tab's avenDB session: what it is now, read as state, and what it does. */
export const session = {
	/** @returns {Phase} */
	get phase() {
		return phase;
	},
	/** what the device shows of its world, once open: refreshed as it changes while a page holds the session */
	get world() {
		return world;
	},
	/** the vault the person looks at: the one they picked in avenDB's nav pill, else their own */
	get vault() {
		return world && world.vaults.some((v) => v.id === vault) ? vault : (world?.mine ?? '');
	},
	set vault(id) {
		vault = id;
	},
	/** the vault the person acts as in the vault they look at, as the device says (the world's `acting`): the vault
	 *  itself where theirs owns it, else the vault of theirs that holds the strongest share over it; '' until open */
	get acting() {
		return world ? actingIn(world, this.vault).as : '';
	},
	/** the person's name: their own vault's profile, avenDB being where a person's profile lives (Samuel 2026-10-18,
	 *  nothing of it in maiaCITY's database); '' until the device shows it */
	get name() {
		const w = world;
		return w?.vaults.find((v) => v.id === w.mine)?.name ?? '';
	},
	/** what opens the device again, its name and relay among it, once it holds an account */
	get meta() {
		return meta;
	},
	/** the device, once open: this browser's, or in the Mac app the bridge to the app's */
	get device() {
		return device;
	},
	/** in the Mac app, its bridge (./native.js), through which the page calls the app's device; else null */
	get mac() {
		return mac;
	},
	/** what the page is doing for the person, which a page shows while it lasts */
	get doing() {
		return doing;
	},
	set doing(what) {
		doing = what;
	},
	/** what went wrong last, in the person's words, or why the device couldn't start */
	get error() {
		return error;
	},
	set error(why) {
		error = why;
	},
	boot,
	load,
	unlock,
	lock,
	found,
	link,
	forget,
	rename,
	refresh,
	qr,
	attempt,
	change,
	api,
	run: api.run,
	runAll: api.runAll,
	ask: api.ask
};
