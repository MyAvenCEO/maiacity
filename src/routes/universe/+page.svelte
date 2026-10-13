<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Maia Universe: maiaCITY's own content stream. Everything lives in memory for now; a reload starts it over.
	import { AUTHORS, CHANNELS, POSTS, ago } from '$lib/universe/posts.js';

	let posts = $state(POSTS.map((p) => ({ ...p, liked: false })));
	let channel = $state('All');
	let draft = $state('');
	let draftChannel = $state('Devlog');

	const shown = $derived(channel === 'All' ? posts : posts.filter((p) => p.channel === channel));
	const counts = $derived(Object.fromEntries(CHANNELS.map((c) => [c, c === 'All' ? posts.length : posts.filter((p) => p.channel === c).length])));
	const top = $derived([...posts].sort((a, b) => b.likes - a.likes).slice(0, 3));

	function like(p) {
		p.liked = !p.liked;
		p.likes += p.liked ? 1 : -1;
	}

	function share(e) {
		e.preventDefault();
		const text = draft.trim();
		if (!text) return;
		posts.unshift({ id: `n${Date.now()}`, author: 'samuel', ago: 0, channel: draftChannel, text, likes: 0, replies: 0, liked: false });
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
				{@const a = AUTHORS[p.author]}
				<article class="post card">
					<span class="avatar" style:background={a.color}>{a.initials}</span>
					<div class="body">
						<div class="meta">
							<strong>{a.name}</strong>
							{#if a.ai}<span class="badge">AI</span>{:else if a.coop}<span class="badge coop">COOP</span>{/if}
							<span class="dim">@{a.handle} · {p.ago === 0 ? 'now' : ago(p.ago)}</span>
							<span class="channel">{p.channel}</span>
						</div>

						{#if p.kind === 'quote'}
							<blockquote>“{p.text}”<cite>{p.note}</cite></blockquote>
						{:else}
							<p class="text">{p.text}</p>
						{/if}

						{#if p.kind === 'stat'}
							<div class="stat">
								<span class="value">{p.stat.value}<small>{p.stat.unit}</small></span>
								<span class="label">{p.stat.label}</span>
							</div>
						{:else if p.kind === 'visual'}
							<div class="visual" style:background="linear-gradient(135deg, {p.visual.from}, {p.visual.to})">
								<span>{p.visual.caption}</span>
							</div>
						{/if}

						<div class="actions">
							<button class="act" aria-label="Reply">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" /></svg>{p.replies}
							</button>
							<button class="act" class:liked={p.liked} aria-pressed={p.liked} aria-label="Like" onclick={() => like(p)}>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>{p.likes}
							</button>
						</div>
					</div>
				</article>
			{:else}
				<p class="empty">Nothing in {channel} yet. Be the first to share.</p>
			{/each}
		</main>

		<aside class="side">
			<section class="card">
				<h2>Most loved</h2>
				<ol>
					{#each top as p (p.id)}
						<li><strong>{AUTHORS[p.author].name}</strong><span>{p.text}</span></li>
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

	.composer,
	.post {
		display: flex;
		gap: 0.9rem;
	}

	.compose,
	.body {
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

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem 0.5rem;
		font-size: 0.9rem;
	}

	.dim {
		color: var(--muted);
	}

	.badge {
		padding: 0.05rem 0.4rem;
		border-radius: 6px;
		background: #2f6fbf1f;
		color: #2f6fbf;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
	}

	.badge.coop {
		background: #1f7a521f;
		color: #1f7a52;
	}

	.channel {
		margin-left: auto;
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--terracotta);
	}

	.text {
		margin: 0.45rem 0 0;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	blockquote {
		margin: 0.6rem 0 0;
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-style: italic;
		line-height: 1.3;
	}

	cite {
		display: block;
		margin-top: 0.4rem;
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-style: normal;
		color: var(--muted);
	}

	.stat {
		display: flex;
		align-items: baseline;
		gap: 0.8rem;
		margin-top: 0.8rem;
		padding: 0.9rem 1.1rem;
		border-radius: 16px;
		background: var(--cream);
	}

	.value {
		font-family: var(--font-display);
		font-size: 2.2rem;
		font-weight: 600;
		line-height: 1;
	}

	.value small {
		margin-left: 0.3rem;
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--terracotta);
	}

	.label {
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.visual {
		display: flex;
		align-items: flex-end;
		aspect-ratio: 16 / 7;
		margin-top: 0.8rem;
		padding: 0.9rem 1.1rem;
		border-radius: 16px;
	}

	.visual span {
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-style: italic;
		color: #fff;
		text-shadow: 0 1px 8px rgb(0 0 0 / 0.25);
	}

	.actions {
		display: flex;
		gap: 1.2rem;
		margin-top: 0.7rem;
	}

	.act {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.4rem;
		margin-left: -0.4rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.act svg {
		width: 1.05rem;
		height: 1.05rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}

	.act:hover {
		color: var(--ink);
	}

	.act.liked {
		color: var(--terracotta);
	}

	.act.liked svg {
		fill: currentColor;
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

		.composer,
		.post {
			gap: 0.7rem;
		}

		.avatar {
			width: 2.2rem;
			height: 2.2rem;
			font-size: 0.72rem;
		}

		.channel {
			margin-left: 0;
		}
	}
</style>
