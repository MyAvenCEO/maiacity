<!--
	Ingest — the studio's first step, and only in maiaCITY Studio (the Mac app). Choose the story a batch goes into (or
	the inbox), pick a card, a drive or a folder (or drop files anywhere on the window), and every file is copied into
	this Mac's vault with three hashes that must agree: the bytes as they came off the source, the copy read back from
	the disk, and iroh's own. Each file gets its class (told from the file, or set for the batch). The card is safe to
	format only once a second verified copy exists. Devices & storage live here too.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { command } from '$lib/native';
	import CopiesBadge from './CopiesBadge.svelte';
	import Devices from './Devices.svelte';
	import Stories from './Stories.svelte';
	import StoryTable from './StoryTable.svelte';
	import Details from '$lib/admin/media/Details.svelte';
	import { parse } from '$lib/admin/media/facets';
	import type { MediaItem } from '$lib/auth/client';
	import { BY_HAND, CLASSES, gb, name, verifiedCopies, type Copies, type Outcome, type Progress, type Scan, type Source, type StoryView, type Summary } from './vault';

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
	/** the story the batch goes into (its id; the inbox's by default) */
	let story = $state<string | null>(null);
	/** the class for the whole batch, or '' — told from each file */
	let klass = $state('');
	let storiesPanel = $state<{ load: () => Promise<void> } | null>(null);
	let storyList = $state<StoryView[]>([]);
	/** bumped after every batch and every move: the table reads the catalog again */
	let reload = $state(0);
	let showDevices = $state(false);
	/** the file whose metadata the right column shows (a row clicked in the table) */
	let openFile = $state<MediaItem | null>(null);
	let openCopies = $state<Copies | undefined>(undefined);
	async function openRow(m: MediaItem) {
		openFile = m;
		openCopies = (await command<Copies[]>('vault_copies').catch(() => [])).find((c) => c.hash === m.hash);
	}
	const chosenStory = $derived(storyList.find((s) => s.id === story) ?? null);
	// another story on the left: its own panel again, not the last file
	$effect(() => {
		void story;
		openFile = null;
	});
	let autoProxy = $state(false);
	const unlisten: Array<() => void> = [];

	async function setAutoProxy(on: boolean) {
		autoProxy = (await command<{ auto_proxy: boolean }>('settings_set', { key: 'auto_proxy', value: on })).auto_proxy;
	}

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
			summary = await command<Summary>('vault_ingest', {
				paths: picked,
				tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
				story,
				class: klass || null
			});
			onDone();
			await storiesPanel?.load();
			reload++;
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
		autoProxy = (await command<{ auto_proxy: boolean }>('settings_get').catch(() => ({ auto_proxy: false }))).auto_proxy;
		const timer = setInterval(() => summary && !safe && followCopies(), 5000);
		unlisten.push(() => clearInterval(timer));
	});
	onDestroy(() => unlisten.forEach((u) => u()));

	const done = $derived(rows.filter((r) => r.outcome));
	const verdict = (o: Outcome) => (o.verdict === 'verified' ? '✅' : o.verdict === 'duplicate' ? '•' : '❌');
</script>

