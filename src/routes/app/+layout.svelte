<!--
	The signed-in app (/app/): its own place, apart from the public site — no public header, no footer. Its door opens on
	the person's avenDB vault alone (Samuel 2026-10-20): their passkey unlocks it on this browser, Touch ID in the Mac app
	where they set it up, and nothing else signs them in ($lib/app/entry.js): maiaCITY's API knows them by their vault,
	from the pass their device signs for each call (api/src/founders.js). A browser new to them joins their human vault,
	and a person new to avenDB, as everyone just signed up, founds it, named as they say. While avenDB starts, a sheet shows each step, the passkey's prompts among them, with its seconds
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
	import { ApiError, me, passBy, signOut, type Founder } from '$lib/auth/client';
	import { claimInvite, failure, later, open, signUpName, waits } from '$lib/app/entry.js';
	import { pillContext } from '$lib/app/pill.svelte.js';
	import { session } from '$lib/avendb/session.svelte.js';
	import { pillVaults, seeded, signerName } from '$lib/avendb/vaults.js';
	import { remember } from '$lib/app/session';
	import { forwardConsole, native } from '$lib/native';
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

	/** the founder the person's vault is, as maiaCITY's API says (their number in the nav pill), if any */
	let founder = $state<Founder | null>(null);
	// avenDB starting; to unlock, or to sign in with the passkey where this browser holds no account (`locked`); or in
	let phase = $state<'loading' | 'locked' | 'ready'>('loading');
	/** what the way in is doing, while it does it */
	let busy = $state('');
	let error = $state('');
	/** avenDB didn't open: the person may go on without it in this tab */
	let stuck = $state(false);
	/** why the invite a link brought didn't go through, if it didn't */
	let invited = $state('');
	/** the key move (K3b) under way, and why it didn't go through, if it didn't */
	let moveBusy = $state(false);
	let moveError = $state('');
	/** the key move went through: said once, as the banner goes (Samuel 2026-10-20: after his touch "nothing happened"),
	 *  'avens' where only the server and the agents of their coop's aven moved (K3c), 'retired' where the old keys went */
	let moved = $state<boolean | 'avens' | 'retired' | 'checkpoint'>(false);
	/** the key move's last step, once every key moved (Samuel 2026-10-20: "you should have removed all the old keys"):
	 *  the earlier keys and the old devices it removes, each `{ kind, key }` ('root' hands the root on, 'owner' or
	 *  'device' goes), and whether it waits until this device holds what the coop's server holds (`behind`) */
	const retire = $derived(session.moving?.retire ?? []);
	/** what the last step removes, in words: earlier keys (owners, and devices whose next key took their place), and
	 *  the old devices never unlocked since the move, by name */
	const retireWhat = $derived.by(() => {
		const world = session.world;
		const next = (key: string) => world?.vaults.some((v: any) => v.devices.some((d: any) => d.id === key && d.next));
		const old = retire.filter((r) => r.kind === 'device' && !next(r.key));
		const keys = retire.filter((r) => r.kind === 'owner').length + retire.filter((r) => r.kind === 'device').length - old.length;
		const names = old.map((r) => (world ? signerName(world, r.key, true) : 'A device'));
		const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
		return [keys ? plural(keys, 'earlier key') : '', old.length ? `${plural(old.length, 'old device')} not unlocked since (${names.join(', ')})` : '']
			.filter(Boolean)
			.join(' and ');
	});
	/** what moves: their keys, the server and the agents of their coop's aven (K3c), or both */
	const moveWhat = $derived(
		!session.moving?.avens
			? 'Your keys move'
			: session.moving.device
				? 'Your keys, and your coop’s server and agents, move'
				: 'Your coop’s server and agents move'
	);
	/** who asks once more for the key move: the passkey's prompt, Touch ID, or both */
	const moveAsks = $derived(
		[session.moving?.passkey ? `${asks} once more` : '', session.moving?.touch ? 'Touch ID asks for a touch' : '']
			.filter(Boolean)
			.join(', and ')
	);

	/** Moves the person's keys to ML-DSA-65 now (session.moveKeys), showing why not if it didn't go through. */
	async function moveNow() {
		[moveBusy, moveError] = [true, ''];
		const avens = !!session.moving?.avens && !session.moving.device;
		const retiring = retire.length > 0;
		const checkpoint = !!session.moving?.checkpoint;
		if (await session.moveKeys()) moved = retiring ? 'retired' : checkpoint ? 'checkpoint' : avens ? 'avens' : true;
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
		// in the Mac app, every page's warnings and errors go into the app's log, which has a reader, as the studio's do
		forwardConsole(window, 'app');
		// the views and logic modules from the Maia City vault (C10), loaded beside avenDB's start so the app's pages run
		// them from the start; it never throws, and offline the repo's seed runs
		const code = loadCode();
		// each call to maiaCITY's API brings a pass this device signs for it, a new one each time: the API knows the person
		// by their vault (api/src/founders.js), with no sign-in of its own
		passBy(async () => {
			if (session.phase !== 'open') return null;
			const got = await session.ask({ op: 'api_pass', audience: API_AUDIENCE });
			return got?.ok?.pass ?? null;
		});
		await session.load();
		await code;
		settle();
	});

	/** The service maiaCITY's API names itself as in a device's pass (api/src/standing.ts `AUDIENCE`). */
	const API_AUDIENCE = 'maiaCITY API';
	/** the founder the API said this vault is, last time: shown while it is asked again (local first) */
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
	const refused = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

	/** The founder the person's vault is, as the API says by this device's pass: the last one it said meanwhile, and
	 *  none where it says no founder's passkey owns the vault. It keeps nobody out: the vault is the way in. */
	async function loadFounder() {
		founder = lastFounder();
		try {
			founder = await me();
			keepFounder(founder);
		} catch (e) {
			if (!refused(e)) return;
			founder = null;
			keepFounder(null);
		}
	}

	/** In, or avenDB waiting to be opened first, with the name a new human vault takes where it founds one. */
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
		remember(true);
		void loadFounder();
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

	/** Opens avenDB, the way in: the human vault founded named `named` where it takes one. */
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

	/** The gate's one button: opens the person's avenDB, which is the whole way in. */
	const enter = () => avendb(naming ? name.trim() : '');

	/** Signs out of this browser: it locks avenDB here, so the next way in asks for the passkey again, and a session an
	 *  API sign-in of before left here goes too. theOS has none: its avenDB runs while the app does. */
	async function leave() {
		await session.lock();
		await signOut().catch(() => {});
		remember(false);
		founder = null;
		keepFounder(null);
		await goto(`${base}/`);
	}

	const rel = $derived(page.url.pathname.slice(base.length));
	// full screen: a sandbox, a world, the turntables ($lib/app/Turntable.svelte), a
	// factory's hall, and the studio's editor
	const immersive = $derived(/^\/app\/(games\/[^/]+|worlds\/[^/]+|maiacity-v1|factories|biomes)\/?$/.test(rel) || rel.startsWith('/app/studio') || fullScreen.on);
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
	{#if phase !== 'ready'}<title>{session.phase === 'new' ? 'Sign in' : 'Unlock'} · maiaCITY</title>{:else if closed}<title>Not open to you yet · maiaCITY</title>{/if}
</svelte:head>

<!-- pinned to the home screen: a dark strip behind the status bar's white words, except over a world in full screen -->
{#if !(phase === 'ready' && immersive && !closed)}<div class="status-strip" aria-hidden="true"></div>{/if}
{#if phase === 'loading'}
	<div class="gate"><p class="quiet">One moment…</p></div>
{:else if phase !== 'ready'}
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
			{#if session.phase === 'new'}
				<p class="lede">The city’s own rooms — the games, your avenDB, what we build with — open to its founders, with one passkey.</p>
			{/if}
			<button class="pill-btn" disabled={!!busy} onclick={enter}>{busy ? `${busy}…` : session.phase === 'new' ? 'Sign in with your passkey' : 'Unlock now'}</button>
			<a class="back" href="{base}/">← Back to the homepage</a>
		{/if}
		{#if error}<p class="bad">{error}</p>{/if}
		{#if phase === 'locked' && (stuck || naming) && !busy}<button class="quiet later" onclick={without}>Go on without avenDB for now</button>{/if}
		<!-- for a newcomer, signed out or at a browser that holds someone's account, in the browser alone -->
		{#if phase === 'locked' && !naming && !native()}<p class="fine">New here? maiaCITY is invite only: an invite link from its admin <a href="{base}/join/">lets you join →</a></p>{/if}
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
		{:else if retire.length && session.moving?.behind}<p class="invite-note move-note" role="status">
				Your keys moved to ML-DSA-65. Removing the old ones waits until this device holds all your coop’s server holds: it is syncing.
			</p>
		{:else if retire.length && moveAsks}<p class="invite-note move-note" role="status">
				Your keys moved to ML-DSA-65. Remove the old ones now, {retireWhat}: {moveAsks}.
				<button class="quiet later" disabled={moveBusy} onclick={moveNow}>{moveBusy ? 'Removing…' : 'Remove old keys'}</button>
				{#if moveError}<span class="bad">{moveError}</span>{/if}
			</p>
		{:else if session.moving?.checkpoint && moveAsks}<p class="invite-note move-note" role="status">
				Your keys moved to ML-DSA-65. Sign one checkpoint over what your old keys signed, so their old signatures need no checking any more: {moveAsks}.
				<button class="quiet later" disabled={moveBusy} onclick={moveNow}>{moveBusy ? 'Signing…' : 'Sign checkpoint'}</button>
				{#if moveError}<span class="bad">{moveError}</span>{/if}
			</p>
		{:else if session.moving && moveAsks}<p class="invite-note move-note" role="status">
				{moveWhat} to ML-DSA-65, smaller and faster post-quantum signatures: {moveAsks}.
				<button class="quiet later" disabled={moveBusy} onclick={moveNow}>{moveBusy ? 'Moving…' : session.moving.device || !session.moving.avens ? 'Move my keys' : 'Move them'}</button>
				{#if moveError}<span class="bad">{moveError}</span>{/if}
			</p>
		{:else if moved}<p class="invite-note move-note" role="status">
				{#if moved === 'retired'}Your old keys are removed. Your other devices learn it as they sync with this one.
				{:else if moved === 'checkpoint'}Your checkpoint is signed. Your other devices learn it as they sync with this one.
				{:else if moved === 'avens'}Your coop’s server and agents moved to ML-DSA-65. Each signs with its new key from its next start.
				{:else}Your keys moved to ML-DSA-65. Your other devices learn it as they sync with this one.{/if}
				<button class="quiet later" onclick={() => (moved = false)}>OK</button>
			</p>{/if}
		<div class="app" class:immersive>
			<VaultRecipes hold={assetPage}>{@render children()}</VaultRecipes>
		</div>
	{/if}
	<NavPill {founder} name={session.name} onsignout={native() ? undefined : leave} />
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
