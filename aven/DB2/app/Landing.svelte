<script>
	// The landing page on a Peer-Light's origin. Until the Peer-Light itself (crates/web) runs here, the page shows what
	// the box already gives it: its place in the cast, its vault and signer, and its own OPFS, which keeps a mark
	// across reloads.
	let { id, peer, cast } = $props();

	const vault = Object.values(cast.vaults).find((v) => v.owners.includes(id));
	let mark = $state('');
	let storage = $state('reading OPFS');

	async function keepMark() {
		try {
			const root = await navigator.storage.getDirectory();
			const handle = await root.getFileHandle('mark', { create: true });
			let text = await (await handle.getFile()).text();
			if (!text) {
				text = crypto.randomUUID().slice(0, 8);
				const writable = await handle.createWritable();
				await writable.write(text);
				await writable.close();
			}
			mark = text;
			storage = 'OPFS';
		} catch (error) {
			storage = `no OPFS (${error.name})`;
		}
	}

	keepMark();
</script>

<main>
	<h1>avenDB2</h1>
	<p class="soon">coming soon</p>

	<p class="status"><span class="dot"></span> page live · the Peer-Light comes next</p>

	<dl>
		<dt>you</dt>
		<dd data-testid="who">{peer.name}</dd>
		<dt>vault</dt>
		<dd data-testid="vault">{vault?.name ?? 'none'}</dd>
		<dt>signer</dt>
		<dd><code>{peer.signer.slice(0, 8)}…</code></dd>
		<dt>stores in</dt>
		<dd data-testid="mark">{storage}{mark ? ` · mark ${mark}` : ''}</dd>
	</dl>
</main>

<style>
	main {
		min-height: 100vh;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 6px;
		padding: 24px 16px;
		text-align: center;
	}

	h1 {
		margin: 0;
		font-size: 44px;
		letter-spacing: -0.02em;
	}

	.soon {
		margin: 0 0 18px;
		color: var(--muted);
		font-size: 18px;
	}

	.status {
		margin: 0 0 14px;
		font-size: 14px;
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--pending);
		vertical-align: 1px;
	}

	dl {
		display: grid;
		grid-template-columns: auto auto;
		gap: 2px 14px;
		margin: 0;
		font-size: 14px;
		text-align: left;
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
	}
</style>
