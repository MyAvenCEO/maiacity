<!--
	Your account (P8e, P8f): the person's own avenDB. Their account is their human vault: its root is their passkey,
	which stays in the browser's authenticator and is the vault's only recovery, and this browser is one of its devices,
	its keys unmasked by the passkey at every unlock, what it holds kept in IndexedDB so that it opens again in one
	ceremony. Every device of the vault shows by the name on its card, an entry of the vault the device writes itself,
	end-to-end encrypted like its notes (avendb-browser's `Device::card`), and every vault by the name on its profile,
	an entry this browser writes into it (`Device::profile`): the person's own by their maiaCITY name, avenCEO's as
	avenCEO. In the Mac app the device runs natively beside the app ($lib/avendb/native.js): its node on UDP sockets of
	its own, its store in a folder on the Mac, and the device a page there made before moves into that folder as it
	unlocks. A new person founds their vault here with the passkey they signed up to maiaCITY with (the same relying
	party, maia.city), or one they make here; the first to found a vault through a server nobody has claimed yet claims
	it in the same ceremony, so their vault owns avenCEO, the aven vault the server is a device of. A person with an
	account signs in on a new browser with their passkey alone: avenDB's server, which keeps their vault's log as
	ciphertext, hands it over, and the browser joins their vault (P8c), as it does after they lost every device. Or it
	links through the code another of their devices shows, scanned as a QR code or opened as a link (?link=). Once
	unlocked, the account opens on the vaults it knows ($lib/avendb/Shell.svelte): the person's own, and the aven and
	coop vaults their vault founds and owns, each of which they act as. avenDB's server runs at avendb.maia.city: its
	relay and its code are filled in, and a test server's can take their place (?relay=, ?server=).
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { me } from '$lib/auth/client';
	import { native } from '$lib/native';
	import Shell from './Shell.svelte';
	import { answer } from './ops.js';
	import { count, plain } from './vaults.js';

	const STORE = 'avendb-browser';
	/** avenDB's server (avendb.maia.city, rolled out by .github/workflows/avendb.yml): its relay, and its offer as it
	 *  logs it at every start; the same as long as its folder on the Hetzner volume keeps its device's secret */
	const RELAY = 'https://avendb.maia.city';
	const SERVER =
		'AVENDB1B6LJH6OGZJSR7VZ5VTUMZCXWT2W6UM7R5ACTO73WJ5SKYT3TIFMGNISFZ4E5FJUDQQRIOA3W6V5HCRAUVZAOVRI3C7JPSOKNK3T4VXQBAS6PKHZODTUQCGLIOR2HA4Z2F4XWC5TFNZSGELTNMFUWCLTDNF2HSLY';

	/** @type {any} the device's WebAssembly */
	let avendb = null;
	/** @type {any} in the Mac app, its device beside it ($lib/avendb/native.js): null where the page runs the device */
	let mac = null;
	/** in the Mac app: whether the device a page there made before, in IndexedDB, moves into the app's folder as it
	 *  unlocks */
	let moving = $state(false);
	/** @type {any} */
	let stores = null;
	/** @type {any} */
	let store = null;
	/** @type {any} */
	let device = $state(null);
	/** @type {any} what opens this browser's device again: kept as a plain object, as IndexedDB can't clone a proxy */
	let meta = $state.raw(null);
	/** @type {'loading' | 'new' | 'closed' | 'open'} */
	let phase = $state('loading');
	let doing = $state('');
	let error = $state('');
	/** @typedef {{ title: string, signs: string }} Prompt */
	/** @type {Prompt[]} the passkey's prompts what is under way asks for, each with what it signs */
	let prompts = $state([]);
	/** which of them is up: -1 before the first */
	let prompted = $state(-1);
	let relay = $state('');
	let server = $state('');
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
	/** whether the device is writing its card, or vaults' profiles: one such write at a time */
	let carding = false;
	let profiling = false;

	/** @param {string} key */
	function remembered(key) {
		try {
			return localStorage.getItem(`avendb.${key}`) ?? '';
		} catch {
			return '';
		}
	}

	/** @param {string} key @param {string} value */
	function remember(key, value) {
		try {
			localStorage.setItem(`avendb.${key}`, value);
		} catch {
			// a private window keeps nothing: the fields stay empty next time
		}
	}

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
		relay = q.get('relay') ?? (remembered('relay') || RELAY);
		server = q.get('server') ?? (remembered('server') || SERVER);
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
		if (native() && (await openMac())) return;
		try {
			const pkg = await import('./device/avendb_browser.js');
			await pkg.default();
			avendb = pkg;
			stores = await import('./device/store.js');
			store = await stores.open(STORE);
			meta = await store.meta();
			phase = meta ? 'closed' : 'new';
		} catch (e) {
			error = `This browser can't be a device: ${/** @type {Error} */ (e).message}`;
			phase = 'new';
		}
	});

	onDestroy(() => device?.close());

	/** In the Mac app: its device beside it, open already or to unlock, or the page's to move there. Whether the app
	 *  runs avenDB natively: if it can't, the page runs the device, as before. */
	async function openMac() {
		const bridge = await import('./native.js');
		const held = await bridge.status();
		if (!held) return false;
		mac = bridge;
		if (held.meta) {
			meta = held.meta;
			if (held.device) running(new mac.NativeDevice(held.device));
			else phase = 'closed';
			return true;
		}
		// the device a page here made before: it moves into the app's folder as it unlocks
		try {
			stores = await import('./device/store.js');
			store = await stores.open(STORE);
			meta = (await store.meta()) ?? null;
		} catch {
			meta = null;
		}
		moving = !!meta;
		phase = meta ? 'closed' : 'new';
		return true;
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

	/** The passkey's prompts, by what each signs. */
	const PROMPT = {
		make: { title: 'Make your passkey', signs: 'nothing yet: it makes the key that signs the rest' },
		unlock: { title: `Unlock ${here}`, signs: `a pass for ${here}'s new keys, for 10 minutes` },
		vault: { title: 'Create your vault', signs: `your new vault, with ${here} in it` },
		signIn: { title: 'Sign in', signs: `${here}'s pass and its place in your vault` },
		reopen: { title: 'Unlock', signs: `nothing new: it opens your vault ${here === 'this Mac' ? 'on this Mac' : 'here'}` }
	};

	/**
	 * Runs `work`, showing what it does, the passkey's prompts it asks for (`prompts`), and what went wrong: whether
	 * it went through. `work` moves on to each prompt with `next` as it asks for it.
	 * @param {string} what @param {(next: () => void) => Promise<unknown>} work @param {Prompt[]} [asked]
	 */
	async function run(what, work, asked = []) {
		[doing, error, prompts, prompted] = [what, '', asked, mac ? 0 : -1];
		try {
			await work(() => prompted++);
			return true;
		} catch (e) {
			error = plain(/** @type {Error} */ (e).message ?? String(e));
			return false;
		} finally {
			[doing, prompts, prompted] = ['', [], -1];
		}
	}

	async function ceremonies(/** @type {string | undefined} */ id) {
		const passkey = await import('./device/passkey.js');
		return { passkey, ...passkey.ceremonies(avendb, id) };
	}

	/** Founds the person's human vault with the passkey they signed up to maiaCITY with, or with one made here if
	 *  `fresh`: the unlock, which is the passkey's pass for this new device, and one ceremony for the vault and this
	 *  device in it, which also claims the server if nobody has yet; one ceremony more to make the passkey.
	 *  @param {boolean} fresh */
	const found = (fresh) =>
		run(
			`Setting up your account: ${asks} ${fresh ? 'three times' : 'twice'}`,
			async (next) => {
				if (mac) {
					await macOpened(await mac.call('found', name.trim(), relay, server));
					remember('relay', relay);
					remember('server', server);
					return;
				}
				const { passkey, unlock, sign, held } = await ceremonies(undefined);
				if (fresh) next();
				const made = fresh ? await passkey.create(person || name) : null;
				if (made) held.id = made.id;
				const nonce = crypto.getRandomValues(new Uint8Array(32));
				const unlockNew = (/** @type {Uint8Array<ArrayBuffer>} */ challenge) => (next(), unlock(nonce, challenge));
				const signNext = (/** @type {Uint8Array<ArrayBuffer>} */ challenge, /** @type {string} */ step) => (next(), sign(challenge, step));
				const d = await avendb.Device.found(name.trim(), relay, server, made?.spki, unlockNew, signNext);
				await started(d, nonce, held.id);
			},
			fresh ? [PROMPT.make, PROMPT.unlock, PROMPT.vault] : [PROMPT.unlock, PROMPT.vault]
		);

	/** Links this browser to the person's vault through `through`: the code another of their devices shows, or
	 *  avenDB's server's, which hands over their vault for their passkey alone. One ceremony, the unlock, which is the
	 *  passkey's pass for this new device and signs the edit that adds it to their vault too. @param {string} through
	 *  @param {string} what */
	const linkHere = (through, what = `Linking ${here}`) =>
		run(
			`${what}: ${asks} once`,
			async (next) => {
				if (mac) {
					await macOpened(await mac.call('link', name.trim(), relay, through.trim()).catch(noAccount));
					remember('relay', relay);
					remember('server', server);
					return;
				}
				const { unlock, held } = await ceremonies(undefined);
				const nonce = crypto.getRandomValues(new Uint8Array(32));
				const unlockNew = (/** @type {Uint8Array<ArrayBuffer>} */ challenge) => (next(), unlock(nonce, challenge));
				const d = await avendb.Device.link(name.trim(), relay, through.trim(), unlockNew).catch(noAccount);
				await started(d, nonce, held.id);
			},
			[PROMPT.signIn]
		);

	const unlockHere = () =>
		run(`Unlocking: ${asks} once`, async (next) => {
			try {
				await unlocking(next);
			} catch (e) {
				// a store of the device taken out of its vault, or kept before avenDB started fresh with flat vaults
				if (!String(/** @type {Error} */ (e)?.message ?? e).includes('holds no vault this device belongs to')) throw e;
				throw new Error(
					`What ${here} kept holds no vault of yours: it was taken out of your vault, or kept before avenDB started fresh. Forget it here, then sign in or set up your account again with your passkey.`
				);
			}
		}, [PROMPT.reopen]);

	/** Opens the device this browser, or the app, holds, in the unlock alone, moving on to its prompt with `next`.
	 *  @param {() => void} [next] */
	async function unlocking(next = () => {}) {
		if (mac && moving) {
			// the page's device moves into the app's folder, the same device; then the page lets go of its copy, so
			// that it never runs twice
			const kept = await store.load();
			const info = await mac.call('adopt', meta, kept.edits.map(mac.base64), kept.keys.map(mac.base64));
			store.close();
			await stores.remove(STORE);
			[store, moving] = [null, false];
			return macOpened(info);
		}
		if (mac) return macOpened(await mac.call('open'));
		const { unlock } = await ceremonies(meta.credential);
		const kept = await store.load();
		next();
		const opens = [meta.name, meta.relay, meta.passkey, meta.mask];
		const d = await avendb.Device.open(...opens, await unlock(unhex(meta.nonce)), kept.edits, kept.keys);
		running(d);
	}

	/** The device runs from here on, its store following it, even should keeping what opens it again fail: it can
	 *  still show its code, for the person's next device to link through. @param {any} d @param {Uint8Array} nonce
	 *  @param {string} credential */
	async function started(d, nonce, credential) {
		meta = { name: name.trim(), relay, nonce: hex(nonce), mask: d.mask(), credential, passkey: d.passkey() };
		running(d);
		remember('relay', relay);
		remember('server', server);
		await store.setMeta(meta);
	}

	/** @param {any} d */
	function running(d) {
		device = d;
		phase = 'open';
		sockets = mac ? d.sockets() : null;
		// the app's device keeps its own store
		if (!mac) store.follow(d).catch((/** @type {Error} */ e) => (error = `Saving failed: ${e.message}`));
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
		const w = (await d.world()) ?? null;
		if (d !== device) return;
		world = w;
		if (!w) return;
		const mine = w.vaults.find((v) => v.id === w.mine);
		// its card, so the person's other devices show it by name: once it holds its vault's key, as a device just
		// linked does soon after; what it writes comes back as a change, and shows
		const card = mine?.devices.find((x) => x.me);
		if (card && card.name !== meta.name && !carding) {
			carding = true;
			d.card(meta.name)
				.catch((/** @type {Error} */ e) => (error = `Naming ${here} failed: ${e.message}`))
				.finally(() => (carding = false));
		}
		// the profiles of the person's vault, by their maiaCITY name, and of avenCEO, if their vault owns it: written
		// once, by whichever of their devices comes first
		const ceo = w.vaults.find(
			(v) => v.kind === 'aven' && v.devices.length && v.owners.some((o) => 'vault' in o && o.vault === w.mine)
		);
		/** @type {[string, string][]} */
		const unnamed = [];
		if (mine && !mine.name && person) unnamed.push([mine.id, person]);
		if (ceo && !ceo.name) unnamed.push([ceo.id, 'avenCEO']);
		if (unnamed.length && !profiling) {
			profiling = true;
			(async () => {
				for (const [v, name] of unnamed) await d.profile(v, name);
			})()
				.catch((/** @type {Error} */ e) => (error = `Naming your vaults failed: ${plain(e.message)}`))
				.finally(() => (profiling = false));
		}
	}

	/** The passkey's ceremony for what its vault approves: new vaults, an owner cap or its revocation. */
	const approver = async () => (mac ? undefined : (await ceremonies(meta.credential)).sign);

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
		 * Runs op `op` of avenDB's ops engine as `what` (./ops.js): a change of what this browser holds, acting for the
		 * vault the op names (`as`). What it did, or `null` if it didn't go through, with why shown.
		 * @param {string} what @param {object} op
		 */
		run: async (what, op) => {
			let done = null;
			const ok = await act(what, async () => (done = answer(await device.run(op))));
			return ok ? done : null;
		},
		/**
		 * Runs op `op` as it is, a read or a change, as the studio's console does: the device's answer, `{ ok }` or
		 * `{ refused, why }`.
		 * @param {object} op
		 */
		ask: (op) => device.run(op),
		/** Vault `vault`'s database as this browser holds it, for the database studio. @param {string} vault */
		database: (vault) => device.database(vault),
		/** The database's history: every signed edit this browser holds, for the studio's History. */
		history: () => device.history(),
		/** A note's main line, its proposals and every edit of it, for its page. @param {string} entry */
		note: (entry) => device.note(entry),
		/**
		 * A cap: role `role` on what `slice` selects of vault `over`, to vault `grantee` or `"public"`, acting for vault
		 * `issuer`; making a vault owner takes the passkey.
		 * @param {string} issuer @param {string} over @param {import('./vaults.js').Slice} slice @param {string} role
		 * @param {string} grantee
		 */
		share: (issuer, over, slice, role, grantee) =>
			act(role === 'owner' ? `Sharing: ${asks} once` : 'Sharing', async () =>
				device.share(issuer, over, slice, role, grantee, await approver())
			),
		/** @param {string} actor @param {string} cap @param {string} role */
		revoke: (actor, cap, role) =>
			act(role === 'owner' ? `Revoking: ${asks} once` : 'Revoking', async () =>
				device.revoke(actor, cap, await approver())
			),
		/** @param {{ name: string, kind: string }[]} vaults */
		foundVaults: (vaults) =>
			act(`Creating ${count(vaults.length, 'vault')}: ${asks} once`, async () =>
				device.foundVaults(vaults, await approver())
			),
		/** @param {string} vault @param {string} name */
		profile: (vault, name) => act('Renaming', () => device.profile(vault, name)),
		/** @param {string} name */
		rename: (name) =>
			act(`Renaming ${here}`, async () => {
				if (!name || name === meta.name) return;
				if (mac) {
					await mac.call('rename', name);
					meta = { ...meta, name };
					return;
				}
				meta = { ...meta, name };
				await store.setMeta(meta);
				await device.card(name);
			}),
		forget: () => forget()
	};

	const forget = () => {
		const mine = world?.vaults.find((v) => v.id === world?.mine);
		const ask =
			mine && mine.devices.length > 1
				? `Forget your account on ${here}? Your vault and your other devices keep everything, and you can sign in here again.`
				: `Forget your account on ${here}? Your vault stays yours: sign in with your passkey on any device, and avenDB’s server hands it back.`;
		if (!confirm(ask)) return;
		return run(`Forgetting ${here}`, async () => {
			await device?.close();
			if (mac && !moving) {
				// the app puts its folder's store aside, never deleting it
				await mac.call('forget');
				[device, meta, world, phase] = [null, null, null, 'new'];
				return;
			}
			store.close();
			await stores.remove(STORE);
			[device, meta, world, phase, moving] = [null, null, null, 'new', false];
			store = mac ? null : await stores.open(STORE);
		});
	};
