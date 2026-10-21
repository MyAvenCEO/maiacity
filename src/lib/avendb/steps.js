// The steps of a device's start, as the page shows them while the person waits (Signing.svelte): founding their
// vault, signing in or unlocking. The device marks each step of its own as it begins and ends it, with how long it
// took (avendb-net's `Progress`, avendb-browser's `steps_json`): in a page through the function it is handed, in the
// Mac app through its `steps` call. The page marks its own steps around them, the same way: making a passkey, and
// saving what opens the device again.

/** @typedef {{ step: string, start: number, end: number | null }} Stage a step begun, by the page's clock (ms) */
/** @typedef {{ steps: { step: string, at: number, took: number | null }[], over: boolean }} Report the device's */
/** @typedef {{ step: string, title: string, does: string, prompt: boolean, state: 'next' | 'now' | 'done' | 'failed',
 *  ms: number }} Row */

/**
 * What each step shows: its title, and what happens in it; a passkey's prompt is marked as one. `here` is this
 * device as the person sees it.
 * @param {string} here
 * @returns {Record<string, { title: string, does: string, prompt?: boolean }>}
 */
export function stepWords(here) {
	const Here = `${here.slice(0, 1).toUpperCase()}${here.slice(1)}`;
	return {
		make: {
			title: 'Make your passkey',
			does: 'Your browser makes a passkey for maia.city: your vault’s root',
			prompt: true
		},
		unlock: { title: `Unlock ${here}`, does: `Your passkey signs a pass for ${here}’s new keys`, prompt: true },
		touch: { title: 'Touch ID', does: `Your finger opens ${here}’s keys in its Secure Enclave`, prompt: true },
		keys: { title: `Making ${here}’s keys`, does: 'Post-quantum keys from a secret your passkey unmasks' },
		// the same step after Touch ID (`touch`): the secret is the one the Secure Enclave's key opens at the touch
		touchKeys: { title: `Making ${here}’s keys`, does: 'Post-quantum keys from a secret the Secure Enclave opens at your touch' },
		restore: { title: 'Replaying your vault', does: 'Every edit checked again and applied in order' },
		// a page's pass goes to the server by a request of its own, as a WebSocket's URL can't carry it whole
		show: { title: 'Showing avenDB’s relay your pass', does: `One request to the server, so its relay lets ${here} in` },
		node: { title: `Starting ${here}’s node`, does: 'Its own endpoint, quantum-proof TLS on every connection' },
		relay: {
			title: 'Joining avenDB’s relay',
			does: `The server’s connection server lets ${here} in, so it can reach the server`
		},
		server: {
			title: 'Reaching avenDB’s server',
			does: 'Through its connection server; its hello proves it is the server'
		},
		draft: {
			title: 'Drafting your vault',
			does: `Its genesis, ${here} in it, and if nobody owns the server, Maia Holding, avenCEO, its server and Maia City`
		},
		sign: { title: 'Create your vault', does: 'Your passkey signs the whole draft in one go', prompt: true },
		claim: { title: 'Handing the server its claim', does: 'It signs that it is avenMAIA’s device' },
		settle: {
			title: 'Sharing your vault with the server',
			does: `As Backup, or as Relay with backups off, and ${here}’s card in your vault`
		},
		pass: { title: 'Showing your pass', does: 'The server checks it, hands back your vault, still encrypted' },
		vault: { title: 'Checking your vault', does: 'Every edit’s signatures, before any of it counts' },
		join: { title: `Adding ${here} to your vault`, does: 'Your pass signs the edit that adds it' },
		check: { title: 'Opening your vault', does: `${Here} belongs to the vault its store holds` },
		save: { title: `Saving on ${here}`, does: 'What opens it again, kept on its shelf in this browser' },
		profile: { title: 'Naming your human vault', does: 'Its profile takes your name, which everyone reads' }
	};
}

/**
 * The steps each start takes, in order: those it may skip show until a later one begins. In the Mac app the app's
 * device keeps its own shelf, so the page saves nothing. The repo seed a founding that claims the server brings into
 * the Maia City it founded is no step of it: it runs in the background after (Samuel 2026-10-18), ./Account.svelte.
 * An open in the Mac app that keeps a Touch ID key takes a touch first (`touch`), its passkey's sheet only where none
 * comes.
 * @param {'found' | 'link' | 'open'} start @param {{ mac: boolean, make?: boolean, touch?: boolean }} how
 */
export function plan(start, { mac, make = false, touch = false }) {
	const own = (/** @type {string[]} */ steps) => (mac ? [] : steps);
	if (start === 'found')
		return [
			...(make ? ['make'] : []),
			...['unlock', 'keys', ...own(['show']), 'node', 'relay', 'server', 'draft', 'sign', 'claim', 'settle'],
			...own(['save'])
		];
	if (start === 'link')
		return ['unlock', 'keys', ...own(['show']), 'node', 'relay', 'server', 'pass', 'vault', 'join', ...own(['save'])];
	return [touch ? 'touch' : 'unlock', 'keys', 'restore', 'node', 'check'];
}

/**
 * The device's steps on the page's clock: `t0` is when the page asked the device to start.
 * @param {Report | null} report @param {number} t0 @returns {Stage[]}
 */
export function reported(report, t0) {
	return (report?.steps ?? []).map((s) => ({
		step: s.step,
		start: t0 + s.at,
		end: s.took == null ? null : t0 + s.at + s.took
	}));
}

/** The steps that found a vault, which a setup skips when its passkey's vault is on the server already. */
const FOUNDING = ['draft', 'sign', 'claim', 'settle'];

/**
 * The rows the sheet shows: every step begun, in order, each done but the last while the start goes on, then those
 * of `planned` still to come. A step left open once a later one began ended as that one began. `now` is the page's
 * clock; `ended` when the start was over, if it is, and `failed` whether it failed, in its last step.
 * @param {Stage[]} stages @param {string[]} planned @param {ReturnType<typeof stepWords>} words
 * @param {{ now: number, ended: number, failed: boolean }} at
 * @returns {Row[]}
 */
export function rows(stages, planned, words, { now, ended, failed }) {
	const begun = [...stages].sort((a, b) => a.start - b.start);
	const last = Math.max(-1, ...begun.map((s) => planned.indexOf(s.step)));
	// a setup whose passkey has a vault already signs in to it, as a link does, and founds nothing
	const joins = begun.some((s) => s.step === 'pass');
	const next = planned
		.slice(last + 1)
		.filter((step) => !begun.some((s) => s.step === step) && !(joins && FOUNDING.includes(step)));
	// after Touch ID, this device's keys come from the secret the Secure Enclave opened, not from the passkey
	const touched = planned.includes('touch') || begun.some((s) => s.step === 'touch');
	/** @param {string} step @param {Row['state']} state @param {number} ms @returns {Row} */
	const row = (step, state, ms) => {
		const w = step === 'keys' && touched ? words.touchKeys : words[step];
		return { step, title: w?.title ?? step, does: w?.does ?? '', prompt: !!w?.prompt, state, ms };
	};
	return [
		...begun.map((s, i) => {
			const end = s.end ?? begun[i + 1]?.start ?? (ended || null);
			const state = failed && i === begun.length - 1 ? 'failed' : end == null ? 'now' : 'done';
			return row(s.step, state, (end ?? now) - s.start);
		}),
		...next.map((step) => row(step, 'next', 0))
	];
}

/** Milliseconds as the sheet shows them: tenths of a second. @param {number} ms */
export const seconds = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
