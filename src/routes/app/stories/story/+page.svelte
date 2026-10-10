<!--
	One story, on its own page: its steps as tabs along the bottom (as the studio's), the step it stands on marked —
	Idea (the brainstorm pad) · Hook (the hook, the intro, the description) · Thumbnail (the 16:9 card, in layers) · Journey (the arc, beat by beat) ·
	Writing (the long-form article) · Movie (the film, in the studio) · Derivatives (the posts) · Scheduled (when) ·
	Published (where). Every tab can be looked at and worked on whatever step the story stands on; it moves on (or back)
	with the buttons under its title, or on the Stories board. What is typed is saved a moment after the typing stops.
	The nav pill's Back leads to the Stories board.

	/app/stories/story/?id=<id>&tab=<step>
-->
<script>
	import { base } from '$app/paths';
	import { goto, replaceState } from '$app/navigation';
	import { onDestroy, onMount, tick } from 'svelte';
	import { STATUSES, deleteContent, listContent, may, me, saveContent } from '$lib/auth/client';
	import { movePatch, statusLabel, step } from '$lib/admin/board';
	import DerivativesTab from '$lib/stories/DerivativesTab.svelte';
	import HookTab from '$lib/stories/HookTab.svelte';
	import IdeaTab from '$lib/stories/IdeaTab.svelte';
	import JourneyTab from '$lib/stories/JourneyTab.svelte';
	import MovieTab from '$lib/stories/MovieTab.svelte';
	import PublishedTab from '$lib/stories/PublishedTab.svelte';
	import ScheduledTab from '$lib/stories/ScheduledTab.svelte';
	import ThumbnailTab from '$lib/stories/ThumbnailTab.svelte';
	import WritingTab from '$lib/stories/WritingTab.svelte';
	import { STAGE_NOTE, storyHref } from '$lib/stories/stories.js';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */
	/** @typedef {import('$lib/auth/client').Status} Status */

	/** the steps from Derivatives on: the article is locked, its posts derive from it */
	const LOCKED = ['derivatives', 'scheduled', 'published'];

	/** @type {'loading' | 'signed-out' | 'forbidden' | 'missing' | 'ready'} */
	let phase = $state('loading');
	let error = $state('');
	let item = $state(/** @type {ContentItem | null} */ (null));
	/** @type {readonly Status[]} */
	let statuses = $state(STATUSES);
	/** @type {Status} the tab on view */
	let tab = $state('idea');
	let id = '';
	let sure = $state(false);
	/** @type {HTMLElement | null} */
	let bar = $state(null);

	// ── saving: every change at once on the page, sent a moment after the typing stops ──
	/** @type {Partial<ContentItem>} */
	let pending = {};
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	/** @type {'saved' | 'waiting' | 'saving' | 'failed'} */
	let saving = $state('saved');

	const at = $derived(item ? statuses.indexOf(item.status) : 0);
	const prev = $derived(item ? step(item.status, -1, statuses) : null);
	const next = $derived(item ? step(item.status, 1, statuses) : null);

	onMount(async () => {
		const q = new URLSearchParams(location.search);
		id = q.get('id') ?? '';
		try {
			const founder = await me();
			if (!may(founder, 'content:admin')) return void (phase = 'forbidden');
		} catch {
			return void (phase = 'signed-out');
		}
		try {
			const got = await listContent();
			if (got.statuses?.length) statuses = got.statuses;
			item = got.items.find((i) => i.id === id) ?? null;
		} catch (e) {
			error = /** @type {Error} */ (e).message;
		}
		if (!item) return void (phase = error ? 'ready' : 'missing');
		const want = /** @type {Status} */ (q.get('tab'));
		tab = statuses.includes(want) ? want : item.status;
		phase = 'ready';
		await tick();
		showTab();
	});

	// the story may change elsewhere (pushed from the repo, a render delivered, the Mac app filing it): read again when
	// the window comes back, unless something typed here is still on its way
	onMount(() => {
		const again = () => phase === 'ready' && document.visibilityState === 'visible' && !Object.keys(pending).length && saving !== 'saving' && reload();
		const away = () => document.visibilityState === 'hidden' && flush();
		document.addEventListener('visibilitychange', again);
		document.addEventListener('visibilitychange', away);
		window.addEventListener('focus', again);
		window.addEventListener('pagehide', flush);
		return () => {
			document.removeEventListener('visibilitychange', again);
			document.removeEventListener('visibilitychange', away);
			window.removeEventListener('focus', again);
			window.removeEventListener('pagehide', flush);
		};
	});
	onDestroy(() => {
		if (typeof window !== 'undefined') void flush();
	});

	async function reload() {
		try {
			const got = (await listContent()).items.find((i) => i.id === id);
			if (got && !Object.keys(pending).length) item = got;
		} catch {
			// the next time
		}
	}

	/** @param {Partial<ContentItem>} patch */
	function edit(patch) {
		if (!item) return;
		item = { ...item, ...patch };
		pending = { ...pending, ...patch };
		saving = 'waiting';
		clearTimeout(timer);
		timer = setTimeout(flush, 800);
	}

	async function flush() {
		clearTimeout(timer);
		const patch = pending;
		if (!item || !Object.keys(patch).length) return;
		pending = {};
		// a beat or a title emptied while it is typed is sent as something the API takes
		const sent = { ...patch };
		if (sent.title !== undefined && !sent.title.trim()) delete sent.title;
		if (sent.journey) sent.journey = { ...sent.journey, beats: (sent.journey.beats ?? []).map((b) => ({ ...b, title: b.title.trim() || statusLabel(b.type) })) };
		saving = 'saving';
		error = '';
		try {
			const got = await saveContent(item.id, sent);
			// what was typed here stays as typed (the server's copy of those fields may be trimmed); the rest as it has it
			item = { ...got, ...patch, ...pending };
			saving = Object.keys(pending).length ? 'waiting' : 'saved';
		} catch (e) {
			error = /** @type {Error} */ (e).message;
			pending = { ...patch, ...pending };
			saving = 'failed';
		}
	}

	/** On to another step: what is typed first, then the step. @param {Status} status */
	async function moveTo(status) {
		if (!item) return;
		await flush();
		const patch = movePatch(item, status);
		error = '';
		try {
			item = await saveContent(item.id, patch);
			setTab(status);
		} catch (e) {
			error = /** @type {Error} */ (e).message;
		}
	}

	async function remove() {
		if (!item) return;
		clearTimeout(timer);
		pending = {};
		try {
			await deleteContent(item.id);
			await goto(`${base}/app/stories/`);
		} catch (e) {
			error = /** @type {Error} */ (e).message;
		}
	}

	/** @param {Status} t */
	function setTab(t) {
		tab = t;
		replaceState(storyHref(id, t), {});
		scrollTo({ top: 0 });
		void tick().then(showTab);
	}

	// the chosen tab in view in the bar, when the bar scrolls (a phone)
	const showTab = () => bar?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
</script>

<svelte:head>
	<title>{item?.title ?? 'Story'} · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap story">
	{#if phase === 'loading'}
		<p class="lede">One moment…</p>
	{:else if phase === 'signed-out'}
		<p class="lede">The stories belong to the admin. <a href="{base}/join/">Sign in</a> first.</p>
	{:else if phase === 'forbidden'}
		<p class="lede">The stories belong to the admin, and your account is not one.</p>
	{:else if phase === 'missing' || !item}
		<p class="lede">{error || 'There is no such story (any more).'} <a href="{base}/app/stories/">All the stories</a></p>
	{:else}
		<header class="head">
			<p class="eyebrow">
				<span class="stage">{statusLabel(item.status)}</span>
				<span class="of">step {at + 1} of {statuses.length}</span>
				<span class="state {saving}">{saving === 'saving' ? 'Saving…' : saving === 'waiting' ? 'Changed' : saving === 'failed' ? 'Not saved' : 'Saved'}</span>
			</p>
			<input class="title" value={item.title} maxlength="200" aria-label="The story's title" oninput={(e) => edit({ title: e.currentTarget.value })} />
			<div class="moves">
				{#if prev}<button class="back" onclick={() => moveTo(/** @type {Status} */ (prev))}>‹ Back to {statusLabel(prev)}</button>{/if}
				{#if next}<button class="on" onclick={() => moveTo(/** @type {Status} */ (next))}>On to {statusLabel(next)} ›</button>{/if}
				<span class="grow"></span>
				<button class="del" class:sure onclick={() => (sure ? remove() : (sure = true))} onblur={() => (sure = false)}>{sure ? 'Delete for good?' : 'Delete'}</button>
			</div>
			{#if error}<p class="bad">{error}</p>{/if}
		</header>

		<section class="pane" aria-label={statusLabel(tab)}>
			{#if tab !== 'thumbnail'}<p class="note">{STAGE_NOTE[tab] ?? ''}</p>{/if}
			{#if tab === 'idea'}
				<IdeaTab {item} onchange={edit} />
			{:else if tab === 'hook'}
				<HookTab {item} onchange={edit} />
			{:else if tab === 'journey'}
				<JourneyTab journey={item.journey ?? {}} onchange={(journey) => edit({ journey })} />
			{:else if tab === 'thumbnail'}
				<ThumbnailTab {item} onchange={edit} />
			{:else if tab === 'writing'}
				<WritingTab {item} locked={LOCKED.includes(item.status)} onchange={edit} />
			{:else if tab === 'movie'}
				<MovieTab {item} onchange={edit} />
			{:else if tab === 'derivatives'}
				<DerivativesTab {item} />
			{:else if tab === 'scheduled'}
				<ScheduledTab {item} onchange={edit} />
			{:else}
				<PublishedTab {item} onchange={edit} />
			{/if}
		</section>

		<!-- the steps, along the bottom edge above the nav pill (as the studio's) -->
		<nav class="tabs" aria-label="The story's steps" bind:this={bar}>
			<div class="track" role="tablist">
				{#each statuses as s, k (s)}
					<button role="tab" aria-selected={tab === s} class:on={tab === s} class:done={k < at} class:now={k === at} title={STAGE_NOTE[s] ?? ''} onclick={() => setTab(s)}>
						<i aria-hidden="true"></i>{statusLabel(s)}
					</button>
				{/each}
			</div>
		</nav>
	{/if}
</main>

<style>
	.story {
		max-width: 1320px;
		/* room under the last line for the steps' bar, which stands above the nav pill */
		padding-block: 1rem 4.5rem;
	}

	.lede {
		color: var(--ink-soft);
	}

	.lede a {
		color: var(--terracotta);
	}

	/* ── the head: where it stands, its title, the moves ── */
	.head {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--line);
	}

	.eyebrow {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.8rem;
		margin: 0;
		font-size: 0.72rem;
	}

	.stage {
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--terracotta);
	}

	.of {
		color: var(--muted);
	}

	.state {
		margin-left: auto;
		color: var(--muted);
	}

	.state.waiting,
	.state.saving {
		color: #b07a1a;
	}

	.state.failed {
		font-weight: 600;
		color: #9c3b26;
	}

	.title {
		width: 100%;
		box-sizing: border-box;
		margin: 0;
		padding: 0.1rem 0;
		border: 0;
		border-bottom: 1px dashed transparent;
		background: none;
		font-family: var(--font-display);
		font-size: clamp(1.6rem, 3.6vw, 2.5rem);
		line-height: 1.15;
		color: var(--ink);
	}

	.title:hover,
	.title:focus {
		border-bottom-color: var(--line);
		outline: none;
	}

	.moves {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.3rem;
	}

	.moves button {
		padding: 0.35rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.82rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.moves .on {
		border-color: var(--ink);
		background: var(--ink);
		font-weight: 600;
		color: var(--paper);
	}

	.grow {
		flex: 1;
	}

	.moves .del {
		border-color: transparent;
		background: none;
		color: #9c3b26;
	}

	.moves .del.sure {
		background: #9c3b26;
		color: var(--paper);
	}

	.bad {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
		color: #9c3b26;
	}

	.pane {
		padding-top: 1rem;
	}

	.note {
		margin: 0 0 1.1rem;
		font-size: 0.82rem;
		color: var(--muted);
	}

	/* ── the steps' bar: fixed along the bottom, just above the nav pill ── */
	.tabs {
		position: fixed;
		right: max(8px, env(safe-area-inset-right, 0px));
		bottom: calc(var(--nav-foot) + var(--nav-height) + 0.45rem);
		left: max(8px, env(safe-area-inset-left, 0px));
		z-index: 40;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}

	.track {
		display: flex;
		max-width: 100%;
		padding: 3px;
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.92);
		box-shadow: 0 6px 24px rgb(38 56 44 / 0.12);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		scrollbar-width: none;
		pointer-events: auto;
	}

	.track::-webkit-scrollbar {
		display: none;
	}

	.track button {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 0.35rem;
		min-width: 5.4rem;
		justify-content: center;
		padding: 0.38rem 0.85rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
	}

	/* a dot: the steps behind it filled, its own marked */
	.track i {
		width: 6px;
		height: 6px;
		border: 1px solid currentColor;
		border-radius: 50%;
		opacity: 0.6;
	}

	.track button.done i {
		border-color: var(--sage);
		background: var(--sage);
		opacity: 1;
	}

	.track button.now i {
		border-color: var(--terracotta);
		background: var(--terracotta);
		opacity: 1;
	}

	.track button.now {
		color: var(--ink);
	}

	.track button.on {
		background: var(--ink);
		color: var(--paper);
	}

	@media (max-width: 760px), (max-height: 500px) {
		.story {
			padding-bottom: 4rem;
		}

		.track button {
			min-width: 0;
			padding: 0.36rem 0.7rem;
			font-size: 0.76rem;
		}
	}
</style>
