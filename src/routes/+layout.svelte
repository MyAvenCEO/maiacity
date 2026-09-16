<script lang="ts">
	import { base } from '$app/paths';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { socials } from '$lib/social';
	import SiteFooter from '$lib/SiteFooter.svelte';
	import SocialIcon from '$lib/SocialIcon.svelte';

	let { children } = $props();

	const links = [
		{ href: base || '/', label: 'Home' },
		{ href: `${base}/blog`, label: 'Journal' },
		{ href: `${base}/inspire-me`, label: 'Inspire me' },
		{ href: `${base}/games`, label: 'Games' }
	];

	// A sandbox is a leaf: it runs full-screen without the site chrome. The
	// games index above it keeps the nav.
	const bare = $derived(/^\/games\/[^/]+\/?$/.test(page.url.pathname.slice(base.length)));

	const isActive = (href: string) =>
		href === (base || '/') ? page.url.pathname === (base || '/') : page.url.pathname.startsWith(href);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !bare}
	<header class="wrap">
	<nav>
		<a class="logo" href="{base || '/'}">maia<strong>CITY</strong></a>
		<div class="right">
			<ul class="pages">
				{#each links as link (link.href)}
					<li>
						<a href={link.href} aria-current={isActive(link.href) ? 'page' : undefined}>{link.label}</a>
					</li>
				{/each}
			</ul>
			<ul class="social" aria-label="Follow avenSAMUEL">
				{#each socials as s (s.id)}
					<li>
						<a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label}>
							<SocialIcon id={s.id} size={16} />
						</a>
					</li>
				{/each}
			</ul>
		</div>
		</nav>
	</header>
{/if}

{@render children()}

{#if !bare}
	<SiteFooter />
{/if}

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

	.right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	ul {
		display: flex;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.social {
		gap: 0.1rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--line);
	}

	.social a {
		display: grid;
		place-items: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 50%;
		color: var(--ink-soft);
		transition: background-color 150ms ease, color 150ms ease;
	}

	.social a:hover {
		background: var(--cream);
		color: var(--ink);
	}

	.pages a {
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

	.pages a:hover {
		color: var(--ink);
	}

	.pages a[aria-current='page'] {
		background: var(--ink);
		color: var(--cream);
	}

	/* On a phone the pill becomes a small card: logo, then the page links
	   spread across the full width, then the channels on a row of their own. */
	@media (max-width: 760px) {
		nav {
			flex-direction: column;
			align-items: stretch;
			gap: 0.35rem;
			padding: 0.7rem 0.7rem 0.55rem;
			border-radius: 22px;
		}

		.logo {
			padding-left: 0.5rem;
		}

		.right {
			flex-direction: column;
			align-items: stretch;
			gap: 0.35rem;
		}

		.pages {
			justify-content: space-between;
		}

		.pages a {
			padding: 0.55rem 0.65rem;
			font-size: 0.64rem;
			letter-spacing: 0.1em;
			white-space: nowrap;
		}

		.social {
			justify-content: center;
			padding: 0.35rem 0 0;
			border-left: 0;
			border-top: 1px solid var(--line);
		}
	}
</style>
