<!--
	The media library: every image, sound and video the city has, as it is kept in Postgres — by its CID.

	One flat pool of files. A path is only a name a file goes by, never a folder; all grouping is by tags, and a file
	sits in as many pools as it has tags. On the left: the type, and the days, newest first. In the middle: the files
	— a chosen day colocated by scene in film order, then shot, then take; everything else by what it is for. On the
	right: the facets of what is on screen (OR within a facet, AND across them), or, with a file open, all about it.
	The whole view lives in the address (?day=19&scene=the%20dip&role=shot), so it can be linked.

	A prerendered shell like every other page; the API decides who may look (media:admin), and serves the originals
	straight from the database. The public copies live on Bunny; the details say whether a file has one.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { listMedia, may, me, type MediaItem } from '$lib/auth/client';
	import Tile from '$lib/admin/media/Tile.svelte';
	import Viewer from '$lib/admin/media/Viewer.svelte';
	import Details from '$lib/admin/media/Details.svelte';
	import {
		byDay,
		byScene,
		dayTag,
		FACET_LABEL,
		facetOrder,
		parse,
		size,
		valueOrder,
		type Parsed
	} from '$lib/admin/media/facets';

	type Kind = 'all' | 'image' | 'video' | 'audio';
	type Measure = { w?: number; h?: number; d?: number };

	let phase = $state<'loading' | 'signed-out' | 'forbidden' | 'ready'>('loading');
	let media = $state<MediaItem[]>([]);
	let error = $state('');

	// the view — every piece of it mirrored in the address
	let kind = $state<Kind>('all');
	/** a day's number ("19"), "none" for the files of no day, or null for every day */
	let day = $state<string | null>(null);
	/** facet → the values chosen in it */
	let chosen = $state<Record<string, string[]>>({});
	let showOld = $state(false);
	let unusedOnly = $state(false);
	let q = $state('');
	let openCid = $state<string | null>(null);

	/** what the viewer learnt about a file while showing it: its frame and its length */
	let measures = $state<Record<string, Measure>>({});

	const KINDS = [
		['all', 'All'],
		['image', 'Images'],
		['video', 'Video'],
		['audio', 'Sound']
	] as const;
	const RESERVED = ['type', 'day', 'q', 'superseded', 'unused', 'open'];
	const LONG = 14;

	// ── the pools ───────────────────────────────────────────────────────────
	const parsed = $derived(new Map(media.map((m) => [m.cid, parse(m)])));
	const P = (m: MediaItem): Parsed => parsed.get(m.cid)!;

	// the search reads everything a file says about itself: its title, description and words, its tags, its CID
	const found = (m: MediaItem, f: string) =>
		!f ||
		m.cid.toLowerCase().includes(f) ||
		m.title.toLowerCase().includes(f) ||
		m.description.toLowerCase().includes(f) ||
		m.tags.some((t) => t.toLowerCase().includes(f)) ||
		String(m.meta?.title ?? '').toLowerCase().includes(f) ||
		String(m.meta?.text ?? '').toLowerCase().includes(f);

	// superseded files stay out unless asked for; "unused only" keeps just what nothing names
	const pool = $derived.by(() => {
		const f = q.trim().toLowerCase();
		return media.filter((m) => (showOld || !P(m).superseded) && (!unusedOnly || P(m).unused) && found(m, f));
	});
	const ofKind = (m: MediaItem, k: Kind = kind) => k === 'all' || m.kind === k;
	const ofDay = (m: MediaItem, d: string | null = day) =>
		d === null || (d === 'none' ? P(m).days.length === 0 : P(m).days.includes(Number(d)));
	const holds = (m: MediaItem, k: string, vs: string[]) => !vs.length || (P(m).facets.get(k) ?? []).some((v) => vs.includes(v));
	/** passes every chosen facet — but one, when counting that one's own chips */
	const passes = (m: MediaItem, except?: string) => Object.entries(chosen).every(([k, vs]) => k === except || holds(m, k, vs));

	/** the current selection, before the facets narrow it */
	const selection = $derived(pool.filter((m) => ofKind(m) && ofDay(m)));
	const shown = $derived(selection.filter((m) => passes(m)));

	// the left: the types counted within the day, the days within the type
	const kindCount = (k: Kind) => pool.filter((m) => ofKind(m, k) && ofDay(m)).length;
	const days = $derived.by(() => {
		const counts = new Map<number, number>();
		let none = 0;
		for (const m of pool) {
			if (!ofKind(m)) continue;
			const d = P(m).days;
			if (!d.length) none++;
			for (const n of d) counts.set(n, (counts.get(n) ?? 0) + 1);
		}
		return { list: [...counts.entries()].sort(([a], [b]) => b - a), none };
	});

	// the right: every facet the selection holds, each chip counted as if the others still applied
	const panel = $derived.by(() => {
		const keys = new Set<string>(Object.keys(chosen));
		for (const m of selection) for (const k of P(m).facets.keys()) keys.add(k);
		return [...keys]
			.sort(facetOrder)
			.map((k) => {
				const counts = new Map<string, number>();
				for (const m of selection)
					if (passes(m, k)) for (const v of new Set(P(m).facets.get(k) ?? [])) counts.set(v, (counts.get(v) ?? 0) + 1);
				for (const v of chosen[k] ?? []) if (!counts.has(v)) counts.set(v, 0);
				return { key: k, values: [...counts.entries()].sort(([a], [b]) => valueOrder(k)(a, b)) };
			})
			.filter((g) => g.values.length);
	});
	const narrowed = $derived(Object.values(chosen).some((vs) => vs.length));
	let wide = $state<string[]>([]);

	function toggle(k: string, v: string) {
		const vs = chosen[k] ?? [];
		const next = vs.includes(v) ? vs.filter((x) => x !== v) : [...vs, v];
		const { [k]: _, ...rest } = chosen;
		chosen = next.length ? { ...rest, [k]: next } : rest;
	}

	// ── the grid ────────────────────────────────────────────────────────────
	// a day colocates by scene; every day at once groups by day
	const sections = $derived(day !== null ? byScene(shown, P) : byDay(shown, P));
	/** the files in the order they stand on screen, each once: what ← and → step through */
	const order = $derived.by(() => {
		const seen = new Set<string>();
		const out: MediaItem[] = [];
		for (const s of sections)
			for (const b of s.blocks)
				for (const m of b.items)
					if (!seen.has(m.cid)) {
						seen.add(m.cid);
						out.push(m);
					}
		return out;
	});
	const opened = $derived(openCid ? (media.find((m) => m.cid === openCid) ?? null) : null);
	const at = $derived(opened ? order.findIndex((m) => m.cid === opened.cid) : -1);

	const heading = $derived(day === null ? 'Every day' : day === 'none' ? 'No day' : dayTag(Number(day)));

	// the columns fill the window below the page's head, and only they scroll: where they start is measured
	let cols = $state<HTMLElement | null>(null);
	let top = $state(0);
	const measureTop = () => cols && (top = Math.round(cols.getBoundingClientRect().top + window.scrollY));
	$effect(() => {
		if (!cols) return;
		error;
		measureTop();
		const ro = new ResizeObserver(measureTop);
		ro.observe(document.body);
		return () => ro.disconnect();
	});

	function open(m: MediaItem) {
		openCid = m.cid;
	}
	function step(by: number) {
		const next = order[at < 0 ? 0 : at + by];
		if (next) openCid = next.cid;
	}
	// back to the grid, where the last file seen stands
	async function back() {
		const cid = openCid;
		openCid = null;
		await tick();
		document.querySelector(`[data-cid="${cid}"]`)?.scrollIntoView({ block: 'nearest' });
	}
	/** a chip in the details: the grid, narrowed to that one value */
	function filterBy(k: string, v: string) {
		if (k === 'day') day = v;
		else chosen = { ...chosen, [k]: [v] };
		back();
	}
	function clearAll() {
		chosen = {};
	}

	const onKey = (e: KeyboardEvent) => {
		if (!openCid || e.metaKey || e.ctrlKey || e.altKey) return;
		const el = e.target as HTMLElement | null;
		if (el?.closest?.('input, textarea, select')) return;
		if (e.key === 'Escape') back();
		// a focused player keeps its own arrows (seeking)
		else if (el?.closest?.('video, audio')) return;
		else if (e.key === 'ArrowRight') (e.preventDefault(), step(1));
		else if (e.key === 'ArrowLeft') (e.preventDefault(), step(-1));
	};

	// ── the address ─────────────────────────────────────────────────────────
	function readAddress() {
		const s = new URLSearchParams(location.search);
		const t = s.get('type');
		if (t === 'image' || t === 'video' || t === 'audio') kind = t;
		const d = s.get('day');
		if (d && (d === 'none' || /^\d+$/.test(d))) day = d === 'none' ? d : String(Number(d));
		q = s.get('q') ?? '';
		showOld = s.get('superseded') === '1';
		unusedOnly = s.get('unused') === '1';
		openCid = s.get('open');
		const c: Record<string, string[]> = {};
		for (const [k, v] of s) if (!RESERVED.includes(k) && v) c[k] = [...new Set([...(c[k] ?? []), v])];
		chosen = c;
	}

	$effect(() => {
		if (phase !== 'ready') return;
		const s = new URLSearchParams();
		if (kind !== 'all') s.set('type', kind);
		if (day) s.set('day', day);
		for (const k of Object.keys(chosen).sort(facetOrder)) for (const v of chosen[k]!) s.append(k, v);
		if (q.trim()) s.set('q', q.trim());
		if (showOld) s.set('superseded', '1');
		if (unusedOnly) s.set('unused', '1');
		if (openCid) s.set('open', openCid);
		const next = s.toString().replaceAll('+', '%20');
		if (next === location.search.slice(1)) return;
		replaceState(next ? `?${next}` : `${base}/app/media/`, {});
	});

	onMount(async () => {
		try {
			const founder = await me();
			if (!may(founder, 'media:admin')) return void (phase = 'forbidden');
		} catch {
			return void (phase = 'signed-out');
		}
		try {
			media = (await listMedia()).media;
		} catch (e) {
			error = (e as Error).message;
		}
		readAddress();
		phase = 'ready';
	});
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
	<title>Media · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap library">

	{#if phase === 'loading'}
		<p class="lede">One moment…</p>
	{:else if phase === 'signed-out'}
		<p class="lede">The media library belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
	{:else if phase === 'forbidden'}
		<p class="lede">The media library belongs to the admin, and your account is not one.</p>
	{:else}
		{#if error}<p class="note bad">{error}</p>{/if}

		<div class="cols" bind:this={cols} style:--top="{top}px">
			<!-- the left: the type, then the days -->
			<aside class="left" aria-label="Type and day">
				<div class="kinds" role="tablist" aria-label="Type">
					{#each KINDS as [k, label] (k)}
						<button role="tab" aria-selected={kind === k} class:on={kind === k} onclick={() => (kind = k)}>
							<span>{label}</span> <span class="n">{kindCount(k)}</span>
						</button>
					{/each}
				</div>

				<h3>Days</h3>
				<ul class="days">
					<li>
						<button class:on={day === null} aria-pressed={day === null} onclick={() => (day = null)}>
							<span>Every day</span>
						</button>
					</li>
					{#each days.list as [n, count] (n)}
						<li>
							<button class:on={day === String(n)} aria-pressed={day === String(n)} onclick={() => (day = String(n))}>
								<span>{dayTag(n)}</span> <span class="n">{count}</span>
							</button>
						</li>
					{/each}
					{#if days.none}
						<li>
							<button class:on={day === 'none'} aria-pressed={day === 'none'} onclick={() => (day = 'none')}>
								<span>No day</span> <span class="n">{days.none}</span>
							</button>
						</li>
					{/if}
				</ul>

				<div class="toggles">
					<label><input type="checkbox" bind:checked={showOld} /> Show superseded</label>
					<label><input type="checkbox" bind:checked={unusedOnly} /> Unused only</label>
				</div>
			</aside>

			<!-- the middle: the files, or the one open -->
			<section class="centre" aria-label="Files">
				{#if opened}
					<div class="stage-wrap">
						<Viewer
							m={opened}
							p={P(opened)}
							index={at}
							total={order.length}
							onprev={() => step(-1)}
							onnext={() => step(1)}
							onback={back}
							onmeasure={(cid, got) => (measures[cid] = { ...measures[cid], ...got })}
						/>
					</div>
				{:else}
					<div class="head">
						<h2>{heading} <span>{shown.length} {kind === 'all' ? 'files' : KINDS.find(([k]) => k === kind)?.[1].toLowerCase()}</span></h2>
						<input type="search" bind:value={q} placeholder="Find by title, words, tag, name or CID" aria-label="Find" />
					</div>

					{#if shown.length === 0}
						<p class="empty">{media.length ? 'Nothing matches.' : 'The library is empty. Seed it from library/: bun media seed --local.'}</p>
					{/if}

					{#each sections as s (s.key)}
						<section class="group">
							<h3 class="section">{s.title} <span>{s.count}</span></h3>
							{#each s.blocks as b (b.key)}
								{#if b.label}<h4 class="block">{b.label}</h4>{/if}
								<ul class="grid">
									{#each b.items as m (m.cid)}
										<li data-cid={m.cid}><Tile {m} p={P(m)} onopen={() => open(m)} /></li>
									{/each}
								</ul>
							{/each}
						</section>
					{/each}
				{/if}
			</section>

			<!-- the right: the facets of what is on screen, or everything about the open file -->
			<aside class="right" aria-label={opened ? 'Details' : 'Filters'}>
				{#if opened}
					<Details m={opened} p={P(opened)} measure={measures[opened.cid]} onfilter={filterBy} />
				{:else}
					<div class="filters-head">
						<h3>Narrow down</h3>
						{#if narrowed}<button class="quiet" onclick={clearAll}>Clear</button>{/if}
					</div>
					{#each panel as g (g.key)}
						{@const long = g.values.length > LONG && !wide.includes(g.key)}
						<div class="facet">
							<h4>{FACET_LABEL[g.key] ?? g.key}</h4>
							<div class="chips">
								{#each long ? g.values.slice(0, LONG) : g.values as [v, n] (v)}
									{@const on = chosen[g.key]?.includes(v) ?? false}
									<button class="tag" class:on class:none={!n && !on} aria-pressed={on} onclick={() => toggle(g.key, v)}>
										{v} <span>{n}</span>
									</button>
								{/each}
								{#if g.values.length > LONG}
									<button class="quiet more" onclick={() => (wide = long ? [...wide, g.key] : wide.filter((k) => k !== g.key))}>
										{long ? `all ${g.values.length}` : 'fewer'}
									</button>
								{/if}
							</div>
						</div>
					{:else}
						<p class="empty small">No tags to narrow by here.</p>
					{/each}
				{/if}
			</aside>
		</div>
	{/if}
</main>

<style>
	/* the library wants the whole window, like the studio */
	main.library {
		max-width: none;
		padding-block: 2.5rem 1rem;
	}


	.lede {
		margin: 0 0 1.5rem;
		color: var(--ink-soft);
	}

	.lede a {
		color: var(--terracotta);
	}

	/* the three columns fill the window from where they start (--top, measured) to its foot; each scrolls on its own,
	   the page does not. vh first, for the browsers without dvh (Safari's toolbar is what dvh leaves out) */
	.cols {
		display: grid;
		grid-template-columns: 13.5rem minmax(0, 1fr) 19rem;
		grid-template-rows: minmax(0, 1fr);
		gap: 1.75rem;
		height: calc(100vh - var(--top, 0px) - 6rem);
		height: calc(100dvh - var(--top, 0px) - 6rem);
		min-height: 24rem;
	}

	.cols > * {
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
	}

	aside {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding-bottom: 1.5rem;
	}

	/* a column scrolls; its parts never squeeze to fit it */
	aside > * {
		flex-shrink: 0;
	}

	aside h3,
	.facet h4 {
		margin: 0.6rem 0 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	/* the type, as the tabs it always was, stacked */
	.kinds {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.kinds button,
	.days button {
		display: flex;
		justify-content: space-between;
		width: 100%;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		font: inherit;
		font-size: 0.86rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.n {
		color: var(--muted);
	}

	.kinds button.on {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--paper);
	}

	.kinds button.on .n {
		color: var(--sage);
	}

	.days {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.days button {
		border-color: transparent;
		background: none;
		border-radius: 8px;
	}

	.days button:hover {
		background: var(--cream);
	}

	.days button.on {
		background: var(--mustard);
		color: var(--ink);
	}

	.days button.on .n {
		color: var(--ink-soft);
	}

	.toggles {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: auto;
		padding-top: 0.8rem;
		border-top: 1px solid var(--line);
		font-size: 0.84rem;
		color: var(--ink-soft);
	}

	.toggles label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
	}

	.toggles input {
		accent-color: var(--ink);
	}

	/* the middle */
	.centre {
		min-width: 0;
		padding: 0 0.25rem 2rem 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		margin-bottom: 1rem;
	}

	.head h2 {
		margin: 0;
		font-size: 1.5rem;
	}

	.head h2 span,
	.section span {
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--muted);
	}

	input[type='search'] {
		flex: 0 1 20rem;
		min-width: 0;
		padding: 0.55rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink);
	}

	.group + .group {
		margin-top: 2rem;
	}

	.section {
		margin: 0 0 0.7rem;
		padding-bottom: 0.35rem;
		border-bottom: 1px solid var(--line);
		font-size: 1.15rem;
		text-transform: none;
	}

	.section::first-letter {
		text-transform: uppercase;
	}

	.block {
		margin: 0.9rem 0 0.45rem;
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--ink-soft);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
		gap: 0.8rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* the open file takes the room the grid had, the whole column */
	.stage-wrap {
		height: 100%;
		min-height: 22rem;
	}

	.centre:has(.stage-wrap) {
		padding-bottom: 0;
	}

	/* the right */
	.filters-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.facet {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.tag {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		font: inherit;
		font-size: 0.76rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.tag span {
		color: var(--muted);
	}

	.tag.on {
		border-color: var(--mustard);
		background: var(--mustard);
		color: var(--ink);
	}

	.tag.on span {
		color: var(--ink-soft);
	}

	/* chosen, but nothing left under it */
	.tag.none {
		opacity: 0.5;
	}

	.quiet {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.82rem;
		color: var(--terracotta);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.more {
		font-size: 0.74rem;
	}

	.empty {
		color: var(--muted);
	}

	.empty.small {
		font-size: 0.84rem;
	}

	.note.bad {
		color: #9c3b26;
	}

	@media (max-width: 1100px) {
		.cols {
			grid-template-columns: 11.5rem minmax(0, 1fr) 15.5rem;
			gap: 1.1rem;
		}
	}

	/* a phone: one column after another, and the page scrolls again */
	@media (max-width: 760px) {
		.cols {
			grid-template-columns: 1fr;
			grid-template-rows: none;
			height: auto;
			min-height: 0;
		}

		.cols > * {
			overflow: visible;
		}

		.toggles {
			margin-top: 0.8rem;
		}

		.days {
			flex-direction: row;
			flex-wrap: wrap;
		}

		.days button {
			width: auto;
			gap: 0.4rem;
		}

		.grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.6rem;
		}

		.stage-wrap {
			height: 70vh;
		}
	}
</style>