<section class="ingest" class:dragging aria-label="Ingest">
	<aside>
		<Stories bind:this={storiesPanel} bind:chosen={story} bind:list={storyList} />
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
		<h2>This batch → {storyList.find((s) => s.id === story)?.inbox ? 'Inbox' : (storyList.find((s) => s.id === story)?.title ?? 'Inbox')}</h2>
		{#if picked.length}
			<ul class="picked">{#each picked as p (p)}<li title={p}>{name(p)}</li>{/each}</ul>
			{#if scan}
				<p class="scan">{scan.files} files · {gb(scan.bytes)} · {Object.entries(scan.kinds).map(([k, n]) => `${n} ${k}`).join(' · ')}</p>
			{/if}
			<label>Class
				<select bind:value={klass} disabled={running}>
					<option value="">told from each file (camera and recorder files: original; the rest: default)</option>
					{#each BY_HAND as c (c)}<option value={c}>{c}</option>{/each}
				</select>
			</label>
			<label>Tags <input bind:value={tags} placeholder="A7IV, drone" disabled={running} /></label>
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
		<StoryTable {story} stories={storyList} {reload} open={openFile?.hash ?? null} onchanged={() => storiesPanel?.load()} onopen={openRow} />
	</div>

	<div class="log">
		{#if openFile}
			<button class="link back" onclick={() => (openFile = null)}>← {chosenStory?.inbox ? 'Inbox' : (chosenStory?.title ?? 'the story')}</button>
			<Details
				m={openFile}
				p={parse(openFile)}
				measure={undefined}
				copies={openCopies}
				stories={storyList}
				onplaced={(n) => ((openFile = n), storiesPanel?.load(), reload++)}
				onfilter={() => {}}
			/>
		{:else}
			{#if chosenStory}
				<div class="story">
					<span class="ep">{chosenStory.inbox ? 'INBOX' : [chosenStory.series, chosenStory.episode].filter(Boolean).join(' · ')}</span>
					<h3>{chosenStory.title}</h3>
					{#if chosenStory.description && !chosenStory.inbox}<p>{chosenStory.description}</p>{/if}
					<p class="dim">{chosenStory.files} files · {gb(chosenStory.bytes)}{chosenStory.inbox ? '' : ` · id ${chosenStory.id.slice(0, 12)}…`}</p>
				</div>
				<h2>Classes → destinations</h2>
				<table class="classes">
					<tbody>
						{#each CLASSES as c (c)}
							<tr>
								<th>{c}</th>
								<td>{chosenStory.classes[c]?.[0] ?? 0} · {gb(chosenStory.classes[c]?.[1] ?? 0)}</td>
								<td class="to">{chosenStory.rules[c].join(' + ')}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<h2>Settings</h2>
			<div class="switches">
				<label class="switch"><input type="checkbox" checked={autoProxy} onchange={(e) => setAutoProxy(e.currentTarget.checked)} /> Proxies by themselves after ingest</label>
				<button class="link" onclick={() => (showDevices = !showDevices)}>{showDevices ? 'Hide devices & storage' : 'Devices & storage'}</button>
			</div>
			{#if showDevices}<div class="devices"><Devices /></div>{/if}

		<h2>Activity{#if rows.length} · {done.length} files{/if}</h2>
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
		{/if}
	</div>
</section>

<style>
	.ingest { grid-area: main; display: grid; grid-template-columns: 19rem minmax(0, 1fr) 22rem; gap: 1px; background: var(--edge); min-height: 0; }
	.batch { display: flex; flex-direction: column; gap: 0.2rem; min-height: 0; }
	.batch > :global(.table) { flex: 1; margin-top: 1rem; }
	.devices { margin: 0.8rem 0 1.2rem; border: 1px solid var(--edge); border-radius: 12px; background: var(--bg); }
	.log h2 { margin-top: 1.2rem; }
	.back { margin-bottom: 0.8rem; font-size: 0.82rem; }
	.story .ep { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--dim); }
	.story h3 { margin: 0.15rem 0 0.3rem; font-size: 1.1rem; }
	.story p { margin: 0 0 0.3rem; font-size: 0.82rem; }
	.dim { color: var(--dim); }
	.classes { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
	.classes th { padding: 0.25rem 0; font-weight: 600; text-align: left; }
	.classes td { padding: 0.25rem 0.4rem; color: var(--dim); }
	.classes .to { text-align: right; }
	select { padding: 0.45rem 0.6rem; border: 1px solid var(--edge); border-radius: 8px; background: #fff; font: inherit; color: var(--ink); }
	.switches { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1.2rem; padding-top: 0.8rem; border-top: 1px solid var(--edge); }
	.switch { flex-direction: row; align-items: center; gap: 0.45rem; margin: 0; }
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
