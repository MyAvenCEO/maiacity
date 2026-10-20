<!--
	Postgres: the admins' window into the city's Postgres, read only (api/src/tables.ts). Every table of it with how many
	rows it holds, and a page of one table's rows at a time; a row opens whole below. A column that keeps a secret or a
	credential is never sent, only that it is there. The page opens for Maia City's Admin cap group ($lib/app/places),
	the rows for `db:read`, which only a person signed in with their passkey holds: The OS's key reaches the media
	vault alone (api/src/keys.ts KEY_CAPS), so inside The OS the page says where it opens instead.
-->
<script>
	import { onMount } from 'svelte';
	import { apiCall } from '$lib/auth/client';
	import { native } from '$lib/native';

	const PAGE = 50;
	const SITE = 'https://maia.city/app/postgres/';
	/** inside The OS: known once the page runs in it, as the prerendered shell can't tell */
	let inApp = $state(false);

	/** @typedef {{ name: string, type: string, hidden: boolean }} Column */
	let tables = $state(/** @type {{ name: string, rows: number, columns: Column[] }[]} */ ([]));
	let loaded = $state(false);
	let error = $state('');
	let chosen = $state('');
	let data = $state(/** @type {{ name: string, columns: Column[], total: number, offset: number, limit: number, rows: Record<string, any>[] } | null} */ (null));
	let busy = $state(false);
	/** the row opened whole, by its place on the page */
	let open = $state(-1);

	onMount(async () => {
		inApp = native();
		if (inApp) return void (loaded = true);
		try {
			tables = await apiCall('/api/tables');
			const asked = new URLSearchParams(location.search).get('table');
			const first = tables.find((t) => t.name === asked) ?? tables[0];
			if (first) await show(first.name, 0);
		} catch (e) {
			error = /** @type {Error} */ (e).message;
		}
		loaded = true;
	});

	/** @param {string} name @param {number} offset */
	async function show(name, offset) {
		chosen = name;
		open = -1;
		busy = true;
		error = '';
		try {
			data = await apiCall(`/api/tables/${encodeURIComponent(name)}?offset=${offset}&limit=${PAGE}`);
			const url = new URL(location.href);
			url.searchParams.set('table', name);
			history.replaceState(history.state, '', url);
		} catch (e) {
			error = /** @type {Error} */ (e).message;
		}
		busy = false;
	}

	/** A cell, short, as the grid shows it. @param {any} v */
	function short(v) {
		if (v === null || v === undefined) return '—';
		if (v?.hidden) return 'hidden';
		const text = v?.cut !== undefined ? v.cut : typeof v === 'string' ? v : JSON.stringify(v);
		return text.length > 80 ? `${text.slice(0, 80)}…` : text;
	}

	/** A cell, whole, as the opened row shows it. @param {any} v */
	function whole(v) {
		if (v === null || v === undefined) return '—';
		if (v?.hidden) return 'hidden: it keeps a secret or a credential';
		if (v?.cut !== undefined) return `${v.cut}\n… cut at ${v.cut.length.toLocaleString('en-US')} of ${v.length.toLocaleString('en-US')} characters`;
		return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
	}

	const pages = $derived(data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1);
	const at = $derived(data ? Math.floor(data.offset / data.limit) + 1 : 1);
</script>

<svelte:head>
	<title>Postgres · maiaCITY</title>
</svelte:head>

