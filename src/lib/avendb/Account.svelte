<!--
	Your account (P8e, P8f): the person's own avenDB. Their account is their human vault: its root is their passkey,
	which stays in the browser's authenticator, with the master recovery key as a way back while avenDB is young, and
	this browser is one of its devices, its keys unmasked by the passkey at every unlock, what it holds kept on its
	shelf in the browser's private file system (OPFS) so that it opens again in one ceremony, and kept open as long as
	the tab lives, by the tab's one session ($lib/avendb/session.svelte.js), which every page of the site that reads
	avenDB shares: leaving avenDB for another page and coming back, or opening one that reads it, asks for no second
	unlock. Every device of the vault
	shows by the name on its card, an entry of the vault the device writes itself, end-to-end encrypted like its notes
	(avendb-browser's `Device::card`), and every vault by the name on its profile, an entry this browser writes into it
	(`Device::profile`): the person's own by the name they gave as they set it up, their profile, which lives
	here alone (none of it in maiaCITY's database), the seed's by theirs. In the Mac app the device runs
	natively beside the app ($lib/avendb/native.js): its node on UDP sockets of its own, its shelf in a folder on the
	Mac; and it hosts each of the person's drives plugged into the Mac, a device of their vault of its own, which the
	page lists and joins in Owners & devices ($lib/avendb/Settings.svelte), where alone the person forgets their
	account here. A device forgotten there, one taken out of its vault, or what an earlier avenDB kept, is put aside and
	never read again. A new person
	founds their vault with the passkey they signed up to maiaCITY with (the same relying party, maia.city), as they
	come into the app ($lib/app/entry.js), or here if they went on without it; the first to found a vault through a server nobody has claimed yet claims it in the same
	ceremony and founds the seed (avendb's `world::SEED`): Maia City, a coop their vault owns, and avenMAIA, Maia
	City's one aven, which lives on the server, its device. A person
	with an account signs in on a new browser with their passkey alone: avenDB's server, which keeps their vault's log
	as ciphertext, hands it over, and the browser joins their vault (P8c), as it does after they lost every device. Or
	it links through the code another of their devices shows, scanned as a QR code or opened as a link (?link=), which
	asks to join on the one consent sheet every request rises on ($lib/avendb/AccessRequest.svelte): approving it is the
	passkey's one touch that unlocks this browser and adds it to their vault, and denying it puts the link away. Once
	unlocked, the account opens on the vaults it knows ($lib/avendb/Shell.svelte): the person's own, and those their vault
	founds and owns, each of which they act as: coops, their one aven, and the device vaults of its agents, which join
	it from the consent screen ($lib/avendb/AccessRequest.svelte). avenDB's server runs at avendb.maia.city: its
	relay and its code are filled in, and in a dev build a test server’s can take their place (?relay=, ?server=).
-->
<script module>
	// Maia City's seed and the studio's films run in the background (Samuel 2026-10-18), on past this page: kept here,
	// once for the tab, so a person who leaves avenDB while they run and comes back sees them going on, and the page
	// never starts them a second time beside the first, which would write the same pieces twice

	/** whether the device is writing the repo seed into Maia City, and the vaults it wrote it into, or failed to:
	 *  each tried once a visit, the next visit writing what is left */
	let bringing = false;
	const seededInto = new Set();
	const seedFailed = /** @type {Map<string, string>} */ (new Map());
	/** how far the repo seed has come, the pieces written of those it is writing, while it writes them in the
	 *  background: a corner pill shows it, and nothing waits for it */
	let seedAt = $state(/** @type {{ done: number, of: number } | null} */ (null));
	/** whether the device is copying the site's media into Maia City (./sitemedia-copy.js), the vaults it tried this
	 *  visit, and how far it is, which the corner shows */
	let copyingMedia = false;
	const mediaTried = new Set();
	let mediaAt = $state(/** @type {{ done: number, of: number } | null} */ (null));
</script>

<script>
	import { onMount, untrack } from 'svelte';
	import { signUpName } from '$lib/app/entry.js';
	import { native } from '$lib/native';
	import { sure } from '$lib/app/sure.js';
	import AccessRequest from './AccessRequest.svelte';
	import Shell from './Shell.svelte';
	import Signing from './Signing.svelte';
	import { FLOW, FLOWS, FUNCTION, FUNCTIONS } from './flows.js';
	import { answer, refs } from './ops.js';
	import { beside, seeding, seedPieces, unseeded } from './seed.js';
	import { copySiteMedia, leftOut, siteLeft } from './sitemedia-copy.js';
	import { capGroupOps } from './capgroups.js';
	import { deviceName, relay as relayOf, server as serverOf } from './server.js';
	import { asks, Here, here, session } from './session.svelte.js';
	import { plan, reported, rows, stepWords } from './steps.js';
	import { nameShare, nameShared, plain, seeded, standingOps } from './vaults.js';

	// the tab's device, as the session holds it (./session.svelte.js): what it is now, and what it shows of its world
	const phase = $derived(session.phase);
	const device = $derived(session.device);
	const meta = $derived(session.meta);
	const world = $derived(session.world);
	/** in the Mac app, its device beside it ($lib/avendb/native.js): null where the page runs the device */
	const mac = $derived(session.mac);
	/** what the page is doing, and what went wrong: the session's, which its `attempt` and every op shows */
	const doing = $derived(session.doing);
	const error = $derived(session.error);
	/**
	 * @typedef {{ title: string, asks: string, plan: string[], own: import('./steps.js').Stage[],
	 *  report: import('./steps.js').Report | null, began: number, t0: number, ended: number, error: string }} Start
	 */
	/** The start of this device under way or just over, which the sheet shows step by step (`signs`). */
	let signing = $state(/** @type {Start | null} */ (null));
	/** The page's clock while a start is under way, ticking for the sheet's seconds. */
	let clock = $state(0);
	let relay = $state('');
	let server = $state('');
	/** Whether the vault founded here has avenDB's server keep its ciphertext: on unless the person turns it off. */
	let backup = $state(true);
	/** Whether this device keeps a full copy, every entry and every file, or a light one, every entry and a file as
	 *  it is opened: its copy setting, which it writes once it has none (`upkeep`). A full copy in the Mac app, a light
	 *  one in any browser, whose storage the browser may clear: Safari does after a week unused. */
	let full = $state(native());
	let code = $state('');
	/** whether another device's link brought the person here, to link this browser */
	let arrived = $state(false);
	/** this browser's name, its card's title, which the person's other devices show it by */
	let name = $state('');
	/** the person's name, their human vault's profile: as it names them once open, else as they signed up, or type it
	 *  for the vault they found here */
	let person = $state('');
	let qr = $state('');
	let link = $state('');
	/** in the Mac app, the UDP sockets its device's node bound, on which it reaches its peers directly */
	let sockets = $state(/** @type {string[] | null} */ (null));
	/** in the Mac app, the access requests the agent devices on this Mac left for the person to answer
	 *  (avendb-device's `agent`, ./AccessRequest.svelte) */
	let requests = $state(/** @type {import('./vaults.js').AccessRequestView[]} */ ([]));
	/** the access requests as records (the `requests` op, ./AccessRequest.svelte): those asking a vault the person
	 *  acts for, which they answer, and those their vaults made, with the answers, in the browser and the Mac app alike */
	let records = $state.raw(/** @type {import('./vaults.js').Requests} */ ({ asked: [], made: [] }));
	/** in the Mac app, the volumes plugged into this Mac and the drives joined here, each a device of the person's
	 *  vault of its own that this Mac's device hosts while it is plugged in (avendb-device's `drive`): null elsewhere */
	let drives = $state.raw(/** @type {import('./native.js').Drives | null} */ (null));
	/** whether the device is writing its card, its copy setting, or vaults' profiles: one such write at a time */
	let carding = false;
	let copying = false;
	let profiling = false;
	/** whether the device is writing avenCEO GmbH's standard schemas, and the companies whose it wrote */
	let standardizing = false;
	const standardized = new Set();

	// the tab's device, loaded once for every page of the site, or taken up again where this tab opened it already, so
	// one unlock lasts the tab (./session.svelte.js); the session lets this page go as it closes, and what watched the
	// device for it stops, while the device runs on, syncing
	onMount(() => {
		const q = new URLSearchParams(location.search);
		// the built-in server, or, in a dev build alone, a test server's for this visit only: a link can't lead a
		// person's page to another server
		relay = (import.meta.env.DEV && q.get('relay')) || relayOf();
		server = (import.meta.env.DEV && q.get('server')) || serverOf();
		code = q.get('link') ?? '';
		arrived = !!code;
		name = deviceName();
		person = session.name || signUpName();
		return session.boot();
	});

	// once it runs: the link and the QR code the person's next device links through, its own and the relay it reaches
	// avenDB's server by; and in the Mac app, the sockets its node bound
	$effect(() => {
		const d = device;
		const via = meta?.relay;
		if (phase !== 'open' || !d || !via) return;
		sockets = mac ? d.sockets() : null;
		// a link the person's other devices open: the site's, as the app's own pages are the app's alone
		const site = native() ? 'https://maia.city' : location.origin;
		const shown = `${site}${location.pathname}?${new URLSearchParams({ link: d.offer(), relay: via })}`;
		link = shown;
		session.qr(shown, 240).then((svg) => link === shown && (qr = svg));
	});

	// while it is open: the access requests as records, looked for every few seconds as well as at each change, in the
	// browser and the Mac app alike; and in the Mac app, the requests on this Mac, as an agent device leaves its request
	// once its harness starts it, and again as it asks for more, and the drives plugged in and unplugged. The phase is
	// read first, so that the effect runs again as it changes
	$effect(() => {
		if (phase !== 'open') return;
		const look = () => {
			lookAsks();
			if (!mac) return;
			mac
				.call('agents')
				.then((/** @type {typeof requests} */ asked) => (requests = asked))
				.catch(() => {});
			lookDrives();
		};
		look();
		const every = setInterval(look, 3000);
		return () => clearInterval(every);
	});

	/** The access requests as records, as the device holds them now (the `requests` op): none where it doesn't say. */
	const lookAsks = () =>
		session.device &&
		session
			.ask({ op: 'requests' })
			.then((/** @type {any} */ out) => {
				if (out && 'ok' in out) records = out.ok;
			})
			.catch(() => {});

	/** In the Mac app: the volumes plugged in and the drives joined, as its device sees them now. */
	const lookDrives = () =>
		session.mac
			?.call('drives')
			.then((/** @type {import('./native.js').Drives} */ seen) => (drives = seen))
			.catch(() => {});

	const run = session.attempt;
	const act = session.change;

	/** What each step of a start shows in the sheet. */
	const words = stepWords(here);
	const shown = $derived(
		signing
			? rows([...signing.own, ...reported(signing.report, signing.t0)], signing.plan, words, {
					now: clock,
					ended: signing.ended,
					failed: !!signing.error
				})
			: []
	);
	const times = (/** @type {number} */ n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

	/**
	 * Runs `work`, a start of this device's that takes the steps of `plan`, showing each in the sheet as it happens
	 * (Signing.svelte), with how long it took: `work` marks the page's own steps with `step`, and hands the device the
	 * function it shows its steps by with `device`, from when it starts on. Whether it went through; the sheet closes
	 * by itself a little after a start that did.
	 * @param {string} title @param {string[]} plan
	 * @param {(at: import('./session.svelte.js').Steps) => Promise<unknown>} work
	 */
	async function signs(title, plan, work) {
		const prompts = plan.filter((step) => words[step]?.prompt).length;
		const began = performance.now();
		const asked = prompts ? `${asks[0].toUpperCase()}${asks.slice(1)} ${times(prompts)}` : '';
		signing = { title, asks: asked, plan, own: [], report: null, began, t0: began, ended: 0, error: '' };
		const s = signing;
		[session.doing, session.error] = [title, ''];
		clock = began;
		const tick = setInterval(() => (clock = performance.now()), 100);
		/** The page's own step under way, if any, is over at `at`. @param {number} at */
		const over = (at) => s.own.filter((o) => o.end == null).forEach((o) => (o.end = at));
		const step = (/** @type {string} */ step) => {
			const at = performance.now();
			over(at);
			s.own.push({ step, start: at, end: null });
		};
		const device = () => {
			over((s.t0 = performance.now()));
			return (/** @type {any} */ report) => {
				s.report = report;
			};
		};
		try {
			await work({ step, device });
			over((s.ended = performance.now()));
			setTimeout(() => signing === s && (signing = null), 3000);
			return true;
		} catch (e) {
			over((s.ended = performance.now()));
			session.error = s.error = plain(/** @type {Error} */ (e).message ?? String(e));
			return false;
		} finally {
			clearInterval(tick);
			session.doing = '';
			clock = performance.now();
		}
	}

	/** Founds the person's human vault with the passkey they signed up to maiaCITY with, or with one made here if
	 *  `fresh`: the unlock, which is the passkey's pass for this new device, and one ceremony for the vault and this
	 *  device in it, which also claims the server if nobody has yet; one ceremony more to make the passkey. The vault
	 *  gives avenDB's server a backup cap, keeping its ciphertext, unless the person turned `backup` off: then a relay
	 *  cap, which lets their devices through and keeps nothing (the session's `found`). @param {boolean} fresh */
	const found = (fresh) =>
		signs('Setting up your account', plan('found', { mac: !!mac, make: fresh }), async (at) => {
			await session.found(fresh, { name: name.trim(), relay, server, backup, person }, at);
		});

	/** Links this browser to the person's vault through `through`: the code another of their devices shows, or
	 *  avenDB's server's, which hands over their vault for their passkey alone. One ceremony, the unlock, which is the
	 *  passkey's pass for this new device and signs the edit that adds it to their vault too (the session's `link`).
	 *  @param {string} through @param {string} what */
	const linkHere = (through, what = `Linking ${here}`) =>
		signs(what, plan('link', { mac: !!mac }), (at) =>
			session.link(through.trim(), { name: name.trim(), relay }, at)
		);

	/** Opens the device this browser, or the app, holds, in the unlock alone; a store of the device taken out of its
	 *  vault, or kept before avenDB started fresh, is put aside, and this browser signs in or sets up again (the
	 *  session's `unlock`). */
	const unlockHere = () =>
		signs('Unlocking your account', plan('open', { mac: !!mac, touch: !!session.meta?.touch }), (at) =>
			session.unlock(at)
		);

	// what the device shows of its world, each time it reads it again: what this page keeps up in it besides
	$effect(() => {
		const [w, who] = [world, person];
		if (w) untrack(() => upkeep(w, who));
	});

	/**
	 * What this page keeps up as world `w` shows: the access requests as records; this device's card and copy setting;
	 * the profiles of the person's vault, by their maiaCITY name `who`, and of the seed; avenCEO's standard schemas.
	 * @param {import('./vaults.js').WorldView} w @param {string} who
	 */
	function upkeep(w, who) {
		lookAsks();
		const mine = w.vaults.find((v) => v.id === w.mine);
		// its card, so the person's other devices show it by name: once it holds its vault's key, as a device just
		// linked does soon after; what it writes comes back as a change, and shows
		const card = mine?.devices.find((x) => x.me);
		if (card && card.name !== meta.name && !carding) {
			carding = true;
			session
				.ask({ op: 'card', name: meta.name })
				.then(answer)
				.catch((/** @type {Error} */ e) => (session.error = `Naming ${here} failed: ${e.message}`))
				.finally(() => (carding = false));
		}
		// its copy setting, a full copy or a light one, as the person chose it here, where it has none yet
		if (card && !card.copy && !copying) {
			copying = true;
			session
				.ask({ op: 'copy', full })
				.then(answer)
				.catch((/** @type {Error} */ e) => (session.error = `Setting what ${here} keeps failed: ${e.message}`))
				.finally(() => (copying = false));
		}
		// the profiles of the person's vault, by their maiaCITY name, and of the seed their claim of the server
		// founded, if it did: written once, by whichever of their devices comes first, each public as it is named
		// (./vaults.js `NAME_TYPES`)
		/** @type {[string, string][]} */
		const unnamed = [];
		if (mine && !mine.name && who) unnamed.push([mine.id, who]);
		for (const [v, name] of seeded(w)) if (!v.name) unnamed.push([v.id, name]);
		if (unnamed.length && !profiling) {
			profiling = true;
			(async () => {
				for (const [v, name] of unnamed) {
					answer(await session.ask({ op: 'profile', vault: v, name }));
					if (!nameShared(w, v)) answer(await session.ask(nameShare(v)));
				}
			})()
				.catch((/** @type {Error} */ e) => (session.error = `Naming your vaults failed: ${plain(e.message)}`))
				.finally(() => (profiling = false));
		}
		// avenDB's standard schemas and lenses, each an entry of the seed's coop, Maia City, shared with everyone
		// as it adds them, their JSON as avenDB has it, so the same ids; and the content flow and its functions, Public
		// too: written once, by whichever device comes first
		const company = seeded(w)[0]?.[0];
		if (company && !standardizing && !standardized.has(company.id)) {
			standardizing = true;
			standardize(w, company.id)
				.then(() => standardized.add(company.id))
				.catch((/** @type {Error} */ e) => (session.error = `Adding avenCEO’s schemas failed: ${plain(e.message)}`))
				.finally(() => (standardizing = false));
		}
		// the repo seed's top-up (./seed.js): the code, games, settings, docs and recipes the repository adds that Maia
		// City never held, deleted or not, written into it once it holds the standard schemas, by the person's first device
		// alone: one that joins later might not have synced what the first wrote yet, and would write it all again
		const city = seeded(w)[0]?.[0];
		const first = mine?.devices[0]?.me === true;
		const tried = seededInto.has(city?.id) || seedFailed.has(city?.id ?? '');
		if (city && company && first && standardized.has(company.id) && !bringing && !tried) {
			bringing = true;
			const left = unseeded(w, city.id, seedPieces());
			// a background job (Samuel 2026-10-18): nothing waits for it, the setup is over without it, and the corner
			// shows how far it is while it has pieces to write
			seed(w, city.id, left)
				.then(() => seededInto.add(city.id))
				.catch((/** @type {Error} */ e) => {
					const said = `Bringing the repo’s seed into Maia City failed: ${plain(e.message)}`;
					seedFailed.set(city.id, said);
					session.error = said;
				})
				.finally(() => {
					bringing = false;
					seedAt = null;
				});
		}
		// the site's media (./sitemedia-copy.js, Samuel 2026-10-19: "copy everything for me"): what Maia City lacks of
		// the pictures, sounds and films the site shows from the old media vault, copied into it in the background once
		// the seed's top-up is over (or another device brings it), once a visit, by an owner's Mac app alone, as it
		// copies the private ones too, with its key (a browser has the Library's card), as fast as it goes, on any page
		const seedOver = !bringing && (!first || seededInto.has(city?.id) || seedFailed.has(city?.id ?? ''));
		const owns = !!city?.owners.some((o) => 'vault' in o && o.vault === mine?.id);
		if (native() && city && owns && seedOver && !copyingMedia && !mediaTried.has(city.id) && siteLeft(w, city.id).length) {
			copyingMedia = true;
			mediaTried.add(city.id);
			copySiteMedia(session.api, () => session.world ?? w, city.id, city.id, (at) => (mediaAt = at))
				.then((out) => {
					const missed = leftOut(out);
					if (missed) session.error = `Copying the site’s media into Maia City: ${missed}.`;
				})
				.catch((/** @type {Error} */ e) => (session.error = `Copying the site’s media into Maia City failed: ${plain(e.message)}`))
				.finally(() => {
					copyingMedia = false;
					mediaAt = null;
				});
		}
	}

	/**
	 * Maia City's cap groups where it holds none of their names yet (./capgroups.js), then
	 * each piece of the repo seed vault `city` holds no copy of yet (./seed.js), `left`, written into it acting for it,
	 * one piece after another, each op of a piece naming the entries the ones before it made (`refs`); a recipe's create
	 * with its file beside it, as the session brings one (`beside`). A piece the vault refuses is left out, and the rest
	 * go on: what was left out is said at the end, and the next visit tries it again.
	 * @param {import('./vaults.js').WorldView} w @param {string} city @param {import('./seed.js').Piece[]} left
	 */
	async function seed(w, city, left) {
		const send = session.ask;
		/** @type {string[]} */
		const failed = [];
		/** why each piece that failed did, the first time a reason comes up */
		const reasons = new Set();
		// first the cap groups every invite and grant names (Samuel 2026-10-19: Traveler, Citizen), so invites can be
		// made at once: each defined where Maia City holds none of its name yet (./capgroups.js), a group it includes
		// just before it
		try {
			/** @type {any[]} */
			const made = [];
			for (const op of capGroupOps(answer(await send({ op: 'cap_groups', vault: city })), city)) made.push(answer(await send(refs(op, made))));
		} catch (e) {
			failed.push('the cap groups');
			reasons.add(`the cap groups: ${/** @type {Error} */ (e)?.message ?? e}`);
		}
		seedAt = { done: 0, of: left.length };
		for (const p of left) {
			/** @type {any[]} */
			const done = [];
			try {
				for (const op of await seeding(p, city)) {
					const { op: ready, file } = beside(refs(op, done));
					const made = file ? await session.api.bring(`Adding ${p.name}`, ready, file, true) : answer(await send(ready));
					if (file && !made) throw new Error(`${p.name} didn’t go in`);
					done.push(made);
				}
			} catch (e) {
				failed.push(p.name);
				reasons.add(`${p.name}: ${/** @type {Error} */ (e)?.message ?? e}`);
			}
			seedAt = { done: (seedAt?.done ?? 0) + 1, of: left.length };
		}
		if (failed.length)
			throw new Error(`Maia City refused ${failed.length} of them: ${failed.join(', ')}. Why: ${[...reasons].slice(0, 3).join(' · ')}`);
	}

	/**
	 * Each of avenDB's standard schemas and lenses that vault `company` doesn't hold an entry of yet, added as its own:
	 * the schemas first, so each lens joins two it holds. Then the flows and functions every app knows (./flows.js)
	 * that it doesn't hold yet, by their key and their name. It never writes over an entry, nor shares anything
	 * (Samuel 2026-10-19: Maia City as it is is the truth): its flows and functions are Public already.
	 * @param {import('./vaults.js').WorldView} w @param {string} company
	 */
	async function standardize(w, company) {
		const send = session.ask;
		/** @type {import('./db.js').Db} */
		const db = answer(await send({ op: 'database', vault: company }));
		const held = new Set([...db.schemas, ...db.lenses].map((x) => x.id));
		const missing = [
			...db.builtIn.schemas.filter((x) => !held.has(x.id)).map((x) => ['schema', x.json]),
			...db.builtIn.lenses.filter((x) => !held.has(x.id)).map((x) => ['lens', x.json])
		];
		for (const [type, json] of missing) {
			answer(await send({ op: 'create', vault: company, type, value: json, as: company }));
		}
		const own = (/** @type {string} */ type) =>
			w.entries.filter((e) => e.vault === company && e.type === type && e.kind === 'record').map((e) => e.record);
		const [flows, fns] = [own(FLOW).map((f) => f?.key), own(FUNCTION).map((f) => `${f?.flow}\n${f?.name}`)];
		const made = [
			...FLOWS.filter((f) => !flows.includes(f.key)).map((f) => [FLOW, f]),
			...FUNCTIONS.filter((f) => !fns.includes(`${f.flow}\n${f.name}`)).map((f) => [FUNCTION, f])
		];
		for (const [type, value] of made) answer(await send({ op: 'create', vault: company, type, value, as: company }));
	}

	/** What the vaults' screens do, each acting for the vault it names; each resolves to whether it went through: the
	 *  session's (./session.svelte.js), and what this page does besides. */
	const api = {
		...session.api,
		/** @param {string} name */
		rename: (name) => act(`Renaming ${here}`, () => session.rename(name)),
		forget: () => forget(),
		/** In the Mac app: whether Touch ID may open avenDB here, and whether it does; else null. */
		touchState: () => session.touchState(),
		/** In the Mac app: Touch ID on or off here (./session.svelte.js `touch`). @param {boolean} on */
		touch: (/** @type {boolean} */ on) =>
			act(on ? 'Turning on Touch ID' : 'Turning off Touch ID', () => session.touch(on)),
		/**
		 * In the Mac app: grants agent device `name`'s access request, the one its device `device` left: it joins the
		 * person's one aven, named `avenName`, which the Mac founds first where their vault owns no aven yet, as a device
		 * vault of its own under it, its device in it, in one ceremony of their passkey where it has none yet; and it
		 * gets each of `shares`, `{over, level}`, a sub cap resting on the aven's own share over that vault
		 * (avendb-device's `grant`). The Mac answers the aven and the agent's device vault, `{aven, vault}`. With
		 * `standing`, a level, it gets all the person's vaults, now and later, too: a standing grant of their vault to
		 * the aven, and the aven's, resting on it, to the agent's device vault (the `share` op's `standing`), which every
		 * vault they own follows now and every vault they found later follows.
		 * @param {string} name @param {string} device @param {{ over: string, level: string }[]} shares
		 * @param {string} avenName @param {string} [standing]
		 */
		grant: (name, device, shares, avenName, standing = '') =>
			act(`Granting ${name}`, async () => {
				const joined = await mac.call('grant', name, device, shares, avenName);
				requests = requests.filter((r) => r.device !== device);
				const w = session.world;
				if (!standing || !w) return;
				for (const op of standingOps(w, joined.aven, joined.vault, standing)) answer(await session.ask(op));
			}),
		/** In the Mac app: denies agent device `name`'s access request, its device `device`'s. @param {string} name
		 *  @param {string} device */
		deny: (name, device) =>
			run(`Denying ${name}`, async () => {
				await mac.call('deny', name, device);
				requests = requests.filter((r) => r.device !== device);
			}),
		/** In the Mac app: the command that runs harness `harness`'s agent device, and for Claude Code the line that
		 *  adds it (avendb-device's `agentCommand`); else none. @param {string} harness
		 *  @returns {Promise<{ device: string, command: string, claude: string | null } | null>} */
		agentCommand: async (harness) => (mac ? mac.call('agentCommand', harness) : null),
		/**
		 * In the Mac app: uses the drive plugged in at volume `path` for avenDB, as a device of the person's vault of
		 * its own named `name`, in one ceremony of their passkey (avendb-device's `joinDrive`).
		 * @param {string} path @param {string} name
		 */
		useDrive: (path, name) =>
			act(`Using ${name} for avenDB`, async () => {
				await mac.call('joinDrive', path, name);
				await lookDrives();
			}),
		/**
		 * In the Mac app: opens the drive at volume `path`, one of the person's another Mac of theirs joined, on this
		 * Mac in one ceremony of their passkey, which this Mac hosts from then on without one (`openDrive`).
		 * @param {string} path @param {string} name
		 */
		openDrive: (path, name) =>
			act(`Opening ${name} on ${here}`, async () => {
				await mac.call('openDrive', path);
				await lookDrives();
			}),
		/**
		 * In the Mac app: ejects the drive at volume `path`, hosted here: its node stops and lets go of every file on it,
		 * and macOS ejects the volume, so Finder never finds it in use (`ejectDrive`). It shows unplugged, with when it
		 * last checked what it holds.
		 * @param {string} path @param {string} name
		 */
		ejectDrive: (path, name) =>
			run(`Ejecting ${name}`, async () => {
				await mac.call('ejectDrive', path);
				await lookDrives();
			})
	};

	// on a dev server only: the walks (scripts/avendb-hitl.mjs) act as an aven through the page's own api, as its agent
	// device would over MCP
	if (import.meta.env.DEV) /** @type {any} */ (globalThis).avendb = { api, world: () => session.world };

	const forget = async () => {
		const mine = world?.vaults.find((v) => v.id === world?.mine);
		const ask =
			mine && mine.devices.length > 1
				? `Forget your account on ${here}? Your vault and your other devices keep everything, and you can sign in here again.`
				: `Forget your account on ${here}? Your vault stays yours: sign in with your passkey on any device, and avenDB’s server hands it back.`;
		if (!(await sure(ask))) return;
		// the session lets go of the device on every page of the tab, and its shelf is put aside, never deleted, and a
		// new one is in use: in the app's folder, or in OPFS
		return run(`Forgetting ${here}`, () => session.forget());
	};
</script>

{#if phase === 'open' && world}
	<Shell
		{world}
		{api}
		doing={signing ? '' : doing}
		{error}
		thisName={meta?.name ?? ''}
		{link}
		{qr}
		{sockets}
		{requests}
		asks={records}
		{drives}
	/>
{:else}
	<div class="account">
		<header class="lead">
			<small>Your account</small>
			<h1>{session.name || person || 'You'}</h1>
			<p>Your own database, end-to-end encrypted and quantum-proof: a vault only you hold, on every device you link to it.</p>
		</header>
		{#if doing && !signing}<p class="soft asking" role="status">{doing}…</p>{/if}

		{#if phase === 'loading'}
			<p class="soft">Loading your account…</p>
		{:else if phase === 'broken'}
			<p class="soft">Restart the Mac app once its avenDB builds.</p>
		{:else if phase === 'open'}
			<p class="soft">Opening your vaults…</p>
		{:else if phase === 'closed'}
			<div class="cards">
				<article class="card">
					<h3>Unlock your account</h3>
					<p>Your account is on {here}, as {meta?.name}. Unlock it with your passkey.</p>
					<div class="row">
						<button class="btn primary" disabled={!!doing} onclick={unlockHere}>Unlock</button>
					</div>
				</article>
			</div>
		{:else}
			<div class="cards">
				{#if arrived}
					<AccessRequest
						world={null}
						api={null}
						busy={!!doing}
						joining={{
							name,
							ready: !!code.trim() && !!relay.trim(),
							rename: (/** @type {string} */ n) => (name = n),
							onjoin: () => linkHere(code),
							ondeny: () => ([arrived, code] = [false, ''])
						}}
					/>
				{/if}
				{#if !arrived}
					<article class="card">
						<h3>New to avenDB?</h3>
						<p>
							Set up your human vault: a vault that only you hold. The passkey you signed up to maiaCITY with becomes its
							root, and {here} its first device. The master recovery key can also recover it while avenDB is young.
						</p>
						<label class="name">
							<span class="soft">Your name, which your vault's profile keeps: the city knows you by it</span>
							<input class="field" bind:value={person} maxlength="60" autocomplete="name" />
						</label>
						<div class="row">
							<button
								class="btn primary"
								disabled={!!doing || !server.trim() || !relay.trim() || !name.trim() || !person.trim()}
								onclick={() => found(false)}
							>
								Use my maiaCITY passkey
							</button>
						</div>
					</article>
					<article class="card">
						<h3>Have an account already?</h3>
						<p>
							Sign in with your passkey, even with every other device of yours lost: avenDB's server hands {here} your vault,
							which only your passkey opens, and it joins as one more of your devices.
						</p>
						<button class="btn primary" disabled={!!doing || !server.trim() || !relay.trim() || !name.trim()} onclick={() => linkHere(server, 'Signing in')}>
							Sign in with my passkey
						</button>
						<details>
							<summary class="soft">Or link through your other device</summary>
							<p class="soft">Open the link your other device shows, or scan its QR code. Or paste its code here.</p>
							<input class="field" placeholder="Its code: AVENDB1…" bind:value={code} />
							<button class="btn" disabled={!!doing || !code.trim() || !relay.trim() || !name.trim()} onclick={() => linkHere(code)}>Link {here}</button>
						</details>
					</article>
				{/if}
				<article class="card">
					<h3>{Here}</h3>
					<label class="name">
						<span class="soft">Its name, which your other devices show it by</span>
						<input class="field" bind:value={name} />
					</label>
					<details>
						<summary class="soft">avenDB's server</summary>
						<p class="soft">maiaCITY's server, at avendb.maia.city. Change these only for a test server.</p>
						<input class="field" placeholder="Its connection server: https://…" bind:value={relay} />
						<input class="field" placeholder="The server’s code: AVENDB1…" bind:value={server} />
						<p class="soft">
							The first person to found their vault through a server owns it: their vault founds Maia City, which owns
							avenMAIA, its one aven, which lives on the server, its device.
						</p>
					</details>
					<label class="check">
						<input type="checkbox" bind:checked={full} />
						<span>
							Keep a full copy on {here}
							<span class="soft">
								{full
									? 'Every entry and every file, kept here: it works offline and is one more backup.'
									: 'Every entry, and a file only once you open it: it takes little space.'}
								You can change it later in Owners and devices.
							</span>
						</span>
					</label>
					<label class="check">
						<input type="checkbox" bind:checked={backup} />
						<span>
							Back up to avenDB's server
							<span class="soft">
								{backup
									? 'It keeps your vault encrypted, which it can never open, so your passkey alone brings it back.'
									: 'It only connects your devices and keeps nothing: your vault lives on your devices alone.'}
							</span>
						</span>
					</label>
				</article>
			</div>
		{/if}
		{#if error && !signing}<p class="error" role="alert">{error}</p>{/if}
	</div>
{/if}

{#if seedAt && seedAt.of}
	<p class="seeding" role="status" title="Maia City’s seed: what the repository adds that Maia City never held, written in the background">
		<span class="spin" aria-hidden="true"></span>
		Bringing Maia City’s seed · {seedAt.done} of {seedAt.of}
	</p>
{:else if mediaAt && mediaAt.of}
	<p class="seeding" role="status" title="The site’s pictures, sounds and films, copied from the old media vault into Maia City">
		<span class="spin" aria-hidden="true"></span>
		Copying the site’s media · {mediaAt.done} of {mediaAt.of}
	</p>
{/if}

{#if signing}
	<Signing
		title={signing.title}
		asks={signing.asks}
		rows={shown}
		total={(signing.ended || clock) - signing.began}
		over={!!signing.ended}
		error={signing.error}
		onclose={() => (signing = null)}
	/>
{/if}

<style>
	.seeding {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		background: var(--surface, #fff);
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.12);
		font-size: 0.8rem;
		pointer-events: none;
	}

	.seeding .spin {
		width: 0.8rem;
		height: 0.8rem;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		opacity: 0.6;
		animation: seeding 0.9s linear infinite;
	}

	@keyframes seeding {
		to {
			transform: rotate(360deg);
		}
	}

	.account {
		max-width: 64rem;
		margin: 0 auto;
		padding: 2rem clamp(1rem, 4vw, 2.6rem) 8rem;
	}

	.account input.field {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin: 0.25rem 0 0.5rem;
	}

	.lead small {
		color: var(--accent);
		font-size: 0.78rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.lead h1 {
		margin: 0.3rem 0 0.5rem;
		font-size: clamp(1.6rem, 3vw, 2.2rem);
		line-height: 1.15;
	}

	.lead p {
		max-width: 72ch;
		margin: 0 0 1.2rem;
		line-height: 1.55;
		color: var(--soft);
	}

	.card h3 {
		margin: 0 0 0.5rem;
	}

	.card p {
		line-height: 1.5;
	}

	.name {
		display: block;
	}

	.check {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		margin-top: 0.6rem;
		cursor: pointer;
	}

	.check .soft {
		display: block;
		font-size: 0.85rem;
	}

	details {
		margin-top: 0.6rem;
	}

	summary {
		cursor: pointer;
	}

	.asking {
		margin: 0 0 1.2rem;
	}
</style>
