<script lang="ts">
	import { base } from '$app/paths';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { children } = $props();

	const links = [
		{ href: base || '/', label: 'Home' },
		{ href: `${base}/inspire-me`, label: 'Inspire me' }
	];

	const isActive = (href: string) =>
		href === (base || '/') ? page.url.pathname === (base || '/') : page.url.pathname.startsWith(href);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="wrap">
	<nav>
		<a class="logo" href="{base || '/'}">maia<strong>CITY</strong></a>
		<ul>
			{#each links as link (link.href)}
				<li>
					<a href={link.href} aria-current={isActive(link.href) ? 'page' : undefined}>{link.label}</a>
				</li>
			{/each}
		</ul>
	</nav>
</header>

{@render children()}

<style>
	header {
		padding-top: 1.25rem;
	}

	nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.45rem 0.45rem 0.45rem 1.4rem;
		border-radius: 999px;
		background: var(--paper);
		box-shadow: 0 6px 24px rgb(38 56 44 / 0.06);
	}

	.logo {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 300;
		letter-spacing: -0.02em;
		text-decoration: none;
	}

	.logo strong {
		font-weight: 600;
	}

	ul {
		display: flex;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ul a {
		display: block;
		padding: 0.6rem 1.1rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--ink-soft);
	}

	ul a:hover {
		color: var(--ink);
	}

	ul a[aria-current='page'] {
		background: var(--ink);
		color: var(--cream);
	}
</style>
