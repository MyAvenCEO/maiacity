<!--
	The app's nav pill, floating at the bottom: home to the dashboard (where the games are), the admin's tools (for whoever holds
	them), and the account — who is signed in, the public site, signing out.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import type { Founder } from '$lib/auth/client';
	import Icon from './Icon.svelte';
	import { ADMIN, APPS, holds } from './places';

	let { founder, onsignout }: { founder: Founder; onsignout: () => void } = $props();

	let open = $state(false);
	const path = $derived(page.url.pathname);
	const here = (href: string) => (href === `${base}/app/` ? path === href : path.startsWith(href));
	const tools = $derived(ADMIN.filter((p) => holds(founder, p) && p.icon !== 'key'));
	const initials = $derived(founder.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
	$effect(() => {
		void path;
		open = false;
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<nav class="pill" aria-label="App">
	<a class="item home" href="{base}/app/" aria-current={here(`${base}/app/`) ? 'page' : undefined} title="Dashboard">
		<Icon name="home" /><span>Home</span>
	</a>
	{#each APPS as t (t.href)}
		<a class="item" href={t.href} aria-current={here(t.href) ? 'page' : undefined} title={t.label}>
			<Icon name={t.icon} /><span>{t.label}</span>
		</a>
	{/each}
	{#each tools as t (t.href)}
		<a class="item" href={t.href} aria-current={here(t.href) ? 'page' : undefined} title={t.label}>
			<Icon name={t.icon} /><span>{t.label}</span>
		</a>
	{/each}
	<button class="item me" class:on={open} onclick={() => (open = !open)} aria-expanded={open} aria-haspopup="true" title={founder.name}>
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
	/* centred, as wide as its items and never wider than the screen (clear of its edges and the notch): when they are
	   more than fit, they share the room. Pinned to an iPhone's home screen it sits lower by the gap iOS leaves at the
	   screen's foot ($lib/app/screenGap.js), the same distance above the home bar as anywhere else */
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

	.home[aria-current='page'] {
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

	/* a phone, upright or on its side, and a narrow window: icons only, each as wide as a finger while the pill has the
	   room, narrower when it has not (eleven of them still fit across the narrowest phone) */
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
