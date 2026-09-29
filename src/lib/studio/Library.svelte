<!--
	Library — everything this Mac's vault holds, by its BLAKE3 hash, played straight from the local store
	(vault://localhost/<hash>, with Range). Filter by kind; a click opens the file.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { command } from '$lib/native';
	import CopiesBadge from './CopiesBadge.svelte';
	import Devices from './Devices.svelte';
	import { gb, vaultUrl, type Copies, type VaultFile, type VaultStatus } from './vault';

	let files = $state<VaultFile[]>([]);
	let status = $state<VaultStatus | null>(null);
	let kind = $state('all');
	let q = $state('');
	let open = $state<VaultFile | null>(null);
	let error = $state('');
	let copies = $state<Record<string, Copies>>({});
	let showDevices = $state(false);

	async function loadCopies() {
		try {
			copies = Object.fromEntries((await command<Copies[]>('vault_copies')).map((c) => [c.hash, c]));
		} catch {
			/* the API may be away: the cards still show what is here */
		}
	}

	const shown = $derived(
		files.filter(
			(m) =>
				(kind === 'all' || m.kind === kind) &&
				(!q || [m.title, m.original_name, m.hash, ...(m.tags ?? [])].some((t) => t?.toLowerCase().includes(q.toLowerCase())))
		)
	);

	async function load() {
		try {
			[files, status] = await Promise.all([command<VaultFile[]>('vault_list'), command<VaultStatus>('vault_status')]);
		} catch (e) {
			error = String(e);
		}
		await loadCopies();
	}

	onMount(() => {
		load();
		// the copies change while files sync: look again every 10 s while this tab is open
		const timer = setInterval(loadCopies, 10000);
		return () => clearInterval(timer);
	});
</script>

<section class="library" aria-label="Library">
	<div class="head">
		<div class="filters">
			{#each ['all', 'video', 'image', 'audio', 'other'] as k (k)}
				<button class:on={kind === k} onclick={() => (kind = k)}>{k}</button>
			{/each}
		</div>
		<input bind:value={q} placeholder="Search names, tags, hashes" />
		{#if status}
			<span class="meta">{status.files} files · {gb(status.bytes)} · {gb(status.disk_free)} free on this Mac · node {status.endpoint.slice(0, 10)}…</span>
		{/if}
		<button class="dev" class:on={showDevices} onclick={() => (showDevices = !showDevices)}>Devices & storage</button>
	</div>
	{#if showDevices}<div class="panel"><Devices /></div>{/if}
	{#if error}<p class="err">{error}</p>{/if}
	<div class="grid">
		{#each shown as m (m.hash)}
			<button class="card" onclick={() => (open = m)}>
				{#if m.kind === 'image'}
					<img src={vaultUrl(m.hash)} alt={m.original_name} loading="lazy" />
				{:else if m.kind === 'video'}
					<video src={vaultUrl(m.hash)} preload="metadata" muted></video>
				{:else}
					<div class="blank">{m.kind}</div>
				{/if}
				<span class="n">{m.title || m.original_name}</span>
				<small>{gb(m.size)} · {m.hash.slice(0, 10)}…{#if m.tags?.length} · {m.tags.join(', ')}{/if}</small>
				{#if copies[m.hash]}<CopiesBadge c={copies[m.hash]} />{/if}
			</button>
		{:else}
			<p class="quiet">Nothing here yet — ingest a card, a drive or a folder.</p>
		{/each}
	</div>
</section>

{#if open}
	<div class="viewer" role="presentation" onclick={() => (open = null)}>
		<div class="frame" role="presentation" onclick={(e) => e.stopPropagation()}>
			{#if open.kind === 'video'}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={vaultUrl(open.hash)} controls autoplay></video>
			{:else if open.kind === 'image'}
				<img src={vaultUrl(open.hash)} alt={open.original_name} />
			{:else if open.kind === 'audio'}
				<audio src={vaultUrl(open.hash)} controls autoplay></audio>
			{/if}
			<p><strong>{open.title || open.original_name}</strong> · {gb(open.size)} · {open.mime}</p>
			<code>{open.hash}</code>
			{#if copies[open.hash]}<CopiesBadge c={copies[open.hash]} wide />{/if}
		</div>
	</div>
{/if}

<style>
	.library { grid-area: main; overflow: auto; padding: 1rem 1.2rem; background: var(--panel); }
	.head { display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: center; margin-bottom: 1rem; }
	.filters { display: flex; gap: 0.3rem; }
	.filters button { padding: 0.28rem 0.8rem; border: 1px solid var(--edge); border-radius: 999px; background: #fff; font: inherit; color: var(--dim); cursor: pointer; }
	.filters button.on { border-color: var(--ink); background: var(--ink); color: #fff; }
	input { min-width: 16rem; padding: 0.35rem 0.6rem; border: 1px solid var(--edge); border-radius: 999px; background: #fff; font: inherit; }
	.meta { margin-left: auto; font-size: 0.75rem; color: var(--dim); }
	.dev { padding: 0.28rem 0.8rem; border: 1px solid var(--edge); border-radius: 999px; background: #fff; font: inherit; font-size: 0.78rem; color: var(--ink); cursor: pointer; }
	.dev.on { border-color: var(--ink); }
	.panel { margin-bottom: 1rem; border: 1px solid var(--edge); border-radius: 12px; background: var(--bg); }
	.err { color: #9c3b26; }
	.quiet { color: var(--dim); }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 0.8rem; }
	.card { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.5rem; border: 1px solid var(--edge); border-radius: 10px; background: #fff; font: inherit; text-align: left; color: var(--ink); cursor: pointer; }
	.card img, .card video, .card .blank { display: grid; place-items: center; width: 100%; aspect-ratio: 16 / 10; border-radius: 6px; background: var(--bg); object-fit: cover; color: var(--dim); }
	.card .n { overflow: hidden; font-size: 0.8rem; white-space: nowrap; text-overflow: ellipsis; }
	.card small { font-size: 0.68rem; color: var(--dim); }
	.viewer { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; background: rgba(20, 26, 22, 0.85); }
	.frame { display: flex; flex-direction: column; gap: 0.5rem; max-width: 90vw; color: #f6f3ec; }
	.frame video, .frame img { max-width: 90vw; max-height: 78vh; border-radius: 6px; background: #000; }
	.frame code { font-size: 0.75rem; color: #a8b88a; }
</style>
