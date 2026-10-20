<!--
	One message of a room, as the timeline and a thread show it: who wrote it (read off the room's history by the device,
	never off the row), its time, its text as Markdown through the app's one engine, which never lets markup run, that
	it was edited or deleted, its reactions as chips, and its thread's replies. On hover, or a tap on a phone: react,
	reply in the thread, and for the person's own message edit and delete (the room's vault may delete any).
-->
<script>
	// @ts-nocheck — plain JS
	import { markdown } from '$lib/markdown';
	import { shaped } from '$lib/app/shapes.js';
	import { hue, initials, nameOf } from '$lib/avendb/vaults.js';
	import { chips, clock } from './rooms.js';

	/** the emoji a reaction picks from */
	const QUICK = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🌱', '✅'];

	let {
		m,
		me,
		byId,
		head = true,
		mine = false,
		deletable = false,
		replies = 0,
		inThread = false,
		onreact,
		onreply,
		onedit,
		ondelete,
		editing = $bindable(false)
	} = $props();

	const who = $derived(m.by?.vault ? byId.get(m.by.vault) : null);
	const name = $derived(m.by?.name ?? (who ? nameOf(who) : m.by ? 'Someone' : 'Not yet counted'));
	const agent = $derived(m.actor && m.by?.vault && m.actor !== m.by.vault ? byId.get(m.actor) : null);
	const reactions = $derived(chips(m, me));
	let picking = $state(false);
	let text = $state('');
	$effect(() => {
		if (editing) text = m.text ?? '';
	});

	function save() {
		const t = text.trim();
		if (t && t !== m.text) onedit?.(t);
		editing = false;
	}
</script>

<article class="msg" class:head id={inThread ? undefined : `m${m.id}`} class:mine>
	<div class="gutter">
		{#if head}
			<span class="avatar" style="background: hsl({hue(m.by?.vault ?? '0000')} 38% 42%); {shaped(m.by?.kind ?? who?.kind)}"
				>{who ? initials(who) : (name[0] ?? '?')}</span
			>
		{:else}
			<time class="hover-time">{clock(m.at)}</time>
		{/if}
	</div>
	<div class="body">
		{#if head}
			<header>
				<b>{name}</b>{#if agent}<span class="dim"> · {nameOf(agent)}</span>{/if}
				<time>{clock(m.at)}</time>
			</header>
		{/if}
		{#if editing}
			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				class="edit"
				bind:value={text}
				autofocus
				rows="2"
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), save());
					if (e.key === 'Escape') editing = false;
				}}
			></textarea>
			<p class="dim small">Enter saves, Escape cancels.</p>
		{:else if m.deleted}
			<p class="gone">This message was deleted. It stays in the room’s signed history.</p>
		{:else}
			<div class="text">{@html markdown(m.text ?? '', { figures: false })}</div>
			{#if m.edited}<span class="dim small">(edited)</span>{/if}
		{/if}
		{#if reactions.length}
			<div class="chips">
				{#each reactions as c (c.key)}
					<button
						class="chip"
						class:on={c.mine != null}
						title={c.who.map((v) => nameOf(byId.get(v))).join(', ')}
						onclick={() => onreact?.(c.key, c.mine)}>{c.key} <small>{c.count}</small></button
					>
				{/each}
			</div>
		{/if}
		{#if replies && !inThread}
			<button class="replies" onclick={() => onreply?.()}>{replies === 1 ? '1 reply' : `${replies} replies`}</button>
		{/if}
	</div>
	{#if !m.deleted && !editing}
		<div class="actions" class:open={picking}>
			<button title="React" aria-label="React" onclick={() => (picking = !picking)}>☺</button>
			{#if !inThread}<button title="Reply in thread" aria-label="Reply in thread" onclick={() => onreply?.()}>↩</button>{/if}
			{#if mine}<button title="Edit" aria-label="Edit" onclick={() => (editing = true)}>✎</button>{/if}
			{#if mine || deletable}<button title="Delete" aria-label="Delete" onclick={() => ondelete?.()}>🗑</button>{/if}
			{#if picking}
				<div class="picker">
					{#each QUICK as k (k)}<button onclick={() => ((picking = false), onreact?.(k, reactions.find((c) => c.key === k)?.mine ?? null))}>{k}</button>{/each}
				</div>
			{/if}
		</div>
	{/if}
</article>

<style>
	.msg {
		position: relative;
		display: grid;
		grid-template-columns: 2.6rem minmax(0, 1fr);
		gap: 0.6rem;
		padding: 0.12rem 0.6rem;
		border-radius: 8px;
	}
	.msg.head {
		margin-top: 0.55rem;
	}
	.msg:hover,
	.msg:focus-within {
		background: rgb(0 0 0 / 0.03);
	}
	.msg:target {
		background: rgb(239 181 77 / 0.18);
	}
	.gutter {
		display: flex;
		justify-content: center;
	}
	.avatar {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		margin-top: 0.15rem;
		color: #fff;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.hover-time {
		visibility: hidden;
		padding-top: 0.25rem;
		color: var(--soft);
		font-size: 0.66rem;
	}
	.msg:hover .hover-time {
		visibility: visible;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.9rem;
	}
	header time {
		color: var(--soft);
		font-size: 0.72rem;
	}
	.text {
		overflow-wrap: anywhere;
		line-height: 1.45;
	}
	.text :global(p) {
		margin: 0.1rem 0;
	}
	.text :global(pre) {
		overflow-x: auto;
		padding: 0.5rem;
		border-radius: 6px;
		background: rgb(0 0 0 / 0.05);
	}
	.gone {
		margin: 0.1rem 0;
		color: var(--soft);
		font-style: italic;
	}
	.dim {
		color: var(--soft);
	}
	.small {
		font-size: 0.75rem;
	}
	.edit {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem;
		border: 1px solid var(--accent);
		border-radius: 8px;
		font: inherit;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.25rem;
	}
	.chip {
		padding: 0.08rem 0.45rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.chip.on {
		border-color: var(--accent);
		background: rgb(47 109 98 / 0.1);
	}
	.replies {
		margin-top: 0.2rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	.actions {
		position: absolute;
		top: -0.7rem;
		right: 0.6rem;
		display: none;
		gap: 0.1rem;
		padding: 0.1rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.08);
	}
	.msg:hover .actions,
	.msg:focus-within .actions,
	.actions.open {
		display: flex;
	}
	.actions button {
		width: 1.9rem;
		height: 1.7rem;
		border: 0;
		border-radius: 6px;
		background: none;
		font: inherit;
		cursor: pointer;
	}
	.actions button:hover {
		background: rgb(0 0 0 / 0.06);
	}
	.picker {
		position: absolute;
		top: 2rem;
		right: 0;
		z-index: 2;
		display: grid;
		grid-template-columns: repeat(4, 2rem);
		padding: 0.25rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
	}
	@media (hover: none) {
		.actions {
			position: static;
			display: flex;
			grid-column: 2;
			justify-self: start;
			border: 0;
			box-shadow: none;
			background: none;
		}
	}
</style>
