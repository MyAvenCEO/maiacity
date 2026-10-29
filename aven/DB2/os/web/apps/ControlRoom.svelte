<script>
	// avenOS's Control Room: every peer the vault you act as governs, side by side, and nothing else. The Peer-Lights run
	// avenOS in frames on their own origins; the Peers' panes fill in once peer/native runs them.
	import { actsFor, chain, key, peersOf, vaultName } from '../cast.js';

	let { cast, account, device } = $props();

	const port = location.port ? `:${location.port}` : '';
	const peers = $derived(peersOf(cast, account));
	const kind = (peer) => (peer.kind === 'peer-light' ? 'Peer-Light' : peer.relay ? 'Peer + relay' : 'Peer');
	const above = (id) => chain(cast, id).map((vault) => vaultName(cast, vault)).join(' → ');
</script>

<div data-view="control-room" data-account={account}>
	<p class="lead">
		{vaultName(cast, account)} governs {[`no peers yet`, 'one peer'][peers.length] ?? `${peers.length} peers`}
	</p>

	<section>
		{#each peers as id (id)}
			{@const peer = cast.peers[id]}
			<article data-peer={id}>
				<h2>{peer.name} <small>{kind(peer)}</small></h2>
				<p class="meta">
					acts for {vaultName(cast, actsFor(cast, id))}{chain(cast, id).length > 1 ? ` (${above(id)})` : ''} · key
					<code>{key(cast, id).slice(0, 8)}…</code> · stores in {peer.store}
				</p>
				{#if id === device}
					<p class="pending">this device</p>
				{:else if peer.origin}
					<iframe title={peer.name} src={`${location.protocol}//${peer.origin}${port}/`}></iframe>
				{:else}
					<p class="pending">not running yet: it comes with peer/native</p>
				{/if}
			</article>
		{/each}
	</section>

	<footer>timeline · the peers' events appear here once they run</footer>
</div>

<style>
	.lead {
		margin: 0;
		padding: 14px 16px 0;
		color: var(--muted);
		font-size: 14px;
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

	small,
	.meta,
	footer {
		color: var(--muted);
		font-size: 13px;
	}

	.meta {
		margin: 2px 0 10px;
	}

	iframe {
		width: 100%;
		height: 100%;
		min-height: 500px;
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
