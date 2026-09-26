<!--
	The publishing calendar: everything we put out, from the first idea to the day it goes live.

	Ideas without a date wait in the backlog on the left; drag one onto a day to schedule it, drag a scheduled item
	to another day to move it. Click anything to open it: its kind and channels, where it stands, when it goes out,
	its text or script, and the library files it carries. Filter by kind, channel or status; switch to the list for
	everything coming up in order.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import {
		API,
		createContent,
		deleteContent,
		listContent,
		listMedia,
		may,
		me,
		saveContent,
		type ContentItem,
		type MediaItem
	} from '$lib/auth/client';
	import AdminNav from '$lib/admin/AdminNav.svelte';

	const KIND: Record<string, { label: string; color: string }> = {
		film: { label: 'Film', color: '#c8744f' },
		reel: { label: 'Reel / short', color: '#d99a2b' },
		post: { label: 'Post', color: '#6f9a7c' },
		thread: { label: 'Thread', color: '#5b7fa8' },
		article: { label: 'Article', color: '#26382c' },
		newsletter: { label: 'Newsletter', color: '#8a6fb0' },
		story: { label: 'Story', color: '#c46b8e' },
		podcast: { label: 'Podcast', color: '#7a8a3c' }
	};
	const CHANNEL: Record<string, string> = {
		youtube: 'YouTube',
		instagram: 'Instagram',
		tiktok: 'TikTok',
		x: 'X',
		linkedin: 'LinkedIn',
		journal: 'Journal',
		newsletter: 'Newsletter'
	};
	const SHORT: Record<string, string> = { youtube: 'YT', instagram: 'IG', tiktok: 'TT', x: 'X', linkedin: 'in', journal: 'J', newsletter: 'NL' };
	const STATUS = ['idea', 'draft', 'ready', 'scheduled', 'published'] as const;
	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	let phase = $state<'loading' | 'signed-out' | 'forbidden' | 'ready'>('loading');
	let error = $state('');
	let items = $state<ContentItem[]>([]);
	let library = $state<MediaItem[]>([]);
	let view = $state<'month' | 'list'>('month');
	let month = $state(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
	let kinds = $state<string[]>([]);
	let channels = $state<string[]>([]);
	let open = $state<ContentItem | null>(null);
	let draft = $state<ContentItem | null>(null);
	let quick = $state('');
	let pick = $state('');

	const byCid = $derived(new Map(library.map((m) => [m.cid, m])));
	const visible = (i: ContentItem) =>
		(!kinds.length || kinds.includes(i.kind)) && (!channels.length || i.channels.some((c) => channels.includes(c)));
	const backlog = $derived(items.filter((i) => !i.scheduled_at && visible(i)));
	const dated = $derived(items.filter((i) => i.scheduled_at && visible(i)).sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!)));

	// the month's grid, Monday first, from the week the 1st falls in to the week the last day falls in
	const grid = $derived.by(() => {
		const first = new Date(month);
		const start = new Date(first);
		start.setDate(1 - ((first.getDay() + 6) % 7));
		const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
		const cells: Date[] = [];
		for (let d = new Date(start); d <= last || cells.length % 7; d.setDate(d.getDate() + 1)) cells.push(new Date(d));
		return cells;
	});
	const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	const onDay = $derived.by(() => {
		const map = new Map<string, ContentItem[]>();
		for (const i of dated) {
			const k = key(new Date(i.scheduled_at!));
			map.set(k, [...(map.get(k) ?? []), i]);
		}
		return map;
	});
	const today = key(new Date());
	const monthLabel = $derived(month.toLocaleDateString([], { month: 'long', year: 'numeric' }));
	const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

	onMount(async () => {
		try {
			const founder = await me();
			if (!may(founder, 'content:admin')) return void (phase = 'forbidden');
		} catch {
			return void (phase = 'signed-out');
		}
		try {
			[items, library] = await Promise.all([listContent().then((r) => r.items), listMedia().then((r) => r.media).catch(() => [])]);
		} catch (e) {
			error = (e as Error).message;
		}
		phase = 'ready';
	});

	const replace = (i: ContentItem) => (items = [...items.filter((x) => x.id !== i.id), i]);

	async function run(action: () => Promise<unknown>) {
		error = '';
		try {
			await action();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function add(title: string, extra: Partial<ContentItem> = {}) {
		if (!title.trim()) return;
		await run(async () => {
			const made = await createContent({ title: title.trim(), kind: 'post', ...extra });
			replace(made);
			edit(made);
		});
	}

	function edit(i: ContentItem) {
		open = i;
		draft = structuredClone($state.snapshot(i)) as ContentItem;
		pick = '';
	}

	async function save() {
		if (!draft || !open) return;
		const d = draft;
		await run(async () => {
			const saved = await saveContent(d.id, { ...d, status: d.scheduled_at && d.status === 'idea' ? 'scheduled' : d.status });
			replace(saved);
			open = null;
			draft = null;
		});
	}

	async function remove() {
		if (!open || !confirm(`Delete “${open.title}”?`)) return;
		const id = open.id;
		await run(async () => {
			await deleteContent(id);
			items = items.filter((x) => x.id !== id);
			open = null;
			draft = null;
		});
	}

	// ── drag to schedule or move: the time of day stays, a backlog item goes out at 18:00 ──
	function dragStart(e: DragEvent, i: ContentItem) {
		e.dataTransfer?.setData('text/x-item', i.id);
	}
	async function dropOn(e: DragEvent, day: Date | null) {
		e.preventDefault();
		const id = e.dataTransfer?.getData('text/x-item');
		const i = items.find((x) => x.id === id);
		if (!i) return;
		let when: string | null = null;
		if (day) {
			const t = i.scheduled_at ? new Date(i.scheduled_at) : new Date(0, 0, 0, 18, 0);
			when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), t.getHours(), t.getMinutes()).toISOString();
		}
		const status = when ? (i.status === 'idea' || i.status === 'draft' ? 'scheduled' : i.status) : i.status === 'scheduled' ? 'ready' : i.status;
		replace({ ...i, scheduled_at: when, status }); // at once, then confirmed by the server
		await run(async () => replace(await saveContent(i.id, { scheduled_at: when, status })));
	}

	const shift = (n: number) => (month = new Date(month.getFullYear(), month.getMonth() + n, 1));
	const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

	// the date-time field wants local time without a zone
	const localInput = (iso: string | null) => {
		if (!iso) return '';
		const d = new Date(iso);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
	};

	const matches = $derived(
		pick.trim().length < 2
			? []
			: library
					.filter((m) => m.paths.some((p) => p.toLowerCase().includes(pick.toLowerCase())) || String(m.meta?.title ?? '').toLowerCase().includes(pick.toLowerCase()) || m.tags.some((t) => t.toLowerCase() === pick.toLowerCase()))
					.slice(0, 8)
	);
	const fileName = (cid: string) => {
		const m = byCid.get(cid);
		return String(m?.meta?.title ?? m?.paths[0]?.split('/').pop() ?? cid.slice(0, 12));
	};
	const thumb = (m: MediaItem | undefined) => (m?.cdn_path ? `https://maia.city/${m.cdn_path}` : m ? `${API}/api/media/${m.cid}` : '');
