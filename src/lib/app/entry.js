/*
 * The one way into the app (Samuel 2026-10-18: "one unified unlock/signin on opening any protected routes … not a
 * separate sub signin at avenDB"): the app's gate (src/routes/app/+layout.svelte) signs the person in to maiaCITY's
 * API and opens their avenDB together, with the one passkey that roots both. Where this browser holds their account,
 * one ceremony does both: the unlock is over the API's challenge, and its assertion goes to the API without the PRF
 * outputs, which never leave the page ($lib/avendb/session.svelte.js `unlock`). Where it holds none, the sign-in comes
 * first, then this browser joins their human vault through avenDB's server, which hands it over for the passkey alone,
 * in a ceremony of its own (a new device's unlock is over the device's own challenge). Signing up is the same way in:
 * the join page makes the passkey, and the gate founds the person's human vault with it, its profile named as they
 * signed up and public, so every person has one; a passkey that has none yet founds one the same way, named as the person says.
 * A person's profile lives in their human vault alone (session.name), none of it in maiaCITY's database. The invite
 * that brought them (the join page's link) is claimed once their vault is open (`claimInvite`): a share of Maia City's
 * Traveler or Citizen cap group, which is what opens the sandboxes, worlds, game assets and games to them.
 *
 * In the Mac app the app signs in with its own key, approved in the browser, and each ceremony runs in its sign-in
 * sheet. avenDB failing never keeps anyone out of the app: the gate says why and lets them go on without it in this
 * tab (`later`); a passkey without PRF, from which avenDB derives the keys, isn't asked again on this browser.
 */
import { loginFinish, loginOptions, signIn as apiSignIn } from '$lib/auth/client';
import { native } from '$lib/native';
import { deviceName, relay, server } from '$lib/avendb/server.js';
import { session } from '$lib/avendb/session.svelte.js';
import { nameShare, nameShared, plain, seedCity } from '$lib/avendb/vaults.js';

/**
 * How the gate shows a start of avenDB's step by step while it runs ($lib/avendb/steps.js, Signing.svelte): called as
 * the start of kind `kind` begins, it hands over how the session marks its steps. The way in shows none without one.
 * @typedef {(kind: 'found' | 'link' | 'open') => import('$lib/avendb/session.svelte.js').Steps} Starts
 */
/** @type {Starts} */
const UNSHOWN = () => ({ step: () => {}, device: () => () => {} });

/** sessionStorage: this tab goes on without avenDB */
const LATER = 'avendb:later';
/** localStorage: this browser's passkey has no PRF, so avenDB can't open here with it */
const NO_PRF = 'avendb:no-prf';
/** sessionStorage: the name the person just signed up with, for their human vault's profile */
const SIGNUP = 'maia:signup';
/** sessionStorage: the invite the join page's link brought, `{ share, key }`, until the person's human vault claims it */
const INVITE = 'maia:invite';
const HEX = /^[0-9a-f]{64}$/;

/** @param {() => Storage} at @param {string} key */
const flag = (at, key) => {
	try {
		return at().getItem(key) ?? '';
	} catch {
		return '';
	}
};
/** @param {() => Storage} at @param {string} key @param {string | null} value */
const keep = (at, key, value) => {
	try {
		if (value == null) at().removeItem(key);
		else at().setItem(key, value);
	} catch {
		/* no storage */
	}
};

/** The name the person signed up with in this tab, which their human vault's profile takes; '' if none. */
export const signUpName = () => flag(() => sessionStorage, SIGNUP);

/** Remembers the name the person signs up with, until their human vault takes it. @param {string} name */
export const signingUp = (name) => keep(() => sessionStorage, SIGNUP, name.trim());

/**
 * Remembers the invite a link brought (Samuel 2026-10-19: "The invite automatically should sign that share"): its
 * share of one of Maia City's cap groups, Traveler or Citizen ($lib/avendb/capgroups.js), and the key that claims it,
 * until the person's human vault claims it as they come into the app (`claimInvite`).
 * @param {string} share @param {string} key
 */
export const invitedWith = (share, key) =>
	keep(() => sessionStorage, INVITE, HEX.test(share) && HEX.test(key) ? JSON.stringify({ share, key }) : null);

/** The invite a link brought in this tab that no vault claimed yet, or null. @returns {{ share: string, key: string } | null} */
export function invitation() {
	try {
		const got = JSON.parse(flag(() => sessionStorage, INVITE) || 'null');
		return HEX.test(got?.share ?? '') && HEX.test(got?.key ?? '') ? got : null;
	} catch {
		return null;
	}
}

/**
 * Claims the invite a link brought in this tab, if any, for the person's human vault, once avenDB is open: just
 * founded, as they signed up with it, or theirs from before ($lib/avendb/session.svelte.js `claim`). What it gives
 * them is theirs from then on, with no owner of Maia City signing. Its owners' own devices claim none: they run the
 * city, and the invite stays for whoever it was made for. Why it didn't go through, in the person's words, or ''.
 */
export async function claimInvite() {
	const got = invitation();
	if (!got || session.phase !== 'open') return '';
	keep(() => sessionStorage, INVITE, null);
	if (session.world && seedCity(session.world)) return 'You run Maia City: the invite you opened stays for whoever it was made for.';
	try {
		await session.claim(server(), got.share, got.key);
		return '';
	} catch (e) {
		const why = String(/** @type {Error} */ (e)?.message ?? e);
		// the server hands an invite only while it holds it unclaimed: one used or revoked, or one the device that made
		// it hasn't brought the server yet, as when its tab closed at once
		if (why.includes('knows no such invite'))
			return 'Maia City’s server doesn’t know your invite: it was used already, or it hasn’t reached the server yet. Open its link again later, or ask for a new one.';
		return `Your invite didn’t go through: ${plain(why)} Ask for a new one.`;
	}
}

