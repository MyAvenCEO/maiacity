<!--
	A vault's settings, one page (Samuel 2026-10-20, #1106: "a single hierarchic settings page", each concept once), in
	the layout every avenDB view has (./Frame.svelte): on the left its sections, each a link that scrolls to it
	(`#settings/devices`), in the middle all of them, one after another.

	Profile: what it is, by the kind table, its name and who sees it, its id, and how this device acts for it. Owners:
	its owners, each key listed once, how many of them approve a change, adding or inviting one, the master recovery
	key, and what it owns (./Owned.svelte). Devices: its devices, each listed once, what each keeps of what it syncs, and
	Remove on every one but this; for the person's own vault this device itself (its name, Touch ID in the Mac app, how
	deep its queries read, forgetting it), its drives, linking the next device, and the agents that act as the coop's
	aven. Sharing: who has it, each vault and Everyone with its shares and the devices of theirs it is on, the one Share
	form, what others share with it, and asking for access (./Ask.svelte). Backup, for the person's own vault: whether
	avenDB's server keeps an encrypted copy. Each device says when it was last seen and whether it is an old one, not
	unlocked since its person's keys moved (Samuel 2026-10-20: "which Safari devices are the old ones we can kick?").

	All of it is the device's: its world (avendb-browser's `World`) and the shares over the vault (the `shares` op). A
	button shows only where the device answers a dry run of its op (`may`), and every change goes out as one op, acting
	for the acting vault, which the rules check against what is shared with it. A key or a device is removed only once
	this device holds all its peers hold (`synced`): a removal drops every edit resting on that key that the device
	removing it doesn't hold.