</script>

{#if phase === 'open' && world}
	<Shell {world} {api} {doing} {error} thisName={meta?.name ?? ''} {link} {qr} {sockets} />
{:else}
	<div class="account">
		<header class="lead">
			<small>Your account</small>
			<h1>{person || 'You'}</h1>
			<p>Your own database, end-to-end encrypted and quantum-proof: a vault only you hold, on every device you link to it.</p>
		</header>
		{#if doing}
			<div class="asking" role="status">
				<p class="soft">{doing}…</p>
				{#if prompts.length}
					<ol class="prompts">
						{#each prompts as p, i (p.title)}
							<li class:now={i === prompted} class:done={i < prompted}>
								<span class="n">{i < prompted ? '✓' : i + 1}</span>
								<span><b>{p.title}</b><small>Signs: {p.signs}</small></span>
							</li>
						{/each}
					</ol>
				{/if}
			</div>
		{/if}

		{#if phase === 'loading'}
			<p class="soft">Loading your account…</p>
		{:else if phase === 'open'}
			<p class="soft">Opening your vaults…</p>
		{:else if phase === 'closed'}
			<div class="cards">
				<article class="card">
					<h3>Unlock your account</h3>
					<p>Your account is on {here}, as {meta?.name}. Unlock it with your passkey.</p>
					{#if moving}
						<p class="soft">
							As it unlocks, it moves into the app: avenDB then runs natively beside it, on its own UDP sockets, and keeps
							your vault in a folder on this Mac.
						</p>
					{/if}
					<div class="row">
						<button class="btn primary" disabled={!!doing} onclick={unlockHere}>Unlock</button>
						<button class="btn quiet" disabled={!!doing} onclick={forget}>Forget it here</button>
					</div>
				</article>
			</div>
		{:else}
			<div class="cards">
				{#if arrived}
					<article class="card">
						<h3>Link {here}</h3>
						<p>Your other device sent you here: confirm with your passkey, and {here} joins your vault.</p>
						<div class="row">
							<button class="btn primary" disabled={!!doing || !code.trim() || !relay.trim() || !name.trim()} onclick={() => linkHere(code)}>
								Link {here}
							</button>
							<button class="btn quiet" disabled={!!doing} onclick={() => ([arrived, code] = [false, ''])}>Not now</button>
						</div>
					</article>
				{:else}
					<article class="card">
						<h3>New to avenDB?</h3>
						<p>
							Set up your account: a vault that only you hold. The passkey you signed up to maiaCITY with becomes its root and
							its only recovery, and {here} its first device.
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
						<input class="field" placeholder="Its relay: https://…" bind:value={relay} />
						<input class="field" placeholder="The server’s code: AVENDB1…" bind:value={server} />
						<p class="soft">The first person to found their vault through a server owns avenCEO, the aven vault the server is a device of.</p>
					</details>
				</article>
			</div>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
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

	details {
		margin-top: 0.6rem;
	}

	summary {
		cursor: pointer;
	}

	.asking {
		margin: 0 0 1.2rem;
	}

	.asking > p {
		margin: 0;
	}

	.prompts {
		display: grid;
		gap: 0.4rem;
		max-width: 34rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.prompts li {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		opacity: 0.5;
	}

	.prompts li.now {
		opacity: 1;
		border-color: var(--accent);
	}

	.prompts li.done {
		opacity: 0.75;
	}

	.prompts .n {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		font-size: 0.75rem;
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
	}

	.prompts b {
		display: block;
		font-size: 0.92rem;
	}

	.prompts small {
		display: block;
		color: var(--soft);
		font-size: 0.8rem;
		line-height: 1.35;
	}
</style>