/** Whether avenDB waits for the passkey before the app opens: where this browser holds the person's account, locked,
 *  or none, and may hold one; unless this tab goes on without it. Once the session loaded (`session.load`). */
export function waits() {
	if (flag(() => sessionStorage, LATER)) return false;
	if (session.phase === 'closed') return true;
	return session.phase === 'new' && !session.error && !(flag(() => localStorage, NO_PRF) && !signUpName());
}

/** This tab goes on without avenDB: the gate lets the person in, and asks no more until the tab closes. */
export const later = () => keep(() => sessionStorage, LATER, '1');

/** What a failed ceremony or start says, in the person's words, and what kind it is: `cancelled` (they closed the
 *  passkey's prompt), `held` (another tab holds avenDB), `no-account` (the passkey roots no vault yet), `no-prf`, or ''.
 *  @param {unknown} e */
export function failure(e) {
	const err = /** @type {any} */ (e);
	const message = String(err?.message ?? e);
	const kind = /NotAllowed|abort|cancel/i.test(`${err?.name} ${message}`)
		? 'cancelled'
		: err?.code === 'held' || err?.code === 'no-account'
			? err.code
			: /has no PRF/.test(message)
				? 'no-prf'
				: '';
	if (kind === 'no-prf') keep(() => localStorage, NO_PRF, '1');
	return { kind, message: kind === 'cancelled' ? '' : message };
}

/**
 * Signs the person in to the API: where this browser holds their account, locked, in the ceremony that unlocks it too,
 * which `say` names as it begins. Their founder, and why avenDB didn't open, if it was to open and didn't; a passkey the
 * API doesn't know (one made for avenDB alone) signs in with a ceremony of its own after. The unlock shows its steps by
 * `starts`.
 * @param {(what: string) => void} say @param {Starts} [starts]
 * @returns {Promise<{ founder: import('$lib/auth/client').Founder, why: unknown }>}
 */
export async function signIn(say, starts = UNSHOWN) {
	await session.load();
	if (native() || session.phase !== 'closed' || flag(() => sessionStorage, LATER)) {
		say('Signing in');
		return { founder: await apiSignIn(), why: null };
	}
	say('Signing in and unlocking avenDB');
	const options = await loginOptions();
	/** @type {Promise<import('$lib/auth/client').Founder | null> | null} */
	let signed = null;
	const finish = (/** @type {object} */ assertion) => {
		signed = loginFinish(assertion).catch(() => null);
	};
	/** @type {unknown} */
	let why = null;
	try {
		await session.unlock(starts('open'), { challenge: options.challenge, finish });
	} catch (e) {
		// no ceremony, or none that finished: the sign-in alone, unless the person closed the prompt
		if (!signed && failure(e).kind !== 'held') throw e;
		why = e;
	}
	const founder = signed ? await signed : null;
	if (founder) return { founder, why };
	say('Signing in');
	return { founder: await apiSignIn(), why };
}

/**
 * Opens avenDB once the person is signed in, naming each step by `say`: unlocks the account this browser holds, or
 * where it holds none, joins their human vault through avenDB's server; and where their passkey has none yet, or they
 * just signed up, founds it, its profile named `name` (or as they signed up). Whether it founded the vault. Fails with
 * `failure`'s kinds: `no-account` asks for the name the new vault's profile takes. Each start shows its steps by
 * `starts`, a founding's naming last.
 * @param {(what: string) => void} say @param {string} [name] @param {Starts} [starts]
 */
export async function open(say, name = '', starts = UNSHOWN) {
	await session.load();
	if (session.phase === 'closed') {
		say('Unlocking avenDB');
		await session.unlock(starts('open'));
		return false;
	}
	if (session.phase !== 'new') return false;
	const how = { name: deviceName(), relay: relay() };
	const named = (name || signUpName()).trim();
	if (!named) {
		say(`Adding ${native() ? 'this Mac' : 'this browser'} to your avenDB`);
		await session.link(server(), how, starts('link'));
		return false;
	}
	say('Setting up your human vault');
	const at = starts('found');
	await session.found(false, { ...how, server: server(), backup: true, person: named }, at);
	keep(() => sessionStorage, SIGNUP, null);
	say('Naming your human vault');
	at.step('profile');
	await profile(named);
	return true;
}

/** Names the person's new human vault `name`: its profile, once the device shows the vault (within a minute), which
 *  everyone reads by default, shared Public with their own key ($lib/avendb/vaults.js `NAME_TYPES`).
 *  @param {string} name */
async function profile(name) {
	const by = Date.now() + 60_000;
	for (;;) {
		await session.refresh();
		const mine = session.world?.mine;
		if (mine) {
			const out = /** @type {any} */ (await session.ask({ op: 'profile', vault: mine, name }));
			if (out?.refused) throw new Error(`Naming your human vault failed: ${out.why ?? 'refused'}`);
			const shown = session.world && !nameShared(session.world, mine) && /** @type {any} */ (await session.ask(nameShare(mine)));
			if (shown?.refused) throw new Error(`Making your name public failed: ${shown.why ?? 'refused'}`);
			await session.refresh();
			return;
		}
		if (Date.now() > by) throw new Error('Your human vault didn’t show on this device after a minute');
		await new Promise((r) => setTimeout(r, 250));
	}
}