-->
<script>
	import { tick } from 'svelte';
	import { sure } from '$lib/app/sure.js';
	import Ask from './Ask.svelte';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import Mark from './Mark.svelte';
	import { allowed, may, read } from './ops.js';
	import Ops from './Ops.svelte';
	import Owned, { ownedTitle } from './Owned.svelte';
	import Share from './Share.svelte';
	import { server } from './server.js';
	import { Here, here, session } from './session.svelte.js';
	import { share, sync } from './sync.svelte.js';
	import {
		acting,
		actsWords,
		ago,
		count,
		deviceRoles,
		EVERYONE,
		groupOf,
		isStanding,
		KEEPS,
		kindHint,
		kindRules,
		KINDS,
		levelName,
		lastSaid,
		list,
		mayCoOwn,
		nameOf,
		nameShare,
		nameShared,
		newest,
		newestKey,
		owns,
		roleGroup,
		rowHint,
		rowLevel,
		rowWhat,
		shareWhat,
		short,
		signerName,
		titleOf
	} from './vaults.js';

	/** @typedef {import('./vaults.js').ShareRow} ShareRow */
	/** @typedef {import('./vaults.js').Verdict} Verdict */

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   section?: string, thisName: string, link: string, qr: string, sockets?: string[] | null,
	 *   drives?: import('./native.js').Drives | null, asks?: import('./vaults.js').Requests }}
	 */
	let {
		world,
		vault,
		actor,
		api,
		busy,
		section = '',
		thisName,
		link,
		qr,
		sockets = null,
		drives = null,
		asks = { asked: [], made: [] }
	} = $props();

	/** the page's sections, in order, as its left side lists them: each its address after `#settings/`, name and icon */
	const SECTIONS = /** @type {const} */ ([
		['profile', 'Profile', 'info'],
		['owners', 'Owners', 'key'],
		['devices', 'Devices', 'sync'],
		['sharing', 'Sharing', 'share'],
		['security', 'Backup', 'lock']
	]);
	/** Scrolls the page to section `id`. @param {string} id */
	const scrollTo = (id) => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	// an address that names a section (`#settings/devices`, or an older `#members`) opens the page at it
	$effect(() => {
		const id = section;
		if (id) tick().then(() => scrollTo(id));
	});

	/** in the Mac app, the harness whose agent device the page shows how to run, and that, as the device says */
	let harness = $state('claude');
	let running = $state(/** @type {{ device: string, command: string, claude: string | null } | null} */ (null));
	let copied = $state(false);
	$effect(() => {
		const h = harness.trim();
		if (!/^[A-Za-z0-9_-]+$/.test(h)) return void (running = null);
		api.agentCommand?.(h).then((/** @type {typeof running} */ r) => (running = r), () => (running = null));
	});
	/** in the Mac app, whether Touch ID may open avenDB here, and whether it does (./session.svelte.js `touchState`) */
	let touch = $state(/** @type {{ ready: boolean, on: boolean } | null} */ (null));
	const lookTouch = () =>
		api.touchState?.().then(
			(/** @type {typeof touch} */ t) => (touch = t),
			() => (touch = null)
		);
	$effect(() => {
		if (sockets) lookTouch();
	});
	/** Turns Touch ID on or off here, then looks again. @param {boolean} on */
	async function setTouch(on) {
		await api.touch(on);
		await lookTouch();
	}
	/** Copies the line that runs the harness's agent device. */
	async function copyRunning() {
		await navigator.clipboard.writeText(running?.claude ?? running?.command ?? '');
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}
	/** the cloud agent this page just added, its key shown this once, until the person closes it */
	let cloud = $state(/** @type {{ device: string, name: string, key: string, variable: string } | null} */ (null));
	let cloudCopied = $state(false);
	/** Adds a cloud agent to avenMAIA, in one sheet, and shows its key once. */
	async function addCloud() {
		cloud = (await api.addCloudAgent?.()) ?? null;
	}
	/** in the Mac app, the agents' devices it knows of (avendb-device's `agentDevices`), looked for again now and then,
	 *  as an agent starts or stops and its key moves; else none */
	let agents = $state(/** @type {{ name: string, device: string, cloud: boolean, online: boolean }[] | null} */ (null));
	$effect(() => {
		const look = () =>
			api.agentDevices?.().then(
				(/** @type {typeof agents} */ known) => (agents = known),
				() => (agents = null)
			);
		look();
		const every = setInterval(look, 15000);
		return () => clearInterval(every);
	});
	/** Copies the cloud agent's key. */
	async function copyCloud() {
		await navigator.clipboard.writeText(cloud?.key ?? '');
		cloudCopied = true;
		setTimeout(() => (cloudCopied = false), 1400);
	}

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const v = $derived(/** @type {import('./vaults.js').VaultView} */ (byId.get(vault)));
	/** whether this is the person's own vault: their devices, drives and agents show only there */
	const own = $derived(vault === world.mine);
	/** the share that lets everyone read its name, if it has one */
	const namePublic = $derived(nameShared(world, vault));
	/** whether vaults of its kind hold devices, as the kind table says */
	const holds = $derived(!!kindRules(world, v.kind)?.devices);
	/** the person's own vault lacks the master recovery key this device adds */
	const recoveryMissing = $derived(
		own && !!world.recovery && !v.owners.some((o) => 'signer' in o && o.signer === world.recovery)
	);
	/** its owners and devices, each key once, by its newest (`newest`), this device first */
	const owners = $derived(newest(v.owners));
	const devices = $derived(newest(v.devices).sort((a, b) => Number(b.me) - Number(a.me)));
	/** A signer owner, by the kind of key it is, never ranked: every owner is equal (Samuel 2026-10-19); the master
	 *  recovery key from before the key move as the old one (Samuel 2026-10-20).
	 *  @param {{ signer: string, recovery: boolean, legacy?: boolean, by: string | null }} o */
	const ownerLabel = (o) =>
		o.legacy ? 'Old/legacy recovery' : o.recovery ? 'Master recovery key' : o.by === 'touch' ? 'Mac Touch ID key' : 'Passkey';
	/** An owner as its Remove names it. @param {{ vault: string } | { signer: string, recovery: boolean, by: string | null }} o */
	const ownerName = (o) => ('vault' in o ? nameOf(byId.get(o.vault)) : ownerLabel(o).replace(/^\w/, (c) => c.toLowerCase()));
	/** An owner's key in the page's dry runs. @param {{ vault: string } | { signer: string }} o */
	const ownerKey = (o) => `owner ${'vault' in o ? o.vault : o.signer}`;
	/** How many of its owners approve a change. */
	const approves = $derived(
		v.threshold > 1
			? `${v.threshold} of its ${count(owners.length, 'owner')} approve a change together.`
			: owners.length === 1
				? 'Its one owner approves every change.'
				: `Any one of its ${count(owners.length, 'owner')} approves a change alone. Every owner is equal.`
	);

	/** every share over the vault, as the device lists them for the acting vault (the `shares` op), with whether it may
	 *  revoke each: the last list, until the next one comes */
	let shared = $state.raw(/** @type {import('./vaults.js').Shares | null} */ (null));
	$effect(() => {
		const op = { op: 'shares', over: vault, as: actor };
		void world;
		let gone = false;
		read(api, op, null).then((/** @type {import('./vaults.js').Shares | null} */ s) => !gone && (shared = s));
		return () => {
			gone = true;
		};
	});
	const rows = $derived(shared?.over === vault ? shared.rows : []);
	/** every share in force over the vault, the strongest first, as the device orders them */
	const given = $derived(rows.filter((r) => r.kind === 'grant'));
	/** whether the acting vault may share some of the vault on, as the device says */
	const sharesOn = $derived(shared?.over === vault ? allowed(shared.share) : acting(world, vault).shares);

	/** what is shared with the vault in other vaults */
	const held = $derived(world.shares.filter((c) => c.who === vault && c.over !== vault));
	/** Vault `id`'s name, where it holds a share over it: with the start of its id where another of those goes by the
	 *  same name, as two Studio workers. @param {string} id */
	const heldName = (id) => {
		const name = nameOf(byId.get(id));
		return held.some((c) => c.over !== id && nameOf(byId.get(c.over)) === name) ? `${name} (${short(id)})` : name;
	};
	/** A row's who: a vault's id, a signer's, a device's, or `"everyone"`. @param {ShareRow} r */
	const whoOf = (r) =>
		r.who === EVERYONE ? EVERYONE : 'vault' in r.who ? r.who.vault : 'signer' in r.who ? r.who.signer : 'device' in r.who ? r.who.device : r.who.invite;
	/** The entries a share on chosen entries picks, or none for any other share. @param {ShareRow} r */
	const entriesOf = (r) => {
		const w = /** @type {any} */ (r.what);
		const one = w && typeof w === 'object' && Array.isArray(w.entry) && Object.keys(w).length === 1;
		return one ? /** @type {string[]} */ (w.entry) : [];
	};
	/** the vault itself and the vaults that own it: each holds all of it */
	const holders = $derived(
		[v, ...v.owners.flatMap((o) => ('vault' in o ? [byId.get(o.vault)] : []))].filter((x) => !!x)
	);
	/**
	 * Who has the vault, one each: the vault itself and the vaults that own it, which hold all of it, then each vault
	 * and Everyone a share in force goes to, with its shares. Its shares on chosen entries fold into one line a level,
	 * so entries shared one by one don't fill the page.
	 * @typedef {{ id: string, owner: string, grants: ShareRow[], chosen: Map<string, ShareRow[]> }} Person
	 */
	const people = $derived.by(() => {
		/** @type {Map<string, Person>} */
		const by = new Map();
		for (const o of holders)
			by.set(o.id, { id: o.id, owner: o.id === vault ? 'the vault itself' : 'owns it', grants: [], chosen: new Map() });
		for (const r of given) {
			const id = whoOf(r);
			/** @type {Person} */
			const p = by.get(id) ?? { id, owner: '', grants: [], chosen: new Map() };
			if (entriesOf(r).length) {
				const level = rowLevel(r, world);
				p.chosen.set(level, [...(p.chosen.get(level) ?? []), r]);
			} else p.grants.push(r);
			by.set(id, p);
		}
		return [...by.values()];
	});
	/**
	 * The devices that get some of the vault, by the vault they get it through, as the device's world says, each key
	 * once, by its newest: whether each opens what it gets, or only keeps an encrypted copy.
	 */
	const getters = $derived.by(() => {
		/** @type {Map<string, Map<string, import('./vaults.js').Syncing>>} */
		const by = new Map();
		for (const x of world.audiences.filter((x) => x.vault === vault))
			for (const s of x.syncs) {
				const d = { ...s, device: newestKey(world, s.device) };
				const of = by.get(d.through) ?? new Map();
				const had = of.get(d.device);
				of.set(d.device, had ? { ...had, opens: had.opens || d.opens } : d);
				by.set(d.through, of);
			}
		return by;
	});
	/**
	 * What a device does with the entries it gets: opens them, or, where it doesn't, keeps an encrypted copy (Backup) or
	 * only connects (Relay), by the role the device's world names; else only that it opens none of them.
	 * @param {import('./vaults.js').Syncing} d
	 */
	const gets = (d) => (d.opens ? 'opens it' : ((d.level && KEEPS[d.level]) ?? 'opens none of it'));

	/** whether the Share form is open */
	let adding = $state(false);
	let renaming = $state(/** @type {string | null} */ (null));
	let naming = $state(/** @type {string | null} */ (null));
	/** the vault picked to become an owner too: one this device knows that doesn't own it yet and that the kind table
	 *  lets own it, where its kind takes one more owner (none for an aven or a device vault, which have one alone) */
	let newOwner = $state('');
	const ownable = $derived(
		world.vaults.filter(
			(x) => x.id !== vault && !v.owners.some((o) => 'vault' in o && o.vault === x.id) && mayCoOwn(world, v, x)
		)
	);
	/** whether the vault takes one more owner that is a vault, as the kind table says: a coop does */
	const takesOwner = $derived.by(() => {
		const r = kindRules(world, v.kind);
		return !!r && r.ownedBy !== 'signers' && (r.most == null || v.owners.length < r.most);
	});
	/** the picker's value for a person's vault named by its id, and the id typed */
	const BY_ID = 'id';
	let ownerId = $state('');
	/** the vault to make an owner: the one picked, or the one whose id is typed */
	const newcomer = $derived(newOwner === BY_ID ? ownerId.trim().toLowerCase() : newOwner);
	/** Whether vault `id` is the person's own, or one their vault owns: their passkey alone adds it. @param {string} id */
	const theirs = (id) => id === world.mine || owns(world, world.mine, id);
	/**
	 * Makes vault `id` an owner of this one too: one of the person's own as its owners approve; anyone else's by an
	 * invitation, a request this vault makes (`ask`, "invite"), which they accept with their passkey, and the person's
	 * passkey finishes from the consent screen (./AccessRequest.svelte): an owner is added only with both.
	 * @param {string} id
	 */
	const addOwner = (id) =>
		theirs(id)
			? api.run(`Making ${nameOf(byId.get(id))} an owner`, {
					op: 'share',
					over: vault,
					who: { vault: id },
					level: 'Owner',
					what: 'everything',
					as: actor
				})
			: api.run(`Inviting ${byId.has(id) ? nameOf(byId.get(id)) : `vault ${short(id)}`} to co-own it`, {
					op: 'ask',
					to: id,
					asks: 'invite',
					why: `To co-own ${nameOf(v)}`,
					as: vault
				});
	/** the invitations this vault made, the newest first: pending, accepted and waiting on the person's passkey, or
	 *  done */
	const invited = $derived(
		asks.made.filter((m) => m.from === vault && m.asks === 'invite').sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
	);
	/** What an invitation came to, in words. @param {import('./vaults.js').RequestRow} m */
	const invitedWords = (m) =>
		m.done
			? 'an owner now'
			: m.answer === 'denied'
				? 'declined'
				: m.answer === 'granted'
					? 'accepted: finish it on the consent screen'
					: 'invited, not answered yet';
	/** Whether avenDB's server backs up the person's vault (true), only relays for it (false), or holds no cap (null). */
	const backs = $derived(world.backsUp);

	/**
	 * What the device would make, as it answers a dry run of each (`may`): the vault's name (`profile`), the master
	 * recovery key as an owner (`recovery`), backups on or off (`backUp`), what a device of the vault keeps (`copy`),
	 * and removing each owner (`owner <id>`) and each device but this one (`device <id>`): `true`, `{ approve }` where
	 * the vault's owners approve it, or why not. Each is asked again only once what it asks changes, or who asks, or
	 * how the vault is governed, and kept as it comes even where another changed meanwhile: a device that syncs a big
	 * vault changes its world faster than it answers, and an answer thrown away at each change left every Remove
	 * hidden (Samuel 2026-10-20), then on "checking" for good (his iPhone 2026-10-21). One it doesn't answer in
	 * `MAY_WAIT` it asks again `MAY_AGAIN` on. Removals aren't asked while the device syncs (`behind`): it refuses
	 * them until it has caught up (`waits`), and they are the dearest to check.
	 */
	let can = $state(/** @type {Record<string, Verdict>} */ ({}));
	/** what each answer in `can` answers, or what is being asked, by its name: this device, the acting vault, the
	 *  vault's root and threshold, and the op, as JSON */
	const askedOf = /** @type {Record<string, string>} */ ({});
	/** counts the times it asked again what the device didn't answer */
	let again = $state(0);
	const MAY_WAIT = 20000;
	const MAY_AGAIN = 15000;
	/** Whether this device still brings what its peers hold, as the app's sync pill reads it (./sync.svelte.js). */
	const behind = $derived(sync.known && sync.behind > 0);
	$effect(() => {
		void again;
		/** @type {Record<string, object>} */
		const asks = { profile: { op: 'profile', vault, name: naming?.trim() || nameOf(v) } };
		if (recoveryMissing && world.recovery)
			asks.recovery = { op: 'share', over: vault, who: { signer: world.recovery }, level: 'Owner', what: 'everything' };
		if (own && backs != null) asks.backUp = { op: 'back_up', on: !backs };
		const other = devices.find((d) => !d.me) ?? devices[0];
		if (own && other) asks.copy = { op: 'copy', device: other.id, full: other.copy !== 'full' };
		if (!behind) {
			for (const o of owners)
				asks[ownerKey(o)] = { op: 'revoke', vault, owner: 'vault' in o ? { vault: o.vault } : { signer: o.signer } };
			for (const d of devices) if (!d.me) asks[`device ${d.id}`] = { op: 'revoke', vault, device: d.id };
		}
		const by = JSON.stringify([world.me, actor, v.root, v.threshold]);
		const fresh = Object.entries(asks)
			.map(([name, op]) => ({ name, op, key: `${by} ${JSON.stringify(op)}` }))
			.filter((x) => askedOf[x.name] !== x.key);
		if (!fresh.length) return;
		for (const x of fresh) askedOf[x.name] = x.key;
		may(
			api,
			actor,
			fresh.map((x) => x.op),
			MAY_WAIT
		).then((answers) => {
			const got = fresh.map((x, i) => ({ ...x, verdict: answers[i] })).filter((x) => askedOf[x.name] === x.key);
			if (!got.length) return;
			can = { ...can, ...Object.fromEntries(got.map((x) => [x.name, x.verdict])) };
			let unanswered = false;
			for (const { name, verdict } of got) {
				if (/** @type {any} */ (verdict)?.refused === 'NoAnswer') {
					delete askedOf[name];
					unanswered = true;
				}
				// a removal it refuses goes into the Mac app's log too, with why (Samuel 2026-10-21: no Remove on any device)
				else if (/^(owner|device) /.test(name) && !allowed(verdict)) console.warn(`avenDB: Settings may not remove ${name}:`, verdict);
			}
			if (unanswered) setTimeout(() => again++, MAY_AGAIN);
		});
	});
	/** Whether the device would make `what` (`can`). @param {string} what */
	const lets = (what) => allowed(can[what]);
	/**
	 * Why a Remove of `what` waits or can't be, in words: as the device refuses it, while this device still syncs, while
	 * it hasn't answered its dry run yet, or didn't in time; '' where it would make it. @param {string} what
	 */
	const whyNot = (what) => {
		const verdict = /** @type {any} */ (can[what]);
		const unanswered = verdict?.refused === 'NoAnswer';
		if (verdict !== undefined && !unanswered && !allowed(verdict)) return verdict.why ?? verdict.refused ?? 'refused';
		if (behind) return `Removing waits until ${here} has synced what your other devices hold: ${Math.floor(100 * share())}% so far`;
		if (unanswered) return `${Here} didn’t answer in time whether it may remove it: it asks again`;
		if (verdict === undefined) return `${Here} is checking whether it may remove it`;
		return '';
	};

	/** when each device last said what it holds (`lastSaid`) */
	const said = $derived(lastSaid(world));
	/** When device `id` was last seen, in words. @param {string} id */
	const seen = (id) => {
		const at = said.get(id);
		return at === undefined ? 'not seen yet' : at === null ? 'online now' : `last seen ${ago(at)}`;
	};
	const OLD =
		'Not unlocked since your keys moved to ML-DSA-65: it moves at its next unlock. Remove it if you no longer use it.';
	const OLD_AGENT =
		'Still signs with its key from before the move to ML-DSA-65: it moves the next time a device of yours finds it running, which then asks you once more.';
	/** Whether device `id` is an old one, not unlocked since the key move. @param {string} id */
	const isOld = (id) => world.vaults.some((x) => x.devices.some((d) => d.id === id && d.old));

	/** what an aven's devices are, which carry no card: its server, and its agents, here or in the cloud */
	const roles = $derived(deviceRoles(world, server(), agents));
	/** A device's name, to start a line: its card's, or what it is. @param {string} id */
	const deviceName = (id) => roles.get(id) ?? signerName(world, id, true);
	/** How this device acts for the vault: as the person's vault, through the vaults that own it, from theirs down. */
	const actsFor = $derived.by(() => {
		if (!v.via) return 'It doesn’t act for it: it only knows it from what it syncs.';
		if (!v.via.length) return 'It is one of its devices, and acts for it directly.';
		const [first, ...down] = [...v.via].reverse().map((o) => nameOf(byId.get(o)));
		const owning = down.map((n, i) => `${i ? ', which' : ', who'} owns ${n}`).join('');
		return `It acts for it as ${first}${owning}, ${down.length ? 'which' : 'who'} owns it.`;
	});

	/**
	 * Revokes share `id`, acting for vault `as`; a standing grant ("all my vaults, now and later") ends on every vault
	 * it reached, and no vault founded later follows it.
	 * @param {string | null} id @param {string} as @param {boolean} [standing]
	 */
	const revokeShare = (id, as, standing = false) =>
		api.run('Revoking', { op: 'revoke', share: id, as, ...(standing ? { standing: true } : {}) });
	/** Revokes share row `r`: a keep share as its issuer, any other as the acting vault. @param {ShareRow} r */
	const revoke = (r) =>
		revokeShare(r.id, r.kind === 'keep' ? (r.issuer ?? world.mine) : actor, r.kind === 'grant' && isStanding(r.name));

	/**
	 * Why removing a key or a device waits, or '' where it needn't: a removal drops every edit resting on that key
	 * which the device removing it doesn't hold, so this device first holds all its peers hold (the `synced` op):
	 * reaching at least one, avenDB's server among them, and behind none.
	 */
	async function waits() {
		const s = await read(api, { op: 'synced' }, null);
		if (!s) return `${Here} can’t tell yet how far it has synced`;
		if (!s.peers) return `${Here} reaches neither avenDB’s server nor another device of yours right now`;
		if (s.behind > 0) return `${Here} is still syncing ${count(s.behind, 'log')} from your other devices`;
		return '';
	}
	/**
	 * Removes owner or device `name` from vault `of` by op `op`, once this device has caught up (`waits`) and the
	 * person says yes: its peers refuse it from then on. The vault's owners approve it.
	 * @param {string} name @param {string} of @param {object} op
	 */
	async function remove(name, of, op) {
		const wait = await waits();
		if (wait) return void (session.error = `${name} stays for now: ${wait}. Remove it once it has caught up.`);
		const sureOf = `Remove ${name} from ${nameOf(byId.get(of))}? It syncs nothing more. Anything it wrote that never reached ${here} is dropped; what it holds stays on it, encrypted.`;
		return (await sure(sureOf)) && api.run(`Removing ${name}`, op);
	}
	/** @param {{ vault: string } | { signer: string, recovery: boolean, by: string | null }} o */
	const removeOwner = (o) =>
		remove(ownerName(o), vault, {
			op: 'revoke',
			vault,
			owner: 'vault' in o ? { vault: o.vault } : { signer: o.signer }
		});
	/**
	 * Removes device `id` from vault `of`, this one unless named, as a lost phone is (`revoke`).
	 * @param {string} id @param {string} name @param {string} [of]
	 */
	const removeDevice = (id, name, of = vault) => remove(name, of, { op: 'revoke', vault: of, device: id });

	/**
	 * Sets what device `d` keeps of every vault it syncs: a full copy, or a light one (`copy`).
	 * @param {import('./vaults.js').DeviceView} d @param {boolean} full
	 */
	const keepCopy = (d, full) =>
		api.run(full ? 'Keeping a full copy' : 'Keeping a light copy', { op: 'copy', device: d.id, full });

	/** the drives joined here, by their device: in the Mac app alone */
	const drivesById = $derived(new Map((drives?.drives ?? []).map((x) => [x.device, x])));
	/** the volumes plugged in that this Mac doesn't host as a drive of the vault */
	const loose = $derived((drives?.volumes ?? []).filter((x) => x.state !== 'hosted'));
	/**
	 * How deep this device's queries read, as it says (the `limits` op): at most `depth` rows and links down, whatever a
	 * query asks, which `set_limits` changes and the device keeps with what opens it again; a query that names no depth
	 * reads `default`; no write that counts reaches deeper than `ceiling`.
	 */
	let limits = $state(/** @type {{ depth: number, default: number, ceiling: number } | null} */ (null));
	let deepest = $state(0);
	$effect(() => {
		void world;
		read(api, { op: 'limits' }, null).then((/** @type {typeof limits} */ l) => {
			limits = l;
			if (l) deepest = l.depth;
		});
	});
	/** Keeps `deepest` as the most rows and links down this device's queries read. */
	async function setDepth() {
		if (!limits || deepest === limits.depth) return;
		const done = await api.run('Saving the query limit', { op: 'set_limits', depth: deepest });
		if (done) limits = done;
	}

	/** @type {Record<import('./native.js').Volume['state'], string>} what to say of a volume plugged in, by what it is
	 *  to this Mac */
	const VOLUME = {
		free: 'Not used for avenDB.',
		hosted: 'One of your drives, open on this Mac.',
		locked: 'One of your drives: your passkey opens it on this Mac once, and from then on it opens by itself.',
		removed: 'Taken out of your vault: using it again makes it a new device, what it held put aside on it.',
		other: "Another person's avenDB drive.",
		ejected: 'Ejected: avenDB holds nothing open on it, so you can unplug it.',
		busy: 'Under way…'
	};

	/** how many each section lists, where it lists some */
	const counts = $derived(
		/** @type {Record<string, number | undefined>} */ ({
			owners: owners.length,
			devices: holds ? devices.length : undefined,
			sharing: people.length
		})
	);
	/** the sections it shows: Backup only for the person's own vault, once the device knows how it is backed up */
	const shown = $derived(SECTIONS.filter(([id]) => id !== 'security' || (own && backs != null)));
	/** the section the address names, else the first */
	const at = $derived(shown.some(([id]) => id === section) ? section : 'profile');
