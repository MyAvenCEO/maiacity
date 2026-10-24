/*
 * This tab's avenDB device, the one every page of the site shares: the person's account on this browser, loaded once,
 * unlocked once with their passkey, and kept open as long as the tab lives, so that leaving avenDB for another page of
 * the site and coming back, or opening a page of its own that reads it (the Proposals app's AIPs), asks for no second
 * unlock and runs no second device. Here alone the device's WebAssembly is loaded (./device/avendb_browser.js), in a
 * worker of its own beside the page (./remote.js), so that its long work never holds the page's thread, its
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
 *
 * Once open, the device says what its key move asks of the person (K3b, `moving`): where their passkey or this device,
 * or in the Mac app its Touch ID key, still signs in SLH-DSA, the app asks once more, and `moveKeys` moves them to
 * ML-DSA-65 in one ceremony (and one touch), the device opening again as its next key. The server and the agents of the
 * aven they govern move in the same ceremony (K3c), each opening as its next key from its next start. A move that asks
 * for no ceremony, as one cut short, goes on by itself.
 */

import { tick } from 'svelte';
import { localMediaWorld } from './local-media.svelte.js';
import { command, native } from '$lib/native';
import { allowed, answer, reads, refs } from './ops.js';
import { acting as actingIn, plain } from './vaults.js';
import { createVaultContext } from './context.js';
import { createMoveChecks } from './move-checks.js';
import { beforeLocalWrite } from './local-write.js';
import { noteLifecycle } from './lifecycle.js';
import { createReactiveRead } from './reactive-read.js';
import { createWorldReader } from './world-reader.js';
import { createEntryWindow, createReadWindow, replyEntries } from './query-window.js';
import { bringEntries, learn, useDevice } from '../../../game/code/sources/device.js';
import { sync } from './sync.svelte.js';

/** The name of this browser's shelf in OPFS (./device/store.js). */
const STORE = 'avendb-browser';

/** Who asks for the passkey: the browser, or in the Mac app its sign-in sheet on maia.city ($lib/avendb/device/passkey.js). */
export const asks = native() ? 'a sign-in sheet asks for your passkey' : 'your browser asks for your passkey';

/** This device, as the person sees it, and the same at the start of a sentence. */
export const [here, Here] = native() ? ['this Mac', 'This Mac'] : ['this browser', 'This browser'];

/** The changes a vault's owners may have to approve, with the passkey: owners, devices, Owner shares, settings and
 *  new vaults (avendb/docs/ARCHITECTURE.md §8). */
const APPROVED = ['share', 'share_group', 'revoke', 'settings', 'found'];

/** @typedef {'loading' | 'new' | 'closed' | 'open' | 'broken'} Phase */
/**
 * How a start shows its steps (./steps.js, ./Signing.svelte): `step` marks one of the page's own as it begins, and
 * `device` hands over the function the device shows its own by, from when it starts on. A page that shows none starts
 * the device `QUIET`ly.
 * @typedef {{ step: (step: string) => void, device: () => (report: any) => void }} Steps
 */
/** @type {Steps} */
const QUIET = { step: () => {}, device: () => () => {} };

/** @type {any} the device's WebAssembly, as the page reaches it in its worker (./remote.js) */
let avendb = null;
/** @type {any} in the Mac app, its device beside it (./native.js): null where the page runs the device; state, as
 *  pages read it to know whose device it is */
let mac = $state.raw(null);
/** @type {any} the page's store, its device's shelf in OPFS (./device/store.js), opened in the device's worker */
let store = null;

/** @type {Phase} */
let phase = $state('loading');
/** @type {any} the device once it runs: this browser's, or in the Mac app the bridge to the app's (`NativeDevice`) */
let device = $state.raw(null);
/** @type {any} what opens this browser's device again, as its shelf keeps it (avendb-browser's `Meta`): kept as a
 *  plain object, as it comes */
