<!--
	The board: every story, one card each, in the step it stands on — Idea · Hook · Thumbnail · Journey · Writing · Movie ·
	Derivatives · Scheduled · Published (in the order the API gives). The Idea column is the backlog, and its one line at
	the top captures a new idea. Drag a card to another column, or use its ‹ › (a card scheduled without a date goes out
	tomorrow at 09:00); click it to open the story on its own page, at the step it stands on.
-->
<script>
	import { fileUrl } from '$lib/auth/client';
	import ChannelGlyph from '$lib/admin/ChannelGlyph.svelte';
	import { channelsOf, cutsOf, dateLabel, statusLabel, step, thumbOf } from '$lib/admin/board';
	import { STAGE_NOTE } from './stories.js';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */
	/** @typedef {import('$lib/auth/client').Status} Status */

	/**
	 * @type {{
	 *   items: ContentItem[],
	 *   statuses: readonly Status[],
	 *   onopen: (id: string) => void,
	 *   onmove: (item: ContentItem, status: Status) => void,
	 *   ondelete: (id: string) => void,
	 *   oncreate: (title: string) => Promise<void>
	 * }}
	 */
	let { items, statuses, onopen, onmove, ondelete, oncreate } = $props();

	let idea = $state('');
	let busy = $state(false);
	/** @type {string | null} */
	let confirming = $state(null);
	/** @type {string | null} */
	let dragging = $state(null);
	/** @type {Status | null} */
	let over = $state(null);

	/** @param {ContentItem} i */
	const time = (i) => i.scheduled_at ?? i.updated;
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

	async function capture() {
		const title = idea.trim();
		if (!title || busy) return;
		busy = true;
		try {
			await oncreate(title);
			idea = '';
		} finally {
			busy = false;
		}
	}

	/** @param {DragEvent} e @param {ContentItem} i */
	function dragStart(e, i) {
		dragging = i.id;
		e.dataTransfer?.setData('text/x-item', i.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	/** @param {DragEvent} e @param {Status} status */
	function dropOn(e, status) {
		e.preventDefault();
		over = null;
		dragging = null;
		const i = items.find((x) => x.id === e.dataTransfer?.getData('text/x-item'));
		if (i && i.status !== status) onmove(i, status);
	}
</script>

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
				if (!(/** @type {HTMLElement} */ (e.currentTarget).contains(/** @type {Node} */ (e.relatedTarget)))) over = null;
			}}
			ondrop={(e) => dropOn(e, col.status)}
		>
			<h2 title={STAGE_NOTE[col.status] ?? ''}>{statusLabel(col.status)} <span>{col.cards.length}</span></h2>

			{#if col.status === 'idea'}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void capture();
					}}
				>
					<input bind:value={idea} maxlength="200" placeholder="New idea…" aria-label="A new idea" disabled={busy} />
				</form>
			{/if}

			{#each col.cards as i (i.id)}
				{@render card(i)}
			{:else}
				<p class="empty">{col.status === 'idea' ? 'The backlog is empty.' : 'Nothing here.'}</p>
			{/each}
		</section>
	{/each}
</div>

{#snippet card(/** @type {ContentItem} */ i)}
	{@const thumb = thumbOf(i)}
	{@const cuts = cutsOf(i)}
	{@const at = statuses.indexOf(i.status)}
	{@const prev = step(i.status, -1, statuses)}
	{@const next = step(i.status, 1, statuses)}
	{@const meta = cuts}
	<article class="card" class:lifted={dragging === i.id} draggable="true" ondragstart={(e) => dragStart(e, i)} ondragend={() => ((dragging = null), (over = null))}>
		<button class="open" onclick={() => onopen(i.id)}>
			{#if thumb}<img src={fileUrl(thumb.hash)} alt="" loading="lazy" />{/if}
			{#if meta.length}<span class="m">{meta.join(' · ')}</span>{/if}
			<span class="t">{i.title}</span>
			{#if i.hook && i.hook !== i.title}<span class="h">{i.hook}</span>{/if}
			{#if i.scheduled_at && (i.status === 'scheduled' || i.status === 'published')}<span class="d">{dateLabel(i.scheduled_at)}</span>{/if}
			<span class="progress" aria-label="Step {at + 1} of {statuses.length}">
				{#each statuses as s, k (s)}<i class:done={k < at} class:now={k === at}></i>{/each}
			</span>
		</button>
		<div class="foot">
			<span class="chans">
				{#each channelsOf(i) as c (c)}<ChannelGlyph platform={c} />{/each}
				{#if i.story}<span class="vault" title="Filed in the media vault">◆</span>{/if}
			</span>
			<button class="step" disabled={!prev} onclick={() => prev && onmove(i, prev)} aria-label={prev ? `Back to ${statusLabel(prev)}` : 'Back'}>‹</button>
			<button class="step" disabled={!next} onclick={() => next && onmove(i, next)} aria-label={next ? `On to ${statusLabel(next)}` : 'On'}>›</button>
			<button
				class="del"
				class:sure={confirming === i.id}
				onclick={() => (confirming === i.id ? ((confirming = null), ondelete(i.id)) : (confirming = i.id))}
				onblur={() => confirming === i.id && (confirming = null)}
				aria-label="Delete"
			>
				{confirming === i.id ? 'Delete?' : '×'}
			</button>
		</div>
	</article>
{/snippet}

<style>
	.board {
		display: grid;
		grid-template-columns: repeat(var(--cols, 8), minmax(12.5rem, 1fr));
		align-items: start;
		gap: 0.7rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
		overscroll-behavior-x: contain;
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		/* each column the window's height, under the page's head and above the nav pill */
		min-height: calc(100vh - 8rem - var(--nav-room, 5rem));
		min-height: calc(100dvh - 8rem - var(--nav-room, 5rem));
		padding: 0.75rem;
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
		cursor: default;
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
		gap: 0.25rem;
		padding: 0.6rem 0.65rem 0.4rem;
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
		aspect-ratio: 16 / 9;
		margin-bottom: 0.25rem;
		border-radius: 6px;
		object-fit: cover;
		background: var(--cream);
	}

	.m {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--terracotta);
	}

	.t {
		display: -webkit-box;
		overflow: hidden;
		font-size: 0.88rem;
		font-weight: 600;
		line-height: 1.32;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow-wrap: anywhere;
	}

	.h {
		display: -webkit-box;
		overflow: hidden;
		font-size: 0.78rem;
		font-style: italic;
		line-height: 1.35;
		color: var(--ink-soft);
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.d {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: var(--ink-soft);
	}

	/* the eight steps, as eight short bars: the ones behind it filled, its own marked */
	.progress {
		display: flex;
		gap: 3px;
		margin-top: 0.3rem;
	}

	.progress i {
		flex: 1;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
	}

	.progress i.done {
		background: var(--sage);
	}

	.progress i.now {
		background: var(--terracotta);
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
		align-items: center;
		gap: 0.3rem;
		color: var(--ink-soft);
	}

	.vault {
		font-size: 0.7rem;
		color: var(--sage);
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
