<script lang="ts">
	import { base } from '$app/paths';
	// self-hosted from npm, bundled into the build and served from our own CDN —
	// no request ever goes to Google
	import '@fontsource-variable/dm-sans/opsz.css';
	import '@fontsource-variable/fraunces/opsz.css';
	import '../app.css';
	import { page } from '$app/state';
	import { socials } from '$lib/social';
	import SiteFooter from '$lib/SiteFooter.svelte';
	import SocialIcon from '$lib/SocialIcon.svelte';

	let { children } = $props();

	const links = [
		{ href: base || '/', label: 'Home' },
		{ href: `${base}/blog`, label: 'Journal' },
		{ href: `${base}/inspire-me`, label: 'Inspire me' },
		{ href: `${base}/games`, label: 'Games' },
		{ href: `${base}/join`, label: 'Join' }
	];

	// A sandbox is a leaf: it runs full-screen without the site chrome. The
	// games index above it keeps the nav, and so does Sandbox 3, a page of cards
	// whose domes open over it.
	const bare = $derived(/^\/games\/(?!sandbox-3\/?$)[^/]+\/?$/.test(page.url.pathname.slice(base.length)));

	// the phone menu; it closes itself whenever the page changes
	let menuOpen = $state(false);
	$effect(() => {
		page.url.pathname;
		menuOpen = false;
	});

	const isActive = (href: string) =>
		href === (base || '/') ? page.url.pathname === (base || '/') : page.url.pathname.startsWith(href);
</script>

{#if !bare}
	<header class="wrap">
		<nav>
			<a class="logo" href="{base || '/'}">maia<strong>CITY</strong></a>

			<ul class="social" aria-label="Follow avenSAMUEL">
				{#each socials as s (s.id)}
					<li>
						<a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label}>
							<SocialIcon id={s.id} size={16} />
						</a>
					</li>
				{/each}
			</ul>

			<button
				class="burger"
				type="button"
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={menuOpen}
				aria-controls="site-pages"
				onclick={() => (menuOpen = !menuOpen)}
			>
				<span></span><span></span><span></span>
			</button>

			<ul class="pages" id="site-pages" class:open={menuOpen}>
				{#each links as link (link.href)}
					<li>
						<a href={link.href} aria-current={isActive(link.href) ? 'page' : undefined}>{link.label}</a>
					</li>
				{/each}
			</ul>
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

	/* Desktop: logo · page links · channels, one pill. The order is set in CSS
	   so the phone layout can put the channels in the middle instead. */
	nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.45rem 0.45rem 1.4rem;
		border-radius: 999px;
		background: var(--paper);
		box-shadow: 0 6px 24px rgb(38 56 44 / 0.06);
	}

	.logo {
		margin-right: auto;
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

	.pages {
		order: 1;
	}

	.social {
		order: 2;
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

	.burger {
		display: none;
	}

	/* Phone: logo · channels in the middle · menu button. The page links fold
	   away behind the button and open as a list under the bar. */
	@media (max-width: 760px) {
		nav {
			display: grid;
			grid-template-columns: 1fr auto 1fr;
			gap: 0;
			padding: 0.4rem 0.4rem 0.4rem 1.1rem;
			border-radius: 26px;
		}

		.logo {
			margin: 0;
			font-size: 1.15rem;
		}

		.social {
			order: 0;
			justify-content: center;
			padding: 0;
			border: 0;
		}

		.social a {
			width: 1.9rem;
			height: 1.9rem;
		}

		.burger {
			display: grid;
			justify-self: end;
			align-content: center;
			gap: 4px;
			width: 2.5rem;
			height: 2.5rem;
			padding: 0 0.7rem;
			border: 0;
			border-radius: 50%;
			background: transparent;
			color: var(--ink);
			cursor: pointer;
		}

		.burger span {
			display: block;
			height: 2px;
			border-radius: 2px;
			background: currentColor;
			transition: transform 180ms ease, opacity 180ms ease;
		}

		.burger[aria-expanded='true'] {
			background: var(--cream);
		}

		.burger[aria-expanded='true'] span:nth-child(1) {
			transform: translateY(6px) rotate(45deg);
		}

		.burger[aria-expanded='true'] span:nth-child(2) {
			opacity: 0;
		}

		.burger[aria-expanded='true'] span:nth-child(3) {
			transform: translateY(-6px) rotate(-45deg);
		}

		.pages {
			display: none;
			grid-column: 1 / -1;
			flex-direction: column;
			gap: 0.2rem;
			margin: 0.4rem 0 0.2rem;
			padding-top: 0.5rem;
			border-top: 1px solid var(--line);
		}

		.pages.open {
			display: flex;
		}

		.pages a {
			padding: 0.8rem 1rem;
			font-size: 0.78rem;
		}
	}
</style>
