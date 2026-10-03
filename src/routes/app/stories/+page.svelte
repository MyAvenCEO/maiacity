<!--
	Stories: every story we tell, as a board (the steps it moves through, idea to published) or as the calendar (what
	goes out when, across all of them). Click a story to open it on its own page, its steps as tabs.

	Prerendered like every other page, so it is only a shell until the browser asks the API who is looking. The API is
	the gate: without content:admin it answers nothing, and the page just says so. /app/stories/?view=calendar opens the
	calendar.
-->
<script>
	import { base } from '$app/paths';
	import { goto, replaceState } from '$app/navigation';
	import { onMount } from 'svelte';
	import { STATUSES, createContent, deleteContent, listContent, may, me, saveContent } from '$lib/auth/client';
	import { movePatch } from '$lib/admin/board';
	import StoryBoard from '$lib/stories/StoryBoard.svelte';
	import StoryCalendar from '$lib/stories/StoryCalendar.svelte';
	import { storyHref } from '$lib/stories/stories.js';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */
	/** @typedef {import('$lib/auth/client').Status} Status */

	/** @type {'loading' | 'signed-out' | 'forbidden' | 'ready'} */
	let phase = $state('loading');
	let error = $state('');
	/** @type {ContentItem[]} */
	let items = $state([]);
	/** @type {readonly Status[]} */
	let statuses = $state(STATUSES);
	/** @type {'board' | 'calendar'} */
	let view = $state('board');
	let moving = false;

	onMount(async () => {
		view = new URLSearchParams(location.search).get('view') === 'calendar' ? 'calendar' : 'board';
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
			error = /** @type {Error} */ (e).message;
		}
		phase = 'ready';
	});

	// the stories change from outside too (a day pushed from the repo, a render delivered, the Mac app filing one):
	// fetched again whenever the tab comes back into view, and every 20 s while it is in view
	onMount(() => {
		const again = () => phase === 'ready' && document.visibilityState === 'visible' && refresh();
		const every = setInterval(again, 20000);
		document.addEventListener('visibilitychange', again);
		window.addEventListener('focus', again);
		return () => (clearInterval(every), document.removeEventListener('visibilitychange', again), window.removeEventListener('focus', again));
	});

	async function refresh() {
		if (moving) return;
		try {
			const got = await listContent();
			if (!moving) items = got.items;
			if (got.statuses?.length) statuses = got.statuses;
		} catch {
			// a missed refresh is not an error: the next one comes
		}
	}

	/** @param {() => Promise<unknown>} action */
	async function run(action) {
		error = '';
		moving = true;
		try {
			await action();
		} catch (e) {
			error = /** @type {Error} */ (e).message;
			await refresh();
		} finally {
			moving = false;
		}
	}

	/** @param {ContentItem} i */
	const replace = (i) => (items = items.map((x) => (x.id === i.id ? i : x)));

	/** Changed at once here, then as the server has it. @param {ContentItem} i @param {Partial<ContentItem>} patch */
	function save(i, patch) {
		replace({ ...i, ...patch });
		return run(async () => replace(await saveContent(i.id, patch)));
	}

	/** @param {ContentItem} i @param {Status} status */
	const move = (i, status) => save(i, movePatch(i, status));

	/** @param {string} title */
	const create = (title) => run(async () => void (items = [await createContent({ title, status: 'idea' }), ...items]));

	/** @param {string} id */
	const remove = (id) =>
		run(async () => {
			await deleteContent(id);
			items = items.filter((x) => x.id !== id);
		});

	/** @param {string} id @param {string} [tab] */
	const open = (id, tab) => goto(storyHref(id, tab));

	/** @param {'board' | 'calendar'} v */
	function show(v) {
		view = v;
		replaceState(v === 'calendar' ? `${base}/app/stories/?view=calendar` : `${base}/app/stories/`, {});
	}
</script>

<svelte:head>
	<title>Stories · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	{#if phase === 'loading'}
		<p class="lede">One moment…</p>
	{:else if phase === 'signed-out'}
		<p class="lede">The stories belong to the admin. <a href="{base}/join/">Sign in</a> first.</p>
	{:else if phase === 'forbidden'}
		<p class="lede">The stories belong to the admin, and your account is not one.</p>
	{:else}
		<header class="top">
			<h1>Stories <span>{items.length}</span></h1>
			<div class="switch" role="tablist" aria-label="View">
				<button role="tab" aria-selected={view === 'board'} class:on={view === 'board'} onclick={() => show('board')}>Board</button>
				<button role="tab" aria-selected={view === 'calendar'} class:on={view === 'calendar'} onclick={() => show('calendar')}>Calendar</button>
			</div>
			{#if error}<p class="bad">{error}</p>{/if}
		</header>

		{#if view === 'board'}
			<StoryBoard {items} {statuses} onopen={(id) => open(id)} onmove={move} ondelete={remove} oncreate={create} />
		{:else}
			<StoryCalendar {items} onopen={open} onsave={save} />
		{/if}
	{/if}
</main>

<style>
	/* the board wants the width the other admin pages do not */
	main {
		max-width: 1640px;
		padding-block: 1rem 0;
	}

	.lede {
		color: var(--ink-soft);
	}

	.lede a {
		color: var(--terracotta);
	}

	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1.2rem;
		margin-bottom: 0.9rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.5rem, 3vw, 2rem);
	}

	h1 span {
		font-family: var(--font-body);
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--terracotta);
	}

	.switch {
		display: flex;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
	}

	.switch button {
		min-width: 5.5rem;
		padding: 0.3rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
	}

	.switch button.on {
		background: var(--ink);
		color: var(--paper);
	}

	.bad {
		margin: 0;
		font-size: 0.85rem;
		color: #9c3b26;
	}
</style>
