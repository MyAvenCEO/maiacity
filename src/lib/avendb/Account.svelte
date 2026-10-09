<!--
	Your account (P8e, P8f): the person's own avenDB, apart from the Lab's simulated world. Their account is their human
	vault: its root is their passkey, which stays in the browser's authenticator and is the vault's only recovery, and
	this browser is one of its devices, its keys derived from the passkey at every unlock, what it holds kept in
	IndexedDB so that it opens again in one ceremony. Every device of the vault shows by the name on its card, which the
	device writes itself into the vault's first space, end-to-end encrypted like the notes there (avendb-browser's
	`Device::card`). A new person founds their vault here with the passkey they signed up to maiaCITY with (the same
	relying party, maia.city), or one they make here; the first to found a vault through a server nobody has claimed yet
	claims it in the same ceremony, so their vault owns avenCEO, the aven vault the server is a device of. A person with an
	account signs in on a new browser with their passkey alone: avenDB's server, which keeps their vault's log as
	ciphertext, hands it over, and the browser joins their vault (P8c), as it does after they lost every device. Or it
	links through the code another of their devices shows, scanned as a QR code or opened as a link (?link=). avenDB's
	server runs at avendb.maia.city: its relay and its code are filled in, and a test server's can take their place
	(?relay=, ?server=).
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { me } from '$lib/auth/client';

	const STORE = 'avendb-browser';
	/** avenDB's server (avendb.maia.city, rolled out by .github/workflows/avendb.yml): its relay, and its offer as it
	 *  logs it at every start; the same as long as its folder on the Hetzner volume keeps its device's secret */
	const RELAY = 'https://avendb.maia.city';
	const SERVER =
		'AVENDB1B6LJH6OGZJSR7VZ5VTUMZCXWT2W6UM7R5ACTO73WJ5SKYT3TIFMGNISFZ4E5FJUDQQRIOA3W6V5HCRAUVZAOVRI3C7JPSOKNK3T4VXQBAS6PKHZODTUQCGLIOR2HA4Z2F4XWC5TFNZSGELTNMFUWCLTDNF2HSLY';

	/** @typedef {{ vault: string, root?: string, devices: { id: string, name?: string, me: boolean }[], ownsAven: boolean }} Account */

	/** @type {any} the device's WebAssembly */
	let avendb = null;
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
	let relay = $state('');
	let server = $state('');
	let code = $state('');
	/** whether another device's link brought the person here, to link this browser */
	let arrived = $state(false);
	/** this browser's name, its card's title, which the person's other devices show it by */
	let name = $state('');
	/** the person's name at maiaCITY, which their account goes by */
	let person = $state('');
	let account = $state(/** @type {Account | null} */ (null));
	/** @type {any[]} */
	let notes = $state([]);
	let qr = $state('');
	let link = $state('');
	/** this browser's new name, while the person renames it */
	let renaming = $state(/** @type {string | null} */ (null));
	/** whether the device is writing its card: one write at a time */
	let carding = false;
	/** @type {Record<string, string>} */
	let edits = $state({});
	/** @type {Record<string, string>} each note's text as last shown, to tell the person's edits from what arrives */
	let shown = {};
	/** @type {Record<string, { title: string, body: string }>} */
	let drafts = $state({});

	const mine = $derived(account?.devices.find((d) => d.me));
	const others = $derived(account?.devices.filter((d) => !d.me) ?? []);

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

	/** A name for this browser that tells it from the person's other devices: its browser, on its system. */
	function deviceName() {
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
			(f) => (person = f.name),
			() => {}
		);
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

	/** Runs `work`, showing what it does and what went wrong. @param {string} what @param {() => Promise<void>} work */
	async function run(what, work) {
		[doing, error] = [what, ''];
		try {
			await work();
		} catch (e) {
			error = /** @type {Error} */ (e).message ?? String(e);
		} finally {
			doing = '';
		}
	}

	async function ceremonies(/** @type {string | undefined} */ id) {
		const passkey = await import('./device/passkey.js');
		return { passkey, ...passkey.ceremonies(avendb, id) };
	}

	/** Founds the person's human vault with the passkey they signed up to maiaCITY with, or with one made here if
	 *  `fresh`: the unlock, the pass to the relay, and one ceremony for the vault and this device in it, which also
	 *  claims the server if nobody has yet; one ceremony more to make the passkey. @param {boolean} fresh */
	const found = (fresh) =>
		run(`Setting up your account: your browser asks for your passkey ${fresh ? 'four' : 'three'} times`, async () => {
			const { passkey, unlock, sign, held } = await ceremonies(undefined);
			const made = fresh ? await passkey.create(person || name) : null;
			if (made) held.id = made.id;
			const nonce = crypto.getRandomValues(new Uint8Array(32));
			const d = await avendb.Device.found(name.trim(), relay, server, made?.spki, await unlock(nonce), sign);
			await started(d, nonce, held.id);
		});

	/** Links this browser to the person's vault through `through`: the code another of their devices shows, or
	 *  avenDB's server's, which hands over their vault for their passkey alone. The unlock, the pass to the relay, the
	 *  passkey's hello, and the op that adds this browser to their vault. @param {string} through @param {string} what */
	const linkHere = (through, what = 'Linking this browser') =>
		run(`${what}: your browser asks for your passkey four times`, async () => {
			const { unlock, sign, held } = await ceremonies(undefined);
			const nonce = crypto.getRandomValues(new Uint8Array(32));
			const d = await avendb.Device.link(name.trim(), relay, through.trim(), await unlock(nonce), sign).catch(
				(/** @type {Error} */ e) => {
					throw /no vault of this passkey/.test(e.message) ? new Error('This passkey has no account yet: set one up first.') : e;
				}
			);
			await started(d, nonce, held.id);
		});

	const unlockHere = () =>
		run('Unlocking: your browser asks for your passkey once', async () => {
			const { unlock } = await ceremonies(meta.credential);
			const kept = await store.load();
			const d = await avendb.Device.open(meta.name, meta.relay, meta.passkey, await unlock(unhex(meta.nonce)), kept.ops, kept.keys);
			running(d);
		});

	/** The device runs from here on, its store following it, even should keeping what opens it again fail: it can
	 *  still show its code, for the person's next device to link through. @param {any} d @param {Uint8Array} nonce
	 *  @param {string} credential */
	async function started(d, nonce, credential) {
		meta = { name: name.trim(), relay, nonce: hex(nonce), credential, passkey: d.passkey() };
		running(d);
		remember('relay', relay);
		remember('server', server);
		await store.setMeta(meta);
	}

	/** @param {any} d */
	function running(d) {
		device = d;
		phase = 'open';
		store.follow(d).catch((/** @type {Error} */ e) => (error = `Saving failed: ${e.message}`));
		link = `${location.origin}${location.pathname}?${new URLSearchParams({ link: d.offer(), relay: meta.relay })}`;
		qr = avendb.qrSvg(link, 240);
		watch(d).catch((/** @type {Error} */ e) => (error = `Showing what arrives failed: ${e.message}`));
	}

	/** Shows what `d` holds, then again each time it changes as its other devices sync with it, until it closes. @param {any} d */
	async function watch(d) {
		let [ops, keys] = await d.size();
		await refresh();
		while (device === d && (await d.changed(ops, keys))) {
			[ops, keys] = await d.size();
			await refresh();
		}
	}

	async function refresh() {
		const d = device;
		if (!d) return;
		account = (await d.account()) ?? null;
		notes = await d.notes();
		for (const s of notes) {
			drafts[s.space] ??= { title: '', body: '' };
			for (const doc of s.docs) {
				// a note the person isn't editing follows what arrives
				if (edits[doc.entry] === undefined || edits[doc.entry] === shown[doc.entry]) edits[doc.entry] = doc.text;
				shown[doc.entry] = doc.text;
			}
		}
		// its card, so the person's other devices show it by name: once it holds its vault's first space, as a device
		// just linked does soon after; what it writes comes back as a change, and shows
		const card = account?.devices.find((x) => x.me);
		if (card && card.name !== meta.name && !carding) {
			carding = true;
			d.card(meta.name)
				.catch((/** @type {Error} */ e) => (error = `Naming this browser failed: ${e.message}`))
				.finally(() => (carding = false));
		}
	}

	const rename = () =>
		run('Renaming this browser', async () => {
			const next = renaming?.trim();
			if (!next || next === meta.name) return void (renaming = null);
			meta = { ...meta, name: next };
			await store.setMeta(meta);
			renaming = null;
			await device.card(next);
		});

	/** @param {any} space @param {any} doc */
	const save = (space, doc) =>
		run('Saving', async () => {
			await device.setText(space.founder, space.space, doc.entry, 2, edits[doc.entry]);
			await refresh();
		});

	/** @param {any} space */
	const write = (space) =>
		run('Writing', async () => {
			const d = drafts[space.space];
			if (!d.title.trim()) return;
			await device.write(space.founder, space.space, d.title.trim(), d.body);
			drafts[space.space] = { title: '', body: '' };
			await refresh();
		});

	const forget = () => {
		const ask =
			account && account.devices.length > 1
				? 'Forget your account on this browser? Your vault and your other devices keep everything, and you can sign in here again.'
				: 'Forget your account on this browser? Your vault stays yours: sign in with your passkey on any browser, and avenDB’s server hands it back.';
		if (!confirm(ask)) return;
		return run('Forgetting this browser', async () => {
			await device?.close();
			store.close();
			await stores.remove(STORE);
			[device, meta, account, notes, phase, renaming] = [null, null, null, [], 'new', null];
			store = await stores.open(STORE);
		});
	};

	/** The first characters of an id, enough to tell two apart. @param {string} id */
	const short = (id) => `${id.slice(0, 4)} ${id.slice(4, 8)}`;
