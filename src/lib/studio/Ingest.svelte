<!--
	Ingest — the studio's first step, and only in maiaCITY Studio (the Mac app). Choose the story on the left (or the
	inbox), drop a card, a drive or a folder anywhere (or pick one), and every file is copied into this Mac's vault with
	three hashes that must agree: the bytes as they came off the source, the copy read back from the disk, and iroh's
	own. Its class is told from the file (camera and recorder files: original; the rest: default) — everything else
	about it comes later, in a second step. Below, each source ingested into the story as a card: what came in, and for
	every destination how far its copies are, live — until the source may be released.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { command } from '$lib/native';
	import Activity from './Activity.svelte';
	import SourceCards from './SourceCards.svelte';
	import StoryAside from './StoryAside.svelte';
	import Stories from './Stories.svelte';
	import StoryTable from './StoryTable.svelte';
	import Details from '$lib/admin/media/Details.svelte';
	import { parse } from '$lib/admin/media/facets';
	import type { MediaItem } from '$lib/auth/client';
	import { gb, name, type Copies, type Progress, type Scan, type Source, type StoryView, type Summary } from './vault';

	let { onDone = () => {} }: { onDone?: () => void } = $props();

	let sources = $state<Source[]>([]);
	let picked = $state<string[]>([]);
	let scan = $state<Scan | null>(null);
	let running = $state(false);
	let current = $state<Progress | null>(null);
	let error = $state('');
	let dragging = $state(false);
	/** the story a batch goes into (its id; the inbox's by default) */
	let story = $state<string | null>(null);
	let storiesPanel = $state<{ load: () => Promise<void> } | null>(null);
	let storyList = $state<StoryView[]>([]);
	/** bumped after every batch and every move: cards and table read the catalog again */
	let reload = $state(0);
	/** what the middle shows: the sources ingested into the story, its files, or everything moving now */
	let view = $state<'sources' | 'files' | 'activity'>('sources');
	/** the file whose metadata the right column shows (a row clicked in the table) */
	let openFile = $state<MediaItem | null>(null);
	let openCopies = $state<Copies | undefined>(undefined);
	const unlisten: Array<() => void> = [];

	const chosenStory = $derived(storyList.find((s) => s.id === story) ?? null);
	const storyName = $derived(chosenStory ? (chosenStory.inbox ? 'the Inbox' : chosenStory.title) : 'the Inbox');
	// another story on the left: its own panel again, not the last file
	$effect(() => {
		void story;
		openFile = null;
	});

	async function openRow(m: MediaItem) {
		openFile = m;
		openCopies = (await command<Copies[]>('vault_copies').catch(() => [])).find((c) => c.hash === m.hash);
	}
	async function look() {
		sources = await command<Source[]>('vault_sources');
	}
	async function pick(paths: string[]) {
		picked = [...new Set([...picked, ...paths])];
		error = '';
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
		error = '';
	}
	async function start() {
		if (!picked.length || running) return;
		running = true;
		error = '';
		try {
			const s = await command<Summary>('vault_ingest', { paths: picked, tags: [], story });
			if (s.mismatches) error = `${s.mismatches} files did not hash the same on the way in — keep the source and ingest again.`;
			clear();
			onDone();
			await storiesPanel?.load();
			reload++;
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
		unlisten.push(await listen<Progress>('ingest', ({ payload }) => void (!payload.outcome && (current = payload))));
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
	});
	onDestroy(() => unlisten.forEach((u) => u()));
</script>

