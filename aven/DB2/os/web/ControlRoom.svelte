<script>
	// The control room: every peer of the cast side by side. The Peer-Lights run in frames on their own origins; the
	// Peers' panes fill in once peer/native runs them.
	let { cast } = $props();

	const port = location.port ? `:${location.port}` : '';
	const peers = $derived(Object.entries(cast.peers));
	const vaultOf = (id) => Object.values(cast.vaults).find((v) => v.owners.includes(id))?.name ?? 'no vault';
	const kind = (peer) => (peer.kind === 'peer-light' ? 'Peer-Light' : peer.relay ? 'Peer + relay' : 'Peer');
</script>

<header>
	<h1>avenSANDBOX</h1>
	<span>{peers.length} peers in the cast</span>
</header>

<section>
	{#each peers as [id, peer] (id)}
		<article>
			<h2>{peer.name} <small>{kind(peer)}</small></h2>
			<p class="meta">{vaultOf(id)} · signer <code>{peer.signer.slice(0, 8)}…</code> · stores in {peer.store}</p>
			{#if peer.origin}
				<iframe title={peer.name} src={`${location.protocol}//${peer.origin}${port}/`}></iframe>
			{:else}
				<p class="pending">not running yet: it comes with peer/native</p>
			{/if}
		</article>
	{/each}
</section>

<footer>timeline · the peers' events appear here once they run</footer>

<style>
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
	}

	h1 {
		margin: 0;
		font-size: 18px;
	}

	header span,
	footer,
	.meta,
	small {
		color: var(--muted);
		font-size: 13px;
	}

	section {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
		gap: 12px;
		padding: 12px 16px;
	}

	article {
		display: grid;
		grid-template-rows: auto auto 1fr;
		min-height: 300px;
		padding: 12px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	h2 {
		margin: 0;
		font-size: 15px;
	}

	.meta {
		margin: 2px 0 10px;
	}

	iframe {
		width: 100%;
		height: 100%;
		min-height: 340px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--bg);
	}

	.pending {
		align-self: center;
		justify-self: center;
		color: var(--pending);
		font-size: 14px;
	}

	footer {
		padding: 10px 16px 16px;
		border-top: 1px solid var(--line);
	}
</style>
