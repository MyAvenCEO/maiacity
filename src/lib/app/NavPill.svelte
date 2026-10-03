<!--
	The app's one way round, a pill floating at the foot of every page of the app, the full-screen worlds and sandboxes
	too, on a phone and a desktop alike: back ($lib/app/back.svelte.js: out of what a page has open over itself, else up
	a place), home to the dashboard, and you (who is signed in, your name, the public site, signing out). No page has a
	bar or a back button of its own, and everything else — the games, the worlds, the admin's tools — is a tile on the
	dashboard.

	Full-screen pages keep what they show at their foot clear of it with --nav-room (src/app.css). Pinned to an iPhone's
	home screen it sits lower by the gap iOS leaves at the foot of the screen ($lib/app/screenGap.js).
-->
<script>
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import { back, upFrom } from './back.svelte.js';

	/** @type {{ founder: import('$lib/auth/client').Founder, onsignout: () => void }} */
	let { founder, onsignout } = $props();

	const home = `${base}/app/`;
	let open = $state(false);
	const path = $derived(page.url.pathname);
	const up = $derived(upFrom(path.slice(base.length)));
	const initials = $derived(founder.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
	$effect(() => {
		void path;
		open = false;
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<nav class="pill" aria-label="App">
	{#if back.open}
		<button class="item" onclick={() => back.open?.go()} title={back.open.label} aria-label={back.open.label}>
			<Icon name="back" /><span>Back</span>
		</button>
	{:else if up}
		<a class="item" href={up.href} title={up.label} aria-label={up.label}><Icon name="back" /><span>Back</span></a>
	{/if}
	<a class="item" href={home} aria-current={path === home ? 'page' : undefined} title="Dashboard">
		<Icon name="home" /><span>Home</span>
	</a>
	<button class="item" class:on={open} onclick={() => (open = !open)} aria-expanded={open} aria-haspopup="true" title={founder.name}>
		<span class="avatar">{initials}</span><span>You</span>
	</button>
	{#if open}
		<div class="account" role="menu">
			<p class="who"><b>{founder.name}</b><span>Founder {String(founder.number).padStart(3, '0')}</span></p>
			<a role="menuitem" href="{base}/join/">Your name</a>
			<a role="menuitem" href="{base}/">The public site</a>
			<button role="menuitem" class="out" onclick={onsignout}>Sign out</button>
		</div>
	{/if}
</nav>

<style>
	/* centred, as wide as its items, never wider than the screen (clear of its edges and the notch) */
	.pill {
		position: fixed;
		bottom: calc(14px + env(safe-area-inset-bottom, 0px) - var(--screen-gap, 0px));
		left: max(8px, env(safe-area-inset-left, 0px));
		right: max(8px, env(safe-area-inset-right, 0px));
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 2px;
		width: max-content;
		max-width: calc(100% - max(8px, env(safe-area-inset-left, 0px)) - max(8px, env(safe-area-inset-right, 0px)));
		margin: 0 auto;
		padding: 5px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: rgb(250 248 242 / 0.94);
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
		backdrop-filter: blur(10px);
	}

	.item {
		display: flex;
		flex: 0 1 auto;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		min-width: 3.4rem;
		padding: 0.35rem 0.6rem 0.3rem;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.66rem;
		letter-spacing: 0.04em;
		text-decoration: none;
		cursor: pointer;
	}

	.item:hover {
		color: var(--ink);
		background: rgb(38 56 44 / 0.06);
	}

	.item[aria-current='page'],
	.item.on {
		color: var(--paper);
		background: var(--ink);
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--mustard);
		color: var(--ink);
		font-size: 0.66rem;
		font-weight: 700;
	}

	.account {
		position: absolute;
		right: 0;
		bottom: calc(100% + 10px);
		display: flex;
		flex-direction: column;
		min-width: 13rem;
		padding: 0.5rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--paper);
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
	}

	.who {
		display: flex;
		flex-direction: column;
		margin: 0 0 0.3rem;
		padding: 0.4rem 0.6rem 0.5rem;
		border-bottom: 1px solid var(--line);
		line-height: 1.3;
	}

	.who span {
		font-size: 0.78rem;
		color: var(--muted);
	}

	.account a,
	.account button {
		padding: 0.45rem 0.6rem;
		border: 0;
		border-radius: 10px;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 0.9rem;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.account a:hover,
	.account button:hover {
		background: rgb(38 56 44 / 0.06);
	}

	.out {
		color: var(--terracotta) !important;
	}

	/* a phone, upright or on its side, and a narrow window: icons only, each as wide as a finger (src/app.css keeps
	   --nav-room to these sizes) */
	@media (max-width: 760px), (max-height: 500px) {
		.item span:not(.avatar) {
			display: none;
		}
		.item {
			width: 2.8rem;
			min-width: 0;
			padding: 0.55rem 0;
		}
	}

	@media (max-width: 560px) {
		.pill {
			bottom: calc(10px + env(safe-area-inset-bottom, 0px) - var(--screen-gap, 0px));
			gap: 0;
			padding: 4px;
		}
	}
</style>
