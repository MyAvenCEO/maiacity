<!--
	The signed-in app (/app/): its own place, apart from the public site — no public header, no footer. Whoever opens it
	is asked who they are first (their passkey); then the dashboard, the games and — for whoever holds them — the
	admin's tools, with a slim top bar and the nav pill at the bottom to move between them and back home.
	A sandbox runs full screen (it has its own way back), and so does the studio's editor: no bar, no pill there — nor
	while a game has gone full screen over its own page (Sandbox 3's domes).
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { me, signIn, signOut, type Founder } from '$lib/auth/client';
	import { remember } from '$lib/app/session';
	import NavPill from '$lib/app/NavPill.svelte';
	import { immersive as fullScreen } from '$lib/app/immersive.svelte';
	import { gameAt, placeOf, released } from '$lib/app/places';

	let { children } = $props();

	let founder = $state<Founder | null>(null);
	let phase = $state<'loading' | 'signed-out' | 'ready'>('loading');
	let busy = $state(false);
	let error = $state('');

	onMount(async () => {
		try {
			founder = await me();
			phase = 'ready';
		} catch {
			phase = 'signed-out';
		}
		remember(!!founder);
	});

	async function enter() {
		busy = true;
		error = '';
		try {
			founder = await signIn();
			phase = 'ready';
			remember(true);
		} catch (e) {
			const message = (e as Error).message ?? '';
			error = /NotAllowed|abort/i.test(message) ? '' : message;
		} finally {
			busy = false;
		}
	}

	async function leave() {
		await signOut();
		remember(false);
		founder = null;
		await goto(`${base}/`);
	}

	const rel = $derived(page.url.pathname.slice(base.length));
	// full screen: a sandbox (Sandbox 3 is a page of cards, it keeps the bar), and the studio's editor
	const immersive = $derived(/^\/app\/games\/(?!sandbox-3\/?$)[^/]+\/?$/.test(rel) || rel.startsWith('/app/studio') || fullScreen.on);
	const title = $derived(placeOf(page.url.pathname));
	// a draft game is the admins' only; anyone else with its link is told so
	const game = $derived(gameAt(page.url.pathname));
	const closed = $derived(!!game && !released(founder, game));
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	{#if phase !== 'ready'}<title>Sign in · maiaCITY</title>{:else if closed}<title>Not released yet · maiaCITY</title>{/if}
</svelte:head>

{#if phase === 'loading'}
	<div class="gate"><p class="quiet">One moment…</p></div>
{:else if phase === 'signed-out' || !founder}
	<div class="gate">
		<a class="logo" href="{base}/">maia<strong>CITY</strong></a>
		<h1>Welcome back.</h1>
		<p class="lede">The city's own rooms — the games, and what we build with — open to its founders.</p>
		<button class="pill-btn" disabled={busy} onclick={enter}>{busy ? 'One moment…' : 'Sign in with your passkey'}</button>
		{#if error}<p class="bad">{error}</p>{/if}
		<p class="fine">Not a founder yet? <a href="{base}/join/">Join the line →</a></p>
	</div>
{:else}
	{#if !immersive}
		<header class="bar">
			<a class="logo" href="{base}/app/">maia<strong>CITY</strong></a>
			{#if title}<span class="where">{title}</span>{/if}
			<span class="grow"></span>
			<span class="name">{founder.name}</span>
			<button class="quiet" onclick={leave}>Sign out</button>
		</header>
	{/if}
	{#if closed}
		<div class="gate">
			<h1>Not released yet.</h1>
			<p class="lede">{game?.label} is still being built. It opens to every founder once it is released.</p>
			<a class="pill-btn" href="{base}/app/">Back to the dashboard</a>
		</div>
	{:else}
		<div class="app" class:immersive>
			{@render children()}
		</div>
		{#if !immersive}<NavPill {founder} onsignout={leave} />{/if}
	{/if}
{/if}

<style>
	.gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		min-height: 100svh;
		padding: 2rem 1rem;
		text-align: center;
	}

	.gate h1 {
		margin: 1.2rem 0 0;
		font-size: clamp(2.2rem, 6vw, 3.4rem);
	}

	.lede {
		max-width: 30rem;
		margin: 0 0 0.6rem;
		color: var(--ink-soft);
	}

	.fine,
	.quiet {
		font-size: 0.9rem;
		color: var(--muted);
	}

	.bad {
		color: var(--terracotta);
	}

	.logo {
		font-family: var(--font-display);
		font-size: 1.35rem;
		color: var(--ink);
		text-decoration: none;
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.8rem clamp(1rem, 3vw, 2rem);
		border-bottom: 1px solid var(--line);
		background: rgb(241 237 227 / 0.92);
		backdrop-filter: blur(10px);
	}

	.where {
		padding-left: 0.9rem;
		border-left: 1px solid var(--line);
		font-size: 0.8rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.grow {
		flex: 1;
	}

	.name {
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	.bar button {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		cursor: pointer;
	}

	.bar button:hover {
		color: var(--ink);
	}

	/* room under the content for the pill */
	.app:not(.immersive) {
		padding-bottom: 6.5rem;
	}

	@media (max-width: 560px) {
		.name {
			display: none;
		}
	}
</style>