let meta = $state.raw(null);
/** what the device shows of its world (avendb-browser's `World::to_json`): kept whole, as it comes */
// Accepted local data changes, before the heavier world summary is rebuilt.
let revision = $state(0);
let world = $state.raw(/** @type {import('./vaults.js').WorldView | null} */ (null));
/** the vault the person looks at, picked in avenDB's nav pill (./Shell.svelte): their own until they pick another */
let vault = $state('');
const context = createVaultContext({ world: () => world, read: () => vault, write: (id) => (vault = id) });
/** what the key move asks of the person (K3b, avendb-browser's `Moving`), while their passkey, this device or in the
 *  Mac app its Touch ID key still signs in SLH-DSA, or the server or an agent of the aven they govern does (K3c):
 *  whether their passkey signs, whether Touch ID does, whether the device moves, and how many of the aven's devices
 *  move with it; once all of it moved, the earlier keys and the old devices to remove (`retire`), which waits while
 *  this device doesn't hold what the coop's server holds (`behind`); or, nothing left to move, a checkpoint the
 *  person signs alone (`checkpoint`); null once nothing moves.
 *  @type {{ passkey: boolean, touch: boolean, device: boolean, avens?: number,
 *    retire?: { kind: 'root' | 'owner' | 'device', key: string, next?: string, vault?: string }[], behind?: boolean,
 *    checkpoint?: boolean } | null} */
let moving = $state.raw(null);
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
		const pkg = await import('./remote.js');
		await pkg.load();
		avendb = pkg;
		store = await pkg.openStore(STORE);
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
	const status = await statusOf(bridge);
	mac = bridge;
	meta = status.meta ?? null;
	if (meta && status.device) running(new mac.NativeDevice(status.device));
	else phase = meta ? 'closed' : 'new';
}

/**
 * How long the page waits for the app's status as it loads before it asks again (ms), and how many times it asks: once
 * the window was reloaded (⌘R) while the page before it had calls under way, the new page's first ask never got its
 * answer, and it waited at "One moment…" until theOS was quit (Samuel, 2026-10-21).
 */
const ASK_AGAIN = 2500;
const ASKS = 6;
/** sessionStorage: when this window last opened its page again for want of the app's status (`statusOf`), in ms
 *  since 1970; it does so once a minute at most. */
const REOPENED = 'avendb:reopened';

/**
 * In the Mac app: its status as the page loads, asked again every `ASK_AGAIN` ms while no answer has come, the first
 * answer counting. Should none come to `ASKS` asks, the page opens again, as a new one, once a minute at most; then it
 * fails, saying so.
 * @param {typeof import('./native.js')} bridge
 */
async function statusOf(bridge) {
	const late = Symbol('late');
	/** @type {ReturnType<typeof bridge.status>[]} */
	const asks = [];
	while (asks.length < ASKS) {
		asks.push(bridge.status());
		const wait = /** @type {Promise<typeof late>} */ (new Promise((r) => setTimeout(r, ASK_AGAIN, late)));
		const got = await Promise.race([...asks, wait]);
		if (got === late) continue;
		if (asks.length > 1) unanswered(`status: answered only once asked ${asks.length} times, ${ASK_AGAIN} ms apart`);
		return got;
	}
	const now = Date.now();
	let last = now;
	try {
		last = Number(sessionStorage.getItem(REOPENED)) || 0;
		sessionStorage.setItem(REOPENED, String(now));
	} catch {
		// no storage: the page never opens again, so it can't do so over and over
	}
	if (now - last > 60000) {
		unanswered(`status: no answer to ${ASKS} asks in ${(ASKS * ASK_AGAIN) / 1000} s; the page opens again`);
		// a moment for that line to reach the app's log
		await new Promise((r) => setTimeout(r, 300));
		location.reload();
		// the page goes: nothing answers here any more
		return /** @type {Promise<never>} */ (new Promise(() => {}));
	}
	unanswered(`status: no answer to ${ASKS} asks, even after the page opened again`);
	throw new Error('theOS doesn’t answer this page. Quit theOS and open it again.');
}

/** In the Mac app: its device runs from here on, its folder keeping what opens it again. @param {any} info */
async function macOpened(info) {
	meta = (await mac.call('status')).meta;
	running(new mac.NativeDevice(info));
}

/**
 * How long after the device's steps say its start is over the page waits for the call's own answer before it asks the
 * device whether it opened (`stepping`), ms: the answer to an unlock got lost on its way to the page once, after the
 * device had opened in 22 s, and the page waited at "Starting this Mac's node" for 13 minutes (Samuel, 2026-10-20).
 */
const UNANSWERED = 2000;

/** A start's answer that never came, in the app's log ($lib/native's `log_js`). @param {string} what */
function unanswered(what) {
	console.warn(`avenDB: ${what}`);
	void command('log_js', { level: 'warn', from: 'avendb', message: what }).catch(() => {});
}

/**
 * In the Mac app: calls `name` with `args` on its device, which starts it, showing the steps of its start by
 * `shows` as the device reports them (`steps`) while the call is under way, and once more as it ends. Should the
 * call's answer not come once the steps say the start is over (`UNANSWERED`), the device's status answers for it: its
 * device, where it opened, else, a while later, a failure to try again.
 * @param {(report: any) => void} shows @param {string} name @param {...unknown} args
 */
