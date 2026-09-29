<!--
	maiaCITY Studio's vault — this page lives in the Mac app only (Tauri). Every admin and studio function that
	touches media runs natively there; in a browser this page only says so.

	Ingest: pick a card, a drive or a folder (or drop files), tag the batch, and every file is copied with three
	hashes that must agree — read off the source, read back from the disk, and iroh's own. Library: everything the
	vault holds, played straight from this Mac's store through vault://localhost/<hash>.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	type Meta = {
		hash: string; size: number; mime: string; kind: string; title?: string; tags?: string[];
		original_name?: string; source?: string; ingest?: string; added?: string;
	};
	type Status = { endpoint: string; catalog: string; dir: string; files: number; bytes: number; disk_free: number; disk_total: number };
	type Source = { name: string; path: string; free: number; total: number };
	type Outcome = { source: string; size: number; hash: string; source_hash: string; disk_hash: string; iroh_hash: string; verdict: 'verified' | 'duplicate' | 'mismatch'; seconds: number };
	type Progress = { index: number; total: number; path: string; size: number; outcome: Outcome | null };
	type Summary = { session: string; files: number; bytes: number; seconds: number; verified: number; duplicates: number; mismatches: number; report: string };

	let native = $state<boolean | null>(null);
	let tab = $state<'ingest' | 'library'>('ingest');
	let status = $state<Status | null>(null);
	let sources = $state<Source[]>([]);
	let picked = $state<string[]>([]);
	let scan = $state<{ files: number; bytes: number; kinds: Record<string, number> } | null>(null);
	let tags = $state('');
	let running = $state(false);
	let rows = $state<Progress[]>([]);
	let current = $state<Progress | null>(null);
	let summary = $state<Summary | null>(null);
	let error = $state('');
	let library = $state<Meta[]>([]);
	let kind = $state('all');
	let open = $state<Meta | null>(null);
	let dragging = $state(false);

	let invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
	const unlisten: Array<() => void> = [];

	const src = (m: Meta) => `vault://localhost/${m.hash}`;
	const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`);
	const name = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
	const shown = $derived(kind === 'all' ? library : library.filter((m) => m.kind === kind));
	const done = $derived(rows.filter((r) => r.outcome));

	async function refresh() {
		status = await invoke('vault_status');
		sources = await invoke('vault_sources');
		library = await invoke('vault_list');
	}

	async function pick(paths: string[]) {
		picked = [...new Set([...picked, ...paths])];
		summary = null;
		scan = await invoke('vault_scan', { paths: picked });
	}

	async function chooseFolder() {
		const { open: dialog } = await import('@tauri-apps/plugin-dialog');
		const chosen = await dialog({ directory: true, multiple: true });
		if (chosen) await pick(Array.isArray(chosen) ? chosen : [chosen]);
	}

	function clear() {
		picked = [];
		scan = null;
		rows = [];
		summary = null;
		error = '';
	}

	async function start() {
		if (!picked.length || running) return;
		running = true;
		rows = [];
		summary = null;
		error = '';
		try {
			summary = await invoke('vault_ingest', { paths: picked, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
			await refresh();
		} catch (e) {
			error = String(e);
		} finally {
			running = false;
			current = null;
		}
	}

	onMount(async () => {
		native = '__TAURI_INTERNALS__' in window;
		if (!native) return;
		const core = await import('@tauri-apps/api/core');
		const { listen } = await import('@tauri-apps/api/event');
		const { getCurrentWebview } = await import('@tauri-apps/api/webview');
		invoke = core.invoke;
		unlisten.push(
			await listen<Progress>('ingest', ({ payload }) => {
				if (!payload.outcome) current = payload;
				else rows = [payload, ...rows];
			})
		);
		unlisten.push(
			await getCurrentWebview().onDragDropEvent((e) => {
				if (e.payload.type === 'enter' || e.payload.type === 'over') dragging = true;
				else if (e.payload.type === 'leave') dragging = false;
				else if (e.payload.type === 'drop') {
					dragging = false;
					tab = 'ingest';
					pick(e.payload.paths);
				}
			})
		);
		await refresh();
	});
	onDestroy(() => unlisten.forEach((u) => u()));
</script>

<svelte:head><title>Vault · maiaCITY Studio</title><meta name="robots" content="noindex" /></svelte:head>

{#if native === false}
	<main class="away">
		<h1>maiaCITY Studio</h1>
		<p>The vault, ingest and every studio function live in the Mac app only.</p>
	</main>
{:else if native}
	<div class="app" class:dragging>
		<header>
			<strong>maia<b>CITY</b> Studio</strong>
			<nav>
				<button class:on={tab === 'ingest'} onclick={() => (tab = 'ingest')}>Ingest</button>
				<button class:on={tab === 'library'} onclick={() => (tab = 'library')}>Library{#if status} · {status.files}{/if}</button>
			</nav>
			{#if status}
				<span class="meta">{gb(status.bytes)} in the vault · {gb(status.disk_free)} free on this Mac · node {status.endpoint.slice(0, 10)}…</span>
			{/if}
		</header>

		{#if tab === 'ingest'}
			<section class="ingest">
				<aside>
					<h2>Sources</h2>
					{#each sources as s}
						<button class="source" onclick={() => pick([s.path])}>
							<span>{s.name}</span><small>{gb(s.total - s.free)} of {gb(s.total)}</small>
						</button>
					{:else}
						<p class="quiet">No card or drive mounted.</p>
					{/each}
					<button class="source ghost" onclick={chooseFolder}>+ Choose folder…</button>
					<div class="drop">⇣ drop files or folders anywhere</div>
					<button class="link" onclick={refresh}>Look again</button>
				</aside>

				<div class="batch">
					<h2>This batch</h2>
					{#if picked.length}
						<ul class="picked">{#each picked as p}<li title={p}>{name(p)}</li>{/each}</ul>
						{#if scan}
							<p class="scan">{scan.files} files · {gb(scan.bytes)} · {Object.entries(scan.kinds).map(([k, n]) => `${n} ${k}`).join(' · ')}</p>
						{/if}
						<label>Tags <input bind:value={tags} placeholder="Day 20, A7IV" disabled={running} /></label>
						<div class="actions">
							<button class="primary" onclick={start} disabled={running || !scan?.files}>
								{running ? 'Ingesting…' : `Ingest ${scan?.files ?? ''} files`}
							</button>
							<button class="link" onclick={clear} disabled={running}>Clear</button>
						</div>
					{:else}
						<p class="quiet">Choose a source, a folder, or drop files here.</p>
					{/if}

					{#if current}
						<div class="now">
							<span>{current.index + 1} / {current.total} · copying and hashing</span>
							<strong>{name(current.path)}</strong> <small>{gb(current.size)}</small>
							<div class="bar"><div style="width: {(current.index / current.total) * 100}%"></div></div>
						</div>
					{/if}
					{#if summary}
						<div class="summary" class:bad={summary.mismatches > 0}>
							<strong>{summary.verified} verified · {summary.duplicates} already in the vault · {summary.mismatches} mismatches</strong>
							<span>{summary.files} files, {gb(summary.bytes)} in {summary.seconds.toFixed(1)} s ({(summary.bytes / 1e6 / Math.max(summary.seconds, 0.001)).toFixed(0)} MB/s)</span>
							<span class="keep">{summary.mismatches ? 'Mismatches — keep the card and ingest again.' : '1 verified copy (this Mac) — keep the card until the server holds it too.'}</span>
							<small>Report {summary.report.slice(0, 16)}…</small>
						</div>
					{/if}
					{#if error}<p class="bad">{error}</p>{/if}
				</div>

				<div class="log">
					<h2>Files{#if rows.length} · {done.length}{/if}</h2>
					<ol>
						{#each rows as r (r.index)}
							{@const o = r.outcome!}
							<li class={o.verdict}>
								<span class="v">{o.verdict === 'verified' ? '✅' : o.verdict === 'duplicate' ? '•' : '❌'}</span>
								<span class="n" title={o.source}>{name(o.source)}</span>
								<span class="h" title={`source ${o.source_hash}\ndisk   ${o.disk_hash}\niroh   ${o.iroh_hash}`}>{o.hash.slice(0, 12)}…</span>
								<span class="s">{gb(o.size)}</span>
							</li>
						{/each}
					</ol>
				</div>
			</section>
		{:else}
			<section class="library">
				<div class="filters">
					{#each ['all', 'video', 'image', 'audio', 'other'] as k}
						<button class:on={kind === k} onclick={() => (kind = k)}>{k}</button>
					{/each}
				</div>
				<div class="grid">
					{#each shown as m (m.hash)}
						<button class="card" onclick={() => (open = m)}>
							{#if m.kind === 'image'}
								<img src={src(m)} alt={m.original_name} loading="lazy" />
							{:else if m.kind === 'video'}
								<video src={src(m)} preload="metadata" muted></video>
							{:else}
								<div class="blank">{m.kind}</div>
							{/if}
							<span class="n">{m.title || m.original_name}</span>
							<small>{gb(m.size)} · {m.hash.slice(0, 10)}… {#if m.tags?.length}· {m.tags.join(', ')}{/if}</small>
						</button>
					{:else}
						<p class="quiet">Nothing in the vault yet.</p>
					{/each}
				</div>
			</section>
		{/if}

		{#if open}
			<div class="viewer" role="presentation" onclick={() => (open = null)}>
				<div class="frame" role="presentation" onclick={(e) => e.stopPropagation()}>
					{#if open.kind === 'video'}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={src(open)} controls autoplay></video>
					{:else if open.kind === 'image'}
						<img src={src(open)} alt={open.original_name} />
					{:else if open.kind === 'audio'}
						<audio src={src(open)} controls autoplay></audio>
					{/if}
					<p><strong>{open.original_name}</strong> · {gb(open.size)} · {open.mime}</p>
					<code>{open.hash}</code>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.app { min-height: 100vh; background: var(--paper); color: var(--ink); font-family: var(--font-body); display: flex; flex-direction: column; }
	.app.dragging { outline: 4px dashed var(--mustard); outline-offset: -8px; }
	.away { max-width: 32rem; margin: 20vh auto; padding: 0 16px; font-family: var(--font-body); color: var(--ink); }
	header { display: flex; align-items: center; gap: 24px; padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--cream); }
	header strong { font-family: var(--font-display); font-size: 18px; font-weight: 500; }
	nav { display: flex; gap: 4px; }
	nav button, .filters button { border: 1px solid var(--line); background: transparent; border-radius: 999px; padding: 6px 14px; cursor: pointer; color: var(--ink-soft); font: inherit; }
	nav button.on, .filters button.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.meta { margin-left: auto; color: var(--muted); font-size: 13px; }
	h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 12px; font-weight: 600; }
	.quiet { color: var(--muted); font-size: 14px; }
	.bad { color: var(--terracotta); }
	.ingest { display: grid; grid-template-columns: 240px 1fr 1.2fr; gap: 0; flex: 1; min-height: 0; }
	.ingest > * { padding: 20px; border-right: 1px solid var(--line); overflow: auto; }
	.source { display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left; border: 1px solid var(--line); background: white; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; font: inherit; color: var(--ink); }
	.source small { color: var(--muted); }
	.source.ghost { background: transparent; }
	.drop { border: 1px dashed var(--line); border-radius: 12px; padding: 18px 10px; text-align: center; color: var(--muted); font-size: 13px; margin: 8px 0; }
	.link { background: none; border: none; color: var(--ink-soft); text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }
	.picked { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 6px; }
	.picked li { background: var(--cream); border-radius: 999px; padding: 4px 10px; font-size: 13px; }
	.scan { font-size: 14px; color: var(--ink-soft); }
	label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); margin: 12px 0; }
	input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; color: var(--ink); background: white; }
	.actions { display: flex; align-items: center; gap: 16px; }
	.primary { background: var(--ink); color: var(--paper); border: none; border-radius: 999px; padding: 10px 20px; font: inherit; cursor: pointer; }
	.primary:disabled { opacity: 0.5; cursor: default; }
	.now { margin-top: 20px; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
	.now span { color: var(--muted); font-size: 13px; }
	.bar { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; margin-top: 6px; }
	.bar div { height: 100%; background: var(--mustard); transition: width 0.3s; }
	.summary { margin-top: 20px; padding: 14px; border-radius: 14px; background: #eef2e6; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
	.summary.bad { background: #f6e3da; }
	.summary .keep { color: var(--ink-soft); }
	.summary small { color: var(--muted); }
	.log ol { list-style: none; padding: 0; margin: 0; font-size: 13px; }
	.log li { display: grid; grid-template-columns: 24px 1fr auto 70px; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); align-items: center; }
	.log .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.log .h { font-family: ui-monospace, monospace; color: var(--muted); }
	.log .s { text-align: right; color: var(--muted); }
	.log li.mismatch { color: var(--terracotta); }
	.library { padding: 20px; flex: 1; }
	.filters { display: flex; gap: 6px; margin-bottom: 16px; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
	.card { display: flex; flex-direction: column; gap: 4px; text-align: left; background: white; border: 1px solid var(--line); border-radius: 14px; padding: 8px; cursor: pointer; font: inherit; color: var(--ink); }
	.card img, .card video, .card .blank { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 8px; background: var(--cream); display: grid; place-items: center; color: var(--muted); }
	.card .n { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.card small { color: var(--muted); font-size: 11px; }
	.viewer { position: fixed; inset: 0; background: rgba(20, 26, 22, 0.85); display: grid; place-items: center; z-index: 10; }
	.frame { max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; gap: 8px; color: var(--paper); }
	.frame video, .frame img { max-width: 90vw; max-height: 78vh; border-radius: 8px; background: black; }
	.frame code { font-size: 12px; color: var(--sage); }
</style>
