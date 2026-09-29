<!--
	The board: every snippet we put out, one card each, in the step it stands on — Idea · Draft · Review · Scheduled ·
	Published (in the order the API gives). The Idea column is the swipe file, and its one line at the top is the only
	place anything is typed: an idea goes in there, everything after it is made elsewhere and only moves along here. A
	Draft is its base article being written; on to Derivatives locks the article and the posts are derived from it
	(back to Draft unlocks it). Drag a card to another column, or use its ‹ › — a card scheduled without a date goes out
	tomorrow at 09:00. Click a card to open it large: the idea, the article, its posts' previews, schedule and files.

	Prerendered like every other page, so it is only a shell until the browser asks the API who is looking. The API is
	the gate: without content:admin it answers nothing, and the page just says so. /app/board/?item=<id> opens that
	item at once (the calendar links here).
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import {
		API,
		mediaUrl,
		STATUSES,
		createContent,
		deleteContent,
		listContent,
		may,
		me,
		saveContent,
		type ContentItem,
		type Status
	} from '$lib/auth/client';
	import ChannelGlyph from '$lib/admin/ChannelGlyph.svelte';
	import ContentModal from '$lib/admin/ContentModal.svelte';
	import { channelsOf, cutsOf, dateLabel, movePatch, statusLabel, step, thumbOf } from '$lib/admin/board';

	let phase = $state<'loading' | 'signed-out' | 'forbidden' | 'ready'>('loading');
	let error = $state('');
	let items = $state<ContentItem[]>([]);
	let statuses = $state<readonly Status[]>(STATUSES);
	let idea = $state('');
	let busy = $state(false);
	let input = $state<HTMLInputElement | null>(null);
	let openId = $state<string | null>(null);
	let confirming = $state<string | null>(null);
	let dragging = $state<string | null>(null);
	let over = $state<Status | null>(null);

	const opened = $derived(items.find((i) => i.id === openId) ?? null);
	const time = (i: ContentItem) => i.scheduled_at ?? i.updated;
	// Scheduled by date, soonest first; Published newest first; the rest the latest touched first
	const columns = $derived(
		statuses.map((status) => ({
			status,
			cards: items
				.filter((i) => i.status === status)
				.sort((a, b) =>
					status === 'scheduled' ? time(a).localeCompare(time(b)) : status === 'published' ? time(b).localeCompare(time(a)) : b.updated.localeCompare(a.updated)
				)
		}))
	);

	onMount(async () => {
		try {
			const founder = await me();
			if (!may(founder, 'content:admin')) return void (phase = 'forbidden');
		} catch {
			return void (phase = 'signed-out');
		}
		try {
			const got = await listContent();
			items = got.items;
			if (got.statuses?.length) statuses = got.statuses;
		} catch (e) {
			error = (e as Error).message;
		}
		phase = 'ready';
		const wanted = new URLSearchParams(location.search).get('item');
		if (wanted && items.some((i) => i.id === wanted)) openId = wanted;
		await tick();
		if (!openId) input?.focus();
	});

	// the cards change from outside too (a day pushed from the repo, a render delivered): fetched again whenever the
	// tab comes back into view, and every 20 s while it is in view
	onMount(() => {
		const again = () => phase === 'ready' && document.visibilityState === 'visible' && refresh();
		const every = setInterval(again, 20000);
		document.addEventListener('visibilitychange', again);
		window.addEventListener('focus', again);
		return () => (clearInterval(every), document.removeEventListener('visibilitychange', again), window.removeEventListener('focus', again));
	});

	async function refresh() {
		if (dragging || busy) return;
		try {
			const got = await listContent();
			if (!dragging) items = got.items;
			if (got.statuses?.length) statuses = got.statuses;
		} catch {
			// a missed refresh is not an error: the next one comes
		}
	}

	async function run(action: () => Promise<unknown>) {
		error = '';
		try {
			await action();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	const replace = (i: ContentItem) => (items = items.map((x) => (x.id === i.id ? i : x)));

	/** The swipe file's one line: Enter keeps it as an idea. */
	async function capture() {
		const title = idea.trim();
		if (!title || busy) return;
		busy = true;
		await run(async () => {
			items = [await createContent({ title, status: 'idea' }), ...items];
			idea = '';
		});
		busy = false;
		input?.focus();
	}

	/** On to another step: at once on the board, then as the server has it. */
	async function move(i: ContentItem, status: Status) {
		if (i.status === status) return;
		const patch = movePatch(i, status);
		replace({ ...i, ...patch });
		await run(async () => replace(await saveContent(i.id, patch)));
	}

	async function remove(id: string) {
		confirming = null;
		await run(async () => {
			await deleteContent(id);
			items = items.filter((x) => x.id !== id);
			if (openId === id) close();
		});
	}

	// the open item is in the address, so a reload (or the calendar) opens it again
	function open(id: string) {
		openId = id;
		replaceState(`?item=${id}`, {});
	}
	function close() {
		openId = null;
		replaceState(`${base}/app/board/`, {});
	}

	// ── drag a card to another column ──
	function dragStart(e: DragEvent, i: ContentItem) {
		dragging = i.id;
		e.dataTransfer?.setData('text/x-item', i.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	function dropOn(e: DragEvent, status: Status) {
		e.preventDefault();
		over = null;
		dragging = null;
		const i = items.find((x) => x.id === e.dataTransfer?.getData('text/x-item'));
		if (i) void move(i, status);
	}
</script>

<svelte:head>
	<title>Board · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">

	{#if phase === 'loading'}
		<p class="lede">One moment…</p>
	{:else if phase === 'signed-out'}
		<p class="lede">The board belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
	{:else if phase === 'forbidden'}
		<p class="lede">The board belongs to the admin, and your account is not one.</p>
	{:else}
		{#if error}<p class="bad">{error}</p>{/if}

		<div class="board" style:--cols={statuses.length}>
			{#each columns as col (col.status)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<section
					class="col"
					class:over={over === col.status}
					aria-label={statusLabel(col.status)}
					ondragover={(e) => {
						e.preventDefault();
						over = col.status;
					}}
					ondragleave={(e) => {
						if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) over = null;
					}}
					ondrop={(e) => dropOn(e, col.status)}
				>
					<h2>{statusLabel(col.status)} <span>{col.cards.length}</span></h2>

					{#if col.status === 'idea'}
						<form
							onsubmit={(e) => {
								e.preventDefault();
								void capture();
							}}
						>
							<input bind:this={input} bind:value={idea} maxlength="200" placeholder="Capture an idea…" aria-label="Capture an idea" disabled={busy} />
						</form>
					{/if}

					{#each col.cards as i (i.id)}
						{@render card(i)}
					{:else}
						<p class="empty">{col.status === 'idea' ? 'The swipe file is empty.' : 'Nothing here.'}</p>
					{/each}
				</section>
			{/each}
		</div>
	{/if}
</main>

{#snippet card(i: ContentItem)}
	{@const thumb = thumbOf(i)}
	{@const cuts = cutsOf(i)}
	{@const prev = step(i.status, -1, statuses)}
	{@const next = step(i.status, 1, statuses)}
	<article class="card" class:lifted={dragging === i.id} draggable="true" ondragstart={(e) => dragStart(e, i)} ondragend={() => ((dragging = null), (over = null))}>
		<button class="open" onclick={() => open(i.id)}>
			{#if thumb}<img src={mediaUrl(thumb.cid)} alt="" loading="lazy" style:aspect-ratio={thumb.aspect.replace(':', ' / ')} />{/if}
			<span class="t">{i.title}</span>
			{#if i.project || cuts.length}<span class="m">{[i.project, ...cuts].filter(Boolean).join(' · ')}</span>{/if}
			{#if i.scheduled_at && (i.status === 'scheduled' || i.status === 'published')}<span class="d">{dateLabel(i.scheduled_at)}</span>{/if}
		</button>
		<div class="foot">
			<span class="chans">{#each channelsOf(i) as c (c)}<ChannelGlyph platform={c} />{/each}</span>
			<button class="step" disabled={!prev} onclick={() => prev && move(i, prev)} aria-label={prev ? `Back to ${statusLabel(prev)}` : 'Back'}>‹</button>
			<button class="step" disabled={!next} onclick={() => next && move(i, next)} aria-label={next ? `On to ${statusLabel(next)}` : 'On'}>›</button>
			<button
				class="del"
				class:sure={confirming === i.id}
				onclick={() => (confirming === i.id ? remove(i.id) : (confirming = i.id))}
				onblur={() => confirming === i.id && (confirming = null)}
				aria-label="Delete"
			>
				{confirming === i.id ? 'Delete?' : '×'}
			</button>
		</div>
	</article>
{/snippet}

{#if opened}
	<ContentModal item={opened} {statuses} onmove={(s) => move(opened, s)} ondelete={() => remove(opened.id)} onclose={close} />
{/if}

<style>
	/* the board wants the width the other admin pages do not, and the height: the top bar says where it is */
	main {
		max-width: 1480px;
		padding-block: 1.2rem 0;
	}

	.lede {
		color: var(--ink-soft);
	}

	.lede a {
		color: var(--terracotta);
	}

	.bad {
		color: #9c3b26;
	}

	.board {
		display: grid;
		grid-template-columns: repeat(var(--cols, 5), minmax(13.5rem, 1fr));
		align-items: start;
		gap: 0.8rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		/* each column the window's height, below the top bar and above the nav pill */
		min-height: calc(100vh - 11rem);
		min-height: calc(100dvh - 11rem);
		padding: 0.8rem;
		border: 2px solid transparent;
		border-radius: 14px;
		background: var(--paper);
		transition: border-color 0.12s ease;
	}

	.col.over {
		border-color: var(--mustard);
	}

	h2 {
		margin: 0 0 0.2rem;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h2 span {
		color: var(--terracotta);
	}

	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--cream);
		font: inherit;
		font-size: 0.88rem;
		color: var(--ink);
	}

	input:focus-visible {
		outline: 2px solid var(--terracotta);
		outline-offset: 1px;
	}

	.empty {
		margin: 0.3rem 0 0;
		font-size: 0.75rem;
		color: var(--muted);
	}

	/* ── a card ── */
	.card {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
		cursor: grab;
	}

	.card.lifted {
		opacity: 0.45;
	}

	.open {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.6rem 0.65rem 0.3rem;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.open img {
		display: block;
		width: 100%;
		max-height: 6rem;
		margin-bottom: 0.3rem;
		border-radius: 6px;
		object-fit: cover;
		background: var(--cream);
	}

	.t {
		display: -webkit-box;
		overflow: hidden;
		font-size: 0.86rem;
		font-weight: 500;
		line-height: 1.35;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow-wrap: anywhere;
	}

	.m {
		font-size: 0.7rem;
		color: var(--terracotta);
	}

	.d {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: var(--ink-soft);
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0 0.35rem 0.35rem 0.65rem;
	}

	.chans {
		display: flex;
		flex: 1;
		gap: 0.3rem;
		color: var(--ink-soft);
	}

	.step,
	.del {
		padding: 0.05rem 0.4rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.3;
		color: var(--muted);
		cursor: pointer;
	}

	.step:hover:not(:disabled) {
		background: var(--cream);
		color: var(--ink);
	}

	.step:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.del {
		opacity: 0.5;
	}

	.card:hover .del,
	.del:focus-visible,
	.del.sure {
		opacity: 1;
	}

	.del.sure {
		font-size: 0.72rem;
		background: #9c3b26;
		color: var(--paper);
	}
</style>
