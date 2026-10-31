<script>
	// avenOS's main nav: home (the dashboard, or the network's door) and Brain, the documentation, which anyone may read
	// without signing in
	let { home = '#/', brain = false } = $props();
</script>

<nav class="main" aria-label="Main">
	<a class="brand" href={home}>avenOS</a>
	<a class="item" href="#/brain" data-testid="nav-brain" aria-current={brain ? 'page' : undefined}>Brain</a>
</nav>

<style>
	.main {
		display: flex;
		align-items: center;
		gap: 18px;
		min-width: 0;
	}

	.brand {
		color: var(--accent);
		font-family: var(--font-display);
		font-size: 21px;
		font-weight: 500;
		letter-spacing: -0.01em;
		text-decoration: none;
	}

	.item {
		padding: 4px 12px;
		color: var(--text);
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		border-radius: var(--radius-pill);
	}

	.item:hover {
		background: var(--sage);
	}

	.item[aria-current] {
		color: var(--on-accent);
		background: var(--accent);
	}
</style>
