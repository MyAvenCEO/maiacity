<!--
	The Mac app's sign-in sheet: one ceremony of the person's passkey for avenDB in maiaCITY Studio, whose own web view
	may not use maia.city's passkeys. The app shows this page in macOS's sign-in sheet over its window
	(vault/app/src/passkey.rs) with what its avenDB page asks for in the fragment: the challenge, the PRF salts, the
	passkey's credential if it knows it, and the public key of the `Sheet` it holds for this ceremony alone
	($lib/avendb/device/passkey.js, `inSheet`). The ceremony runs here, in the browser's own passkey prompt, as on the
	site; what it brings back is sealed to that key at once (avendb-browser's `sealCeremony`), its PRF outputs wiped
	from the page as they are sealed, and sent back to the app through its own scheme, which the sheet hands to the app
	instead of loading: nothing crosses but sealed, and only the page that asked opens it. Outside the /app/ layout: the
	sheet keeps no cookies, and needs no maiaCITY sign-in.
-->
<script>
	import { onMount } from 'svelte';

	/** @type {Record<string, string>} what each ceremony is for, by the step the device names */
	const FOR = {
		unlock: 'to unlock avenDB in the app',
		join: 'to add the app to your vault as one of its devices',
		found: 'to found your vault',
		claim: 'to claim avenDB’s server',
		approve: 'to approve what your vault changes'
	};

	/** @type {'loading' | 'asking' | 'sending' | 'failed' | 'lost'} */
	let phase = $state('loading');
	let error = $state('');
	let what = $state('');
	const purpose = $derived(FOR[what] ?? 'for avenDB');
	/** @type {any} */
	let passkey = null;
	/** @type {Promise<any> | null} the device's WebAssembly, for the seal: loading while the person confirms */
	let module = null;
	/** @type {{ challenge: Uint8Array, salt: Uint8Array, device?: Uint8Array, id?: string, key: Uint8Array } | null} */
	let ask = null;

	onMount(async () => {
		module = import('$lib/avendb/device/avendb_browser.js').then(async (pkg) => {
			await pkg.default();
			return pkg;
		});
		passkey = await import('$lib/avendb/device/passkey.js');
		const q = new URLSearchParams(location.hash.slice(1));
		const [challenge, salt, key] = ['challenge', 'salt', 'key'].map((k) => q.get(k));
		what = q.get('what') ?? '';
		if (!challenge || !salt || !key) return void (phase = 'lost');
		const device = q.get('device');
		ask = {
			challenge: passkey.unbase64url(challenge),
			salt: passkey.unbase64url(salt),
			device: device ? passkey.unbase64url(device) : undefined,
			id: q.get('id') ?? undefined,
			key: passkey.unbase64url(key)
		};
		// at once: a browser that wants a tap first refuses, and the button asks again
		go();
	});

	/** The ceremony, sealed to the app's key and sent back to it. */
	async function go() {
		if (!ask) return;
		[phase, error] = ['asking', ''];
		try {
			const done = await passkey.ceremony(ask.id, ask.challenge, ask.salt, ask.device);
			const avendb = await module;
			const sealed = avendb.sealCeremony(ask.key, ask.challenge, done);
			phase = 'sending';
			back({ sealed: passkey.base64url(sealed) });
		} catch (e) {
			const message = /** @type {Error} */ (e).message ?? String(e);
			error = /NotAllowed|not allowed|cancel/i.test(`${/** @type {Error} */ (e).name} ${message}`)
				? 'Your passkey wasn’t used: try again.'
				: message;
			phase = 'failed';
		}
	}

	/** Back to the app, with what the sheet brings: the sealed ceremony, or why there is none. @param {Record<string, string>} answer */
	function back(answer) {
		location.href = `${passkey.BACK}#${new URLSearchParams(answer)}`;
	}
</script>

<svelte:head>
	<title>Your passkey · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="sheet">
	<div class="card">
		<small>maiaCITY Studio · avenDB</small>
		{#if phase === 'lost'}
			<h1>Nothing to confirm here</h1>
			<p>This page opens from maiaCITY Studio, the Mac app, when it asks for your passkey.</p>
		{:else}
			<h1>Confirm with your passkey</h1>
			<p>The app asks for your passkey {purpose}. It stays in your passkey prompt; what the app gets back is sealed to it alone.</p>
			<p class="soft">Confirm only if you just asked for this in maiaCITY Studio: whichever app opened this sheet gets the answer.</p>
			{#if phase === 'sending'}
				<p class="soft" role="status">Back to the app…</p>
			{:else if phase === 'failed'}
				<p class="bad" role="alert">{error}</p>
				<div class="row">
					<button class="btn primary" onclick={go}>Try again</button>
					<button class="btn" onclick={() => back({ error: 'You closed the sign-in sheet.' })}>Cancel</button>
				</div>
			{:else}
				<p class="soft" role="status">Waiting for your passkey…</p>
			{/if}
		{/if}
	</div>
</main>

<style>
	.sheet {
		display: grid;
		place-items: center;
		min-height: 100vh;
		min-height: 100dvh;
		padding: 1rem;
		box-sizing: border-box;
		background: #f4f1eb;
		color: #1f2a23;
	}

	.card {
		width: min(28rem, 100%);
		padding: 1.4rem 1.5rem;
		border: 1px solid rgb(0 0 0 / 0.1);
		border-radius: 16px;
		background: #fff;
	}

	small {
		color: #2f6d62;
		font-size: 0.74rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0.4rem 0 0.6rem;
		font-family: var(--font-body);
		font-size: 1.3rem;
		font-weight: 600;
		font-variation-settings: normal;
		letter-spacing: 0;
		line-height: 1.25;
	}

	p {
		line-height: 1.5;
	}

	.soft {
		color: rgb(0 0 0 / 0.55);
	}

	.bad {
		color: #b5523a;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.8rem;
	}

	.btn {
		padding: 0.45rem 0.95rem;
		border: 1px solid rgb(0 0 0 / 0.14);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.86rem;
		font-weight: 500;
		color: inherit;
		cursor: pointer;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.btn.primary {
		border-color: #2f6d62;
		background: #2f6d62;
		color: #fff;
	}
</style>
