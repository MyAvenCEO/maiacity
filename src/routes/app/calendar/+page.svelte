<!--
	The publishing calendar, as a timeline: the days left to right, one row per platform, and every dated post at its
	time as its platform shows it (the same simulated previews as the board's). A day with posts is as wide as its
	previews; a day without is a narrow strip. It opens on today; scroll sideways (or ‹ › and Today) through the rest.

	Click a post's head to open its item on the board; drag it by its head to another day to move it there (it keeps its
	time — an item without posts moves as a whole, and counts as scheduled). Ideas, hooks and drafts do not show,
	whatever date they kept.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { listContent, may, me, saveContent, type ContentItem, type Platform } from '$lib/auth/client';
	import ChannelGlyph from '$lib/admin/ChannelGlyph.svelte';
	import PostCard from '$lib/admin/PostCard.svelte';
	import { FORMAT_LABEL, PLATFORMS, PLATFORM_LABEL, dayPatch, entriesOf, onDay, placeLabel, statusLabel, timeLabel, type Entry } from '$lib/admin/board';

	let phase = $state<'loading' | 'signed-out' | 'forbidden' | 'ready'>('loading');
	let error = $state('');
	let items = $state<ContentItem[]>([]);
	let over = $state<string | null>(null);
	let scroller = $state<HTMLDivElement | null>(null);

	const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
	const today = midnight(new Date());

	// every dated post (an idea, a hook or a draft is not going anywhere yet, whatever date it kept)
	const entries = $derived(
		items
			.filter((i) => !['idea', 'hook', 'draft'].includes(i.status))
			.flatMap(entriesOf)
			.filter((e) => e.when)
			.sort((a, b) => a.when!.localeCompare(b.when!))
	);

	// the days shown: from a few days before the first (or today) to ten days after the last (or today)
	const days = $derived.by(() => {
		const whens = entries.map((e) => midnight(new Date(e.when!)).getTime());
		const first = addDays(new Date(Math.min(today.getTime(), ...whens)), -3);
		const last = addDays(new Date(Math.max(today.getTime(), ...whens)), 10);
		const out: Date[] = [];
		for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
		return out;
	});

	// one row per platform that has posts (all of them while there are none), and one for items without posts
	type Lane = Platform | 'item';
	const lanes = $derived.by((): Lane[] => {
		const used = PLATFORMS.filter((p) => entries.some((e) => e.post?.platform === p));
		return [...(used.length ? used : PLATFORMS), ...(entries.some((e) => !e.post) ? (['item'] as const) : [])];
	});
	const laneOf = (e: Entry): Lane => e.post?.platform ?? 'item';
	const cell = (day: Date, lane: Lane) => entries.filter((e) => laneOf(e) === lane && key(new Date(e.when!)) === key(day));
	const busy = (day: Date) => entries.some((e) => key(new Date(e.when!)) === key(day));

	// the columns: a day with posts as wide as a preview, an empty one a strip
	const columns = $derived(days.map((d) => (busy(d) ? 'minmax(17.5rem, max-content)' : '3.4rem')).join(' '));

	onMount(async () => {
		try {
			const founder = await me();
			if (!may(founder, 'content:admin')) return void (phase = 'forbidden');
		} catch {
			return void (phase = 'signed-out');
		}
		try {
			items = (await listContent()).items;
		} catch (e) {
			error = (e as Error).message;
		}
		phase = 'ready';
		await tick();
		toToday(false);
	});

	// ── moving along ──
	function toToday(smooth = true) {
		const el = scroller?.querySelector<HTMLElement>('.dayhead.now');
		if (scroller && el) scroller.scrollTo({ left: el.offsetLeft - scroller.clientWidth * 0.15, behavior: smooth ? 'smooth' : 'auto' });
	}
	const page = (n: number) => scroller?.scrollBy({ left: n * scroller.clientWidth * 0.8, behavior: 'smooth' });

	const replace = (i: ContentItem) => (items = items.map((x) => (x.id === i.id ? i : x)));
	async function run(action: () => Promise<unknown>) {
		error = '';
		try {
			await action();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	// the board is where an item is opened
	const openItem = (id: string) => goto(`${base}/app/board/?item=${encodeURIComponent(id)}`);

	// ── drag a post to another day: it keeps its time; an item without posts moves whole ──
	function dragStart(e: DragEvent, entry: Entry) {
		e.dataTransfer?.setData('text/x-post', `${entry.item.id}|${entry.index}`);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	async function dropOn(e: DragEvent, day: Date) {
		e.preventDefault();
		over = null;
		const [id, at] = (e.dataTransfer?.getData('text/x-post') ?? '').split('|');
		const i = items.find((x) => x.id === id);
		if (!i) return;
		const n = Number(at);
		const patch: Partial<ContentItem> =
			n < 0 ? dayPatch(i, day) : { posts: i.posts.map((p, k) => (k === n ? { ...p, scheduled_at: onDay(day, p.scheduled_at ?? i.scheduled_at) } : p)) };
		replace({ ...i, ...patch }); // at once, then as the server has it
		await run(async () => replace(await saveContent(i.id, patch)));
	}
	const dragOver = (e: DragEvent, day: Date) => {
		e.preventDefault();
		over = key(day);
	};

	const weekday = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short' });
	const monthOf = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
</script>

<svelte:head>
	<title>Calendar · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	{#if phase === 'loading'}
		<p class="lede">One moment…</p>
	{:else if phase === 'signed-out'}
		<p class="lede">The calendar belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
	{:else if phase === 'forbidden'}
		<p class="lede">The calendar belongs to the admin, and your account is not one.</p>
	{:else}
		<div class="bar">
			<button onclick={() => page(-1)} aria-label="Earlier">‹</button>
			<button class="today" onclick={() => toToday()}>Today</button>
			<button onclick={() => page(1)} aria-label="Later">›</button>
			<span class="count">{entries.length} {entries.length === 1 ? 'post' : 'posts'} dated</span>
			{#if error}<span class="bad">{error}</span>{/if}
		</div>

		<div class="scroller" bind:this={scroller}>
			<div class="timeline" style:grid-template-columns="7.5rem {columns}">
				<div class="corner"></div>
				{#each days as d (key(d))}
					<div class="dayhead" class:now={key(d) === key(today)} class:monday={d.getDay() === 1} class:busy={busy(d)}>
						{#if d.getDate() === 1 || key(d) === key(days[0]!)}<span class="month">{monthOf(d)}</span>{/if}
						<span class="wd">{weekday(d)}</span><b>{d.getDate()}</b>
					</div>
				{/each}

				{#each lanes as lane (lane)}
					<div class="lanehead">
						{#if lane === 'item'}<span>Items</span>{:else}<ChannelGlyph platform={lane} /><span>{PLATFORM_LABEL[lane]}</span>{/if}
					</div>
					{#each days as d (key(d))}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="cell"
							class:now={key(d) === key(today)}
							class:monday={d.getDay() === 1}
							class:over={over === key(d)}
							ondragover={(e) => dragOver(e, d)}
							ondragleave={(e) => {
								if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) over = null;
							}}
							ondrop={(e) => dropOn(e, d)}
						>
							{#each cell(d, lane) as e (`${e.item.id}|${e.index}`)}
								<article
									class="slot"
									class:tentative={e.item.status !== 'scheduled' && e.item.status !== 'published'}
									class:out={e.item.status === 'published'}
								>
									<button
										class="head"
										draggable="true"
										ondragstart={(ev) => dragStart(ev, e)}
										onclick={() => openItem(e.item.id)}
										title="Open {e.item.project ?? e.item.title} on the board · drag to another day"
									>
										<b>{timeLabel(e.when!)}</b>
										<span>{e.post ? placeLabel(e.post) : FORMAT_LABEL[e.format]}</span>
										<small>{e.item.project ?? ''} · {statusLabel(e.item.status)}</small>
									</button>
									{#if e.post}
										<div class="preview"><PostCard post={e.post} deliveries={e.item.deliveries ?? []} article={e.item.body} when={e.when} /></div>
									{:else}
										<p class="plain">{e.item.title}</p>
									{/if}
								</article>
							{/each}
						</div>
					{/each}
				{/each}
			</div>
		</div>
	{/if}
</main>

<style>
	main {
		padding: 0.9rem clamp(0.8rem, 2vw, 1.5rem) 0;
	}

	.lede {
		color: var(--ink-soft);
	}

	.lede a,
	.bad {
		color: var(--terracotta);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.7rem;
	}

	.bar button {
		min-width: 2.2rem;
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.bar .today {
		font-weight: 600;
	}

	.count {
		margin-left: 0.6rem;
		font-size: 0.82rem;
		color: var(--muted);
	}

	/* the timeline scrolls on its own, both ways, filling the window down to the nav pill */
	.scroller {
		height: calc(100vh - 11.5rem);
		height: calc(100dvh - 11.5rem);
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--paper);
		overscroll-behavior-x: contain;
	}

	.timeline {
		display: grid;
		width: max-content;
		min-width: 100%;
	}

	/* the days along the top, and the platforms down the side, stay in view */
	.corner,
	.dayhead {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--paper);
		border-bottom: 1px solid var(--line);
	}

	.corner {
		left: 0;
		z-index: 4;
	}

	.dayhead {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: flex-end;
		min-height: 3.6rem;
		padding: 0.4rem 0.5rem;
		border-left: 1px solid rgb(220 213 196 / 0.5);
		line-height: 1.1;
	}

	.dayhead .month {
		margin-bottom: 0.15rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--terracotta);
		white-space: nowrap;
	}

	.wd {
		font-size: 0.66rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.dayhead b {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 500;
		color: var(--muted);
	}

	.dayhead.busy b {
		color: var(--ink);
	}

	.dayhead.now {
		background: #f6ecd6;
	}

	.dayhead.now b {
		color: var(--terracotta);
	}

	.monday {
		border-left: 1px solid var(--line) !important;
	}

	.lanehead {
		position: sticky;
		left: 0;
		z-index: 3;
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		padding: 0.8rem 0.7rem;
		border-right: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		background: var(--paper);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--ink);
	}

	.cell {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		min-height: 6rem;
		padding: 0.6rem 0.5rem;
		border-left: 1px solid rgb(220 213 196 / 0.5);
		border-bottom: 1px solid var(--line);
	}

	.cell.now {
		background: rgb(239 181 77 / 0.08);
	}

	.cell.over {
		background: rgb(239 181 77 / 0.2);
	}

	.slot {
		width: 17rem;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
	}

	.slot.tentative {
		border-style: dashed;
	}

	.slot.out {
		opacity: 0.7;
	}

	.head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.1rem 0.45rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: #f7f4ec;
		color: var(--ink);
		font: inherit;
		font-size: 0.8rem;
		text-align: left;
		cursor: grab;
	}

	.head b {
		font-variant-numeric: tabular-nums;
	}

	.head small {
		flex-basis: 100%;
		font-size: 0.72rem;
		color: var(--muted);
	}

	/* the platform's own preview, a little smaller than on the board, and never taller than a card: the long ones (the
	   journal's article, a thread) fade out — the board shows them whole */
	.preview {
		zoom: 0.7;
		max-height: 32rem;
		padding: 0.5rem;
		overflow: hidden;
		mask-image: linear-gradient(to bottom, #000 82%, transparent);
	}

	.plain {
		margin: 0;
		padding: 0.7rem;
		font-size: 0.85rem;
	}
</style>
