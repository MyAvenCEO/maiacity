/**
 * What a page adds to the nav pill ($lib/app/NavPill.svelte), as back.svelte.js adds its way back: a round "+" in the
 * middle, between Home and You, that opens the page's own main sheet (MaiaCity V1's wallet), and the accounts the
 * page can be looked at as, listed in the You menu (V1: you, the other player, each COOP). A page calls `pillCenter`
 * or `pillAccounts` while it shows them, and calls what it gets back once they are gone; the last one wins.
 */
import { untrack } from 'svelte';

/** @typedef {{ label: string, readonly on: boolean, go: () => void }} Center */
/** @typedef {{ id: string, label: string, sub?: string, text: string, colour: string, shape?: 'human' | 'coop' | 'aven' }} Account */
/** @typedef {{ title: string, readonly list: Account[], readonly current: string, pick: (id: string) => void }} Accounts */

/** @type {Center[]} */
let centers = $state.raw([]);
/** @type {Accounts[]} */
let accounts = $state.raw([]);

export const pill = {
	get center() {
		return centers.at(-1) ?? null;
	},
	get accounts() {
		return accounts.at(-1) ?? null;
	}
};

/**
 * the pill's "+" opens this while the page shows it (untracked: called from an effect)
 * @param {Center} c
 * @returns {() => void} it is gone
 */
export function pillCenter(c) {
	untrack(() => (centers = [...centers, c]));
	return () => untrack(() => (centers = centers.filter((x) => x !== c)));
}

/**
 * the You menu lists these accounts while the page shows them; the first is the one signed in
 * @param {Accounts} a
 * @returns {() => void} they are gone
 */
export function pillAccounts(a) {
	untrack(() => (accounts = [...accounts, a]));
	return () => untrack(() => (accounts = accounts.filter((x) => x !== a)));
}
