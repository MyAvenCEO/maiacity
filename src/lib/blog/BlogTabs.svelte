<!-- The blog's two shelves, side by side: the journal (the days) and Inspire me (what shapes the blueprint). -->
<script lang="ts">
	import { base } from '$app/paths';

	let { on }: { on: 'journal' | 'inspire' } = $props();
</script>

<nav class="tabs" aria-label="Blog">
	<a href="{base}/blog/" class:on={on === 'journal'} aria-current={on === 'journal' ? 'page' : undefined}>Journal</a>
	<a href="{base}/blog/inspire-me/" class:on={on === 'inspire'} aria-current={on === 'inspire' ? 'page' : undefined}>Inspire me</a>
</nav>

<style>
	.tabs {
		display: inline-flex;
		gap: 0.3rem;
		margin-bottom: 1.4rem;
		padding: 0.3rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
	}

	a {
		padding: 0.45rem 1.2rem;
		border-radius: 999px;
		color: var(--ink-soft);
		font-size: 0.92rem;
		text-decoration: none;
	}

	a:hover {
		color: var(--ink);
	}

	a.on {
		background: var(--ink);
		color: var(--paper);
	}
</style>