</script>

<!-- what a device keeps, one switch: the chosen half filled -->
{#snippet keeps(/** @type {any} */ d)}
	<span class="keeps" role="group" aria-label="What it keeps">
		{#each [['full', 'Full copy'], ['light', 'Light']] as [copy, label] (copy)}
			{@const chosen = (d.copy === 'full') === (copy === 'full')}
			<button
				class:chosen
				aria-pressed={chosen}
				disabled={busy || !lets('copy') || d.copy === copy}
				onclick={() => keepCopy(d, copy === 'full')}>{label}</button
			>
		{/each}
	</span>
{/snippet}

<!-- down the left, the page's sections, each scrolling to it -->
{#snippet menu()}
	<h3 class="nav-group">Settings</h3>
	{#each shown as [id, label, icon] (id)}
		<a
			class="nav-item"
			class:on={at === id}
			href="#settings/{id}"
			aria-current={at === id ? 'location' : undefined}
			onclick={() => scrollTo(id)}
			><Icon name={icon} size={16} /><span>{label}</span>{#if counts[id] != null}<small>{counts[id]}</small>{/if}</a
		>
	{/each}
{/snippet}

<!-- a section of the page: its heading, then its cards -->
{#snippet part(/** @type {string} */ id, /** @type {import('svelte').Snippet} */ body)}
	{@const [, label, icon] = SECTIONS.find(([x]) => x === id) ?? []}
	<section class="part" id="settings-{id}" aria-label={label}>
		<h2 class="part-head">{#if icon}<Icon name={icon} size={18} />{/if}<span>{label}</span></h2>
		<div class="cards">{@render body()}</div>
	</section>
{/snippet}

{#snippet profile()}
	<article class="card wide">
		<div class="row head">
			<Mark vault={v} size={52} />
			<div>
				<h3>{nameOf(v)}</h3>
				<span class="chip accent">{KINDS[v.kind]}</span>
			</div>
		</div>
		<p class="soft">{kindHint(world, v.kind)}</p>
		<dl>
			<dt>Its id</dt>
			<dd class="mono">{v.id}</dd>
			<dt>{Here}</dt>
			<dd>{actsFor}</dd>
		</dl>
		{#if v.via}
			{#if naming === null}
				<button class="btn" disabled={busy} onclick={() => (naming = v.name ?? '')}>Rename</button>
			{:else}
				<div class="row">
					<input class="field" bind:value={naming} aria-label="Its name" />
					<button
						class="btn primary"
						disabled={busy || !naming.trim() || !lets('profile')}
						onclick={async () =>
							(await api.run('Renaming', { op: 'profile', vault, name: naming?.trim() })) && (naming = null)}
					>
						Save
					</button>
					<button class="btn quiet" onclick={() => (naming = null)}>Cancel</button>
				</div>
			{/if}
			<!-- its name is public by default (./vaults.js NAME_TYPES): its owners keep it to those it shares with here -->
			<div class="row">
				<p class="soft">
					{namePublic ? 'Everyone sees its name.' : 'Only those it shares with see its name.'}
				</p>
				<button
					class="btn quiet"
					disabled={busy}
					onclick={() =>
						namePublic
							? api.run('Keeping its name private', { op: 'revoke', share: namePublic.id, as: vault })
							: api.run('Making its name public', nameShare(vault))}
				>
					{namePublic ? 'Keep it private' : 'Make it public'}
				</button>
			</div>
		{/if}
	</article>
{/snippet}

<!-- Remove for owner or device `what`, by `onremove`: on the person's own vault it shows even where it can't be, and
	says why, or that the device is still checking -->
{#snippet remover(/** @type {string} */ what, /** @type {() => void} */ onremove)}
	{@const why = whyNot(what)}
	<span class="remover">
		{#if why}<span class="soft why">{why}</span>{/if}
		<button class="btn quiet danger" disabled={busy || !!why} onclick={onremove}>Remove</button>
	</span>
{/snippet}

{#snippet ownership()}
	<article class="card wide">
		<h3>Owners</h3>
		<p class="soft">{approves}</p>
		<ul class="list grants">
			{#each owners as o (('vault' in o ? o.vault : o.signer))}
				<li>
					<span class="cap">
						{#if 'vault' in o}
							<Mark vault={byId.get(o.vault)} size={28} />
							<b>{nameOf(byId.get(o.vault))}</b>
							<span class="soft">{KINDS[byId.get(o.vault)?.kind ?? 'human']}</span>
						{:else}
							<span class="key">{o.recovery ? '🛟' : o.by === 'touch' ? '👆' : '🔑'}</span>
							<b>{ownerLabel(o)}</b>
							<span class="soft mono">{short(o.signer)}</span>
						{/if}
					</span>
					{#if lets(ownerKey(o)) || own}{@render remover(ownerKey(o), () => removeOwner(o))}{/if}
				</li>
			{/each}
		</ul>
		{#if actor === vault && takesOwner}
			<div class="add-owner">
				<select class="field" bind:value={newOwner} aria-label="A vault to make an owner too">
					<option value="">A vault to make an owner too…</option>
					{#each ownable as x (x.id)}<option value={x.id}>{nameOf(x)} · {KINDS[x.kind]}</option>{/each}
					<option value={BY_ID}>A person’s vault by its id…</option>
				</select>
				<button
					class="btn"
					disabled={busy || !/^[0-9a-f]{64}$/.test(newcomer)}
					onclick={() => addOwner(newcomer).then(() => ([newOwner, ownerId] = ['', '']))}
					>{!newcomer || theirs(newcomer) ? 'Add as owner' : 'Invite'}</button
				>
			</div>
			{#if newOwner === BY_ID}
				<input class="field" bind:value={ownerId} placeholder="Their vault's id: 64 hex digits" aria-label="Their vault's id" />
			{/if}
			<p class="soft">
				A new owner acts for it as you do. One of your own vaults is added at once; anyone else's is invited, and added
				once they accept with their passkey and you finish it with yours. To hand it over, add the new owner first, then
				remove the old one.
			</p>
		{/if}
		{#if invited.length}
			<ul class="list grants">
				{#each invited as m (m.entry)}
					<li>
						<span class="cap">
							<Mark vault={byId.get(m.to)} size={28} />
							<b>{byId.has(m.to) ? nameOf(byId.get(m.to)) : `Vault ${short(m.to)}`}</b>
							<span class="soft">{invitedWords(m)}{m.created ? ` · ${ago(m.created)}` : ''}</span>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if recoveryMissing && lets('recovery')}
			<p class="soft">
				The master recovery key is avenDB's way back into a vault whose keys are all lost, while avenDB is young. Your
				vault doesn't have it.
			</p>
			<button
				class="btn"
				disabled={busy}
				onclick={() =>
					api.run('Adding the master recovery key', {
						op: 'share',
						over: vault,
						who: { signer: world.recovery },
						level: 'Owner',
						what: 'everything'
					})}>Add the master recovery key</button
			>
		{/if}
	</article>
	{#if ownedTitle(world, vault)}
		<Owned {world} {vault} {api} {busy} onrevoke={revokeShare} onremove={removeDevice} />
	{/if}
{/snippet}

{#snippet hardware()}
	<article class="card wide">
		<h3>Its devices</h3>
		{#if !holds}
			<p class="soft">{actsWords(world, v.kind)}</p>
		{:else if !devices.length}
			<p class="soft">No device of its own yet: {v.via ? `${here} acts for it through its owners` : 'its owners act for it'}.</p>
		{/if}
		<ul class="list">
			{#each devices as d (d.id)}
				<li class="device">
					{#if d.me && renaming !== null}
						<input class="field" bind:value={renaming} aria-label={`${Here}'s name`} />
						<button
							class="btn primary"
							disabled={busy || !renaming.trim()}
							onclick={async () => (await api.rename(renaming?.trim())) && (renaming = null)}
						>
							Save
						</button>
						<button class="btn quiet" onclick={() => (renaming = null)}>Cancel</button>
					{:else}
						<span class="who">
							<b>{d.me ? (d.name ?? thisName) : deviceName(d.id)}</b>
							<span class="meta">
								{#if d.me}<span class="chip accent">{here}</span>{/if}
								{#if drivesById.has(d.id)}<span class="chip">Drive</span>{/if}
								{#if d.old}<span class="chip warn" title={v.kind === 'aven' ? OLD_AGENT : OLD}>Old key</span>{/if}
								<span class="soft mono">{short(d.id)}</span>
								{#if !d.me}<span class="soft">{seen(d.id)}</span>{/if}
							</span>
						</span>
						{#if own}{@render keeps(d)}{/if}
						{#if d.me}
							<button class="btn quiet" disabled={busy} onclick={() => (renaming = d.name ?? thisName)}>Rename</button>
						{:else if lets(`device ${d.id}`) || own}
							{@render remover(`device ${d.id}`, () => removeDevice(d.id, deviceName(d.id)))}
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
		{#if own && devices.length}
			<p class="soft">
				A full copy keeps every entry and every file of every vault the device syncs, so it works offline and is one more
				backup. A light one keeps every entry, and a file only once it is opened there. Remove a device you no longer use
				or have lost: it syncs nothing more.
			</p>
		{/if}
	</article>

	{#if own}
		<article class="card">
			<h3>{Here}</h3>
			{#if sockets}
				<p>
					<span class="chip ok">Native</span>
					avenDB runs beside the app, not in this page: it reaches your other devices directly, over {count(
						sockets.length,
						'UDP socket'
					)} of its own, through avenDB's connection server only where your network leaves no other way, and keeps your
					vault in a folder on this Mac.
				</p>
			{/if}
			{#if sockets && (touch?.ready || touch?.on)}
				<h4>Touch ID</h4>
				{#if touch.on}
					<p class="soft">
						<span class="chip ok">On</span> A touch opens avenDB on {here} as the app starts, with no sign-in sheet. Its key
						is one more owner of your vault, equal to your passkey.
					</p>
					<button class="btn quiet" disabled={busy} onclick={() => setTouch(false)}>Turn off Touch ID</button>
				{:else}
					<p class="soft">
						Open avenDB on {here} with a touch instead of the sign-in sheet. A key in {here}'s Secure Enclave becomes one
						more owner of your vault, equal to your passkey, which approves it once.
					</p>
					<button class="btn" disabled={busy} onclick={() => setTouch(true)}>Use Touch ID</button>
				{/if}
			{/if}
			{#if limits}
				<h4>Query limits</h4>
				<p class="soft">
					A query on {here} reads each record so many rows down, and follows links as many levels: {limits.default} unless
					it asks for more, and never more than this. A link or a list of rows deeper than that shows as not read.
				</p>
				<label class="harness">
					<span>At most</span>
					<input
						class="field"
						type="number"
						min="1"
						max={limits.ceiling}
						bind:value={deepest}
						aria-label="The most rows and links down a query reads"
					/>
					<span class="soft">of {limits.ceiling} levels</span>
					<button
						class="btn quiet"
						disabled={busy || !(deepest >= 1 && deepest <= limits.ceiling) || deepest === limits.depth}
						onclick={setDepth}>Save</button
					>
				</label>
			{/if}
			<h4>Forget</h4>
			<p class="soft">
				Forgetting your account here leaves your vault and everything in it with your other devices and avenDB's server:
				sign in again with your passkey.
			</p>
			<button class="btn danger" disabled={busy} onclick={api.forget}>Forget my account on {here}</button>
		</article>

		<article class="card">
			<h3>Link another device</h3>
			<p class="soft">
				Open this link on your other device, or scan it with its camera. It joins your vault once you confirm with your
				passkey there. Or sign in there with your passkey alone.
			</p>
			<!-- the SVG is the device's own, made by qrSvg from the link -->
			<div class="qr">{@html qr}</div>
			<input class="field code" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
		</article>

		{#if drives}
			<article class="card">
				<h3>Drives</h3>
				<p class="soft">
					Each drive you use for avenDB is a device of your vault of its own, with a key of its own that is never on the
					drive in plain: the drive holds only ciphertext. While it is plugged into {here}, {here} keeps it in sync;
					unplugged, it shows what it held when it last checked.
				</p>
				<ul class="list">
					{#each drives.drives as x (x.device)}
						{@const d = v.devices.find((y) => y.id === x.device)}
						{@const name = d?.name ?? x.name ?? 'A drive'}
						<li class="device">
							<span class="who">
								<b>💽 {name}</b>
								<span class="meta">
									{#if x.plugged}
										<span class="chip ok">Plugged in</span>
									{:else}
										<span class="chip">Unplugged</span>
										<span class="soft">{x.checked == null ? 'not checked yet' : `checked ${ago(x.checked)}`}</span>
									{/if}
								</span>
							</span>
							{#if x.plugged && x.volume}
								<button class="btn quiet" disabled={busy} onclick={() => api.ejectDrive(x.volume, name)}>Eject</button>
							{/if}
						</li>
					{/each}
					{#each loose as x (x.path)}
						<li>
							<span class="key">💽</span>
							<b>{x.name}</b>
							<span class="soft">{VOLUME[x.state]}</span>
							{#if x.state === 'free' || x.state === 'removed'}
								<button class="btn" disabled={busy} onclick={() => api.useDrive(x.path, x.name)}>Use for avenDB</button>
							{:else if x.state === 'locked' || x.state === 'ejected'}
								<button class="btn" disabled={busy} onclick={() => api.openDrive(x.path, x.name)}>Open on {here}</button>
							{/if}
						</li>
					{/each}
				</ul>
				{#if !drives.drives.length && !loose.length}
					<p class="soft">No drive is plugged in. Plug one in to use it for avenDB.</p>
				{:else}
					<p class="soft">
						Using a drive asks for your passkey once. Eject it here before you unplug it. A drive you lose, you remove in
						Its devices, as you would a lost phone.
					</p>
				{/if}
			</article>
		{/if}

		{#if sockets}
			<article class="card">
				<h3>Agents</h3>
				<p class="soft">
					avenMAIA is Maia City's one AI identity, an aven the coop owns. Each agent harness joins it as one of its
					devices, with a key of its own: Claude Code as agentClaude, Codex as agentCodex, and so on. Once a harness runs
					its device, this page asks you to approve it, and it acts as avenMAIA with exactly what avenMAIA holds.
				</p>
				<label class="harness">
					<span>Harness</span>
					<input class="field" bind:value={harness} aria-label="The harness's name" placeholder="claude" />
				</label>
				{#if running}
					<p class="soft">
						{running.claude
							? `Run this line once in a terminal: Claude Code then starts ${running.device} in every folder.`
							: `Give this command to the harness's MCP settings, as the server it starts: ${running.device}.`}
					</p>
					<input class="field code" readonly value={running.claude ?? running.command} onfocus={(e) => e.currentTarget.select()} />
					<button class="btn quiet" onclick={copyRunning}>{copied ? 'Copied' : 'Copy the line'}</button>
				{/if}
				<h4>Cloud sessions</h4>
				<p class="soft">
					Claude Code sessions in Anthropic's cloud run no Mac. A cloud agent, agentCloud, gives them avenMAIA all the
					same: {here} makes a key and adds it to avenMAIA as a device in one sheet. To end it, remove agentCloud from
					avenMAIA's devices in Maia City's settings.
				</p>
				{#if cloud}
					<p class="soft">
						Put this key in your cloud environment's environment variables as <code>{cloud.variable}</code>. New cloud
						sessions of this repository then start agentCloud by themselves (the repository's .mcp.json). The key shows
						only now: {here} keeps no copy.
					</p>
					<input class="field code" readonly value={cloud.key} onfocus={(e) => e.currentTarget.select()} />
					<button class="btn quiet" onclick={copyCloud}>{cloudCopied ? 'Copied' : 'Copy the key'}</button>
					<button class="btn quiet" onclick={() => (cloud = null)}>Done</button>
				{:else}
					<button class="btn" disabled={busy} onclick={addCloud}>Add a cloud agent</button>
				{/if}
			</article>
		{/if}
	{/if}
{/snippet}

{#snippet sharing()}
	<article class="card wide">
		<div class="row top">
			<h3>Who has {nameOf(v)}</h3>
			{#if sharesOn}
				<button class="btn" class:primary={!adding} onclick={() => (adding = !adding)}>
					{adding ? 'Close' : 'Share'}
				</button>
			{/if}
		</div>
		<p class="soft">
			Each vault it is shared with, and Everyone where it is public: at what level, on what, and on which of their
			devices it is. A share on a type or a tag reaches what matches it now and later.{sharesOn
				? ''
				: ` Only ${nameOf(v)} itself, or a vault it shares some of it with as Owner, shares it on.`}
		</p>
		{#if adding}
			<div class="adding"><Share {world} {actor} {api} {busy} {vault} ondone={() => (adding = false)} /></div>
		{/if}
		<ul class="list people">
			{#each people as p (p.id)}
				{@const pv = p.id === EVERYONE ? undefined : byId.get(p.id)}
				{@const on = [...(getters.get(p.id)?.values() ?? [])]}
				<li>
					{#if p.id === EVERYONE}<span class="chip">Public</span>{:else}<Mark vault={pv} size={28} />{/if}
					<div class="person">
						<span>
							<b class:mine={p.id === actor}>{p.id === EVERYONE ? 'Everyone' : nameOf(pv)}</b>
							{#if p.owner}<small class="soft">· {p.owner}</small>{/if}
						</span>
						<ul class="theirs">
							{#if p.owner}<li><span>{roleGroup(world, 'owner')} · Everything</span></li>{/if}
							{#each p.grants as r (r.id)}
								{@const hint = rowHint(r, world)}
								<li>
									<span class="held">
										<span>
											<span title={hint}>{rowLevel(r, world)}</span> · {rowWhat(r, world)}
											{#if isStanding(r.name)}<span
													class="chip"
													title="A standing grant: every vault you found later gets it too, and revoking it ends it on all of them"
													>All your vaults, now and later</span
												>{/if}
											<small class="soft">
												{KEEPS[r.level] ? `· ${KEEPS[r.level]} ` : ''}· reaches
												{count(r.reaches, 'entry', 'entries')} now{r.issuer
													? ` · given by ${nameOf(byId.get(r.issuer))}`
													: ''}{r.parent ? ', through its own Owner share, which narrows it too' : ''}
											</small>
										</span>
										{#if r.what === null}
											<small class="soft">What it picks and allows is sealed from {here}.</small>
										{:else if !r.group && r.ops}
											<Ops ops={r.ops} />
										{/if}
									</span>
									{#if allowed(r.revoke)}
										<button class="btn quiet danger" disabled={busy} onclick={() => revoke(r)}
											>{isStanding(r.name) ? 'Revoke everywhere' : 'Revoke'}</button
										>
									{/if}
								</li>
							{/each}
							{#each [...p.chosen] as [level, rs] (level)}
								<li>
									<details class="chosen">
										<summary>{level} · {count(rs.length, 'chosen entry', 'chosen entries')}</summary>
										<ul>
											{#each rs as r (r.id)}
												<li>
													<span>{list(entriesOf(r).map((e) => titleOf(world, e)))}</span>
													{#if allowed(r.revoke)}
														<button class="btn quiet danger" disabled={busy} onclick={() => revoke(r)}>Revoke</button>
													{/if}
												</li>
											{/each}
										</ul>
									</details>
								</li>
							{/each}
						</ul>
						{#if on.length}
							<span class="on">
								<small class="soft">On</small>
								{#each on as d (d.device)}
									<span class="chip" class:ok={d.opens} title={gets(d)}
										>{deviceName(d.device)}{isOld(d.device) ? ' · old key' : ''}</span
									>
								{/each}
							</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</article>

	<article class="card wide">
		<h3>What others share with {nameOf(v)}</h3>
		<ul class="list">
			{#each held as c (c.id)}
				<li>
					<Mark vault={byId.get(c.over)} size={28} />
					<span class="held">
						<span>
							<b>{levelName(c, world)}</b> · {shareWhat(c, world)} · of <b>{heldName(c.over)}</b>
						</span>
						{#if c.slice && !groupOf(c, world)}<Ops ops={c.slice.ops} />{/if}
					</span>
				</li>
			{:else}
				<li class="soft">Nothing in another vault.</li>
			{/each}
		</ul>
	</article>

	<article class="card wide">
		<h3>Ask for access</h3>
		<p class="soft">
			{v.via
				? `Ask another vault to share with ${own ? 'your aven or a vault of yours' : nameOf(v)}: its owners answer on their consent screen.`
				: `Ask ${nameOf(v)} to share with your aven or a vault of yours: its owners answer on their consent screen.`}
		</p>
		<Ask {world} {api} {busy} made={asks.made} to={v.via ? '' : vault} as={v.via && !own ? vault : ''} />
	</article>
{/snippet}

{#snippet security()}
	<article class="card">
		<h3>Backup</h3>
		<p>
			<span class="chip" class:ok={backs}>{backs ? 'Backed up' : 'Relay only'}</span>
		</p>
		<p class="soft">
			{backs
				? "avenDB's server keeps your vault encrypted, which it can never open, so your passkey alone brings it back with every device lost."
				: "avenDB's server only helps your devices find and reach each other and keeps nothing: your vault lives on your devices alone, so losing them all loses it."}
			Turning it off keeps what the server holds already; it just stops taking more.
		</p>
		<button
			class="btn"
			disabled={busy || !lets('backUp')}
			onclick={() => api.run(backs ? 'Turning backups off' : 'Turning backups on', { op: 'back_up', on: !backs })}
		>
			{backs ? 'Turn backups off' : 'Turn backups on'}
		</button>
	</article>
{/snippet}

<Frame nav={menu} navLabel="{nameOf(v)}’s settings" navIcon="settings">
	<div class="page">
		{@render part('profile', profile)}
		{@render part('owners', ownership)}
		{@render part('devices', hardware)}
		{@render part('sharing', sharing)}
		{#if own && backs != null}{@render part('security', security)}{/if}
	</div>
</Frame>

<style>
	h3 {
		margin: 0 0 0.4rem;
	}

	h4 {
		margin: 1rem 0 0.3rem;
		font-family: var(--font-body);
		font-size: 0.86rem;
		font-weight: 600;
	}

	/* the page: its sections one after another, each its heading, then its cards */
	.page {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.part {
		scroll-margin-top: 0.5rem;
	}

	.part-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.8rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.head {
		gap: 0.8rem;
		margin-bottom: 0.6rem;
	}

	.head h3 {
		margin: 0 0 0.2rem;
		font-size: 1.15rem;
	}

	.card p {
		line-height: 1.5;
	}

	/* a Remove, and on the person's own vault why it can't be yet */
	.remover {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}

	.remover .why {
		max-width: 36ch;
		font-size: 0.78rem;
		line-height: 1.35;
		text-align: right;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.35rem 0.8rem;
		margin: 0 0 0.8rem;
		font-size: 0.84rem;
		line-height: 1.45;
	}

	dt {
		color: var(--soft);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.add-owner {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}

	.add-owner .field {
		flex: 1 1 14rem;
		min-width: 0;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--edge);
	}

	.list li:last-child {
		border-bottom: 0;
	}

	.grants li {
		justify-content: space-between;
	}

	.top {
		justify-content: space-between;
	}

	.adding {
		margin: 0.6rem 0 0.8rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fbfaf7;
	}

	.people > li {
		align-items: flex-start;
	}

	.person {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	/* a person's shares, under their name */
	.theirs {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.88rem;
	}

	.theirs > li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.2rem 0;
	}

	.chosen summary {
		cursor: pointer;
	}

	.chosen ul {
		margin: 0.3rem 0 0 1rem;
		padding: 0;
		list-style: none;
	}

	.chosen li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.15rem 0;
	}

	.on {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	/* a label, its field, and what goes with it, on one line */
	.harness {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.6rem;
	}

	/* a device on one row: who it is, what it keeps, what to do with it */
	.list li.device {
		flex-wrap: nowrap;
	}

	/* the name, and under it what tells it apart */
	.who {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.who b {
		overflow-wrap: anywhere;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.meta:empty {
		display: none;
	}

	/* what a device keeps: a full copy or a light one, the chosen half filled */
	.keeps {
		display: inline-flex;
		flex: none;
		padding: 2px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #f4f1eb;
	}

	.keeps button {
		padding: 0.22rem 0.7rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--soft);
		white-space: nowrap;
		cursor: pointer;
	}

	.keeps button:hover:not(:disabled) {
		color: var(--accent);
	}

	.keeps button.chosen {
		background: var(--accent);
		color: #fff;
		cursor: default;
	}

	.keeps button:disabled:not(.chosen) {
		opacity: 0.5;
		cursor: default;
	}

	/* on a phone: the name and what tells it apart across the row, what it keeps and what to do under it, and why a
	   Remove waits on a line of its own (Samuel's iPhone 2026-10-21: the toggle lay over "last seen") */
	@media (max-width: 520px) {
		.list li.device {
			flex-wrap: wrap;
			row-gap: 0.4rem;
		}

		.list li.device .who {
			flex-basis: 100%;
		}

		.meta {
			flex-wrap: wrap;
			white-space: normal;
		}

		.list li.device > .btn,
		.remover .btn {
			margin-left: auto;
		}

		.remover {
			display: contents;
		}

		.remover .why {
			order: 1;
			flex-basis: 100%;
			max-width: none;
			text-align: left;
		}
	}

	.mine {
		color: var(--accent);
	}

	.held {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.cap {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		line-height: 1.5;
	}

	.wide {
		grid-column: 1 / -1;
	}

	.list li input.field {
		flex: 1 1 10rem;
	}

	.key {
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
	}

	.qr :global(svg) {
		width: 220px;
		max-width: 100%;
		height: auto;
		background: #fff;
	}

	.code {
		display: block;
		width: 100%;
		box-sizing: border-box;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
	}
</style>
