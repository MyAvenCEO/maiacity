<!--
	Ingest — the studio's first step, and only in maiaCITY Studio (the Mac app). Pick a card, a drive or a folder (or
	drop files anywhere on the window), tag the batch, and every file is copied into this Mac's vault with three hashes
	that must agree: the bytes as they came off the source, the copy read back from the disk, and iroh's own. The card
	is safe to format only once a second verified copy exists.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { command } from '$lib/native';
	import CopiesBadge from './CopiesBadge.svelte';
	import { gb, name, verifiedCopies, type Copies, type Outcome, type Progress, type Scan, type Source, type Summary } from './vault';

	let { onDone = () => {} }: { onDone?: () => void } = $props();

	let sources = $state<Source[]>([]);
	let picked = $state<string[]>([]);
	let scan = $state<Scan | null>(null);
	let tags = $state('');
	let running = $state(false);
	let rows = $state<Progress[]>([]);
	let current = $state<Progress | null>(null);
	let summary = $state<Summary | null>(null);
	let error = $state('');
	let dragging = $state(false);
	let copies = $state<Record<string, Copies>>({});
	const unlisten: Array<() => void> = [];

	// after a batch: follow its files' copies until each has two verified ones (this Mac + the server)
	async function followCopies() {
		try {
			copies = Object.fromEntries((await command<Copies[]>('vault_copies')).map((c) => [c.hash, c]));
		} catch {
			/* the API may be away for a moment */
		}
	}
	const batchHashes = $derived(rows.filter((r) => r.outcome && r.outcome.verdict !== 'mismatch').map((r) => r.outcome!.hash));
	const safe = $derived(batchHashes.length > 0 && batchHashes.every((h) => copies[h] && verifiedCopies(copies[h]) >= 2));

	async function look() {
		sources = await command<Source[]>('vault_sources');
	}

	async function pick(paths: string[]) {
		picked = [...new Set([...picked, ...paths])];
		summary = null;
		scan = await command<Scan>('vault_scan', { paths: picked });
	}

	async function chooseFolder() {
		const { open } = await import('@tauri-apps/plugin-dialog');
		const chosen = await open({ directory: true, multiple: true });
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
			summary = await command<Summary>('vault_ingest', { paths: picked, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
			onDone();
			await followCopies();
		} catch (e) {
			error = String(e);
		} finally {
			running = false;
			current = null;
		}
	}

	onMount(async () => {
		const { listen } = await import('@tauri-apps/api/event');
		const { getCurrentWebview } = await import('@tauri-apps/api/webview');
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
					pick(e.payload.paths);
				}
			})
		);
		await look().catch((e) => (error = String(e)));
		const timer = setInterval(() => summary && !safe && followCopies(), 5000);
		unlisten.push(() => clearInterval(timer));
	});
	onDestroy(() => unlisten.forEach((u) => u()));

	const done = $derived(rows.filter((r) => r.outcome));
	const verdict = (o: Outcome) => (o.verdict === 'verified' ? '✅' : o.verdict === 'duplicate' ? '•' : '❌');
</script>

