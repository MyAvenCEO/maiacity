<script>
	// avenOS's dashboard: a greeting, the vault you act as in the network's card (on a device, its status and who is
	// in the room), a row of its apps and, on a Peer-Light's origin, this device: the vault
	// it serves, its key, its own OPFS, which keeps a mark across reloads, the record its Peer-Light keeps through the
	// store, and the Peer-Light's status line, its phase and "N peers" from presence, pushed by its worker.
	import Avatar from './Avatar.svelte';
	import Phase from './Phase.svelte';
	import { tree, vaultName } from './id.svelte.js';
	import { describe, live, record } from './peers.svelte.js';
	import { room } from './room.svelte.js';

	let { cast, device, account, apps } = $props();

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

	$effect(() => {
		if (device) keepMark();
	});

	const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

	// the greeting: the hour's, and the person by their own name ("Alice's vault" is Alice)
	const hour = new Date().getHours();
	const hello = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
	const firstName = (id) => vaultName(id).replace(/'s vault$/i, '');
	const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
	// who is in the network's room right now, by the vault each device acts for
	const present = $derived([...new Set(room.present.map((id) => (tree.kind(id) ? (tree.actsFor(id) ?? id) : id)))]);
	const peers = $derived(account ? tree.sees(account).length : 0);
</script>

<main data-view="dashboard" data-account={account}>
	{#if account}
		<section class="hello">
			<span class="chip">{today}</span>
			<p class="greeting">{hello}, {firstName(account)}</p>
			<small>
				{tree.kind(account)} · governs {count(tree.governs(account).length, 'vault')} ·
				{count(peers, 'peer')}
			</small>
		</section>

		<section class="hero account" aria-label="Your network">
			<div class="who">
				<Avatar id={account} size={44} />
				<div>
					<span class="eyebrow">your vault</span>
					<h1>{vaultName(account)}</h1>
				</div>
			</div>
			{#if device}
				<p class="status"><Phase phase={live.own?.phase} text={describe(live.own)} testid="status" /></p>
				<div class="members">
					<span class="faces" aria-hidden="true">
						{#each present.slice(0, 5) as id (id)}{#if tree.kind(id)}<Avatar {id} size={28} />{/if}{/each}
					</span>
					<span>{present.length ? `${count(present.length, 'member')} here now` : 'Nobody else here yet'}</span>
				</div>
			{:else}
				<p class="status">{count(peers, 'peer')} in the tree it governs</p>
			{/if}
		</section>
	{:else}
		<section class="hello">
			<p class="greeting">{hello}</p>
			<p class="soon">avenOS is coming soon.</p>
		</section>
	{/if}

	<section class="apps" aria-label="Apps">
		{#each apps as app (app.id)}
			<a class="app" class:off={!account} href={account ? `#/${account}/${app.id}` : undefined}>
				<span class="glyph" aria-hidden="true">
					<svg class="icon" viewBox="0 0 24 24" width="22" height="22">
						{#if app.id === 'vault'}
							<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6Z" /><path d="m9 12 2 2 4-4" />
						{:else if app.id === 'control-room'}
							<rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M8 21h8M12 17v4" /><path d="m7 12 2.5-3 2.5 2.5L15 8l2 2" />
						{:else if app.id === 'chat'}
							<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z" />
						{:else if app.id === 'invite'}
							<circle cx="10" cy="8" r="3.5" /><path d="M3.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" />
						{:else}
							<rect x="4" y="4" width="16" height="16" rx="4" />
						{/if}
					</svg>
				</span>
				<strong>{app.name}</strong>
				<small>{account ? app.what : 'needs a vault: runs in avenSANDBOX for now'}</small>
			</a>
		{/each}
	</section>

	{#if device}
		<section class="device card" aria-label="This device">
			<h2>This device</h2>
			<dl>
				<dt>device</dt>
				<dd data-testid="device">{cast.peers[device].name}</dd>
				<dt>serves</dt>
				<dd data-testid="serves">{vaultName(tree.actsFor(device))}</dd>
				<dt>key</dt>
				<dd><code>{tree.key(device).slice(0, 8)}…</code></dd>
				<dt>stores in</dt>
				<dd data-testid="mark">{storage}{mark ? ` · mark ${mark}` : ''}</dd>
				<dt>its record</dt>
				<dd data-testid="record" data-first={live.ownStored?.first}>{record(live.ownStored)}, through the store</dd>
			</dl>
		</section>
	{/if}
</main>

<style>
	main {
		display: grid;
		gap: 24px;
		max-width: 880px;
		margin: 0 auto;
		padding: 28px 16px 48px;
	}

	.hello {
		display: grid;
		gap: 6px;
	}

	.greeting {
		margin: 6px 0 0;
		font-family: var(--font-display);
		font-size: clamp(30px, 7vw, 44px);
		font-weight: 400;
		line-height: 1.1;
		letter-spacing: -0.02em;
	}

	.soon {
		margin: 0;
		color: var(--muted);
	}

	.hero {
		display: grid;
		gap: 16px;
		padding: 24px;
		color: var(--on-accent);
		background: var(--accent);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-lift);
	}

	.who {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.eyebrow {
		color: var(--on-accent-muted);
		font-size: 12px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-size: 26px;
		line-height: 1.2;
	}

	.hero .status {
		margin: 0;
		padding-top: 16px;
		color: var(--on-accent-muted);
		font-size: 14px;
		border-top: 1px solid var(--on-accent-line);
	}

	.hero :global(.phase) {
		color: var(--on-accent);
		font-size: 14px;
	}

	.members {
		display: flex;
		align-items: center;
		gap: 12px;
		color: var(--on-accent-muted);
		font-size: 13px;
	}

	.faces {
		display: flex;
	}

	.faces :global(.avatar) {
		margin-right: -8px;
		box-shadow: 0 0 0 2px var(--accent);
	}

	.apps {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 12px;
	}

	.app {
		display: grid;
		align-content: start;
		gap: 4px;
		padding: 18px;
		color: var(--text);
		text-decoration: none;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-tile);
		box-shadow: var(--shadow-soft);
		transition:
			box-shadow 0.2s,
			transform 0.2s;
	}

	.app:hover:not(.off) {
		box-shadow: var(--shadow-lift);
		transform: translateY(-1px);
	}

	.app.off {
		opacity: 0.55;
		cursor: default;
	}

	.glyph {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		margin-bottom: 10px;
		color: var(--accent);
		background: var(--sage);
		border-radius: var(--radius-inner);
	}

	.app strong {
		font-weight: 600;
	}

	small,
	dt {
		color: var(--muted);
		font-size: 13px;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 20px;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 8px 16px;
		margin: 0;
		font-size: 14px;
	}

	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
</style>