</script>

<div class="account">
	<header class="lead">
		<small>Your account</small>
		<h1>{person || 'You'}</h1>
		{#if phase === 'open' && account}
			<div class="row">
				<span class="chip accent">Human vault</span>
				<span class="chip">{account.devices.length} device{account.devices.length === 1 ? '' : 's'}</span>
				{#if account.ownsAven}<span class="chip ok">Owns avenCEO</span>{/if}
			</div>
		{:else}
			<p>Your own database, end-to-end encrypted: a vault only you hold, on every device you link to it.</p>
		{/if}
	</header>

	{#if phase === 'loading'}
		<p class="soft">Loading your account…</p>
	{:else if phase === 'open'}
		<div class="cards">
			<article class="card">
				<h3>Your passkey</h3>
				<p>
					Your maiaCITY passkey is your vault's root: it approves every change to your vault, and it is its only
					recovery. It never leaves your browser's authenticator.
				</p>
				{#if account?.root}<p class="soft">Root <span class="mono">{short(account.root)}</span></p>{/if}
			</article>

			<article class="card devices">
				<h3>Your devices</h3>
				<ul>
					{#if mine}
						<li>
							<i class="dot"></i>
							{#if renaming !== null}
								<input class="field" bind:value={renaming} aria-label="This browser's name" />
								<button class="btn primary" disabled={!!doing || !renaming.trim()} onclick={rename}>Save</button>
								<button class="btn quiet" onclick={() => (renaming = null)}>Cancel</button>
							{:else}
								<b>{mine.name ?? meta?.name}</b>
								<span class="chip accent">this browser</span>
								<button class="btn quiet" disabled={!!doing} onclick={() => (renaming = meta?.name ?? '')}>Rename</button>
							{/if}
						</li>
					{/if}
					{#each others as d (d.id)}
						<li>
							<b>{d.name ?? 'A device, not named yet'}</b>
							<span class="soft mono">{short(d.id)}</span>
						</li>
					{/each}
				</ul>
				{#if !others.length}
					<p class="soft">Only this browser so far. Add your phone or another computer: link it below, or sign in there with your passkey.</p>
				{/if}
			</article>

			<article class="card">
				<h3>Link another device</h3>
				<p>
						Open this link on your other device, or scan it with its camera. It joins your vault once you confirm with your
						passkey there.
					</p>
				<!-- the SVG is the device's own, made by qrSvg from the link -->
				<div class="qr">{@html qr}</div>
				<input class="field code" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
			</article>

			{#if account?.ownsAven}
				<article class="card">
					<h3>avenCEO</h3>
					<p>
						Your vault owns avenCEO, the aven vault of avenDB's server at avendb.maia.city: you were the first to found a
						vault through it.
					</p>
				</article>
			{/if}
		</div>

		<h2 class="part">Your notes</h2>
		<div class="cards">
			{#each notes as space (space.space)}
				<article class="card">
					{#each space.docs as doc (doc.entry)}
						<label class="doc">
							<b>{doc.title}</b>
							<textarea class="field" rows="3" bind:value={edits[doc.entry]}></textarea>
						</label>
						{#if edits[doc.entry] !== doc.text}
							<button class="btn" disabled={!!doing} onclick={() => save(space, doc)}>Save</button>
						{/if}
					{:else}
						<p class="soft">No notes yet.</p>
					{/each}
					{#if drafts[space.space]}
						<input class="field" placeholder="A new note’s title" bind:value={drafts[space.space].title} />
						<textarea class="field" rows="2" placeholder="What it says" bind:value={drafts[space.space].body}></textarea>
						<button class="btn primary" disabled={!!doing || !drafts[space.space].title.trim()} onclick={() => write(space)}>Write it</button>
					{/if}
				</article>
			{:else}
				<p class="soft">Your notes arrive from your other devices.</p>
			{/each}
		</div>

		<p class="forget"><button class="btn quiet danger" disabled={!!doing} onclick={forget}>Forget my account on this browser</button></p>
	{:else if phase === 'closed'}
		<div class="cards">
			<article class="card">
				<h3>Unlock your account</h3>
				<p>Your account is on this browser, as {meta?.name}. Unlock it with your passkey.</p>
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
					<h3>Link this browser</h3>
					<p>Your other device sent you here: confirm with your passkey, and this browser joins your vault.</p>
					<div class="row">
						<button class="btn primary" disabled={!!doing || !code.trim() || !relay.trim() || !name.trim()} onclick={() => linkHere(code)}>
							Link this browser
						</button>
						<button class="btn quiet" disabled={!!doing} onclick={() => ([arrived, code] = [false, ''])}>Not now</button>
					</div>
				</article>
			{:else}
				<article class="card">
					<h3>New to avenDB?</h3>
					<p>
						Set up your account: a vault that only you hold. The passkey you signed up to maiaCITY with becomes its root and
						its only recovery, and this browser its first device.
					</p>
					<div class="row">
						<button class="btn primary" disabled={!!doing || !server.trim() || !relay.trim() || !name.trim()} onclick={() => found(false)}>
							Use my maiaCITY passkey
						</button>
						<button class="btn quiet" disabled={!!doing || !server.trim() || !relay.trim() || !name.trim()} onclick={() => found(true)}>
							Make a new passkey
						</button>
					</div>
				</article>
				<article class="card">
					<h3>Have an account already?</h3>
					<p>
						Sign in with your passkey, even with every other device of yours lost: avenDB's server hands this browser your
						vault, which only your passkey opens, and it joins as one more of your devices.
					</p>
					<button class="btn primary" disabled={!!doing || !server.trim() || !relay.trim() || !name.trim()} onclick={() => linkHere(server, 'Signing in')}>
						Sign in with my passkey
					</button>
					<details>
						<summary class="soft">Or link through your other device</summary>
						<p class="soft">Open the link your other device shows, or scan its QR code. Or paste its code here.</p>
						<input class="field" placeholder="Its code: AVENDB1…" bind:value={code} />
						<button class="btn" disabled={!!doing || !code.trim() || !relay.trim() || !name.trim()} onclick={() => linkHere(code)}>Link this browser</button>
					</details>
				</article>
			{/if}
			<article class="card">
				<h3>This browser</h3>
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
	{#if doing}<p class="soft" role="status">{doing}…</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.account input.field,
	.account textarea.field {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin: 0.25rem 0 0.5rem;
	}

	.card h3 {
		margin: 0 0 0.5rem;
	}

	.card p {
		line-height: 1.5;
	}

	.lead .row {
		margin-bottom: 1.2rem;
	}

	.devices ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.devices li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--edge);
	}

	.devices li:last-child {
		border-bottom: 0;
	}

	.devices li input.field {
		flex: 1 1 10rem;
		width: auto;
		margin: 0;
	}

	.devices li .btn.quiet {
		margin-left: auto;
	}

	.dot {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ok);
	}

	.qr :global(svg) {
		width: 240px;
		max-width: 100%;
		height: auto;
		background: #fff;
	}

	.code {
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
	}

	.doc {
		display: block;
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

	.forget {
		margin-top: 2rem;
	}
</style>
