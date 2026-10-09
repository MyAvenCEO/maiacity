<!--
	This browser (P8e): the browser itself as a device of its person, apart from the Lab's world. The person's passkey
	stays in the browser's authenticator and each ceremony asks them; the device's keys derive from it at every unlock,
	and what it holds is kept in IndexedDB, so it opens again in one ceremony. A new person founds their human vault here
	with the passkey they signed up to maiaCITY with (the same relying party, maia.city), or one they make here; the
	person who runs the server brings its setup code and claims it for their vault, as avenCEO's owner (P8f). A person
	with a device already links this one through the code that device shows, scanned as a QR code or opened as a link
	(?link=). What its other devices change shows here the moment it arrives. avenDB's server runs at avendb.maia.city:
	its relay and its code are filled in, and a test server's can take their place.
-->
<script>
	import { onDestroy, onMount } from 'svelte';

	const STORE = 'avendb-browser';
	/** avenDB's server (avendb.maia.city, rolled out by .github/workflows/avendb.yml): its relay, and its offer as it
	 *  logs it at every start; the same as long as its folder on the Hetzner volume keeps its device's secret */
	const RELAY = 'https://avendb.maia.city';
	const SERVER =
		'AVENDB1B6LJH6OGZJSR7VZ5VTUMZCXWT2W6UM7R5ACTO73WJ5SKYT3TIFMGNISFZ4E5FJUDQQRIOA3W6V5HCRAUVZAOVRI3C7JPSOKNK3T4VXQBAS6PKHZODTUQCGLIOR2HA4Z2F4XWC5TFNZSGELTNMFUWCLTDNF2HSLY';

	/** @type {any} the device's WebAssembly */
	let avendb = null;
	/** @type {any} */
	let stores = null;
	/** @type {any} */
	let store = null;
	/** @type {any} */
	let device = $state(null);
	/** @type {any} what opens this browser's device again */
	let meta = $state(null);
	/** @type {'loading' | 'new' | 'closed' | 'open'} */
	let phase = $state('loading');
	let doing = $state('');
	let error = $state('');
	let relay = $state('');
	let server = $state('');
	let code = $state('');
	/** the server's setup code, never kept: only the person who runs the server has it, to claim it once */
	let setup = $state('');
	let name = $state('This browser');
	/** @type {any[]} */
	let notes = $state([]);
	let qr = $state('');
	let link = $state('');
	/** @type {Record<string, string>} */
	let edits = $state({});
	/** @type {Record<string, string>} each note's text as last shown, to tell the person's edits from what arrives */
	let shown = {};
	/** @type {Record<string, { title: string, body: string }>} */
	let drafts = $state({});

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

	onMount(async () => {
		const q = new URLSearchParams(location.search);
		relay = q.get('relay') ?? (remembered('relay') || RELAY);
		server = q.get('server') ?? (remembered('server') || SERVER);
		code = q.get('link') ?? '';
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

	const times = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times'];

	/** Founds the person's human vault with the passkey they signed up to maiaCITY with, or with one made here if
	 *  `fresh`: the unlock, the pass to the relay, the vault and the device, one ceremony more to make the passkey,
	 *  and two more to claim the server with its setup code. @param {boolean} fresh */
	const found = (fresh) => {
		const claim = setup.trim();
		const asks = times[4 + (fresh ? 1 : 0) + (claim ? 2 : 0)];
		const what = `${fresh ? 'Making your passkey and founding' : 'Founding'} your vault${claim ? ' and claiming the server' : ''}`;
		return run(`${what}: your browser asks you ${asks}`, async () => {
			const { passkey, unlock, sign, held } = await ceremonies(undefined);
			const made = fresh ? await passkey.create(name) : null;
			if (made) held.id = made.id;
			const nonce = crypto.getRandomValues(new Uint8Array(32));
			const d = await avendb.Device.found(name, relay, server, claim || undefined, made?.spki, await unlock(nonce), sign);
			setup = '';
			await started(d, nonce, held.id);
		});
	};

	const linkHere = () =>
		run('Linking this browser: your browser asks you four times', async () => {
			const { unlock, sign, held } = await ceremonies(undefined);
			const nonce = crypto.getRandomValues(new Uint8Array(32));
			const d = await avendb.Device.link(name, relay, code.trim(), await unlock(nonce), sign);
			await started(d, nonce, held.id);
		});

	const openAgain = () =>
		run('Opening this browser’s device: your browser asks you once', async () => {
			const { unlock } = await ceremonies(meta.credential);
			const kept = await store.load();
			const d = await avendb.Device.open(meta.name, meta.relay, meta.passkey, await unlock(unhex(meta.nonce)), kept.ops, kept.keys);
			running(d);
		});

	/** @param {any} d @param {Uint8Array} nonce @param {string} credential */
	async function started(d, nonce, credential) {
		meta = { name, relay, nonce: hex(nonce), credential, passkey: d.passkey() };
		await store.setMeta(meta);
		remember('relay', relay);
		remember('server', server);
		running(d);
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
		if (!device) return;
		notes = await device.notes();
		for (const s of notes) {
			drafts[s.space] ??= { title: '', body: '' };
			for (const doc of s.docs) {
				// a note the person isn't editing follows what arrives
				if (edits[doc.entry] === undefined || edits[doc.entry] === shown[doc.entry]) edits[doc.entry] = doc.text;
				shown[doc.entry] = doc.text;
			}
		}
	}

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

	const forget = () =>
		run('Forgetting this browser’s device', async () => {
			await device?.close();
			store.close();
			await stores.remove(STORE);
			[device, meta, notes, phase] = [null, null, [], 'new'];
			store = await stores.open(STORE);
		});
</script>

<div class="browser">
	{#if phase === 'loading'}
		<p class="muted">Loading this browser’s device…</p>
	{:else if phase === 'open'}
		<div class="cards">
			<article class="card">
				<h3>{meta?.name}</h3>
				<p class="muted">Its passkey stays in your browser; what it holds stays in this browser’s storage, end-to-end encrypted on the way to your other devices.</p>
				<p>Link your next device: scan this with its camera, or open the link there.</p>
				<!-- the SVG is the device's own, made by qrSvg from the link -->
				<div class="qr">{@html qr}</div>
				<input class="code" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
				<button class="btn quiet" disabled={!!doing} onclick={forget}>Forget this browser’s device</button>
			</article>
			{#each notes as space (space.space)}
				<article class="card">
					<h3>Notes</h3>
					{#each space.docs as doc (doc.entry)}
						<label class="doc">
							<b>{doc.title}</b>
							<textarea rows="3" bind:value={edits[doc.entry]}></textarea>
						</label>
						{#if edits[doc.entry] !== doc.text}
							<button class="btn" disabled={!!doing} onclick={() => save(space, doc)}>Save</button>
						{/if}
					{:else}
						<p class="muted">No notes yet.</p>
					{/each}
					{#if drafts[space.space]}
						<input placeholder="A new note’s title" bind:value={drafts[space.space].title} />
						<textarea rows="2" placeholder="What it says" bind:value={drafts[space.space].body}></textarea>
						<button class="btn primary" disabled={!!doing || !drafts[space.space].title.trim()} onclick={() => write(space)}>Write it</button>
					{/if}
				</article>
			{/each}
		</div>
	{:else}
		<div class="cards">
			{#if phase === 'closed'}
				<article class="card">
					<h3>{meta?.name}</h3>
					<p>This browser is a device of yours already. Open it with your passkey.</p>
					<button class="btn primary" disabled={!!doing} onclick={openAgain}>Open</button>
					<button class="btn quiet" disabled={!!doing} onclick={forget}>Forget it</button>
				</article>
			{:else}
				<article class="card">
					<h3>Link through your other device</h3>
					<p>Scan the QR code your other device shows, or paste its code.</p>
					<input placeholder="Its code: AVENDB1…" bind:value={code} />
					<button class="btn primary" disabled={!!doing || !code.trim() || !relay.trim()} onclick={linkHere}>Link this browser</button>
				</article>
				<article class="card">
					<h3>New to avenDB?</h3>
					<p>Found your human vault with the passkey you signed up to maiaCITY with: it is your vault’s root, and its only recovery. No such passkey here? Make one.</p>
					<button class="btn primary" disabled={!!doing || !server.trim() || !relay.trim()} onclick={() => found(false)}>Use my maiaCITY passkey</button>
					<button class="btn quiet" disabled={!!doing || !server.trim() || !relay.trim()} onclick={() => found(true)}>Make a new passkey</button>
				</article>
				<article class="card">
					<h3>avenDB’s server</h3>
					<p class="muted">maiaCITY’s server, at avendb.maia.city. Change these only for a test server.</p>
					<input placeholder="Its relay: https://…" bind:value={relay} />
					<input placeholder="The server’s code: AVENDB1…" bind:value={server} />
					<p class="muted">Do you run it, and nobody has claimed it yet? Its setup code makes your human vault the owner of avenCEO, the aven vault the server is a device of.</p>
					<input type="password" autocomplete="off" placeholder="Its setup code, only if you run it" bind:value={setup} />
				</article>
				<label class="name">This browser’s name <input bind:value={name} /></label>
			{/if}
		</div>
	{/if}
	{#if doing}<p class="muted" role="status">{doing}…</p>{/if}
	{#if error}<p class="bad" role="alert">{error}</p>{/if}
</div>

<style>
	.browser input,
	.browser textarea {
		width: 100%;
		box-sizing: border-box;
		margin: 0.25rem 0 0.5rem;
		font: inherit;
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
	.bad {
		color: #b42318;
	}
</style>
