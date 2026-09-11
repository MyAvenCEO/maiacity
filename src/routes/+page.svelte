<svelte:head>
	<title>maiaCITY</title>
	<meta name="description" content="maiaCITY — coming soon." />
</svelte:head>

<main>
	<p class="eyebrow">Under construction</p>
	<h1>maia<span>CITY</span></h1>
	<p class="lede">Something is being built here. Check back soon.</p>
</main>

<style>
	:global(html, body) {
		margin: 0;
		height: 100%;
	}

	:global(body) {
		--bg: #f7f6f3;
		--fg: #1a1a1a;
		--muted: #6b6b6b;
		--accent: #3b5bdb;
		background: var(--bg);
		color: var(--fg);
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
	}

	@media (prefers-color-scheme: dark) {
		:global(body) {
			--bg: #111214;
			--fg: #ececec;
			--muted: #9a9a9a;
			--accent: #7c9cff;
		}
	}

	main {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		text-align: center;
		box-sizing: border-box;
	}

	.eyebrow {
		margin: 0 0 1rem;
		font-size: 0.8rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h1 {
		margin: 0;
		font-size: clamp(3rem, 12vw, 7rem);
		font-weight: 300;
		letter-spacing: -0.03em;
		line-height: 1;
	}

	h1 span {
		font-weight: 700;
		color: var(--accent);
	}

	.lede {
		margin: 1.5rem 0 0;
		max-width: 32ch;
		font-size: 1.125rem;
		color: var(--muted);
	}
</style>
