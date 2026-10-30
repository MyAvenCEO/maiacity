<script>
	// avenOS's Control Room: every peer the vault you act as governs, side by side, and nothing else, each with its
	// live status and the record it keeps through its store, and below them the box's one timeline of their events.
	// The Peer-Lights run avenOS in frames on their own origins. Everything here is pushed: the timeline arrives as
	// server-sent events (README, rule 8).
	import Phase from '../Phase.svelte';
	import { tree, vaultName } from '../id.js';
	import { follow, live, record } from '../peers.svelte.js';
	import { read } from './timeline.js';

	let { cast, account, device } = $props();

	follow();

	const port = location.port ? `:${location.port}` : '';
	const peers = $derived(tree.sees(account));
	const kind = (peer) => (peer.kind === 'peer-light' ? 'Peer-Light' : peer.relay ? 'Peer + relay' : 'Peer');
	const above = (id) => tree.chain(id).map((vault) => vaultName(vault)).join(' → ');
	// the Aven Peer counts who is connected: a peer it doesn't count isn't live, whatever its last line said
	const phase = (id) => {
		const said = live.status[id]?.phase;
		const present = live.status['aven-peer']?.present;
		return said === 'live' && !cast.peers[id].relay && present && !present.includes(id) ? 'offline' : said;
	};
	const liveCount = $derived(peers.filter((id) => phase(id) === 'live').length);
	const relays = $derived(Object.values(live.paths).filter((path) => path === 'relay').length);
	const lines = $derived(live.timeline.filter((line) => peers.includes(line.peer)).slice(-14));

	// what follows a peer's phase: the Aven Peer counts who is connected, a Peer says its path, a Peer-Light its peers
	function says(id) {
		const status = live.status[id];
		if (!status) return 'not heard from yet';
		if (phase(id) !== 'live') return phase(id);
		if (cast.peers[id].relay) return `live · ${status.peers} connected`;
		if (cast.peers[id].kind === 'peer') return `live · ${status.path === 'direct' ? 'direct to' : 'through the relay to'} Aven Peer`;
		return `live · ${status.peers} peers`;
	}
</script>

<div data-view="control-room" data-account={account}>
	<p class="lead">
		<span>{vaultName(account)} governs {[`no peers yet`, 'one peer'][peers.length] ?? `${peers.length} peers`}</span>
		<span data-testid="live-count">{liveCount} live</span>
	</p>

	<section>
		{#each peers as id (id)}
			{@const peer = cast.peers[id]}
			<article data-peer={id}>
				<h2>{peer.name} <small>{kind(peer)}</small></h2>
				<p class="meta">
					acts for {vaultName(tree.actsFor(id))}{tree.chain(id).length > 1 ? ` (${above(id)})` : ''} · key
					<code>{tree.key(id).slice(0, 8)}…</code> · stores in {peer.store}{peer.relay ? ` · relays ${relays}` : ''}
				</p>
				<p class="meta" data-testid="record" data-first={live.stored[id]?.first}>{record(live.stored[id])}</p>
				<p class="status"><Phase phase={phase(id)} text={says(id)} testid="peer-status" /></p>
				{#if id === device}
					<p class="pending">this device</p>
				{:else if peer.origin}
					<iframe title={peer.name} src={`${location.protocol}//${peer.origin}${port}/`}></iframe>
				{/if}
			</article>
		{/each}
	</section>

	<footer data-testid="timeline">
		<h3>timeline</h3>
		{#each lines as line, i (`${line.t}-${line.peer}-${i}`)}
			{@const shown = read(cast, line)}
			<p data-event={line.event}><time>{shown.time}</time> <span>{shown.between}</span> <span>{shown.said}</span></p>
		{:else}
			<p>no events yet</p>
		{/each}
	</footer>
</div>

<style>
	.lead {
		display: flex;
		justify-content: space-between;
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
		grid-template-rows: auto auto auto 1fr;
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

	.meta,
	.status {
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

	h3 {
		margin: 0 0 6px;
		font-size: 13px;
		font-weight: 600;
	}

	footer p {
		display: grid;
		grid-template-columns: 7.5em minmax(10em, max-content) 1fr;
		gap: 12px;
		margin: 0;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		line-height: 1.6;
	}
</style>
