<!-- The admin's own corner of the site: its pages, side by side. -->
<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';

	const pages = [
		{ href: `${base}/admin/ideas/`, label: 'Ideas' },
		{ href: `${base}/admin/media/`, label: 'Media' }
	];
</script>

<nav aria-label="Admin">
	<span class="eyebrow">Admin</span>
	{#each pages as p (p.href)}
		<a href={p.href} aria-current={page.url.pathname === p.href ? 'page' : undefined}>{p.label}</a>
	{/each}
</nav>

<style>
	nav {
		display: flex;
		align-items: baseline;
		gap: 1.1rem;
	}

	.eyebrow {
		margin-right: 0.2rem;
	}

	a {
		font-size: 0.9rem;
		color: var(--ink-soft);
		text-decoration: none;
	}

	a:hover {
		color: var(--ink);
	}

	a[aria-current='page'] {
		color: var(--ink);
		font-weight: 600;
		text-decoration: underline;
		text-decoration-color: var(--mustard);
		text-decoration-thickness: 2px;
		text-underline-offset: 5px;
	}
</style>