<section class="ingest" class:dragging aria-label="Ingest">
	<aside>
		<Stories bind:this={storiesPanel} bind:chosen={story} bind:list={storyList} />
	</aside>

	<div class="main">
		<div class="bar" class:ready={picked.length && !running} class:busy={running}>
			{#if running && current}
				<div class="line">
					<span>Copying and hashing into {storyName} · {current.index + 1} / {current.total}</span>
					<strong title={current.path}>{name(current.path)}</strong>
					<small>{gb(current.size)}</small>
				</div>
				<div class="progress"><i style:width="{(current.index / current.total) * 100}%"></i></div>
			{:else if picked.length}
				<div class="line">
					{#each picked as p (p)}<span class="chip" title={p}>{name(p)}</span>{/each}
					{#if scan}<small>{scan.files} files · {gb(scan.bytes)}</small>{/if}
					<span class="grow"></span>
					<button class="link" onclick={clear}>Clear</button>
					<button class="go" onclick={start} disabled={!scan?.files}>Ingest {scan?.files ?? ''} files into {storyName}</button>
				</div>
			{:else}
				<div class="line">
					<span class="hint">⇣ Drop a card, a drive or a folder — it goes into <strong>{storyName}</strong></span>
					<span class="grow"></span>
					{#each sources as s (s.path)}<button class="chip drive" onclick={() => pick([s.path])} title="{gb(s.total - s.free)} of {gb(s.total)}">{s.name}</button>{/each}
					<button class="choose" onclick={chooseFolder}>Choose a folder…</button>
				</div>
			{/if}
		</div>
		{#if error}<p class="err">{error}</p>{/if}

		<nav class="tabs">
			<button class:on={view === 'sources'} onclick={() => (view = 'sources')}>Sources</button>
			<button class:on={view === 'files'} onclick={() => (view = 'files')}>Files <span>{chosenStory?.files ?? ''}</span></button>
			<button class:on={view === 'activity'} onclick={() => (view = 'activity')}>Activity</button>
		</nav>
		{#if view === 'sources'}
			<SourceCards {story} {reload} />
		{:else if view === 'files'}
			<StoryTable {story} stories={storyList} {reload} open={openFile?.hash ?? null} onchanged={() => storiesPanel?.load()} onopen={openRow} />
		{:else}
			<Activity />
		{/if}
	</div>

	<div class="side">
		{#if openFile}
			<button class="link back" onclick={() => (openFile = null)}>← {storyName}</button>
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
			<StoryAside story={chosenStory} />
		{/if}
	</div>
</section>

<style>
	.ingest { grid-area: main; display: grid; grid-template-columns: 17rem minmax(0, 1fr) 21rem; gap: 1px; background: var(--edge); min-height: 0; }
	.ingest.dragging { outline: 3px dashed var(--accent); outline-offset: -6px; }
	.ingest > * { padding: 1rem 1.2rem; background: var(--panel); overflow: auto; }
	.link { padding: 0; border: 0; background: none; font: inherit; font-size: 0.78rem; color: var(--dim); text-decoration: underline; cursor: pointer; }
	.main { display: flex; flex-direction: column; gap: 0.9rem; }
	/* the column scrolls as a whole; nothing in it is squeezed to fit */
	.main > :global(*) { flex-shrink: 0; }
	.drive { border: 1px solid var(--edge); background: var(--raised); font: inherit; font-size: 0.8rem; cursor: pointer; }
	.choose { padding: 0.35rem 0.9rem; border: 1px solid var(--ink); border-radius: 999px; background: var(--raised); font: inherit; font-size: 0.8rem; color: var(--ink); cursor: pointer; }
	.bar { padding: 0.8rem 1rem; border: 1px dashed var(--edge); border-radius: 12px; background: var(--bg); }
	.bar.ready { border-style: solid; border-color: var(--ink); background: var(--raised); }
	.bar.busy { border-style: solid; background: var(--raised); }
	.line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-size: 0.84rem; }
	.line small, .line span:first-child { color: var(--dim); }
	.line strong { overflow: hidden; max-width: 22rem; white-space: nowrap; text-overflow: ellipsis; }
	.chip { padding: 0.15rem 0.6rem; border-radius: 999px; background: var(--bg); color: var(--ink) !important; }
	.grow { flex: 1; }
	.go { padding: 0.45rem 1rem; border: 0; border-radius: 999px; background: var(--ink); font: inherit; font-size: 0.84rem; color: var(--on-ink); cursor: pointer; }
	.go:disabled { opacity: 0.5; }
	.hint { font-size: 0.86rem; color: var(--dim); }
	.progress { overflow: hidden; height: 5px; margin-top: 0.5rem; border-radius: 3px; background: var(--edge); }
	.progress i { display: block; height: 100%; background: var(--accent); transition: width 0.3s; }
	.err { margin: 0; color: var(--bad); font-size: 0.84rem; }
	.tabs { display: flex; gap: 1.2rem; border-bottom: 1px solid var(--edge); }
	.tabs button { margin-bottom: -1px; padding: 0.3rem 0 0.5rem; border: 0; border-bottom: 2px solid transparent; background: none; font: inherit; font-size: 0.86rem; color: var(--dim); cursor: pointer; }
	.tabs button.on { border-bottom-color: var(--ink); color: var(--ink); }
	.tabs span { font-size: 0.74rem; color: var(--dim); }
	.back { margin-bottom: 0.8rem; font-size: 0.82rem; }
</style>
