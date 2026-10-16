<!--
	Your account (P8e, P8f): the person's own avenDB. Their account is their human vault: its root is their passkey,
	which stays in the browser's authenticator, with the master recovery key as a way back while avenDB is young, and
	this browser is one of its devices, its keys unmasked by the passkey at every unlock, what it holds kept on its
	shelf in the browser's private file system (OPFS) so that it opens again in one ceremony. Every device of the vault
	shows by the name on its card, an entry of the vault the device writes itself, end-to-end encrypted like its notes
	(avendb-browser's `Device::card`), and every vault by the name on its profile, an entry this browser writes into it
	(`Device::profile`): the person's own by their maiaCITY name, the seed's by theirs. In the Mac app the device runs
	natively beside the app ($lib/avendb/native.js): its node on UDP sockets of its own, its shelf in a folder on the
	Mac; and it hosts each of the person's drives plugged into the Mac, a device of their vault of its own, which the
	page lists and joins in Owners & devices ($lib/avendb/Settings.svelte). A device forgotten here, or what an
	earlier avenDB kept, is put aside and never read again. A new person
	founds their vault here with the passkey they signed up to maiaCITY with (the same relying party, maia.city), or
	one they make here; the first to found a vault through a server nobody has claimed yet claims it in the same
	ceremony and founds the seed (avendb's `world::SEED`): Maia Holding GmbH, a coop their vault owns, avenCEO GmbH, a
	coop Maia Holding owns, avenCEO server, the device vault avenCEO GmbH owns and the server is a device of, and Maia
	City, a coop avenCEO GmbH owns. A person
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
<script>
	import { onDestroy, onMount } from 'svelte';
	import { me } from '$lib/auth/client';
	import { native } from '$lib/native';
	import AccessRequest from './AccessRequest.svelte';
	import Shell from './Shell.svelte';
	import Signing from './Signing.svelte';
	import { FLOW, FLOWS, FUNCTION, FUNCTIONS, RETIRED } from './flows.js';
	import { allowed, answer, reads, refs } from './ops.js';
	import { plan, reported, rows, stepWords } from './steps.js';
	import { EVERYONE, plain, seeded, standingOps } from './vaults.js';

	const STORE = 'avendb-browser';
	/** avenDB's server (avendb.maia.city, rolled out by .github/workflows/avendb.yml): its relay, and its offer as it
	 *  logs it at every start; the same as long as its shelf (g10, since the reset of #776) keeps its device's key */
	const RELAY = 'https://avendb.maia.city';
	const SERVER =
		'AVENDB1MBCQX7N5J4CIMMOIBDPTTJZANSCFEE5IXOFZBSUAH7PVD7W6FV2WUYSUHQEVHFIJCZ452CQLVIJ4K3W5HBKEQ4SRAA7MGXXMBYPDJ7YBAS6PKHZODTUQCGLIOR2HA4Z2F4XWC5TFNZSGELTNMFUWCLTDNF2HSLY';

	/** @type {any} the device's WebAssembly */
	let avendb = null;
	/** @type {any} in the Mac app, its device beside it ($lib/avendb/native.js): null where the page runs the device */
	let mac = null;
	/** @type {any} the page's store, its device's shelf in OPFS (./device/store.js) */
	let store = null;
	/** @type {any} */
	let device = $state(null);
	/** @type {any} what opens this browser's device again, as its shelf keeps it (avendb-browser's `Meta`): kept as a
	 *  plain object, as it comes */
	let meta = $state.raw(null);
	/** @type {'loading' | 'broken' | 'new' | 'closed' | 'open'} */
	let phase = $state('loading');
	let doing = $state('');
	let error = $state('');
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
	 *  it is opened: its copy setting, which it writes once it has none (`refresh`). A full copy in the Mac app, a light
	 *  one in any browser, whose storage the browser may clear: Safari does after a week unused. */
	let full = $state(native());
	let code = $state('');
	/** whether another device's link brought the person here, to link this browser */
	let arrived = $state(false);
	/** this browser's name, its card's title, which the person's other devices show it by */
	let name = $state('');
	/** the person's name at maiaCITY, which their account goes by */
	let person = $state('');
	/** what the device shows of its world (avendb-browser's `World::to_json`): kept whole, as it comes */
	let world = $state.raw(/** @type {import('./vaults.js').WorldView | null} */ (null));
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

	const hex = (/** @type {Uint8Array} */ b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
	const unhex = (/** @type {string} */ s) => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));

	/** Who asks for the passkey: the browser, or in the Mac app its sign-in sheet on maia.city ($lib/avendb/device/passkey.js). */
	const asks = native() ? 'a sign-in sheet asks for your passkey' : 'your browser asks for your passkey';
	/** This device, as the person sees it. */
	const [here, Here] = native() ? ['this Mac', 'This Mac'] : ['this browser', 'This browser'];

	/** A name for this browser that tells it from the person's other devices: its browser, on its system; or the app. */
	function deviceName() {
		if (native()) return 'maiaCITY Studio on Mac';
		const ua = navigator.userAgent;
		const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
		const system = /iPhone/.test(ua)
			? 'iPhone'
			: /iPad/.test(ua) || touchMac
				? 'iPad'
				: /Android/.test(ua)
					? 'Android'
					: /Mac/.test(ua)
						? 'Mac'
						: /Windows/.test(ua)
							? 'Windows'
							: /Linux|CrOS/.test(ua)
								? 'Linux'
								: '';
		const browser = /Edg(e|A|iOS)?\//.test(ua)
			? 'Edge'
			: /Firefox\/|FxiOS/.test(ua)
				? 'Firefox'
				: /Chrome\/|CriOS/.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: 'A browser';
		return system ? `${browser} on ${system}` : browser;
	}

	onMount(async () => {
		const q = new URLSearchParams(location.search);
		// the built-in server, or, in a dev build alone, a test server's for this visit only: a link can't lead a
		// person's page to another server
		relay = (import.meta.env.DEV && q.get('relay')) || RELAY;
		server = (import.meta.env.DEV && q.get('server')) || SERVER;
		code = q.get('link') ?? '';
		arrived = !!code;
		name = deviceName();
		me().then(
			(f) => {
				person = f.name;
				refresh();
			},
			() => {}
		);
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
	});

	onDestroy(() => device?.close());

	// while it is open: the access requests as records, looked for every few seconds as well as at each change, in the
	// browser and the Mac app alike; and in the Mac app, the requests on this Mac, as an agent device leaves its request
	// once its harness starts it, and again as it asks for more, and the drives plugged in and unplugged. The phase is
	// read first, so that the effect runs again as it changes: `mac` isn't reactive, and is set before the device opens
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
		device &&
		send({ op: 'requests' })
			.then((/** @type {any} */ out) => {
				if (out && 'ok' in out) records = out.ok;
			})
			.catch(() => {});

	/** In the Mac app: the volumes plugged in and the drives joined, as its device sees them now. */
	const lookDrives = () =>
		mac
			?.call('drives')
			.then((/** @type {import('./native.js').Drives} */ seen) => (drives = seen))
			.catch(() => {});

	/** In the Mac app: its device beside it, open already, to unlock, or none yet. The app runs avenDB natively, and
	 *  the page never runs a second device beside it. */
	async function openMac() {
		const bridge = await import('./native.js');
		const held = await bridge.status();
		mac = bridge;
		meta = held.meta ?? null;
		if (meta && held.device) running(new mac.NativeDevice(held.device));
		else phase = meta ? 'closed' : 'new';
	}

	/** In the Mac app: its device runs from here on, its folder keeping what opens it again. @param {any} info */
	async function macOpened(info) {
		meta = (await mac.call('status')).meta;
		running(new mac.NativeDevice(info));
	}

	/** A sign-in whose passkey roots no vault the other side holds: say which button sets one up. @param {Error} e */
	const noAccount = (e) => {
		if (!/no vault of this passkey/.test(e.message)) throw e;
		throw new Error(
			'This passkey has no account yet: set one up with “Use my maiaCITY passkey”, ' +
				'or pick the passkey you set yours up with.'
		);
	};

	/**
	 * Runs `work`, showing what it does and what went wrong: whether it went through.
	 * @param {string} what @param {() => Promise<unknown>} work
	 */
	async function run(what, work) {
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

	/** What each step of a start shows in the sheet. */
	const words = stepWords(here);
	/** The sheet's rows: the steps begun, by the page and the device, then those to come. */
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
	 * @param {(at: { step: (step: string) => void, device: () => (report: any) => void }) => Promise<unknown>} work
	 */
	async function signs(title, plan, work) {
		const prompts = plan.filter((step) => words[step]?.prompt).length;
		const began = performance.now();
		const asked = `${asks[0].toUpperCase()}${asks.slice(1)} ${times(prompts)}`;
		signing = { title, asks: asked, plan, own: [], report: null, began, t0: began, ended: 0, error: '' };
		const s = signing;
		[doing, error, clock] = [title, '', began];
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
			error = s.error = plain(/** @type {Error} */ (e).message ?? String(e));
			return false;
		} finally {
			clearInterval(tick);
			[doing, clock] = ['', performance.now()];
		}
	}

	/**
	 * In the Mac app: calls `name` with `args` on its device, which starts it, showing the steps of its start by
	 * `shows` as the device reports them (`steps`) while the call is under way, and once more as it ends.
	 * @param {(report: any) => void} shows @param {string} name @param {...unknown} args
	 */
	async function watching(shows, name, ...args) {
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

	/** Founds the person's human vault with the passkey they signed up to maiaCITY with, or with one made here if
	 *  `fresh`: the unlock, which is the passkey's pass for this new device, and one ceremony for the vault and this
	 *  device in it, which also claims the server if nobody has yet; one ceremony more to make the passkey. The vault
	 *  gives avenDB's server a backup cap, keeping its ciphertext, unless the person turned `backup` off: then a relay
	 *  cap, which lets their devices through and keeps nothing. @param {boolean} fresh */
	const found = (fresh) =>
		signs('Setting up your account', plan('found', { mac: !!mac, make: fresh }), async ({ step, device }) => {
			if (mac) {
				await macOpened(await watching(device(), 'found', name.trim(), relay, server, backup));
				return;
			}
			const { passkey, unlock, sign, held } = await ceremonies(undefined);
			if (fresh) step('make');
			const made = fresh ? await passkey.create(person || name) : null;
			if (made) held.id = made.id;
			const nonce = crypto.getRandomValues(new Uint8Array(32));
			const unlockNew = (/** @type {Uint8Array<ArrayBuffer>} */ challenge) => unlock(nonce, challenge);
			const shows = device();
			const d = await avendb.Device.found(name.trim(), relay, server, made?.spki, unlockNew, sign, backup, shows, store);
			step('save');
			await started(d, nonce, held.id);
		});

	/** Links this browser to the person's vault through `through`: the code another of their devices shows, or
	 *  avenDB's server's, which hands over their vault for their passkey alone. One ceremony, the unlock, which is the
	 *  passkey's pass for this new device and signs the edit that adds it to their vault too. @param {string} through
	 *  @param {string} what */
	const linkHere = (through, what = `Linking ${here}`) =>
		signs(what, plan('link', { mac: !!mac }), async ({ step, device }) => {
			if (mac) {
				await macOpened(await watching(device(), 'link', name.trim(), relay, through.trim()).catch(noAccount));
				return;
			}
			const { unlock, held } = await ceremonies(undefined);
			const nonce = crypto.getRandomValues(new Uint8Array(32));
			const unlockNew = (/** @type {Uint8Array<ArrayBuffer>} */ challenge) => unlock(nonce, challenge);
			const d = await avendb.Device.link(name.trim(), relay, through.trim(), unlockNew, device(), store)
				.catch(noAccount);
			step('save');
			await started(d, nonce, held.id);
		});

	const unlockHere = () =>
		signs('Unlocking your account', plan('open', { mac: !!mac }), async (at) => {
			try {
				await unlocking(at);
			} catch (e) {
				// a store of the device taken out of its vault, or kept before avenDB started fresh with flat vaults
				if (!String(/** @type {Error} */ (e)?.message ?? e).includes('holds no vault this device belongs to')) throw e;
				throw new Error(
					`What ${here} kept holds no vault of yours: it was taken out of your vault, or kept before avenDB started fresh. Forget it here, then sign in or set up your account again with your passkey.`
				);
			}
		});

	/** Opens the device this browser, or the app, holds, in the unlock alone: the page marks its own steps with `step`
	 *  and hands the device the function it shows its own by with `device`.
	 *  @param {{ step: (step: string) => void, device: () => (report: any) => void }} at */
	async function unlocking({ step, device }) {
		if (mac) return macOpened(await watching(device(), 'open'));
		const { unlock } = await ceremonies(meta.credential);
		step('unlock');
		const unlocked = await unlock(unhex(meta.nonce));
		running(await avendb.Device.open(unlocked, device(), store));
	}

	/** The device runs from here on, its shelf keeping what opens it again, even should that fail: it can still show
	 *  its code, for the person's next device to link through. @param {any} d @param {Uint8Array} nonce
	 *  @param {string} credential */
	async function started(d, nonce, credential) {
		meta = { name: name.trim(), relay };
		running(d);
		meta = await d.keep(hex(nonce), credential);
	}

	/** @param {any} d */
	function running(d) {
		device = d;
		phase = 'open';
		sockets = mac ? d.sockets() : null;
		// a link the person's other devices open: the site's, as the app's own pages are the app's alone
		const site = native() ? 'https://maia.city' : location.origin;
		link = `${site}${location.pathname}?${new URLSearchParams({ link: d.offer(), relay: meta.relay })}`;
		if (mac) mac.call('qrSvg', link, 240).then((/** @type {string} */ svg) => (qr = svg));
		else qr = avendb.qrSvg(link, 240);
		watch(d).catch((/** @type {Error} */ e) => (error = `Showing what arrives failed: ${e.message}`));
	}

	/** Shows what `d` holds, then again each time it changes as its other devices sync with it, until it closes. @param {any} d */
	async function watch(d) {
		let [edits, keys] = await d.size();
		await refresh();
		while (device === d && (await d.changed(edits, keys))) {
			[edits, keys] = await d.size();
			await refresh();
		}
	}

	async function refresh() {
		const d = device;
		if (!d) return;
		/** @type {import('./vaults.js').WorldView | null} */
		const w = answer(await send({ op: 'world' })) ?? null;
		if (d !== device) return;
		world = w;
		if (!w) return;
		lookAsks();
		const mine = w.vaults.find((v) => v.id === w.mine);
		// its card, so the person's other devices show it by name: once it holds its vault's key, as a device just
		// linked does soon after; what it writes comes back as a change, and shows
		const card = mine?.devices.find((x) => x.me);
		if (card && card.name !== meta.name && !carding) {
			carding = true;
			send({ op: 'card', name: meta.name })
				.then(answer)
				.catch((/** @type {Error} */ e) => (error = `Naming ${here} failed: ${e.message}`))
				.finally(() => (carding = false));
		}
		// its copy setting, a full copy or a light one, as the person chose it here, where it has none yet
		if (card && !card.copy && !copying) {
			copying = true;
			send({ op: 'copy', full })
				.then(answer)
				.catch((/** @type {Error} */ e) => (error = `Setting what ${here} keeps failed: ${e.message}`))
				.finally(() => (copying = false));
		}
		// the profiles of the person's vault, by their maiaCITY name, and of the seed their claim of the server
		// founded, if it did: written once, by whichever of their devices comes first
		/** @type {[string, string][]} */
		const unnamed = [];
		if (mine && !mine.name && person) unnamed.push([mine.id, person]);
		for (const [v, name] of seeded(w)) if (!v.name) unnamed.push([v.id, name]);
		if (unnamed.length && !profiling) {
			profiling = true;
			(async () => {
				for (const [v, name] of unnamed) answer(await send({ op: 'profile', vault: v, name }));
			})()
				.catch((/** @type {Error} */ e) => (error = `Naming your vaults failed: ${plain(e.message)}`))
				.finally(() => (profiling = false));
		}
		// avenDB's standard schemas and lenses, each an entry of the seed's company, avenCEO GmbH, shared with everyone
		// as it adds them, their JSON as avenDB has it, so the same ids; and the content flow and its functions, Public
		// too: written once, by whichever device comes first
		const company = seeded(w)[1]?.[0];
		if (company && !standardizing && !standardized.has(company.id)) {
			standardizing = true;
			standardize(w, company.id)
				.then(() => standardized.add(company.id))
				.catch((/** @type {Error} */ e) => (error = `Adding avenCEO’s schemas failed: ${plain(e.message)}`))
				.finally(() => (standardizing = false));
		}
	}

	/**
	 * Each of avenDB's standard schemas and lenses that vault `company` doesn't hold an entry of yet, added as its own:
	 * the schemas first, so each lens joins two it holds. Then the flows and functions every app knows (./flows.js)
	 * that it doesn't hold yet, by their key and their name, and the app's code for each it holds whose code is one
	 * the app ran before (`RETIRED`), not one changed by hand; and a Public share of its flows and functions, where it
	 * gives none yet, so every app may read them as they read its schemas.
	 * @param {import('./vaults.js').WorldView} w @param {string} company
	 */
	async function standardize(w, company) {
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
		const fnEntries = w.entries.filter((e) => e.vault === company && e.type === FUNCTION && !e.deleted && e.record);
		for (const e of fnEntries) {
			const app = FUNCTIONS.find((f) => f.flow === e.record?.flow && f.name === e.record?.name);
			if (!app || !(RETIRED[app.name] ?? []).includes(e.record?.code)) continue;
			for (const [path, value] of [[['code'], app.code], [['about'], app.about]]) {
				answer(await send({ op: 'set', entry: e.entry, path, value, as: company }));
			}
		}
		const types = (/** @type {any} */ c) => [...(c.slice?.where?.type ?? [])].sort().join();
		const open = w.shares.some((c) => c.over === company && c.who === EVERYONE && types(c) === SHARED.join());
		if (!open) {
			const share = { op: 'share', over: company, who: EVERYONE, level: 'Public', what: { type: SHARED }, as: company };
			answer(await send(share));
		}
	}

	/** The types of avenCEO GmbH's entries every app reads, as it reads their schemas. */
	const SHARED = [FLOW, FUNCTION];

	/** The changes a vault's owners may have to approve, with the passkey: owners, devices, Owner shares, settings and
	 *  new vaults (avendb/docs/ARCHITECTURE.md §8). */
	const APPROVED = ['share', 'revoke', 'settings', 'found'];

	/**
	 * Op `op` on the device: the one way the page reads or changes the database (./ops.js, avendb/docs/ARCHITECTURE.md
	 * §8), on the page's own device and on the Mac app's alike. A change takes the passkey's ceremony, which the device
	 * runs only where the vault's owners approve it (in the Mac app, in its sign-in sheet); asked first, the device
	 * says whether it will, and what the page shows it doing says so. `read` hands over a file's bytes, for `put_file`.
	 * The device's answer: `{ ok }`, or `{ refused, why }`.
	 * @param {any} op @param {(at: number, n: number) => Promise<Uint8Array>} [read]
	 */
	async function send(op, read) {
		const d = device;
		if (reads(op)) return d.run(op);
		if (APPROVED.includes(op?.op) && doing) {
			const [verdict] = (await d.run({ op: 'may', ops: [op] }))?.ok ?? [];
			if (allowed(verdict) && verdict !== true) doing = `${doing}: ${asks} once`;
		}
		return d.run(op, mac ? undefined : (await ceremonies(meta.credential)).sign, read);
	}

	/**
	 * Runs `work` as `what`, then shows what changed: whether it went through.
	 * @param {string} what @param {() => Promise<unknown>} work
	 */
	const act = async (what, work) => {
		const ok = await run(what, work);
		if (ok) await refresh();
		return ok;
	};

	/** What the vaults' screens do, each acting for the vault it names; each resolves to whether it went through. */
	const api = {
		/**
		 * Runs change op `op` as `what` (./ops.js, avendb/docs/ARCHITECTURE.md §8): an entry's change, a share, a
		 * revocation, a setting, new vaults, a mark, a name, acting for the vault the op names (`as`). What it did, or
		 * `null` if it didn't go through, with why shown.
		 * @param {string} what @param {object} op
		 */
		run: async (what, op) => {
			let done = null;
			const ok = await act(what, async () => (done = answer(await send(op))));
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
			const ok = await act(what, async () => {
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
		putFile: async (actor, vault, file, media, tags) => {
			const what = `Adding ${file.name}`;
			/** @param {number} at @param {number} n */
			const read = async (at, n) => {
				if (file.size > 0) doing = `${what}: ${Math.floor((100 * at) / file.size)} %`;
				return new Uint8Array(await file.slice(at, at + n).arrayBuffer());
			};
			const op = { op: 'put_file', vault, name: file.name, media, tags, len: file.size, as: actor };
			let done = null;
			const ok = await act(what, async () => (done = answer(await send(op, read))));
			return ok ? done : null;
		},
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
		},
		/** @param {string} name */
		rename: (name) =>
			act(`Renaming ${here}`, async () => {
				if (!name || name === meta.name) return;
				await (mac ? mac.call('rename', name) : device.rename(name));
				meta = { ...meta, name };
			}),
		forget: () => forget(),
		/**
		 * In the Mac app: grants agent device `name`'s access request, the one its device `device` left: it joins the
		 * person's one aven, named `avenName`, which the Mac founds first where their vault owns no aven yet, as a device
		 * vault of its own under it, its device in it, in one ceremony of their passkey where it has none yet; and it
		 * gets each of `shares`, `{over, level}`, a sub cap resting on the aven's own share over that vault
		 * (avendb-device's `grant`). The Mac answers the aven and the agent's device vault, `{aven, vault}`. With
		 * `standing`, a level, it gets all the person's vaults, now and later, too: a standing grant of their vault to
		 * the aven, and the aven's, resting on it, to the agent's device vault (the `share` op's `standing`), which every
		 * vault they own follows now and every vault they found follows later.
		 * @param {string} name @param {string} device @param {{ over: string, level: string }[]} shares
		 * @param {string} avenName @param {string} [standing]
		 */
		grant: (name, device, shares, avenName, standing = '') =>
			act(`Granting ${name}`, async () => {
				const joined = await mac.call('grant', name, device, shares, avenName);
				requests = requests.filter((r) => r.device !== device);
				if (!standing || !world) return;
				for (const op of standingOps(world.mine, joined.aven, joined.vault, standing)) answer(await send(op));
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
	if (import.meta.env.DEV) /** @type {any} */ (globalThis).avendb = { api, world: () => world };

	const forget = () => {
		const mine = world?.vaults.find((v) => v.id === world?.mine);
		const ask =
			mine && mine.devices.length > 1
				? `Forget your account on ${here}? Your vault and your other devices keep everything, and you can sign in here again.`
				: `Forget your account on ${here}? Your vault stays yours: sign in with your passkey on any device, and avenDB’s server hands it back.`;
		if (!confirm(ask)) return;
		return run(`Forgetting ${here}`, async () => {
			await device?.close();
			// its shelf is put aside, never deleted, and a new one is in use: in the app's folder, or in OPFS
			await (mac ? mac.call('forget') : store.aside());
			[device, meta, world, phase] = [null, null, null, 'new'];
		});
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
			<h1>{person || 'You'}</h1>
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
						<button class="btn quiet" disabled={!!doing} onclick={forget}>Forget it here</button>
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
							Set up your account: a vault that only you hold. The passkey you signed up to maiaCITY with becomes its
							root, and {here} its first device. The master recovery key can also recover it while avenDB is young.
						</p>
						<div class="row">
							<button class="btn primary" disabled={!!doing || !server.trim() || !relay.trim() || !name.trim()} onclick={() => found(false)}>
								Use my maiaCITY passkey
							</button>
							{#if !native()}
								<button class="btn quiet" disabled={!!doing || !server.trim() || !relay.trim() || !name.trim()} onclick={() => found(true)}>
									Make a new passkey
								</button>
							{/if}
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
							The first person to found their vault through a server owns it: their vault founds Maia Holding GmbH, which
							owns avenCEO GmbH, which owns avenCEO server, the device vault the server is a device of.
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
