<!--
	The signed-in app (/app/): its own place, apart from the public site — no public header, no footer. Whoever opens it
	is asked who they are first, with their passkey, which in the same touch opens their avenDB on this browser: one way
	in for the app and their own database together, never a second sign-in on avenDB's pages ($lib/app/entry.js); a
	browser new to them joins their human vault, and a person new to avenDB, as everyone just signed up, founds it,
	named as they say. Then the dashboard, the games and — for whoever holds them — the admin's tools. One nav pill at the foot of every page is the only way round ($lib/app/NavPill.svelte: back, home,
	you): no top bar, and no page has a back button of its own. A sandbox, a world and the studio's editor run full
	screen, the pill over them — and so does a game gone full screen over its own page (Sandbox 3's domes). A page that
	builds assets (a world, a viewer, the box's lab: $lib/assets/vault.js ASSET_PAGES) opens once the Maia City vault's
	recipes are in, and says so on the page when they can't be, or when one it asks for is not in the vault
	($lib/assets/VaultRecipes.svelte).
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { me, signOut, type Founder } from '$lib/auth/client';
	import { failure, later, open, signIn, signUpName, waits } from '$lib/app/entry.js';
	import { pillContext } from '$lib/app/pill.svelte.js';
	import { session } from '$lib/avendb/session.svelte.js';
	import { pillVaults, seeded } from '$lib/avendb/vaults.js';
	import { remember } from '$lib/app/session';
	import { command, native } from '$lib/native';
	import NavPill from '$lib/app/NavPill.svelte';
	import AskModal from '$lib/app/AskModal.svelte';
	import { immersive as fullScreen } from '$lib/app/immersive.svelte';
	import { gameAt, released } from '$lib/app/places';
	import { loadGames } from '$lib/app/games.svelte.js';
	import { loadCode } from '../../../game/code/index.js';
	import VaultRecipes from '$lib/assets/VaultRecipes.svelte';
	import { ASSET_PAGES } from '$lib/assets/vault.js';

	let { children } = $props();

	let founder = $state<Founder | null>(null);
	// signed out; signed in, avenDB waiting for the passkey (`locked`); or in
	let phase = $state<'loading' | 'signed-out' | 'locked' | 'ready'>('loading');
	/** what the way in is doing, while it does it */
	let busy = $state('');
	let error = $state('');
	/** avenDB didn't open: the person may go on without it in this tab */
	let stuck = $state(false);
	/** the passkey roots no human vault yet, or the person just signed up: the name its profile takes, to found it */
	let naming = $state(false);
	let name = $state('');

	onMount(async () => {
		void loadGames();
		// the views and logic modules from the Maia City vault (C10), loaded beside the sign-in check so the app's pages
		// run them from the start; it never throws, and offline the repo's seed runs. This browser's avenDB too, whose
		// passkey the way in asks for
		const code = loadCode();
		const avendb = session.load();
		founder = await me().catch(() => null);
		await code;
		remember(!!founder);
		if (!founder) return void (phase = 'signed-out');
		await avendb;
		settle();
	});

	/** Signed in: in, or avenDB waiting for the passkey first, with the name a new human vault takes where it founds one. */
	function settle() {
		name = signUpName();
		naming = !!name && session.phase === 'new';
		if (waits()) phase = 'locked';
		else done();
	}

	/** In: what avenDB shows of the person is read once (their name, their vaults); a vault just founded with the
	 *  server's claim opens on avenDB's page, which brings the repo's seed into the Maia City it founded. */
	async function done(founded = false) {
		phase = 'ready';
		if (session.phase !== 'open') return;
		await session.refresh().catch(() => {});
		if (founded && session.world && seeded(session.world)[3]?.[0]) await goto(`${base}/app/avendb/`);
	}

	const say = (what: string) => (busy = what);

	/** avenDB didn't open after the sign-in: in anyway where another tab holds it, the name asked for where the passkey
	 *  roots no vault yet, else why, and the way on without it. */
	function failed(e: unknown) {
		const f = failure(e);
		if (f.kind === 'held') return void done();
		phase = 'locked';
		if (f.kind === 'no-account') return void ([naming, error] = [true, '']);
		[stuck, error] = [true, f.message];
	}

	/** Opens avenDB, the person signed in: the human vault founded named `named` where it takes one. */
	async function avendb(named = '') {
		[error, stuck] = ['', false];
		try {
			done(await open(say, named));
		} catch (e) {
			failed(e);
		} finally {
			busy = '';
		}
	}

	/** Goes on without avenDB in this tab. */
	function without() {
		later();
		[stuck, naming, error] = [false, false, ''];
		done();
	}

	// on the Mac, the studio's worker (Jobs and studio 2.0) runs while the app does, once its avenDB is open: what a rule
	// wants is made whichever page is open; tried again every two minutes until avenDB opens
	$effect(() => {
		if (!native() || phase !== 'ready') return;
		let stopped = false;
		const tryStart = async () => {
			const { macWorker } = await import('$lib/studio/jobs/mac.js');
			const w = await macWorker().catch(() => null);
			if (!w && !stopped) timer = setTimeout(tryStart, 120_000);
		};
		let timer = setTimeout(tryStart, 5_000);
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	});

	// on the Mac, the page answers what the MCP asks of an avenDB cut (a render, a frame, its jobs) with the studio's own
	// code (vault/app/src/page.rs, $lib/studio/pagecalls.js)
	$effect(() => {
		if (!native() || phase !== 'ready') return;
		let stop: (() => void) | null = null;
		let gone = false;
		import('$lib/studio/pagecalls.js')
			.then((m) => m.servePageCalls())
			.then((s) => (gone ? s() : (stop = s)))
			.catch(() => {});
		return () => {
			gone = true;
			stop?.();
		};
	});

	// maiaCITY Studio (the Mac app) cannot hold maia.city's passkey: it asks for a key, the browser opens the approval
	// page, the admin says yes with the passkey there, and the app is in
	let device = $state<{ user_code: string; url: string } | null>(null);
	async function enterApp() {
		busy = 'Waiting for your approval';
		error = '';
		try {
			const { listen } = await import('@tauri-apps/api/event');
			const stop = await listen<{ signed_in: boolean; reason: string | null }>('auth', async ({ payload }) => {
				stop();
				device = null;
				busy = '';
				if (!payload.signed_in) return void (error = payload.reason ?? '');
				founder = await me();
				remember(true);
				// then the Mac's avenDB, in the app's sign-in sheet, which needs no second click
				await session.load();
				settle();
				if (phase === 'locked' && !naming) void avendb();
			});
			device = await command('auth_start');
		} catch (e) {
			error = String(e);
			busy = '';
		}
	}

	/** The gate's one button: signs in and opens avenDB, in one ceremony of the passkey where this browser holds the
	 *  person's account; avenDB alone where they are signed in already. */
	async function enter() {
		if (founder) return avendb(naming ? name.trim() : '');
		if (native()) return enterApp();
		[error, stuck] = ['', false];
		try {
			const signed = await signIn(say);
			// the sign-in answers who they are; their role and caps (the admin's tools, a draft game) come with /api/me
			founder = (await me().catch(() => null)) ?? signed.founder;
			remember(true);
			if (signed.why) return failed(signed.why);
			settle();
			if (phase === 'locked' && !naming) await avendb();
		} catch (e) {
			error = failure(e).message;
		} finally {
			busy = '';
		}
	}

	async function leave() {
		// signing out locks avenDB on this browser too: the next way in asks for the passkey again
		await session.lock();
		await signOut();
		remember(false);
		founder = null;
		// the Mac app has no public site to go back to: it waits at its own sign-in
		if (native()) return void (phase = 'signed-out');
		await goto(`${base}/`);
	}

	const rel = $derived(page.url.pathname.slice(base.length));
	// full screen: a sandbox (Sandbox 3 is a page of cards), a world, the turntables ($lib/app/Turntable.svelte), a
	// factory's hall, and the studio's editor
	const immersive = $derived(/^\/app\/(games\/(?!sandbox-3\/?$)[^/]+|worlds\/[^/]+|maiacity-v1|models|actors|factories|machines|biomes|plants)\/?$/.test(rel) || rel.startsWith('/app/studio') || fullScreen.on);
	// a draft game is the admins' only; anyone else with its link is told so
	const game = $derived(gameAt(page.url.pathname));
	const closed = $derived(!!game && !released(founder, game));
	// the Proposals app is open signed out too: public is watch and read only (Samuel 2026-10-17), so it shows the
	// proposals of the published games, and nothing there writes without a sign-in
	const watching = $derived(phase === 'signed-out' && rel.startsWith('/app/aips/'));
	// a page that builds assets waits for the Maia City vault's recipes, loaded once, the first time one is opened
	const assetPage = $derived(ASSET_PAGES.test(rel));

	// the person's vaults in the nav pill, on every page, once avenDB is open: their own, their profile, first, and
	// picking one opens it on avenDB's page, whose own list (with what waits in each) takes this one's place there
	const vaultsOpen = $derived(phase === 'ready' && !!session.world);
	$effect(() => {
		if (!vaultsOpen) return;
		return pillContext({
			base: true,
			title: 'Your vaults',
			get list() {
				return session.world ? pillVaults(session.world) : [];
			},
			get current() {
				return session.vault;
			},
			pick: (id) => {
				session.vault = id;
				void goto(`${base}/app/avendb/#home`);
			}
		});
	});
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	{#if phase !== 'ready' && !watching}<title>{phase === 'locked' ? 'Unlock' : 'Sign in'} · maiaCITY</title>{:else if closed}<title>Not released yet · maiaCITY</title>{/if}
</svelte:head>

<!-- pinned to the home screen: a dark strip behind the status bar's white words, except over a world in full screen -->
{#if !(phase === 'ready' && immersive && !closed)}<div class="status-strip" aria-hidden="true"></div>{/if}
{#if phase === 'loading'}
	<div class="gate"><p class="quiet">One moment…</p></div>
{:else if watching}
	<div class="app">
		{@render children()}
	</div>
{:else if phase !== 'ready' || !founder}
	<div class="gate">
		<a class="logo" href="{base}/">maia<strong>CITY</strong></a>
		{#if naming}
			<h1>Your human vault.</h1>
			<p class="lede">
				Your passkey founds your own vault in avenDB: end-to-end encrypted, held by you alone. Its name is the name the city
				knows you by, and it lives in your vault, nowhere else.
			</p>
			<input class="name" bind:value={name} maxlength="60" autocomplete="name" placeholder="Your name" aria-label="Your name" />
			<button class="pill-btn" disabled={!!busy || name.trim().length < 2} onclick={enter}>{busy ? `${busy}…` : 'Set up my human vault'}</button>
			<p class="fine">{native() ? 'The sign-in sheet asks' : 'Your browser asks'} for your passkey twice.</p>
		{:else}
			<h1>Welcome back.</h1>
			{#if phase !== 'locked'}
				<p class="lede">The city’s own rooms — the games, your avenDB, what we build with — open to its founders, with one passkey.</p>
			{/if}
			{#if device}
				<p class="lede">Your browser opened maia.city. Approve this Mac there with your passkey — the code is</p>
				<p class="code">{device.user_code}</p>
				<p class="fine">Waiting for your approval… <button class="quiet" onclick={() => command('auth_open', { url: device!.url })}>Open the page again</button></p>
			{:else}
				<button class="pill-btn" disabled={!!busy} onclick={enter}>{busy ? `${busy}…` : phase === 'locked' ? 'Unlock with your passkey' : 'Sign in with your passkey'}</button>
				<a class="back" href="{base}/">← Back to the homepage</a>
			{/if}
		{/if}
		{#if error}<p class="bad">{error}</p>{/if}
		{#if phase === 'locked' && (stuck || naming) && !busy}<button class="quiet later" onclick={without}>Go on without avenDB for now</button>{/if}
		<!-- for a newcomer, signed out or at a browser that holds someone's account, in the browser alone -->
		{#if (phase === 'signed-out' || (phase === 'locked' && !naming)) && !native()}<p class="fine">New here? maiaCITY is invite only: an invite link from its admin <a href="{base}/join/">lets you join →</a></p>{/if}
	</div>
{:else}
	{#if closed}
		<div class="gate">
			<h1>Not released yet.</h1>
			<p class="lede">{game?.label} is still being built. It opens to every founder once it is released.</p>
		</div>
	{:else}
		<div class="app" class:immersive>
			<VaultRecipes hold={assetPage}>{@render children()}</VaultRecipes>
		</div>
	{/if}
	<NavPill {founder} name={session.name} onsignout={leave} />
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
		max-width: 30rem;
		color: var(--terracotta);
	}

	.back {
		font-size: 0.9rem;
		color: var(--muted);
	}

	.later {
		border: 0;
		background: none;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	/* the name a new human vault takes */
	.name {
		width: min(20rem, 100%);
		padding: 0.6rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		font: inherit;
		text-align: center;
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