</script>

<svelte:head>
	<title>Calendar · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	<AdminNav />
	<h1>Calendar</h1>

	{#if phase === 'loading'}
		<p class="lede">One moment…</p>
	{:else if phase === 'signed-out'}
		<p class="lede">The calendar belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
	{:else if phase === 'forbidden'}
		<p class="lede">The calendar belongs to the admin, and your account is not one.</p>
	{:else}
		{#if error}<p class="bad">{error}</p>{/if}

		<div class="bar">
			<div class="views">
				<button class:on={view === 'month'} onclick={() => (view = 'month')}>Month</button>
				<button class:on={view === 'list'} onclick={() => (view = 'list')}>List</button>
			</div>
			{#if view === 'month'}
				<div class="nav">
					<button onclick={() => shift(-1)} aria-label="Previous month">‹</button>
					<strong>{monthLabel}</strong>
					<button onclick={() => shift(1)} aria-label="Next month">›</button>
					<button class="today" onclick={() => (month = new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
				</div>
			{/if}
			<div class="filters">
				{#each Object.entries(KIND) as [k, v] (k)}
					<button class="chip" class:on={kinds.includes(k)} style:--c={v.color} onclick={() => (kinds = toggle(kinds, k))}>{v.label}</button>
				{/each}
				<span class="sep"></span>
				{#each Object.entries(CHANNEL) as [c, label] (c)}
					<button class="chip ch" class:on={channels.includes(c)} onclick={() => (channels = toggle(channels, c))}>{label}</button>
				{/each}
			</div>
		</div>

		<div class="layout">
			<!-- the backlog: ideas without a date -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<aside class="backlog" ondragover={(e) => e.preventDefault()} ondrop={(e) => dropOn(e, null)}>
				<h2>Backlog <span>{backlog.length}</span></h2>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void add(quick).then(() => (quick = ''));
					}}
				>
					<input bind:value={quick} placeholder="A new idea…" aria-label="New idea" />
				</form>
				{#each backlog as i (i.id)}
					<button class="card" draggable="true" ondragstart={(e) => dragStart(e, i)} onclick={() => edit(i)} style:--c={KIND[i.kind]?.color}>
						<span class="t">{i.title}</span>
						<span class="m">{KIND[i.kind]?.label} · {i.status}{i.channels.length ? ` · ${i.channels.map((c) => SHORT[c]).join(' ')}` : ''}</span>
					</button>
				{:else}
					<p class="empty">Nothing waiting. Ideas go here until they get a date.</p>
				{/each}
			</aside>

			{#if view === 'month'}
				<section class="month">
					{#each DAYS as d (d)}<div class="dow">{d}</div>{/each}
					{#each grid as day (key(day))}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="day"
							class:out={day.getMonth() !== month.getMonth()}
							class:now={key(day) === today}
							ondragover={(e) => e.preventDefault()}
							ondrop={(e) => dropOn(e, day)}
							ondblclick={() => add('New post', { scheduled_at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0).toISOString() })}
						>
							<span class="n">{day.getDate()}</span>
							{#each onDay.get(key(day)) ?? [] as i (i.id)}
								<button
									class="chip-item s-{i.status}"
									draggable="true"
									ondragstart={(e) => dragStart(e, i)}
									onclick={() => edit(i)}
									style:--c={KIND[i.kind]?.color}
									title={i.title}
								>
									<b>{timeOf(i.scheduled_at!)}</b> {i.title}
									{#if i.channels.length}<em>{i.channels.map((c) => SHORT[c]).join(' ')}</em>{/if}
								</button>
							{/each}
						</div>
					{/each}
				</section>
			{:else}
				<section class="list">
					{#each dated as i (i.id)}
						<button class="row" onclick={() => edit(i)} style:--c={KIND[i.kind]?.color}>
							<span class="when">{new Date(i.scheduled_at!).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · {timeOf(i.scheduled_at!)}</span>
							<span class="t">{i.title}</span>
							<span class="m">{KIND[i.kind]?.label} · {i.channels.map((c) => CHANNEL[c]).join(', ') || 'no channel yet'}</span>
							<span class="st s-{i.status}">{i.status}</span>
						</button>
					{:else}
						<p class="empty">Nothing scheduled yet. Drag an idea onto a day in the month view.</p>
					{/each}
				</section>
			{/if}
		</div>
	{/if}
</main>

{#if open && draft}
	<div class="drawer" role="dialog" aria-modal="true" aria-label="Edit">
		<button class="scrim" aria-label="Close" onclick={() => ((open = null), (draft = null))}></button>
		<div class="panel">
			<input class="title" bind:value={draft.title} aria-label="Title" />
			<div class="kinds">
				{#each Object.entries(KIND) as [k, v] (k)}
					<button class="chip" class:on={draft.kind === k} style:--c={v.color} onclick={() => (draft!.kind = k)}>{v.label}</button>
				{/each}
			</div>
			<span class="lbl">Channels</span>
			<div class="kinds">
				{#each Object.entries(CHANNEL) as [c, label] (c)}
					<button class="chip ch" class:on={draft.channels.includes(c)} onclick={() => (draft!.channels = toggle(draft!.channels, c))}>{label}</button>
				{/each}
			</div>
			<div class="two">
				<label>Status
					<select bind:value={draft.status}>
						{#each STATUS as s (s)}<option value={s}>{s}</option>{/each}
					</select>
				</label>
				<label>Goes out
					<input type="datetime-local" value={localInput(draft.scheduled_at)} onchange={(e) => (draft!.scheduled_at = e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : null)} />
				</label>
			</div>
			<label>Text, caption or script
				<textarea bind:value={draft.body} rows="8" placeholder="What goes out, word for word…"></textarea>
			</label>
			<span class="lbl">From the library</span>
			<div class="files">
				{#each draft.cids as cid (cid)}
					{@const m = byCid.get(cid)}
					<span class="file">
						{#if m?.kind === 'image'}<img src={thumb(m)} alt="" />{:else}<i>{m?.kind === 'video' ? '▶' : '♪'}</i>{/if}
						{fileName(cid)}
						<button aria-label="Remove" onclick={() => (draft!.cids = draft!.cids.filter((c) => c !== cid))}>×</button>
					</span>
				{/each}
			</div>
			<input bind:value={pick} placeholder="Find a file: name, path or tag (e.g. film, Day 19)" aria-label="Find a library file" />
			{#if matches.length}
				<ul class="picks">
					{#each matches as m (m.cid)}
						<li><button onclick={() => ((draft!.cids = [...new Set([...draft!.cids, m.cid])]), (pick = ''))}>{String(m.meta?.title ?? m.paths[0])} <span>{m.kind}</span></button></li>
					{/each}
				</ul>
			{/if}
			<div class="two">
				<label>Link <input bind:value={draft.link} placeholder="Where it lives, once published" /></label>
				<label>Tags <input value={draft.tags.join(', ')} onchange={(e) => (draft!.tags = e.currentTarget.value.split(',').map((t) => t.trim()).filter(Boolean))} /></label>
			</div>
			<div class="actions">
				<button class="del" onclick={remove}>Delete</button>
				<span class="grow"></span>
				<button class="quiet" onclick={() => ((open = null), (draft = null))}>Cancel</button>
				<button class="pill-btn" onclick={save}>Save</button>
			</div>
		</div>
	</div>
{/if}

<style>
	main {
		padding-block: 2.5rem 5rem;
	}

	h1 {
		margin: 0.5rem 0 1.2rem;
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1.05;
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

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.8rem 1.2rem;
		margin-bottom: 1rem;
	}

	.views,
	.nav {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.views button,
	.nav button {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		font: inherit;
		font-size: 0.85rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.views button.on {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--paper);
	}

	.nav strong {
		min-width: 9.5rem;
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 500;
		text-align: center;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.sep {
		width: 0.6rem;
	}

	.chip {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--line);
		border-left: 3px solid var(--c, var(--line));
		border-radius: 999px;
		background: var(--paper);
		font: inherit;
		font-size: 0.75rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.chip.ch {
		border-left-width: 1px;
	}

	.chip.on {
		border-color: var(--c, var(--ink));
		background: var(--c, var(--ink));
		color: #fff;
	}

	.layout {
		display: grid;
		grid-template-columns: 15rem 1fr;
		gap: 1rem;
		align-items: start;
	}

	.backlog {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 20rem;
		padding: 0.9rem;
		border-radius: 14px;
		background: var(--paper);
	}

	.backlog h2 {
		margin: 0;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.backlog h2 span {
		color: var(--terracotta);
	}

	.backlog input,
	.panel input,
	.panel select,
	.panel textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--cream);
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--line);
		border-left: 4px solid var(--c);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: grab;
	}

	.card .t {
		font-size: 0.85rem;
		font-weight: 500;
	}

	.card .m,
	.empty {
		font-size: 0.72rem;
		color: var(--muted);
	}

	.month {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 1px;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--line);
	}

	.dow {
		padding: 0.4rem 0.6rem;
		background: var(--paper);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.day {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-height: 7.2rem;
		padding: 0.35rem;
		background: #fff;
	}

	.day.out {
		background: var(--paper);
	}

	.day.out .n {
		color: #c2bba9;
	}

	.day.now {
		box-shadow: inset 0 0 0 2px var(--mustard);
	}

	.n {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--ink-soft);
	}

	.chip-item {
		overflow: hidden;
		padding: 0.2rem 0.4rem;
		border: 0;
		border-left: 3px solid var(--c);
		border-radius: 5px;
		background: color-mix(in srgb, var(--c) 14%, #fff);
		font: inherit;
		font-size: 0.72rem;
		line-height: 1.3;
		text-align: left;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink);
		cursor: grab;
	}

	.chip-item b {
		font-weight: 600;
	}

	.chip-item em {
		margin-left: 0.25rem;
		font-style: normal;
		color: var(--muted);
	}

	.chip-item.s-published {
		opacity: 0.55;
		text-decoration: line-through;
	}

	.chip-item.s-draft,
	.chip-item.s-idea {
		background: repeating-linear-gradient(135deg, #fff 0 6px, color-mix(in srgb, var(--c) 10%, #fff) 6px 12px);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.row {
		display: grid;
		grid-template-columns: 11rem 1fr auto;
		grid-template-areas: 'when t st' 'when m st';
		align-items: center;
		gap: 0.1rem 1rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--line);
		border-left: 4px solid var(--c);
		border-radius: 10px;
		background: #fff;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.row .when {
		grid-area: when;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}

	.row .t {
		grid-area: t;
		font-weight: 500;
	}

	.row .m {
		grid-area: m;
		font-size: 0.75rem;
		color: var(--muted);
	}

	.st {
		grid-area: st;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		background: var(--paper);
		font-size: 0.72rem;
		color: var(--ink-soft);
	}

	.st.s-published {
		background: #dcebe1;
	}

	.st.s-scheduled {
		background: #f3e3c1;
	}

	/* the editor */
	.drawer {
		position: fixed;
		inset: 0;
		z-index: 60;
	}

	.scrim {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(20 28 22 / 0.35);
	}

	.panel {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: min(34rem, 100%);
		padding: 1.4rem;
		overflow: auto;
		background: var(--paper);
		box-shadow: -10px 0 40px rgb(38 56 44 / 0.18);
	}

	.panel .title {
		font-family: var(--font-display);
		font-size: 1.45rem;
		background: transparent;
		border-color: transparent;
	}

	.panel .title:focus {
		border-color: var(--line);
		background: #fff;
	}

	.panel .lbl {
		font-size: 0.75rem;
		color: var(--muted);
	}

	.panel label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--muted);
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}

	.files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.file {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.3rem 0.2rem 0.2rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		font-size: 0.75rem;
	}

	.file img {
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 4px;
		object-fit: cover;
	}

	.file i {
		width: 1.8rem;
		text-align: center;
		font-style: normal;
		color: var(--muted);
	}

	.file button {
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}

	.picks {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
	}

	.picks button {
		display: flex;
		justify-content: space-between;
		width: 100%;
		padding: 0.45rem 0.7rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.82rem;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.picks button:hover {
		background: var(--cream);
	}

	.picks span {
		color: var(--muted);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}

	.grow {
		flex: 1;
	}

	.del,
	.quiet {
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.del {
		color: #9c3b26;
	}

	.quiet {
		color: var(--ink-soft);
	}

	button.pill-btn {
		border: 0;
		cursor: pointer;
		font-family: inherit;
	}

	@media (max-width: 860px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.day {
			min-height: 4.5rem;
		}

		.chip-item em,
		.chip-item b {
			display: none;
		}

		.two {
			grid-template-columns: 1fr;
		}
	}
</style>
