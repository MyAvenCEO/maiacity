<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Maia Universe: maiaCITY's own content stream. Everything lives in memory for now; a reload starts it over.
	import { base } from '$app/paths';
	import { AUTHORS, CHANNELS, fakeDocId, postHref, titleOf } from '$lib/universe/posts.js';
	import { stream } from '$lib/universe/stream.svelte.js';
	import PostCard from '$lib/universe/PostCard.svelte';

	const posts = $derived(stream.posts);
	let channel = $state('All');
	let draft = $state('');
	let draftChannel = $state('Devlog');

	const shown = $derived(channel === 'All' ? posts : posts.filter((p) => p.channel === channel));
	const counts = $derived(Object.fromEntries(CHANNELS.map((c) => [c, c === 'All' ? posts.length : posts.filter((p) => p.channel === c).length])));
	const top = $derived([...posts].sort((a, b) => b.likes - a.likes).slice(0, 3));

	function share(e) {
		e.preventDefault();
		const text = draft.trim();
		if (!text) return;
		stream.posts.unshift({ id: `n${Date.now()}`, doc: fakeDocId(), title: titleOf(text), author: 'samuel', ago: 0, channel: draftChannel, text, likes: 0, replies: 0, liked: false });
		draft = '';
		channel = 'All';
	}
</script>

<svelte:head>
	<title>Maia Universe · maiaCITY</title>
	<meta name="description" content="Maia Universe: the stream of everything that happens in maiaCITY, from the builds and the villages to the COOPs and the avens." />
</svelte:head>

<div class="universe">
	<header class="head">
		<p class="kind">The stream</p>
		<h1>Maia <em>Universe</em></h1>
		<p class="sub">Everything that happens in maiaCITY, as it happens.</p>
	</header>

	<div class="layout">
		<main class="feed">
			<form class="composer card" onsubmit={share}>
				<span class="avatar" style:background={AUTHORS.samuel.color}>{AUTHORS.samuel.initials}</span>
				<div class="compose">
					<textarea bind:value={draft} rows="2" placeholder="What is growing in maiaCITY today?" maxlength="500"></textarea>
					<div class="compose-row">
						<select bind:value={draftChannel} aria-label="Channel">
							{#each CHANNELS.slice(1) as c (c)}<option>{c}</option>{/each}
						</select>
						<button type="submit" disabled={!draft.trim()}>Share</button>
					</div>
				</div>
			</form>

			<nav class="chips" aria-label="Channels">
				{#each CHANNELS as c (c)}
					<button class:on={channel === c} onclick={() => (channel = c)}>{c}<span>{counts[c]}</span></button>
				{/each}
			</nav>

			{#each shown as p (p.id)}
				<PostCard post={p} />
			{:else}
				<p class="empty">Nothing in {channel} yet. Be the first to share.</p>
			{/each}
		</main>

		<aside class="side">
			<section class="card">
				<h2>Most loved</h2>
				<ol>
					{#each top as p (p.id)}
						<li><a href={postHref(base, p)}><strong>{p.title}</strong><span>{AUTHORS[p.author].name}</span></a></li>
					{/each}
				</ol>
			</section>
			<section class="card">
				<h2>Voices</h2>
				<ul>
					{#each Object.values(AUTHORS) as a (a.handle)}
						<li class="voice"><span class="avatar sm" style:background={a.color}>{a.initials}</span>{a.name}</li>
					{/each}
				</ul>
			</section>
			<p class="note">In memory for now: what you share here is gone on the next reload.</p>
		</aside>
	</div>
</div>

<style>
	.universe {
		max-width: 68rem;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 5rem;
		color: var(--ink);
	}

	.head {
		text-align: center;
		margin-bottom: 2rem;
	}

	.kind {
		margin: 0 0 0.6rem;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(2.2rem, 6vw, 3.4rem);
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.05;
	}

	h1 em {
		font-weight: 600;
		color: var(--terracotta);
	}

	.sub {
		margin: 0.7rem 0 0;
		font-family: var(--font-display);
		font-style: italic;
		color: var(--ink-soft);
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 18rem;
		gap: 1.5rem;
		align-items: start;
	}

	.feed {
		display: grid;
		gap: 0.9rem;
		min-width: 0;
	}

	.card {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 1.1rem 1.2rem;
	}

	.avatar {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 50%;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #fff;
	}

	.avatar.sm {
		width: 1.9rem;
		height: 1.9rem;
		font-size: 0.65rem;
	}

	.composer {
		display: flex;
		gap: 0.9rem;
	}

	.compose {
		flex: 1;
		min-width: 0;
	}

	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 1rem;
		color: var(--ink);
		outline: none;
		padding: 0.5rem 0 0.4rem;
	}

	.compose-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--line);
	}

	select {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--cream);
		color: var(--ink);
	}

	button {
		font: inherit;
		cursor: pointer;
	}

	button[type='submit'] {
		padding: 0.5rem 1.3rem;
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		color: var(--cream);
		font-weight: 500;
	}

	button[type='submit']:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.chips {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		padding: 0.2rem 0;
		scrollbar-width: none;
	}

	.chips button {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.chips button span {
		font-size: 0.72rem;
		color: var(--muted);
	}

	.chips button.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--cream);
	}

	.chips button.on span {
		color: var(--sage);
	}

	.empty {
		text-align: center;
		color: var(--muted);
	}

	.side {
		position: sticky;
		top: 6rem;
		display: grid;
		gap: 0.9rem;
	}

	h2 {
		margin: 0 0 0.7rem;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	ol,
	ul {
		display: grid;
		gap: 0.7rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ol a {
		display: grid;
		color: inherit;
		text-decoration: none;
	}

	ol a:hover strong {
		color: var(--terracotta);
	}

	ol li {
		display: grid;
		gap: 0.15rem;
		font-size: 0.85rem;
	}

	ol li span {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		color: var(--ink-soft);
	}

	.voice {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
	}

	.note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
		text-align: center;
	}

	@media (max-width: 860px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.side {
			position: static;
		}
	}

	@media (max-width: 520px) {
		.universe {
			padding: 1.5rem 0.75rem 4rem;
		}

		.card {
			padding: 0.95rem;
		}

		.composer {
			gap: 0.7rem;
		}

		.avatar {
			width: 2.2rem;
			height: 2.2rem;
			font-size: 0.72rem;
		}

	}
</style>
