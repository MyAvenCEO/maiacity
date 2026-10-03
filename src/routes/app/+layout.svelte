<!--
	The signed-in app (/app/): its own place, apart from the public site — no public header, no footer. Whoever opens it
	is asked who they are first (their passkey); then the dashboard, the games and — for whoever holds them — the
	admin's tools. One nav pill at the foot of every page is the only way round ($lib/app/NavPill.svelte: back, home,
	you): no top bar, and no page has a back button of its own. A sandbox, a world and the studio's editor run full
	screen, the pill over them — and so does a game gone full screen over its own page (Sandbox 3's domes).
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { me, signIn, signOut, type Founder } from '$lib/auth/client';
	import { remember } from '$lib/app/session';
	import { command, native } from '$lib/native';
	import NavPill from '$lib/app/NavPill.svelte';
	import AskModal from '$lib/app/AskModal.svelte';
	import { immersive as fullScreen } from '$lib/app/immersive.svelte';
	import { gameAt, released } from '$lib/app/places';

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

	// maiaCITY Studio (the Mac app) cannot hold maia.city's passkey: it asks for a key, the browser opens the approval
	// page, the admin says yes with the passkey there, and the app is in
	let device = $state<{ user_code: string; url: string } | null>(null);
	async function enterApp() {
		busy = true;
		error = '';
		try {
			const { listen } = await import('@tauri-apps/api/event');
			const stop = await listen<{ signed_in: boolean; reason: string | null }>('auth', async ({ payload }) => {
				stop();
				device = null;
				busy = false;
				if (!payload.signed_in) return void (error = payload.reason ?? '');
				founder = await me();
				phase = 'ready';
			});
			device = await command('auth_start');
		} catch (e) {
			error = String(e);
			busy = false;
		}
	}

	async function enter() {
		if (native()) return enterApp();
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
		// the Mac app has no public site to go back to: it waits at its own sign-in
		if (native()) return void (phase = 'signed-out');
		await goto(`${base}/`);
	}

	const rel = $derived(page.url.pathname.slice(base.length));
	// full screen: a sandbox (Sandbox 3 is a page of cards), a world, the 3D models' and the actors' turntables, and
	// the studio's editor
	const immersive = $derived(/^\/app\/(games\/(?!sandbox-3\/?$)[^/]+|worlds\/[^/]+|models|actors)\/?$/.test(rel) || rel.startsWith('/app/studio') || fullScreen.on);
	// a draft game is the admins' only; anyone else with its link is told so
	const game = $derived(gameAt(page.url.pathname));
	const closed = $derived(!!game && !released(founder, game));
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	{#if phase !== 'ready'}<title>Sign in · maiaCITY</title>{:else if closed}<title>Not released yet · maiaCITY</title>{/if}
</svelte:head>

<!-- pinned to the home screen: a dark strip behind the status bar's white words, except over a world in full screen -->
{#if !(phase === 'ready' && immersive && !closed)}<div class="status-strip" aria-hidden="true"></div>{/if}
{#if phase === 'loading'}
	<div class="gate"><p class="quiet">One moment…</p></div>
{:else if phase === 'signed-out' || !founder}
	<div class="gate">
		<a class="logo" href="{base}/">maia<strong>CITY</strong></a>
		<h1>Welcome back.</h1>
		<p class="lede">The city's own rooms — the games, and what we build with — open to its founders.</p>
		{#if device}
			<p class="lede">Your browser opened maia.city. Approve this Mac there with your passkey — the code is</p>
			<p class="code">{device.user_code}</p>
			<p class="fine">Waiting for your approval… <button class="quiet" onclick={() => command('auth_open', { url: device!.url })}>Open the page again</button></p>
		{:else}
			<button class="pill-btn" disabled={busy} onclick={enter}>{busy ? 'One moment…' : 'Sign in with your passkey'}</button>
		{/if}
		{#if error}<p class="bad">{error}</p>{/if}
		{#if !native()}<p class="fine">Not a founder yet? <a href="{base}/join/">Join the line →</a></p>{/if}
	</div>
{:else}
	{#if closed}
		<div class="gate">
			<h1>Not released yet.</h1>
			<p class="lede">{game?.label} is still being built. It opens to every founder once it is released.</p>
		</div>
	{:else}
		<div class="app" class:immersive>
			{@render children()}
		</div>
	{/if}
	<NavPill {founder} onsignout={leave} />
{/if}
{#if native() && phase === 'ready'}<AskModal />{/if}

<style>
	.gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		min-height: 100svh;
		padding: calc(2rem + env(safe-area-inset-top, 0px)) 1rem calc(2rem + env(safe-area-inset-bottom, 0px));
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

	/* the device code the Mac app shows while the browser asks for the passkey */
	.code {
		margin: 0.2rem 0 0.4rem;
		padding: 0.5rem 1rem;
		border-radius: 12px;
		background: var(--cream);
		font-family: ui-monospace, monospace;
		font-size: 2rem;
		letter-spacing: 0.12em;
	}

	.logo {
		font-family: var(--font-display);
		font-size: 1.35rem;
		color: var(--ink);
		text-decoration: none;
	}

	/* Every page of the app sits in it. Its own layers stay inside it (isolation), so the nav pill is always over them;
	   a page that is not full screen keeps clear of the status bar of the pinned app (see-through over the page) and
	   has room at its foot for the pill */
	.app {
		isolation: isolate;
	}

	.app:not(.immersive) {
		padding-top: env(safe-area-inset-top, 0px);
		padding-bottom: calc(var(--nav-room) + 1.5rem);
	}
</style>