async function stepping(shows, name, ...args) {
	let going = true;
	/** @type {(info: any) => void} */
	let opened = () => {};
	/** @type {(e: Error) => void} */
	let failed = () => {};
	// what the device itself says once its start is over and the call still hasn't answered (`UNANSWERED`)
	const said = new Promise((resolve, reject) => ((opened = resolve), (failed = reject)));
	const polling = (async () => {
		let began = false;
		let over = 0;
		while (going) {
			const report = await mac.call('steps').catch(() => null);
			// the last start's, over, until this one's begins
			if (going && report && !report.over) {
				began = true;
				shows(report);
			} else if (going && began && report?.over && Date.now() - (over ||= Date.now()) >= UNANSWERED) {
				const status = await mac.call('status').catch(() => null);
				if (going && status?.open && status.device) {
					unanswered(`${name}: the device opened, but its answer never came; it answered by its status`);
					opened(status.device);
				} else if (going && Date.now() - over >= UNANSWERED * 5) {
					unanswered(`${name}: the device's start ended, its answer never came, and it isn't open`);
					failed(new Error(`avenDB’s start on ${here} ended without an answer. Try again.`));
				}
			}
			// once the answer is late, the device is asked once a second
			await new Promise((r) => setTimeout(r, over && Date.now() - over >= UNANSWERED ? 1000 : 150));
		}
	})();
	try {
		return await Promise.race([mac.call(name, ...args), said]);
	} finally {
		going = false;
		await polling;
		const report = await mac.call('steps').catch(() => null);
		if (report) shows(report);
	}
}

/** The PRF's salt for the passkey's own keys, read off the device's WebAssembly once. @type {Uint8Array | null} */
let prfSalt = null;

/**
 * The passkey's ceremonies (./device/passkey.js), with the passkey whose credential's id is `id`, here on the page, as
 * WebAuthn runs only here; their salts, which it reads off the WebAssembly at once, asked of the device's worker first:
 * the passkey's own, and the salt of the device whose own 32 bytes are `nonce`, for its unlock.
 * @param {string | undefined} id @param {Uint8Array} [nonce]
 */
