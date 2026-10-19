// @ts-nocheck — plain JS, kept loose on purpose
/*
 * Who opens what of Maia City (Samuel 2026-10-19: the sandboxes, worlds, game assets and games "purely behind avenDB
 * native caps", "Not depending on PG"): the Maia City COOP vault's cap groups the person holds, read from their own
 * avenDB ($lib/avendb/capgroups.js). A Traveler, as every invited human is, opens every sandbox, world and game asset,
 * read only; a Citizen plays MaiaCity V1 too; whoever acts for Maia City itself, as its owners' devices do, or holds
 * its Admin group, opens everything, and invites. There is no draft stage: what a group opens, it opens.
 *
 * Maia City is the coop of the seed whose aven is the server the person's vault is kept by, as their own avenDB shows
 * it ($lib/avendb/vaults.js `serverCity`), and on its owners' devices the coop their own seed founded (`seedCity`),
 * never a vault by its name: so a vault that calls itself Maia City and shares a group named Traveler opens nothing.
 * Read again as the device shows
 * its world anew (`readAccess`, from src/routes/app/+layout.svelte); until then, and where avenDB isn't open, the
 * person holds nothing (`access.known` false).
 */
import { base } from '$app/paths';
import { ADMIN, heldGroups } from '$lib/avendb/capgroups.js';
import { session } from '$lib/avendb/session.svelte.js';
import { seedCity, serverCity } from '$lib/avendb/vaults.js';
import { native } from '$lib/native';

export const access = $state({
	/** the Maia City vault's id, '' while unknown */
	city: '',
	/** whether the person acts for Maia City itself, as its owners do */
	owner: false,
	/** the names of the groups they hold, each with those it includes */
	groups: /** @type {Set<string>} */ (new Set()),
	/** Maia City's cap groups, as the `cap_groups` op answers them: what an invite names */
	list: /** @type {import('$lib/avendb/capgroups.js').CapGroup[]} */ ([]),
	/** whether that was read from avenDB, open */
	known: false
});

let reading = null;
let again = false;

/** Reads what the person holds of Maia City from their avenDB as its device shows it now; a read under way reads once
 *  more after, so the last world shown is the one read. */
export function readAccess() {
	if (reading) return void (again = true);
	reading = (async () => {
		do {
			again = false;
			const w = session.world;
			if (session.phase !== 'open' || !w) {
				Object.assign(access, { city: '', owner: false, groups: new Set(), list: [], known: false });
				break;
			}
			const city = (seedCity(w) ?? serverCity(w))?.id ?? '';
			const v = w.vaults.find((x) => x.id === city);
			// a device that knows no Maia City, as one no share of it reached yet, reads none of its groups
			const got = v ? await session.ask({ op: 'cap_groups', vault: city }).catch(() => null) : null;
			const list = got?.ok ?? [];
			Object.assign(access, { city, owner: v?.acting?.as === city, groups: heldGroups(w, city, list), list, known: true });
		} while (again);
	})().finally(() => (reading = null));
}

/** Whether the person opens what cap group `name` opens: they hold it, or Admin, or act for Maia City. @param {string} name */
export const holdsGroup = (name) => access.owner || access.groups.has(ADMIN) || access.groups.has(name);

/** Whether the person makes invites: they act for Maia City, which issues them. */
export const invites = () => access.owner && !!access.city;

/**
 * An invite for one new human, of cap group `name` (Traveler: nobody is invited a citizen, Samuel 2026-10-19): a
 * share of the group to a one-time key, issued as Maia City, which their vault claims at sign-up with no one signing
 * (Samuel 2026-10-19: "The invite automatically should sign that share"). The device signs it as it acts for Maia
 * City, through the person's vault that owns it, with no passkey (Samuel 2026-10-19: the city's admin invites, and
 * their vault signs for it); maiaCITY's API signs the newcomer up on it too, as avenDB's server says it is open
 * (/feed/invite/). The link, always on the site, even made in the Mac app: the share and its key after its `#`,
 * which never leave the browser but for the share's id, which the API asks avenDB about.
 * @param {string} name @returns {Promise<string>}
 */
export async function makeInvite(name) {
	const group = access.list.find((g) => g.name === name);
	if (!invites()) throw new Error('Only Maia City’s own devices invite.');
	if (!group) throw new Error(`Maia City has no ${name} group yet: open the dashboard on your first device, which adds it.`);
	const made = await session.run(`Inviting a ${name.toLowerCase()}`, { op: 'share_group', over: access.city, group: group.entry, who: 'invite', as: access.city });
	if (!made?.share || !made?.secret) throw new Error(session.error || 'The invite wasn’t made.');
	const key = new URLSearchParams({ share: made.share, key: made.secret });
	// the site's, as the one invited opens it in their own browser: the Mac app's own address is the app's alone
	const site = native() ? 'https://maia.city' : location.origin;
	return `${site}${base}/join/#${key}`;
}
