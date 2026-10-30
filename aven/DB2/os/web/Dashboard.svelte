<script>
	// avenOS's dashboard: the vault you act as, a grid of its apps and, on a Peer-Light's origin, this device: the vault
	// it serves, its key, its own OPFS, which keeps a mark across reloads, the record its Peer-Light keeps through the
	// store, and the Peer-Light's status line, its phase and "N peers" from presence, pushed by its worker.
	import Avatar from './Avatar.svelte';
	import Phase from './Phase.svelte';
	import { tree, vaultName } from './id.svelte.js';
	import { describe, live, record } from './peers.svelte.js';

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
</script>

<main data-view="dashboard" data-account={account}>
	{#if account}
		<section class="account">
			<Avatar id={account} size={40} />
			<div>
				<h1>{vaultName(account)}</h1>
				<small>
					{tree.kind(account)} · governs {count(tree.governs(account).length, 'vault')} ·
					{count(tree.sees(account).length, 'peer')}
				</small>
			</div>
		</section>
	{:else}
		<p class="soon">avenOS is coming soon.</p>
	{/if}

	<section class="apps" aria-label="Apps">
		{#each apps as app (app.id)}
			<a class="app" class:off={!account} href={account ? `#/${account}/${app.id}` : undefined}>
				<span class="glyph" aria-hidden="true">
					<svg viewBox="0 0 24 24" width="22" height="22"
						><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect
							x="3"
							y="13"
							width="8"
							height="8"
							rx="2"
						/><rect x="13" y="13" width="8" height="8" rx="2" /></svg
					>
				</span>
				<strong>{app.name}</strong>
				<small>{account ? app.what : 'needs a vault: runs in avenSANDBOX for now'}</small>
			</a>
		{/each}
	</section>

	{#if device}
		<section class="device" aria-label="This device">
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
			<p class="status"><Phase phase={live.own?.phase} text={describe(live.own)} testid="status" /></p>
		</section>
	{/if}
</main>

<style>
	main {
		display: grid;
		gap: 20px;
		padding: 20px 16px;
	}

	.soon {
		margin: 0;
		color: var(--muted);
	}

	.account {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	h1 {
		margin: 0;
		font-size: 20px;
		line-height: 1.2;
	}

	.apps {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 12px;
	}

	.app {
		display: grid;
		gap: 4px;
		padding: 14px;
		color: var(--text);
		text-decoration: none;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
	}

	.app:hover:not(.off) {
		border-color: var(--muted);
	}

	.app.off {
		opacity: 0.55;
		cursor: default;
	}

	.glyph svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
	}

	small,
	dt,
	.status {
		color: var(--muted);
		font-size: 13px;
	}

	.device {
		padding: 14px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
	}

	h2 {
		margin: 0 0 8px;
		font-size: 15px;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 2px 14px;
		margin: 0;
		font-size: 14px;
	}

	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.status {
		margin: 10px 0 0;
	}
</style>
