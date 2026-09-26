<!--
	The admin's notebook: a place to throw an idea the moment it comes, and find it again later.

	Prerendered like every other page, so it is only a shell until the browser asks the API who is
	looking. The API is the gate: without ideas:admin it answers nothing, and the page just says so.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import {
		addIdea,
		deleteIdea,
		listIdeas,
		may,
		me,
		updateIdea,
		type Founder,
		type Idea
	} from '$lib/auth/client';
	import AdminNav from '$lib/admin/AdminNav.svelte';

	let founder = $state<Founder | null>(null);
	let phase = $state<'loading' | 'signed-out' | 'forbidden' | 'ready'>('loading');
	let ideas = $state<Idea[]>([]);
	let draft = $state('');
	let busy = $state(false);
	let error = $state('');
	let editing = $state<string | null>(null);
	let editText = $state('');
	let confirming = $state<string | null>(null);
	let showDone = $state(false);
	let filter = $state('');
	let input = $state<HTMLTextAreaElement | null>(null);

	const open = $derived(ideas.filter((i) => !i.done && matches(i)));
	const done = $derived(ideas.filter((i) => i.done && matches(i)));

	function matches(i: Idea) {
		const f = filter.trim().toLowerCase();
		return !f || i.body.toLowerCase().includes(f);
	}

	onMount(async () => {
		try {
			founder = await me();
		} catch {
			phase = 'signed-out';
			return;
		}
		if (!may(founder, 'ideas:admin')) {
			phase = 'forbidden';
			return;
		}
		try {
			ideas = await listIdeas();
			phase = 'ready';
			await tick();
			input?.focus();
		} catch (e) {
			error = (e as Error).message;
			phase = 'ready';
		}
	});

	async function run(action: () => Promise<unknown>) {
		error = '';
		try {
			await action();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function add() {
		const body = draft.trim();
		if (!body || busy) return;
		busy = true;
		await run(async () => {
			const idea = await addIdea(body);
			ideas = [idea, ...ideas];
			draft = '';
		});
		busy = false;
		input?.focus();
	}

	const replace = (idea: Idea) => (ideas = ideas.map((i) => (i.id === idea.id ? idea : i)));

	const toggle = (idea: Idea) => run(async () => replace(await updateIdea(idea.id, { done: !idea.done })));

	async function startEdit(idea: Idea) {
		editing = idea.id;
		editText = idea.body;
		await tick();
		const el = document.getElementById(`edit-${idea.id}`) as HTMLTextAreaElement | null;
		el?.focus();
		el?.setSelectionRange(el.value.length, el.value.length);
	}

	async function saveEdit(idea: Idea) {
		if (editing !== idea.id) return;
		const body = editText.trim();
		editing = null;
		if (!body || body === idea.body) return;
		await run(async () => replace(await updateIdea(idea.id, { body })));
	}

	async function remove(idea: Idea) {
		if (confirming !== idea.id) {
			confirming = idea.id;
			return;
		}
		confirming = null;
		await run(async () => {
			await deleteIdea(idea.id);
			ideas = ideas.filter((i) => i.id !== idea.id);
		});
	}

	/** Enter keeps it, Shift+Enter starts a new line. */
	const onKey = (e: KeyboardEvent, then: () => void) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			then();
		}
	};

	const when = (iso: string) => {
		const d = new Date(iso);
		const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
		if (days < 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		if (days < 7) return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
		return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
	};
</script>

<svelte:head>
	<title>Ideas · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	<article>
		<AdminNav />
		<h1>Ideas</h1>

		{#if phase === 'loading'}
			<p class="lede">One moment…</p>
		{:else if phase === 'signed-out'}
			<p class="lede">This notebook belongs to the admin. <a href="{base}/join/">Sign in</a> first.</p>
		{:else if phase === 'forbidden'}
			<p class="lede">This notebook belongs to the admin, and your account is not one.</p>
		{:else}
			<form
				class="add"
				onsubmit={(e) => {
					e.preventDefault();
					add();
				}}
			>
				<textarea
					bind:this={input}
					bind:value={draft}
					onkeydown={(e) => onKey(e, add)}
					rows="3"
					maxlength="4000"
					placeholder="An idea, a note, a thing not to forget…"
					aria-label="New idea"
				></textarea>
				<div class="row">
					<span class="hint">Enter to keep it · Shift+Enter for a new line</span>
					<button class="pill-btn" type="submit" disabled={busy || !draft.trim()}>
						{busy ? 'Keeping…' : 'Keep it'}
					</button>
				</div>
			</form>

			{#if error}<p class="note bad">{error}</p>{/if}

			{#if ideas.length > 6}
				<input class="filter" type="search" bind:value={filter} placeholder="Find an idea" aria-label="Find an idea" />
			{/if}

			{#if open.length === 0 && done.length === 0}
				<p class="empty">{filter ? 'Nothing matches.' : 'Nothing written down yet. The first idea goes in the box above.'}</p>
			{/if}

			<ul class="ideas">
				{#each open as idea (idea.id)}
					{@render item(idea)}
				{/each}
			</ul>

			{#if done.length}
				<button class="quiet toggle" onclick={() => (showDone = !showDone)}>
					{showDone ? 'Hide' : 'Show'} done ({done.length})
				</button>
				{#if showDone}
					<ul class="ideas done">
						{#each done as idea (idea.id)}
							{@render item(idea)}
						{/each}
					</ul>
				{/if}
			{/if}
		{/if}
	</article>
</main>

{#snippet item(idea: Idea)}
	<li class:is-done={idea.done}>
		<input
			type="checkbox"
			checked={idea.done}
			onchange={() => toggle(idea)}
			aria-label={idea.done ? 'Mark as open' : 'Mark as done'}
		/>
		<div class="body">
			{#if editing === idea.id}
				<textarea
					id="edit-{idea.id}"
					bind:value={editText}
					onkeydown={(e) => {
						if (e.key === 'Escape') editing = null;
						else onKey(e, () => saveEdit(idea));
					}}
					onblur={() => saveEdit(idea)}
					rows="3"
					maxlength="4000"
					aria-label="Edit idea"
				></textarea>
			{:else}
				<button class="text" onclick={() => startEdit(idea)}>{idea.body}</button>
			{/if}
			<span class="meta">
				{when(idea.created_at)}{#if idea.author && idea.author !== founder?.name} · {idea.author}{/if}
			</span>
		</div>
		<button
			class="del"
			class:sure={confirming === idea.id}
			onclick={() => remove(idea)}
			onblur={() => confirming === idea.id && (confirming = null)}
			aria-label="Delete idea"
		>
			{confirming === idea.id ? 'Delete?' : '×'}
		</button>
	</li>
{/snippet}

<style>
	main {
		padding-block: 3.5rem 6rem;
	}

	article {
		max-width: 40rem;
		margin: 0 auto;
	}

	h1 {
		margin: 0.75rem 0 1.5rem;
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1.05;
	}

	.lede {
		font-size: 1.05rem;
		line-height: 1.6;
		color: var(--ink-soft);
	}

	.lede a {
		color: var(--terracotta);
	}

	.add {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--paper);
	}

	textarea,
	.filter {
		width: 100%;
		box-sizing: border-box;
		padding: 0.8rem 1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--cream);
		font: inherit;
		line-height: 1.5;
		color: var(--ink);
		resize: vertical;
	}

	textarea:focus-visible,
	.filter:focus-visible {
		outline: 2px solid var(--terracotta);
		outline-offset: 1px;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--muted);
	}

	button.pill-btn {
		border: 0;
		cursor: pointer;
		font-family: inherit;
	}

	button.pill-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		transform: none;
	}

	.filter {
		margin-top: 1.5rem;
	}

	.empty {
		margin: 2rem 0 0;
		color: var(--muted);
	}

	.ideas {
		list-style: none;
		margin: 1.5rem 0 0;
		padding: 0;
	}

	.ideas li {
		display: flex;
		align-items: flex-start;
		gap: 0.8rem;
		padding: 0.9rem 0;
		border-bottom: 1px solid var(--line);
	}

	.ideas li input[type='checkbox'] {
		flex: none;
		width: 1.1rem;
		height: 1.1rem;
		margin-top: 0.2rem;
		accent-color: var(--ink);
		cursor: pointer;
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.text {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		line-height: 1.55;
		color: var(--ink);
		text-align: left;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		cursor: text;
	}

	.is-done .text {
		color: var(--muted);
		text-decoration: line-through;
	}

	.meta {
		font-size: 0.75rem;
		color: var(--muted);
	}

	.del {
		flex: none;
		padding: 0.1rem 0.5rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 1.1rem;
		line-height: 1.3;
		color: var(--muted);
		cursor: pointer;
		opacity: 0.5;
	}

	.ideas li:hover .del,
	.del:focus-visible,
	.del.sure {
		opacity: 1;
	}

	.del.sure {
		font-size: 0.8rem;
		background: #9c3b26;
		color: var(--paper);
	}

	.quiet {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.9rem;
		color: var(--terracotta);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.toggle {
		margin-top: 1.5rem;
	}

	.note.bad {
		margin: 1rem 0 0;
		font-size: 0.9rem;
		color: #9c3b26;
	}
</style>