<section class="ingest" class:dragging aria-label="Ingest">
	<aside>
		<h2>Sources</h2>
		{#each sources as s (s.path)}
			<button class="source" onclick={() => pick([s.path])}>
				<span>{s.name}</span><small>{gb(s.total - s.free)} of {gb(s.total)}</small>
			</button>
		{:else}
			<p class="quiet">No card or drive mounted.</p>
		{/each}
		<button class="source ghostly" onclick={chooseFolder}>+ Choose folder…</button>
		<div class="drop">⇣ drop files or folders anywhere</div>
		<button class="link" onclick={look}>Look again</button>
	</aside>

	<div class="batch">
		<h2>This batch</h2>
		{#if picked.length}
			<ul class="picked">{#each picked as p (p)}<li title={p}>{name(p)}</li>{/each}</ul>
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
			<p class="quiet">Choose a source, a folder, or drop files on the window.</p>
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
				<span class="keep">
					{#if summary.mismatches}Mismatches — keep the card and ingest again.
					{:else if safe}✅ Every file has two verified copies (this Mac + the server) — safe to format the card.
					{:else}{batchHashes.filter((h) => copies[h] && verifiedCopies(copies[h]) >= 2).length} of {batchHashes.length} files have two verified copies — keep the card until all do.{/if}
				</span>
				<small>Report {summary.report.slice(0, 16)}…</small>
			</div>
		{/if}
		{#if error}<p class="err">{error}</p>{/if}
	</div>

	<div class="log">
		<h2>Files{#if rows.length} · {done.length}{/if}</h2>
		<ol>
			{#each rows as r (r.index)}
				{@const o = r.outcome!}
				<li class={o.verdict}>
					<span>{verdict(o)}</span>
					<span class="n" title={o.source}>{name(o.source)}</span>
					<span class="h" title={`source ${o.source_hash}\ndisk   ${o.disk_hash}\niroh   ${o.iroh_hash}`}>{o.hash.slice(0, 12)}…</span>
					<span class="s">{gb(o.size)}</span>
					{#if copies[o.hash]}<span class="c"><CopiesBadge c={copies[o.hash]} /></span>{/if}
				</li>
			{/each}
		</ol>
	</div>
</section>

<style>
	.ingest { grid-area: main; display: grid; grid-template-columns: 17rem 1fr 1.2fr; gap: 1px; background: var(--edge); min-height: 0; }
	.ingest.dragging { outline: 3px dashed var(--accent); outline-offset: -6px; }
	.ingest > * { padding: 1rem 1.2rem; background: var(--panel); overflow: auto; }
	h2 { margin: 0 0 0.8rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
	.quiet { color: var(--dim); }
	.source { display: flex; flex-direction: column; align-items: flex-start; width: 100%; margin-bottom: 0.5rem; padding: 0.6rem 0.75rem; border: 1px solid var(--edge); border-radius: 10px; background: #fff; font: inherit; text-align: left; color: var(--ink); cursor: pointer; }
	.source small { color: var(--dim); }
	.source.ghostly { background: transparent; }
	.drop { margin: 0.5rem 0; padding: 1rem 0.5rem; border: 1px dashed var(--edge); border-radius: 10px; font-size: 0.78rem; text-align: center; color: var(--dim); }
	.link { padding: 0; border: 0; background: none; font: inherit; color: var(--dim); text-decoration: underline; cursor: pointer; }
	.picked { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0 0 0.5rem; padding: 0; list-style: none; }
	.picked li { padding: 0.2rem 0.6rem; border-radius: 999px; background: var(--bg); font-size: 0.8rem; }
	.scan { color: var(--dim); }
	label { display: flex; flex-direction: column; gap: 0.25rem; margin: 0.8rem 0; font-size: 0.78rem; color: var(--dim); }
	input { padding: 0.45rem 0.6rem; border: 1px solid var(--edge); border-radius: 8px; background: #fff; font: inherit; color: var(--ink); }
	.actions { display: flex; align-items: center; gap: 1rem; }
	.primary { padding: 0.5rem 1.1rem; border: 0; border-radius: 999px; background: var(--ink); font: inherit; color: #fff; cursor: pointer; }
	.primary:disabled { opacity: 0.5; cursor: default; }
	.now { display: flex; flex-direction: column; gap: 0.2rem; margin-top: 1.2rem; }
	.now span { font-size: 0.78rem; color: var(--dim); }
	.bar { overflow: hidden; height: 5px; margin-top: 0.3rem; border-radius: 3px; background: var(--edge); }
	.bar div { height: 100%; background: var(--accent); transition: width 0.3s; }
	.summary { display: flex; flex-direction: column; gap: 0.2rem; margin-top: 1.2rem; padding: 0.8rem; border-radius: 10px; background: #eef2e6; }
	.summary.bad { background: #f6e3da; }
	.summary small, .summary .keep { color: var(--dim); }
	.err { color: #9c3b26; }
	.log ol { margin: 0; padding: 0; list-style: none; font-size: 0.8rem; }
	.log li { display: grid; grid-template-columns: 1.4rem 1fr auto 4.5rem; gap: 0.5rem; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid var(--edge); }
	.log .n { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.log .h { font-family: ui-monospace, monospace; color: var(--dim); }
	.log .s { text-align: right; color: var(--dim); }
	.log .c { grid-column: 2 / -1; }
	.log li.mismatch { color: #9c3b26; }
</style>