<main class="app-page">
	<header>
		<p class="eyebrow">Admin</p>
		<h1>Postgres</h1>
		<p class="dim">Every table of the city’s Postgres and its rows, read only. Columns that keep a secret or a credential say only that they are there.</p>
	</header>

	{#if inApp}
		<p class="note">The tables open in your browser, signed in with your passkey: The OS’s own key reaches the media library alone. Open <a href={SITE}>{SITE}</a>.</p>
	{:else if !loaded}
		<p class="dim">One moment…</p>
	{:else if !tables.length}
		<p class="note">{error || 'No tables yet.'}</p>
	{:else}
		<div class="cols">
			<nav>
				<label class="pick">
					<span class="eyebrow">Table</span>
					<select value={chosen} onchange={(e) => show(e.currentTarget.value, 0)}>
						{#each tables as t (t.name)}<option value={t.name}>{t.name} ({t.rows.toLocaleString('en-US')})</option>{/each}
					</select>
				</label>
				<ul class="list">
					{#each tables as t (t.name)}
						<li>
							<button class:on={chosen === t.name} onclick={() => show(t.name, 0)}>
								<span class="mono">{t.name}</span><small>{t.rows.toLocaleString('en-US')}</small>
							</button>
						</li>
					{/each}
				</ul>
			</nav>

			<section class="detail">
				{#if data}
					<div class="bar">
						<h2 class="mono">{data.name}</h2>
						<span class="dim small">{data.total.toLocaleString('en-US')} {data.total === 1 ? 'row' : 'rows'} · {data.columns.length} columns</span>
					</div>
					{#if error}<p class="bad small">{error}</p>{/if}
					{#if data.rows.length}
						<div class="grid" class:busy>
							<table>
								<thead>
									<tr>
										{#each data.columns as c (c.name)}<th title={c.type}>{c.name}{#if c.hidden}<small> · hidden</small>{/if}</th>{/each}
									</tr>
								</thead>
								<tbody>
									{#each data.rows as r, i (i)}
										<tr class:open={open === i} onclick={() => (open = open === i ? -1 : i)}>
											{#each data.columns as c (c.name)}<td class:soft={r[c.name] == null || r[c.name]?.hidden}>{short(r[c.name])}</td>{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						{#if open >= 0 && data.rows[open]}
							<dl class="whole">
								{#each data.columns as c (c.name)}
									<dt>{c.name} <small>{c.type}</small></dt>
									<dd><pre>{whole(data.rows[open][c.name])}</pre></dd>
								{/each}
							</dl>
						{:else}
							<p class="dim small">Tap a row to see it whole.</p>
						{/if}
						{#if pages > 1}
							<div class="pager">
								<button class="btn" disabled={busy || at <= 1} onclick={() => data && show(data.name, data.offset - data.limit)}>Back</button>
								<span class="dim small">Page {at} of {pages}</span>
								<button class="btn" disabled={busy || at >= pages} onclick={() => data && show(data.name, data.offset + data.limit)}>Next</button>
							</div>
						{/if}
					{:else}
						<p class="note">This table is empty.</p>
					{/if}
				{:else if error}
					<p class="bad small">{error}</p>
				{/if}
			</section>
		</div>
	{/if}
</main>

<style>
	.app-page {
		max-width: 76rem;
		margin: 0 auto;
		padding: 1.6rem clamp(1rem, 4vw, 2rem) 6rem;
	}
	.dim {
		color: var(--muted);
	}
	.small {
		font-size: 0.85rem;
	}
	.bad {
		color: var(--terracotta);
	}
	a {
		color: var(--ink);
		text-decoration-color: var(--mustard);
		text-underline-offset: 3px;
		overflow-wrap: anywhere;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		margin: 0.2rem 0 0.4rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 2.8rem);
	}
	h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	.note {
		padding: 1rem 1.2rem;
		border: 1px dashed var(--line);
		border-radius: 14px;
		color: var(--muted);
	}
	.cols {
		display: grid;
		grid-template-columns: 14rem minmax(0, 1fr);
		gap: 1.5rem;
		margin-top: 1.4rem;
	}
	.pick {
		display: none;
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.list button {
		display: flex;
		width: 100%;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid transparent;
		border-radius: 10px;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 0.86rem;
		text-align: left;
		cursor: pointer;
	}
	.list button:hover {
		border-color: var(--line);
	}
	.list button.on {
		background: var(--ink);
		color: var(--paper);
	}
	.list small {
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.detail {
		min-width: 0;
		padding: 1.2rem 1.3rem;
		border: 1px solid var(--line);
		border-radius: 20px;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem 0.9rem;
		margin-bottom: 0.8rem;
	}
	.grid {
		overflow: auto;
		max-height: 60vh;
		border: 1px solid var(--line);
		border-radius: 12px;
	}
	.grid.busy {
		opacity: 0.55;
	}
	table {
		border-collapse: collapse;
		font-size: 0.8rem;
		width: max-content;
		min-width: 100%;
	}
	th,
	td {
		padding: 0.4rem 0.65rem;
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: top;
		white-space: nowrap;
		max-width: 22rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	th {
		position: sticky;
		top: 0;
		background: var(--paper);
		font-weight: 600;
		z-index: 1;
	}
	th small {
		font-weight: 400;
		color: var(--muted);
	}
	td.soft {
		color: var(--muted);
	}
	tbody tr {
		cursor: pointer;
	}
	tbody tr:hover,
	tbody tr.open {
		background: rgb(0 0 0 / 0.04);
	}
	.whole {
		margin: 1rem 0 0;
		display: grid;
		grid-template-columns: minmax(8rem, max-content) minmax(0, 1fr);
		gap: 0.35rem 1rem;
		font-size: 0.82rem;
	}
	.whole dt {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.whole dt small {
		display: block;
		font-weight: 400;
		color: var(--muted);
	}
	.whole dd {
		margin: 0;
		min-width: 0;
	}
	.whole pre {
		margin: 0;
		max-height: 24rem;
		overflow: auto;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.78rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		margin-top: 1rem;
	}
	.btn {
		padding: 0.38rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	@media (max-width: 720px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
		}
		.list {
			display: none;
		}
		.pick {
			display: flex;
			flex-direction: column;
			gap: 0.3rem;
		}
		.pick select {
			padding: 0.5rem 0.6rem;
			border: 1px solid var(--line);
			border-radius: 10px;
			background: none;
			color: var(--ink);
			font: inherit;
		}
		.detail {
			padding: 1rem;
		}
		.whole {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
