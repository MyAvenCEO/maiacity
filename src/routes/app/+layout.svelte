<!--
	The signed-in app (/app/): its own place, apart from the public site — no public header, no footer. Whoever opens it
	is asked who they are first, with their passkey, which in the same touch opens their avenDB on this browser: one way
	in for the app and their own database together, never a second sign-in on avenDB's pages ($lib/app/entry.js); a
	browser new to them joins their human vault, and a person new to avenDB, as everyone just signed up, founds it,
	named as they say. While avenDB starts, a sheet shows each step, the passkey's prompts among them, with its seconds
	(Samuel 2026-10-18: what happens while the passkey's window is open or the device works). Then the dashboard; the games, worlds and game assets, each opened by the cap group of the Maia City vault it needs, which the person holds in their avenDB ($lib/app/access.svelte.js); and for whoever holds them, the admin's tools. One nav pill at the foot of every page is the only way round ($lib/app/NavPill.svelte: back, home,
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
	import { ApiError, loginFinish, me, sheetAssertion, signOut, type Founder } from '$lib/auth/client';
	import { claimInvite, failure, later, open, signIn, signUpName, waits } from '$lib/app/entry.js';
	import { pillContext } from '$lib/app/pill.svelte.js';
	import { session } from '$lib/avendb/session.svelte.js';
	import { pillVaults, seeded } from '$lib/avendb/vaults.js';
	import { remember } from '$lib/app/session';
	import { native } from '$lib/native';
	import NavPill from '$lib/app/NavPill.svelte';
	import { immersive as fullScreen } from '$lib/app/immersive.svelte';
	import { gameAt, opens } from '$lib/app/places';
	import { access, readAccess } from '$lib/app/access.svelte.js';
	import { loadCode } from '../../../game/code/index.js';
	import VaultRecipes from '$lib/assets/VaultRecipes.svelte';
	import StatusPill from '$lib/app/StatusPill.svelte';
	import { ASSET_PAGES } from '$lib/assets/vault.js';
	import Signing from '$lib/avendb/Signing.svelte';
	import { asks, here, type Steps } from '$lib/avendb/session.svelte.js';
	import { plan, reported, rows, stepWords, type Report, type Stage } from '$lib/avendb/steps.js';
	import { ADMIN, CITIZEN } from '$lib/avendb/capgroups.js';

	let { children } = $props();

	let founder = $state<Founder | null>(null);
	// signed out; signed in, avenDB waiting for the passkey (`locked`); or in
	let phase = $state<'loading' | 'signed-out' | 'locked' | 'ready'>('loading');
	/** what the way in is doing, while it does it */
	let busy = $state('');
	let error = $state('');
	/** the API couldn't say who this is yet, and why: the way in waits for it */
	let reaching = $state('');
	/** avenDB didn't open: the person may go on without it in this tab */
	let stuck = $state(false);
	/** why the invite a link brought didn't go through, if it didn't */
	let invited = $state('');
	/** the key move (K3b) under way, and why it didn't go through, if it didn't */
	let moveBusy = $state(false);
	let moveError = $state('');
	/** the key move went through: said once, as the banner goes (Samuel 2026-10-20: after his touch "nothing happened") */
	let moved = $state(false);
	/** who asks once more for the key move: the passkey's prompt, Touch ID, or both */
	const moveAsks = $derived(
		[session.moving?.passkey ? `${asks} once more` : '', session.moving?.touch ? 'Touch ID asks for a touch' : '']
			.filter(Boolean)
			.join(', and ')
	);

	/** Moves the person's keys to ML-DSA-65 now (session.moveKeys), showing why not if it didn't go through. */
	async function moveNow() {
		[moveBusy, moveError] = [true, ''];
		if (await session.moveKeys()) moved = true;
		else moveError = session.error;
		moveBusy = false;
	}
	/** the passkey roots no human vault yet, or the person just signed up: the name its profile takes, to found it */
	let naming = $state(false);
	let name = $state('');
	/**
	 * avenDB's start under way at the way in, or just over, which the sheet shows step by step with the seconds each took
	 * (Signing.svelte): the passkey's prompts among them, so the person sees what happens while the prompt is open and
	 * after it (`starts`). The page's clock ticks for it while it runs.
	 */
	let start = $state<{
		title: string;
		asks: string;
		plan: string[];
		own: Stage[];
		report: Report | null;
		began: number;
		t0: number;
		ended: number;
		error: string;
	} | null>(null);
	let clock = $state(0);
	let tick: ReturnType<typeof setInterval> | undefined;
	const words = stepWords(here);
	const shown = $derived(
		start
			? rows([...start.own, ...reported(start.report, start.t0)], start.plan, words, { now: clock, ended: start.ended, failed: !!start.error })
			: []
	);

	onMount(async () => {
		// the views and logic modules from the Maia City vault (C10), loaded beside the sign-in check so the app's pages
		// run them from the start; it never throws, and offline the repo's seed runs. This browser's avenDB too, whose
		// passkey the way in asks for
		const code = loadCode();
		const avendb = session.load();
		founder = await whoAmI();
		await code;
		remember(!!founder);
		if (!founder) return void (phase = 'signed-out');
		await avendb;
		settle();
	});

	/** how long the way in waits for the API to say who this is before it goes on without it (ms) */
	const ME_WAIT = 8000;
	/** who signed in here last, as the API said it: who the app opens for while the API can't be reached */
	const LAST = 'maia:founder';
	const lastFounder = (): Founder | null => {
		try {
			return JSON.parse(localStorage.getItem(LAST) ?? 'null');
		} catch {
			return null;
		}
	};
	const keepFounder = (f: Founder | null) => {
		try {
			if (f) localStorage.setItem(LAST, JSON.stringify(f));
			else localStorage.removeItem(LAST);
		} catch {
			/* no storage */
		}
	};
	/** the API's word on who this is, or a failure once it took longer than `ME_WAIT` */
	const askMe = () =>
		Promise.race([me(), new Promise<never>((_, no) => setTimeout(() => no(new Error(`no answer within ${ME_WAIT / 1000} s`)), ME_WAIT))]);
	const refused = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

	/**
	 * Who the API says is signed in. Only its refusal (401, 403) signs out: an API that can't be reached, or answers
	 * anything else (mid-deploy, a restart), never sends the person to the passkey's sign-in for a blip (Samuel
	 * 2026-10-20: The OS opened while the API redeployed and asked for a passkey it never needs). Local first (Samuel
	 * 2026-10-20: "everything should be offline / local first"): where someone signed in here before, the app opens for
	 * them at once and asks the API again meanwhile (`askAgain`), their avenDB opening on this device as ever; the first
	 * sign-in on a device waits for the API.
	 */
	async function whoAmI(): Promise<Founder | null> {
		for (let tries = 1, wait = 1000; ; tries++, wait = Math.min(wait * 2, 15000)) {
			try {
				const who = await askMe();
				reaching = '';
				keepFounder(who);
				return who;
			} catch (e) {
				if (refused(e)) {
					reaching = '';
					keepFounder(null);
					return null;
				}
				const last = lastFounder();
				if (last) {
					void askAgain(wait);
					return last;
				}
				const why = e instanceof ApiError ? `it answered ${e.status}` : String((e as Error)?.message ?? e);
				reaching = `maiaCITY can't be reached (${why}): trying again${tries > 1 ? `, ${tries} tries so far` : ''}`;
				await new Promise((r) => setTimeout(r, wait));
			}
		}
	}

	/** The API asked again while the app runs on who signed in here last: its word kept once it has one, and its refusal
	 *  (the session ran out meanwhile) asks them to sign in again. @param {number} wait */
	async function askAgain(wait: number) {
		for (;;) {
			await new Promise((r) => setTimeout(r, wait));
			wait = Math.min(wait * 2, 60000);
			try {
				const who = await askMe();
				keepFounder(who);
				founder = who;
				return;
			} catch (e) {
				if (!refused(e)) continue;
				keepFounder(null);
				remember(false);
				founder = null;
				phase = 'signed-out';
				return;
			}
		}
	}

	/** Signed in: in, or avenDB waiting for the passkey first, with the name a new human vault takes where it founds one. */
	function settle() {
		name = signUpName();
		naming = !!name && session.phase === 'new';
		if (waits()) phase = 'locked';
		else done();
	}

	/** In: what avenDB shows of the person is read once (their name, their vaults); the invite a link brought them
	 *  claimed, a newcomer's or theirs from before ($lib/app/entry.js); a vault just founded with the server's claim
	 *  opens on avenDB's page, which brings the repo's seed into the Maia City it founded. */
	async function done(founded = false) {
		phase = 'ready';
		if (session.phase !== 'open') return;
		// the views, logic and configs again, off this device's own copy of Maia City now that it is open
		void loadCode();
		await session.refresh().catch(() => {});
		invited = await claimInvite();
		if (founded && session.world && seeded(session.world)[0]?.[0]) await goto(`${base}/app/`);
	}

	const say = (what: string) => (busy = what);

	/** Begins the sheet for a start of avenDB of kind `kind`, titled as the way in says what it does; a founding ends by
	 *  naming the vault. How the session marks the start's steps: the page's own, and the device's from when it starts. */
	function starts(kind: 'found' | 'link' | 'open'): Steps {
		const steps = plan(kind, { mac: native() }).filter((step) => step !== 'seed');
		const prompts = steps.filter((step) => words[step]?.prompt).length;
		const began = performance.now();
		const asked = `${asks[0].toUpperCase()}${asks.slice(1)} ${prompts === 1 ? 'once' : 'twice'}`;
		start = { title: busy, asks: asked, plan: kind === 'found' ? [...steps, 'profile'] : steps, own: [], report: null, began, t0: began, ended: 0, error: '' };
		const s = start;
		clearInterval(tick);
		[clock, tick] = [began, setInterval(() => (clock = performance.now()), 100)];
		/** the page's own step under way, if any, is over at `at` */
		const over = (at: number) => s.own.filter((o) => o.end == null).forEach((o) => (o.end = at));
		return {
			step: (step) => {
				const at = performance.now();
				over(at);
				s.own.push({ step, start: at, end: null });
			},
			device: () => {
				over((s.t0 = performance.now()));
				return (report) => (s.report = report);
			}
		};
	}

	/** The sheet's start is over: through, when the sheet closes by itself a little after; or failed, saying why
	 *  `e`, where it says more than that the person closed the passkey's prompt, which closes it. */
	function ended(e?: unknown) {
		const s = start;
		if (!s || s.ended) return;
		clearInterval(tick);
		const f = e === undefined ? null : failure(e);
		if (f && (!f.message || f.kind === 'held' || f.kind === 'no-account')) return void (start = null);
		const at = performance.now();
		s.own.filter((o) => o.end == null).forEach((o) => (o.end = at));
		[s.ended, s.error, clock] = [at, f?.message ?? '', at];
		if (!f) setTimeout(() => start === s && (start = null), 3000);
	}

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
			const founded = await open(say, named, starts);
			ended();
			done(founded);
		} catch (e) {
			ended(e);
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

	// on the Mac, the job runner (Jobs and studio 2.0) runs while the app does, once its avenDB is open: what a rule
	// wants is made whichever page is open; tried again every two minutes until avenDB opens
	$effect(() => {
		if (!native() || phase !== 'ready') return;
		let stopped = false;
		const tryStart = async () => {
			const { macRunner } = await import('$lib/studio/jobs/mac.js');
			const r = await macRunner().catch(() => null);
			if (!r && !stopped) timer = setTimeout(tryStart, 120_000);
		};
		// a minute after the app opens: its pages, avenDB and the dashboard's worlds load first
		let timer = setTimeout(tryStart, 60_000);
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

	// The OS (the Mac app) cannot use maia.city's passkey in its own web view: the passkey signs a sign-in's challenge in
	// the app's sign-in sheet, as every other ceremony (src/routes/app/avendb/sheet/), and the app signs in with that
	// answer, which reaches it alone, as a browser does: it keeps the session the API answers with (vault/app/src/auth.rs)
	async function enterApp() {
		busy = 'Waiting for your passkey';
		error = '';
		try {
			await loginFinish(await sheetAssertion());
			founder = await me();
			keepFounder(founder);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return void (busy = '');
		}
		busy = '';
		remember(true);
		// then the Mac's avenDB, in the app's sign-in sheet, which needs no second click
		await session.load();
		settle();
		if (phase === 'locked' && !naming) void avendb();
	}

	/** The gate's one button: signs in and opens avenDB, in one ceremony of the passkey where this browser holds the
	 *  person's account; avenDB alone where they are signed in already. */
	async function enter() {
		if (founder) return avendb(naming ? name.trim() : '');
		if (native()) return enterApp();
		[error, stuck] = ['', false];
		try {
			const signed = await signIn(say, starts);
			ended(signed.why ?? undefined);
			// the sign-in answers who they are; their role and caps (the admin's tools, a draft game) come with /api/me
			founder = (await me().catch(() => null)) ?? signed.founder;
			keepFounder(founder);
			remember(true);
			if (signed.why) return failed(signed.why);
			settle();
			if (phase === 'locked' && !naming) await avendb();
		} catch (e) {
			ended(e);
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
		keepFounder(null);
		// the Mac app has no public site to go back to: it waits at its own sign-in
		if (native()) return void (phase = 'signed-out');
		await goto(`${base}/`);
	}

	const rel = $derived(page.url.pathname.slice(base.length));
	// full screen: a sandbox (Sandbox 3 is a page of cards), a world, the turntables ($lib/app/Turntable.svelte), a
	// factory's hall, and the studio's editor
	const immersive = $derived(/^\/app\/(games\/(?!sandbox-3\/?$)[^/]+|worlds\/[^/]+|maiacity-v1|factories|biomes)\/?$/.test(rel) || rel.startsWith('/app/studio') || fullScreen.on);
	// a game, world or game asset page opens by the Maia City cap group it needs ($lib/app/access.svelte.js), read from
	// the person's avenDB as it shows its world anew; until that is read it waits, and anyone without it is told what
	// opens it
	const game = $derived(gameAt(page.url.pathname));
	$effect(() => {
		if (phase !== 'ready') return;
		void session.world;
		readAccess();
	});
	const waiting = $derived(!!game?.needs && !access.owner && !access.known && session.phase === 'open');
	const closed = $derived(!!game && !waiting && !opens(game));
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
				void goto(`${base}/app/#home`);
			}
		});
	});
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	{#if phase !== 'ready' && !watching}<title>{phase === 'locked' ? 'Unlock' : 'Sign in'} · maiaCITY</title>{:else if closed}<title>Not open to you yet · maiaCITY</title>{/if}
</svelte:head>

<!-- pinned to the home screen: a dark strip behind the status bar's white words, except over a world in full screen -->
{#if !(phase === 'ready' && immersive && !closed)}<div class="status-strip" aria-hidden="true"></div>{/if}
{#if phase === 'loading'}
	<div class="gate"><p class="quiet">{reaching ? `${reaching}…` : 'One moment…'}</p></div>
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
			<button class="pill-btn" disabled={!!busy} onclick={enter}>{busy ? `${busy}…` : phase === 'locked' ? 'Unlock now' : 'Sign in with your passkey'}</button>
			<a class="back" href="{base}/">← Back to the homepage</a>
		{/if}
		{#if error}<p class="bad">{error}</p>{/if}
		{#if phase === 'locked' && (stuck || naming) && !busy}<button class="quiet later" onclick={without}>Go on without avenDB for now</button>{/if}
		<!-- for a newcomer, signed out or at a browser that holds someone's account, in the browser alone -->
		{#if (phase === 'signed-out' || (phase === 'locked' && !naming)) && !native()}<p class="fine">New here? maiaCITY is invite only: an invite link from its admin <a href="{base}/join/">lets you join →</a></p>{/if}
	</div>
{:else}
	{#if waiting}
		<div class="gate"><p class="quiet">One moment…</p></div>
	{:else if closed}
		<div class="gate">
			<h1>Not open to you yet.</h1>
			<p class="lede">
				{#if session.phase !== 'open'}{game?.label} opens with your avenDB, which holds what Maia City gave you: unlock it with your passkey.
				{:else if game?.needs === ADMIN}{game.label} is the admins’ own.
				{:else if game?.needs === CITIZEN}{game.label} is for citizens, which travelers become later on.
				{:else}{game?.label} opens to every traveler, as everyone invited to Maia City is: ask for an invite.{/if}
			</p>
		</div>
	{:else}
		{#if invited}<p class="invite-note" role="status">{invited} <button class="quiet later" onclick={() => (invited = '')}>OK</button></p>
		{:else if session.moving && moveAsks}<p class="invite-note move-note" role="status">
				Your keys move to ML-DSA-65, smaller and faster post-quantum signatures: {moveAsks}.
				<button class="quiet later" disabled={moveBusy} onclick={moveNow}>{moveBusy ? 'Moving…' : 'Move my keys'}</button>
				{#if moveError}<span class="bad">{moveError}</span>{/if}
			</p>
		{:else if moved}<p class="invite-note move-note" role="status">
				Your keys moved to ML-DSA-65. Your other devices learn it as they sync with this one.
				<button class="quiet later" onclick={() => (moved = false)}>OK</button>
			</p>{/if}
		<div class="app" class:immersive>
			<VaultRecipes hold={assetPage}>{@render children()}</VaultRecipes>
		</div>
	{/if}
	<NavPill {founder} name={session.name} onsignout={leave} />
	<StatusPill />
{/if}
<!-- what the passkey's prompt and avenDB's start are doing, step by step, at the way in and as it hands over to the app -->
{#if start}
	<div class="sheet">
		<Signing
			title={start.title}
			asks={start.asks}
			rows={shown}
			total={(start.ended || clock) - start.began}
			over={!!start.ended}
			error={start.error}
			onclose={() => (start = null)}
		/>
	</div>
{/if}

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

	/* why the invite a link brought didn't go through */
	.invite-note {
		position: fixed;
		z-index: 30;
		top: calc(0.8rem + env(safe-area-inset-top, 0px));
		left: 50%;
		max-width: min(36rem, calc(100% - 2rem));
		margin: 0;
		padding: 0.6rem 1rem;
		border-radius: 14px;
		background: var(--paper);
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
		color: var(--terracotta);
		font-size: 0.9rem;
		transform: translateX(-50%);
	}

	/* the key move's one ask (K3b): news, not trouble */
	.move-note {
		color: var(--ink);
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

	/* the sheet of avenDB's start, in the colours of avenDB's page (src/routes/app/avendb/+page.svelte) */
	.sheet {
		display: contents;
		--ok: #3f7a4f;
		--bad: #b5523a;
		--soft: rgb(0 0 0 / 0.55);
		--edge: rgb(0 0 0 / 0.1);
		--card: #fff;
		--accent: #2f6d62;
		text-align: left;
	}

	.sheet :global(.btn) {
		padding: 0.38rem 0.8rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 500;
		color: #fff;
		cursor: pointer;
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