async function ceremonies(id, nonce) {
	const passkey = await import('./device/passkey.js');
	prfSalt ??= await avendb.prfSalt();
	const salt = nonce ? await avendb.deviceSalt(nonce) : null;
	const salts = {
		prfSalt: () => prfSalt,
		deviceSalt: (/** @type {Uint8Array} */ n) => {
			if (!salt || !nonce || hex(n) !== hex(nonce)) throw new Error('no salt asked for this device');
			return salt;
		}
	};
	return { passkey, ...passkey.ceremonies(salts, id) };
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
 * names the passkey made, and `invite` the share of the open invite they sign up with, if any, which the device shows
 * its relay pass with, so a server that lets newcomers in by invite lets them in. It shows its steps by `at`.
 * @param {boolean} fresh
 * @param {{ name: string, relay: string, server: string, backup: boolean, person: string, invite?: string | null }} how
 * @param {Steps} [at]
 */
async function found(fresh, { name, relay, server, backup, person, invite }, { step, device: shown } = QUIET) {
	if (mac) {
		await macOpened(await stepping(shown(), 'found', name, relay, server, backup));
		return;
	}
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const { passkey, unlock, sign, held } = await ceremonies(undefined, nonce);
	if (fresh) step('make');
	const made = fresh ? await passkey.create(person || name) : null;
	if (made) held.id = made.id;
	// a copy of the nonce, as what the unlock brings back is moved to the device's worker, and the nonce kept after it
	const unlockNew = (/** @type {Uint8Array<ArrayBuffer>} */ challenge) => unlock(nonce.slice(), challenge);
	const shows = shown();
	await avendb.signUpWith(invite);
	const d = await avendb.Device.found(name, relay, server, made?.spki, unlockNew, sign, backup, shows, store).finally(() =>
		avendb.signUpWith(null)
	);
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
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const { unlock, held } = await ceremonies(undefined, nonce);
	// a copy of the nonce, as what the unlock brings back is moved to the device's worker, and the nonce kept after it
	const unlockNew = (/** @type {Uint8Array<ArrayBuffer>} */ challenge) => unlock(nonce.slice(), challenge);
	const d = await avendb.Device.link(name, relay, through, unlockNew, shown(), store).catch(noAccount);
	step('save');
	await started(d, nonce, held.id, { name, relay });
}

/**
 * Claims the invite a link brought for the person's human vault through avenDB's server, whose code reads `server`:
 * `share`, the invite's share, and `secret`, its key's, each 64 hex digits, as the link holds them
 * ($lib/app/entry.js). The device fetches the invite from the server, claims its share with the key, with no owner
 * signing, and hands the server the vault's logs and the claim at once, as a server that takes a new human vault only
 * with its invite's claim wants them (avendb-net's `Node::claim_invite`); then shows what changed. The vault's id.
 * Fails where the invite was used or revoked, or the server takes the vault no more. In a browser alone: nobody signs
 * up in the Mac app.
 * @param {string} server @param {string} share @param {string} secret @returns {Promise<string>}
 */
async function claim(server, share, secret) {
	if (mac) throw new Error('An invite is taken in a browser, where you sign up');
	if (!device) throw new Error('avenDB isn’t open on this page yet');
	const vault = await device.claim_invite(server, share, secret);
	await refresh();
	return vault;
}

/**
 * Opens the account this browser, or the app, holds, in the one ceremony of the passkey that unlocks it, only where it
 * is closed: it shows its steps by `at`, and a second call while it is under way joins it. A store another tab holds
 * open fails before the passkey is asked (`code` 'held'). A store of the device taken out of its vault, or
 * kept before avenDB started fresh, opens nothing: it is put aside, never deleted, the account is new here again, and
 * it fails saying so. Fails with why not.
 * @param {Steps} [at]
 * @returns {Promise<void>}
 */
function unlock(at = QUIET) {
	if (phase !== 'closed') return unlocking ?? Promise.resolve();
	unlocking ??= (async () => {
		try {
			await opening(at);
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

/** Opens the device this browser, or the app, holds, in the unlock alone: it marks its own steps with `step` and hands
 *  the device the function it shows its own by with `device`. @param {Steps} at */
async function opening({ step, device: shown }) {
	if (mac) return macOpened(await stepping(shown(), 'open'));
	noteLifecycle('unlocking');
	// the store first, so that a tab that can't open it never asks for the passkey: one tab at a time holds it
	await store.hold().catch(() => {
		const why = new Error(`avenDB is open in another tab of ${here}: it opens in one tab at a time`);
		throw Object.assign(why, { code: 'held' });
	});
	const nonce = unhex(meta.nonce);
	const { unlock } = await ceremonies(meta.credential, nonce);
	step('unlock');
	let unlocked;
	try {
		unlocked = await unlock(nonce);
	} catch (e) {
		await store.release().catch(() => {});
		throw e;
	}
	running(await avendb.Device.open(unlocked, shown(), store));
}

/** The device runs from here on, its shelf keeping what opens it again, even should that fail: it can still show
 *  its code, for the person's next device to link through. @param {any} d @param {Uint8Array} nonce
 *  @param {string} credential @param {{ name: string, relay: string }} how */
async function started(d, nonce, credential, { name, relay }) {
	meta = { name, relay };
	running(d);
	meta = await d.keep(hex(nonce), credential);
}

/** Device `d` runs, for every page of the tab, and the pages holding it see what it holds, and read the code they run
 *  off it, the games' and the assets' (game/code/sources/device.js); then it asks what its key move asks of the person
 *  (`checkMove`). @param {any} d */
function running(d) {
	if (device && device !== d) retireWorld(device);
	device = d;
	phase = 'open';
	if (!mac) noteLifecycle('open');
	useDevice({
		// Demand disposal belongs to this device even while a replacement is opening. Never send stale work to it.
		run: (/** @type {any} */ op) => op?.op === 'demand' ? d.run(op) : device === d ? send(op) : Promise.reject(new Error('the device changed')),
		read: api.readFile
	});
	if (holders) watch();
	if (!mac) keepStorage();
	void checkMove(d);
}

/** Asks the browser to keep this origin's storage for good, the device's shelf in OPFS with it, so that it never clears
 *  it under pressure: a cleared shelf brings everything from the server again (2026-10-22: an iPhone holding 818 MB
 *  said "the browser may clear it", as no page had ever asked). The browser decides, and nothing waits on it. */
function keepStorage() {
	const s = navigator.storage;
	s?.persisted?.()
		.then((kept) => kept || s.persist?.())
		.catch(() => {});
}

/** One bounded recheck timer. No-work results are reconsidered as new history or a remote next key arrives;
 *  pending freshness retries sooner. A replaced/locked device's pending answers and timers cannot act on its successor. */
const moveChecks = createMoveChecks({
	current: () => phase === 'open' ? device : null,
	ask: (d) => mac ? mac.call('moving') : d.moving(),
	show: (asked) => { moving = asked; },
	move: () => moveKeys(),
	warn: (e) => console.warn('avenDB: the key move is asked about again in a moment:', e?.message ?? e)
});

/** What this device's key migration asks now; no work is checked again in three minutes, pending work in thirty seconds.
 *  @param {any} d @param {boolean} [again] */
const checkMove = (d, again = false) => moveChecks.check(d, again);

/** Moves the person's passkey and this device to ML-DSA-65 (K3b), as `moving` asks: one ceremony of their passkey, and
 *  in the Mac app a touch of its Touch ID key, which moves too, with the drives it hosts. The device opens again as its
 *  next key, with no ceremony, and runs on. Whether it went through, with why not shown. */
async function moveKeys() {
	const d = device;
	if (!d || !moving) return false;
	const what = moving.retire?.length
		? 'Removing your old keys'
		: moving.checkpoint
			? 'Signing your checkpoint'
			: 'Moving your keys to ML-DSA-65';
	const ok = await change(what, async () => {
		if (mac) return macOpened(await mac.call('moveKeys'));
		const moved = await d.move_keys((await ceremonies(meta.credential)).sign, null);
		if (!moved) return;
		// the store is the new device's: the old one is freed, never closed, which would let go of it
		watching = null;
		running(moved);
		d.free();
		meta = (await avendb.storeMeta(store)) ?? meta;
	});
	// a device that stays as it was, as after its old keys' removal, says what is left: the avens' move, or nothing
	if (ok && device === d) void checkMove(d);
	return ok;
}

/** Signs a checkpoint over every edit the person's key may vouch for now, as they ask for it on the Performance page:
 *  the edits earlier keys signed in SLH-DSA that no checkpoint covers, those of keys that still sign the old way too
 *  (avendb-browser's `sign_checkpoint`), in one ceremony of their passkey or, in the Mac app, one touch of its Touch ID
 *  key. How many edits it covered, or `null` if it didn't go through, with why shown. */
async function signCheckpoint() {
	const d = device;
	if (!d) return null;
	let covered = 0;
	const ok = await change('Signing your checkpoint', async () => {
		covered = mac
			? ((await mac.call('signCheckpoint'))?.covered ?? 0)
			: await d.sign_checkpoint((await ceremonies(meta.credential)).sign);
	});
	if (ok && device === d) void checkMove(d);
	return ok ? covered : null;
}

/** How long a change waits at least before the page reads the world again, so the changes after it come along. */
const SETTLE = 150;

/** Shows what the device holds, then again each time it changes as its other devices sync with it, until it closes,
 *  another takes its place or no page holds the session any more. A burst of changes, as the seed's hundreds of writes
 *  after sign-up, shows once it settles: the page reads the world again only after waiting twice as long as its last
 *  read and redraw took (at least `SETTLE`), so they never take more than a third of the page's time, where one read per
 *  write froze the dashboard. The person's own changes show at once (`change`). */
function watch() {
	const d = device;
	if (!d || (watching && watched === d)) return;
	const token = (watching = {});
	watched = d;
	const on = () => watching === token && device === d;
	// A second cheap change subscription invalidates targeted views independently of
	// full-world rendering/backoff. It never downloads or materializes the world.
	(async () => {
		let held = await d.size();
		if (on()) revision++; // cover changes concurrent with this initial snapshot too
		while (on() && (await d.changed(...held)) && on()) {
			held = await d.size();
			if (on()) revision++;
		}
	})().catch((/** @type {Error} */ e) => on() && (error = `Watching local changes failed: ${e.message}`));
	(async () => {
		let [edits, keys] = await d.size();
		if (!on()) return;
		let took = await timed(() => refreshDevice(d));
		while (on() && (await d.changed(edits, keys)) && on()) {
			await new Promise((r) => setTimeout(r, Math.max(SETTLE, 2 * took)));
			if (!on()) break;
			[edits, keys] = await d.size();
			if (!on()) break;
			took = await timed(() => refreshDevice(d));
		}
	})().catch((/** @type {Error} */ e) => on() && (error = `Showing what arrives failed: ${e.message}`));
}

/** How long `work` took, in milliseconds, with the redraw it set off (a task later, after Svelte's own).
 *  @param {() => Promise<unknown>} work */
async function timed(work) {
	const t = performance.now();
	await work();
	await new Promise((r) => setTimeout(r, 0));
	return performance.now() - t;
}

/** Both background watchers and explicit barriers share one reader per device. */
const worldReaders = new WeakMap();
const retiredWorlds = new WeakSet();
function retireWorld(/** @type {any} */ d) {
	retiredWorlds.add(d);
	worldReaders.get(d)?.cancel(new Error('The avenDB device changed during its world refresh.'));
	// Keep the terminal reader until this device object is collected: late callers
	// during asynchronous close must not resurrect a new reader for it.
}
function refreshDevice(/** @type {any} */ d) {
	if (retiredWorlds.has(d)) return Promise.reject(new Error('The avenDB device changed before its world refresh.'));
	let reader = worldReaders.get(d);
	if (!reader) {
		reader = createWorldReader({
			read: async () => {
				if (device !== d) throw new Error('The avenDB device changed before its world refresh.');
				return answer(await near(d, { op: 'world' })) ?? null;
			},
			take: (w) => {
				if (device !== d) throw new Error('The avenDB device changed during its world refresh.');
				world = w;
				localMediaWorld(w);
				context.reconcile();
			}
		});
		worldReaders.set(d, reader);
	}
	return reader.request();
}

/** Explicit barrier: its snapshot starts after this call, even if an older read runs. */
async function refresh() {
	const d = device;
	if (d) await refreshDevice(d);
}

/** Accepted local writes do not wait for their requested summary. Let Svelte
 * dispatch targeted observer reads first: otherwise a synchronous world dispatch
 * reaches the serialized native/WASM engine before those effects can run. Explicit
 * refresh() remains an immediate freshness barrier. */
const queuedSummaries = new WeakSet();
function queueRefresh(/** @type {any} */ d) {
	if (!d || queuedSummaries.has(d)) return;
	queuedSummaries.add(d);
	void tick().then(() => {
		queuedSummaries.delete(d);
		if (device === d && !retiredWorlds.has(d)) return refreshDevice(d);
	}).catch((/** @type {Error} */ e) => {
		if (device === d) error = `Showing local changes failed: ${e.message}`;
	});

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
	if (reads(op)) return near(d, op);
	await current(d, op);
	if (APPROVED.includes(op?.op) && doing) {
		const [verdict] = (await d.run({ op: 'may', ops: [op] }))?.ok ?? [];
		if (allowed(verdict) && verdict !== true) doing = `${doing}: ${asks} once`;
	}
	return d.run(op, mac ? undefined : (await ceremonies(meta.credential)).sign, read);
}

/** an entry's id: 64 hex digits */
const ENTRY = /^[0-9a-f]{64}$/;

/** the reads whose answers name the entries a view shows, which the page learns (`learn`): not the device's own
 *  bookkeeping (`world`, `jobs`, `synced`, `log`, `bring`, …), whose answers name everything it holds */
const VIEWS = new Set(['query', 'get', 'room', 'history', 'note', 'pin', 'posts', 'code', 'aip', 'aip_records', 'aips', 'database']);

/** The entries answer `got` of a view's read names: its entry, or each row's, shallow. @param {any} got */
const namedIn = replyEntries;

/**
 * A read, for every app view the same way (Samuel 2026-10-21: query views solved once, for all our views, by the
 * manifests): run on what the device holds; where it names an entry the device holds nothing of yet (`NoEntry`, a new
 * device still syncing), that entry alone is brought from its peers first (`bring`, before anything else it syncs)
 * and read again; and the entries the answer names are learned for this page, which a device opened on it brings
 * first the next time (game/code/sources/device.js `learn`). @param {any} d @param {any} op
 * @param {{ signal?: AbortSignal, scoped?: boolean, demand?: any }} [options]
 */
async function near(d, op, { signal, scoped = false, demand } = {}) {
	const path = typeof location === 'undefined' ? '' : location.pathname;
	const currentView = () => !signal?.aborted && d === device && path === (typeof location === 'undefined' ? '' : location.pathname);
	let got = await d.run(op);
	if (!currentView()) return got;
	const entry = typeof op?.entry === 'string' && ENTRY.test(op.entry) ? op.entry : null;
	if (got?.refused === 'NoEntry' && entry) {
		// Reads return local state immediately. Sync completion refreshes the view separately.
		void bringEntries([entry], { run: (/** @type {any} */ o) => d.run(o) }, { signal, path, prioritize: !scoped, learnPriority: !scoped }).catch(() => {});
	}
	if (currentView() && VIEWS.has(op?.op)) {
		const named = [...(entry && got?.ok ? [entry] : []), ...namedIn(got)];
		learn(named, path, { prioritize: !scoped });
		if (!scoped) freshen(d, named);
	}
	return got;
}

/** Whether the device is still behind its peers, as the status pill last heard (./sync.svelte.js). */
const behind = () => sync.known && sync.behind > 0;

/** the entries each device was asked to bring while behind, so each comes once (`freshen`) @type {WeakMap<object, Set<string>>} */
const freshened = new WeakMap();

/**
 * While the device is still behind its peers, the entries a view's answer names come first, in the background: a
 * device holds an entry it took early at the heads it had then (an AIP still "proposed" that its vault accepted and
 * applied since, Samuel's iPhone 2026-10-22), and the whole vault comes a page at a time behind it. What the view shows
 * is shown at once; once they land, the world changes and the view reads again. Each entry once a device.
 * @param {any} d @param {string[]} named
 */
function freshen(d, named) {
	if (!behind() || !named.length) return;
	let of = freshened.get(d);
	if (!of) freshened.set(d, (of = new Set()));
	const ids = named.filter((e) => !of.has(e));
	if (!ids.length) return;
	ids.forEach((e) => of.add(e));
	void bringEntries(ids, { run: (/** @type {any} */ o) => d.run(o) });
}

/** A head-conditional review retains its freshness guard. Ordinary edits never wait for peers.
 * @param {any} d @param {any} op */
async function current(d, op) {
	const what = doing;
	await beforeLocalWrite(op, {
		behind: behind(),
		bring: (entry) => bringEntries([entry], { run: (/** @type {any} */ o) => d.run(o) }),
		refresh,
		waiting: (on) => {
			if (!what || !doing.startsWith(what)) return;
			doing = on ? `${what}: bringing it up to date first, as this device still syncs` : what;
		}
	});
}

/**
 * Runs `work` as `what`, showing what it does and what went wrong: whether it went through.
 * @param {string} what @param {() => Promise<unknown>} work
 */
async function attempt(what, work) {
	[doing, error] = [what, ''];
	const ours = () => doing.startsWith(what);
	// a change the device is slow to answer (a busy Mac) goes on in the background: the page is no longer held by it,
	// and shows what it made once it lands
	const late = `${what} is taking long. It goes on in the background and shows here once it’s done.`;
	const slow = setTimeout(() => ours() && ([doing, error] = ['', late]), SLOW);
	try {
		await work();
		if (error === late) error = '';
		return true;
	} catch (e) {
		error = plain(/** @type {Error} */ (e).message ?? String(e));
		return false;
	} finally {
		clearTimeout(slow);
		if (ours()) doing = '';
	}
}

/** How long a change holds the page before it goes on in the background (`attempt`), in ms. */
const SLOW = 45_000;

/**
 * Runs `work` as `what`, then shows what changed: whether it went through.
 * @param {string} what @param {() => Promise<unknown>} work
 */
async function change(what, work) {
	const d = device;
	const ok = await attempt(what, work);
	if (ok && device === d) {
		revision++;
		// Local acceptance completes independently of the expensive world summary.
		// Targeted subscribers read the authoritative local device immediately.
		queueRefresh(d);
	}
	return ok;
}

/**
 * Runs op `op` as `what`, a change that brings file `file` (./ops.js `brings`), its length set in the op and its bytes
 * handed over a megabyte at a time, whatever its size: what it did, or `null` if it didn't go through. Done `quiet`ly,
 * as the repo seed's top-up writes in the background, it shows nothing while it runs, and a refusal throws.
 * @param {string} what @param {any} op @param {Blob} file @param {boolean} [quiet]
 */
async function bring(what, op, file, quiet = false) {
	/** @param {number} at @param {number} n */
	const read = async (at, n) => {
		if (file.size > 0 && !quiet) doing = `${what}: ${Math.floor((100 * at) / file.size)} %`;
		return new Uint8Array(await file.slice(at, at + n).arrayBuffer());
	};
	const sized = op.op === 'create' ? { ...op, file: { ...op.file, len: file.size } } : { ...op, len: file.size };
	if (quiet) return answer(await send(sized, read));
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
	noteLifecycle('locked');
	moveChecks.stop();
	const d = device;
	if (d) retireWorld(d);
	watching = null;
	useDevice(null);
	[device, world, vault] = [null, null, ''];
	if (meta) phase = 'closed';
	await d?.close().catch(() => {});
}

/** Forgets the account here: the device lets go, and its shelf is put aside, never deleted, and a new one is in use,
 *  in the app's folder or in OPFS; the account is new here, and every page of the tab sees it so. */
async function forget() {
	moveChecks.stop();
	if (device) retireWorld(device);
	await device?.close();
	watching = null;
	useDevice(null);
	await (mac ? mac.call('forget') : store.aside());
	[device, meta, world, vault, phase] = [null, null, null, '', 'new'];
}

/** In the Mac app: whether a touch may open avenDB here, its Secure Enclave able to hold a Touch ID key (macOS 26, a
 *  finger enrolled), and whether one does; else null. @returns {Promise<{ ready: boolean, on: boolean } | null>} */
async function touchState() {
	if (!mac) return null;
	const ready = await mac.touchReady().catch(() => false);
	return { ready, on: !!meta?.touch };
}

/** In the Mac app: its Touch ID key made in its Secure Enclave and added as an owner of the person's vault beside
 *  their passkey, in the passkey's sheet and a touch, so a touch opens avenDB here from then on and approves what their
 *  vault's owners approve (avendb-device's `touchSetup`); or, with `on` false, forgotten here, the passkey's sheet
 *  opening it again (`touchOff`). @param {boolean} on */
async function touch(on) {
	await mac.call(on ? 'touchSetup' : 'touchOff');
	meta = (await mac.call('status')).meta;
}

/** A QR code of `text`, as SVG, `size` pixels wide: drawn by the device's WebAssembly, or in the Mac app by the app.
 *  @param {string} text @param {number} size @returns {Promise<string>} */
const qr = async (text, size) => (mac ? mac.call('qrSvg', text, size) : avendb.qrSvg(text, size));

/** What the vaults' screens do, each acting for the vault it names (./Shell.svelte's `api`, beside what its page adds). */
const api = {
	/** Subscribe to any targeted local query, independent of the world summary.
	 * @param {() => any} query @param {(answer: any) => void} take @param {(error: Error) => void} [failed] */
	observe(query, take, failed) {
		const reader = createReactiveRead({ read: (/** @type {any} */ d, /** @type {any} */ op, /** @type {AbortSignal} */ signal) => near(d, op, { signal }), take, failed });
		const dispose = $effect.root(() => {
			$effect(() => {
				void revision;
				reader.update(query(), device, context.current);
			});
		});
		return () => { dispose(); reader.close(); };
	},
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
	/** A component-owned read window. Replace its query on each read and close it on unmount. */
	window: () => {
		const window = createReadWindow({ device: () => device, read: (d, op, signal, demand) => near(d, op, { signal, demand, scoped: true }) });
		const dispose = $effect.root(() => {
			$effect(() => { void device; window.invalidate(); });
		});
		return { ...window, close() { dispose(); window.close(); } };
	},
	/** A mounted view's visible entries, already materialized locally: scheduling only, without a second read. */
	demand: () => {
		const window = createEntryWindow({ device: () => device });
		const dispose = $effect.root(() => {
			$effect(() => { void device; void window.invalidate(); });
		});
		return { ...window, close() { dispose(); window.close(); } };
	},
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
	 * `null` if it didn't go through. `quiet`, it shows nothing while it runs, and a refusal throws.
	 * @param {string} what @param {object} op @param {Blob} file @param {boolean} [quiet]
	 */
	bring: (what, op, file, quiet) => bring(what, op, file, quiet),
	/** Shows what changed, as after a change: what `quiet` ones made, once they are done. */
	refresh: () => refresh(),
	/**
	 * Bytes `from` to `to` of the file whose root is `root` and whose sealed size is `size`, from this device's
	 * store or fetched from a peer that may hand them over.
	 * @param {string} root @param {number} size @param {number} from @param {number} to
	 * @returns {Promise<Uint8Array>}
	 */
	readFile: async (root, size, from, to) => {
		const out = await send({ op: 'read_file', root, size, from, to, local: true });
		answer(out);
		return out.bytes;
	}
};

/** This tab's avenDB session: what it is now, read as state, and what it does. */
export const session = {
	/** Invalidates targeted local reads without waiting for the full world summary. */
	get revision() { return revision; },
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
		return context.current;
	},
	set vault(id) {
		context.current = id;
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
	/** what the key move asks of the person (K3b, K3c): `{ passkey, touch, device, avens, retire, behind }` while
	 *  anything of theirs here, or a device of the aven they govern, is to move to ML-DSA-65, or once it all moved, the
	 *  earlier keys and old devices to remove (`retire`, waiting while `behind`), else null */
	get moving() {
		return moving;
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
	touch,
	touchState,
	moveKeys,
	signCheckpoint,
	found,
	link,
	claim,
	forget,
	rename,
	refresh,
	qr,
	attempt,
	change,
	api,
	run: api.run,
	runAll: api.runAll,
	ask: api.ask,
	observe: api.observe
};
