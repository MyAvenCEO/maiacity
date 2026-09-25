<!--
	avenCITY Sandbox 2 — the planet, its cities, and the islands inside them.

	On the planet every city is one card, its tower counting citizens. Click a
	city and the camera dives into the card: it opens as the city's own island
	of cells (Sandbox 1's world, copied in), where settlements — dome clusters —
	stand, each at the level its headcount has reached.

	Joining a city takes two steps. First citizenship: at least 25,000 of your
	own hearts into the city. Then a home: found a settlement on a free cell, or
	move into one with an invite link from a settler — 5,000 hearts either way.
	Every heart becomes the city's HEARTS; every investor receives MINDS.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { accrued, format, gameClock, parse } from '../../../../game/time';
	import { ONE, STARTING } from '../../../../game/policy';
	import { coopPolicy, mindsFor, room } from '../../../../game/coops';
	import { buildable, cellKey } from '../../../../game/island/island';
	import type { HexTile } from '../../../../game/island/hexmap';
	import { loadBiomeMap, loadDepthMap, loadLandMask, loadMountainMask } from '../../../../game/map';
	import * as api from '$lib/sandbox-2/api';
	import Island from '$lib/sandbox-2/Island.svelte';
	import Tour, { type TourStep } from '$lib/sandbox-2/Tour.svelte';
	import DomeInterior from '$lib/sandbox-2/DomeInterior.svelte';
	import { planFor } from '../../../../game/island/villages';
	import type { DomeKind } from '$lib/sandbox-2/interior/interior';
	import type { WorldHandle } from '$lib/sandbox-2/world/world';

	const CITIZENSHIP = BigInt(coopPolicy.city.citizenshipMinHearts) * ONE;
	const SETTLING = BigInt(coopPolicy.settlement.joinMinHearts) * ONE;
	const INVITE_KEY = 'sandbox2.invite';
	const TOUR_KEY = 'sandbox2.tour';

	let stage: HTMLDivElement;
	let world: WorldHandle | null = null;
	let islandView: Island | undefined = $state();
	let loading = $state(true);

	let cityData = $state<api.City | null>(null);
	let me = $state<api.Account | null>(null);
	let now = $state(new Date());

	/** The city whose island is open — null on the planet. */
	let insideSlug = $state<string | null>(null);
	let diving = $state(false);

	type Selection =
		| { kind: 'place'; detail: api.CoopDetail }
		| { kind: 'land'; tile: number }
		| { kind: 'cell'; cell: string }
		| { kind: 'invite'; invite: api.Invite }
		| null;
	let selected = $state<Selection>(null);
	let sheet = $state<'cities' | 'ledger' | null>(null);
	let tab = $state<'overview' | 'settlements' | 'schedule'>('overview');
	let toast = $state('');

	let heartsText = $state('');
	let foundName = $state('');
	let foundPitch = $state('');
	let foundHearts = $state('');
	let busy = $state(false);
	let error = $state('');
	let inviteLink = $state('');

	let ledgerData = $state<api.LedgerView | null>(null);

	/** The dome being walked through, over the island. */
	let walking = $state<{ kind: DomeKind; place: string } | null>(null);
	/** The domes a settlement has at its level, each one you can step inside. */
	function domesOf(level: number): { kind: DomeKind; label: string }[] {
		const plan = planFor(level);
		const out: { kind: DomeKind; label: string }[] = [];
		if (plan.counts.GLAMP) out.push({ kind: 'glamp', label: 'a glamping dome' });
		if (plan.counts.DOME3) out.push({ kind: 'home', label: 'a dome home' });
		if (plan.counts.DOME4) out.push({ kind: 'large', label: 'a large dome' });
		if (plan.master) out.push({ kind: 'master', label: 'the master dome' });
		return out;
	}

	/* ── the first-time tour: one hint at a time until the first citizenship ── */
	let tourOff = $state(true);
	/** Set the moment the player becomes a citizen, for the tour's last word. */
	let welcomed = $state<string | null>(null);
	function endTour() {
		tourOff = true;
		welcomed = null;
		try {
			localStorage.setItem(TOUR_KEY, 'done');
		} catch {}
	}

	const can = (cap: string) => !!me?.caps.includes(cap);

	/* The income ticks on the client with the same function the server mints with. */
	const claimable = $derived(me ? accrued(new Date(me.lastClaimAt), now) + (me.startingPending ? STARTING : 0n) : 0n);
	const clock = $derived(gameClock(now).label);
	const inside = $derived(cityData?.cities.find((c) => c.slug === insideSlug) ?? null);
	const place = $derived(selected?.kind === 'place' ? selected.detail : null);
	const homeCity = $derived(me?.city?.slug ?? null);
	const homeSettlement = $derived(me?.settlement?.slug ?? null);
	/** Becoming a citizen of the chosen city with this investment. */
	const joining = $derived(!!place && place.kind === 'city' && !!me && homeCity === null);
	/** The chosen place takes the viewer's hearts. */
	const canBack = $derived(
		!!place && !!me && (place.kind === 'city' ? homeCity === null || homeCity === place.slug : homeSettlement === place.slug)
	);

	/* What an investment would do, computed with the same rule the server applies. */
	const preview = $derived.by(() => {
		if (!place || !heartsText.trim()) return null;
		try {
			const hearts = parse(heartsText);
			if (hearts <= 0n) return null;
			if (joining && hearts < CITIZENSHIP) return { error: `Becoming a citizen takes at least ${format(CITIZENSHIP, 0)}♥.` };
			const raised = BigInt(place.raised);
			if (hearts > room(raised)) return { error: `Only ${format(room(raised), 0)}♥ of room left.` };
			const out = mindsFor(raised, hearts);
			return { minds: format(out.investor), hearts: format(hearts, 2) };
		} catch {
			return { error: 'Not an amount.' };
		}
	});

	const tourStep = $derived.by((): TourStep | null => {
		if (tourOff || loading || diving) return null;
		if (welcomed)
			return {
				target: 'home',
				title: 'You are a citizen',
				text: `Welcome to ${welcomed}. Step two is a home: choose free land on the island to found a settlement, or open an invite link from a settler.`,
				final: true
			};
		if (me?.city) return null;
		if (!me)
			return { target: 'join', title: 'Welcome to the planet', text: 'Every tower is a city. Look around as long as you like — to live in one, sign up with a passkey.' };
		if (me.startingPending)
			return { target: 'mint', title: 'Your first hearts', text: `${format(STARTING, 0)} hearts are waiting for you, owed to nobody. Press Mint to make them yours.` };
		if (selected?.kind === 'land')
			return { target: 'found-city', title: 'Found a city', text: `Name it, say what it is for, and put in at least ${format(CITIZENSHIP, 0)} of your hearts. You become its first citizen — for good.` };
		if (place?.kind === 'city' && joining)
			return { target: 'join-form', title: 'Step one: citizenship', text: `Invest at least ${format(CITIZENSHIP, 0)} of your hearts. They become ${place.heartsToken}, you receive ${place.mindToken}, and ${place.name} is your city — for good.` };
		if (sheet === 'cities' && cityData?.cities.length)
			return { target: 'cities-list', title: 'Choose your city', text: 'Pick one to dive into its island. You can only ever be a citizen of one, so look around first.' };
		if (cityData?.cities.length)
			return { target: 'cities', title: 'Find a city', text: 'Open the list of cities, or click a tower on the planet. Or found your own on any empty card of land.' };
		return { target: 'cities', title: 'The planet is empty', text: 'No city stands yet. Click any card of land to found the first one.' };
	});

	const settlementCount = $derived((cityData?.cities ?? []).reduce((n, c) => n + c.settlements.length, 0));

	function markers() {
		return (cityData?.cities ?? []).map((c) => ({
			slug: c.slug,
			tile: c.tile,
			citizens: c.citizens,
			milestone: c.milestone,
			coops: c.settlements.slice(0, 18).map((k, i) => ({ slug: k.slug, slot: i, milestone: k.milestone }))
		}));
	}

	async function refresh() {
		const [c, a] = await Promise.all([api.city(), api.account().catch(() => null)]);
		cityData = c;
		me = a;
		world?.setCities(markers());
	}

	function flash(message: string) {
		toast = message;
		setTimeout(() => (toast === message ? (toast = '') : null), 4000);
	}

	function reset() {
		error = '';
		heartsText = '';
		inviteLink = '';
		tab = 'overview';
		sheet = null;
	}

	async function show(slug: string) {
		reset();
		const detail = await api.coop(slug);
		selected = { kind: 'place', detail };
		if (detail.kind === 'city' && me && !me.city) heartsText = coopPolicy.city.citizenshipMinHearts;
	}

	/** The middle of what the panel leaves visible: above the bottom sheet on a phone, left of the side panel elsewhere. */
	function visibleMiddle() {
		const w = window.innerWidth;
		if (w <= 640) return { x: 0, y: 0.6 };
		const panel = Math.min(26 * 16, w - 32) + 16;
		return { x: -panel / w, y: 0 };
	}

	/** Dive from the planet into a city's card: it opens as the city's island. */
	async function enter(citySlug: string, then?: string) {
		const city = cityData?.cities.find((c) => c.slug === citySlug);
		if (!city) return;
		sheet = null;
		if (insideSlug !== citySlug) {
			world?.focus(city.tile, { x: 0, y: 0 }, 0.4);
			diving = true;
			await new Promise((r) => setTimeout(r, 1100));
			insideSlug = citySlug;
			world?.setPaused(true);
			setTimeout(() => (diving = false), 250);
		}
		await show(then ?? citySlug).catch((e) => flash((e as Error).message));
	}

	/** Back up to the planet, above the city you were in. */
	function leave() {
		const city = inside;
		insideSlug = null;
		selected = null;
		world?.setPaused(false);
		if (city) world?.focus(city.tile, visibleMiddle(), 0.62);
	}

	/** On the planet: a city is entered, an empty card offers a founding, the sea is the sea. */
	async function onTile(pick: { tile: number; biome: 'land' | 'water'; coop: string | null }) {
		reset();
		if (pick.coop) {
			const city = cityData?.cities.find((c) => c.slug === pick.coop || c.settlements.some((k) => k.slug === pick.coop));
			if (city) await enter(city.slug, pick.coop === city.slug ? undefined : pick.coop);
		} else if (pick.biome === 'land') {
			selected = { kind: 'land', tile: pick.tile };
			foundHearts = coopPolicy.city.citizenshipMinHearts;
		} else {
			selected = null;
			flash('Open sea. Cities stand on land.');
		}
	}

	/** On an island: a settlement opens, free land offers a home, water is water. */
	async function onCell(tile: HexTile | null) {
		reset();
		if (!tile || !inside) return void (selected = null);
		const cell = cellKey(tile);
		const there = inside.settlements.find((s) => s.cell === cell);
		if (there) return show(there.slug).catch((e) => flash((e as Error).message));
		if (!buildable(tile)) {
			selected = null;
			return flash('Water. Settlements stand on land.');
		}
		selected = { kind: 'cell', cell };
		foundHearts = coopPolicy.settlement.joinMinHearts;
	}

	/** Chosen from a list: on the island, bring its cell into view. */
	async function openSettlement(slug: string) {
		const s = inside?.settlements.find((k) => k.slug === slug);
		if (s?.cell) islandView?.frame(s.cell);
		await show(slug);
	}

	/** Spending starts with collecting: what has accrued is minted first, so it can be spent. */
	async function mintPending() {
		if (claimable >= 10n ** 16n) await api.mint();
	}

	async function act(run: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await run();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	const doMint = () =>
		act(async () => {
			const r = await api.mint();
			flash(`Minted ${r.claimedLabel} ${me?.token ?? '♥'}`);
			await refresh();
		}).then(() => error && flash(error));

	const doInvest = () =>
		act(async () => {
			if (!place) return;
			const becoming = joining;
			await mintPending();
			const detail = await api.invest(place.slug, heartsText.trim());
			if (becoming && !tourOff) welcomed = detail.name;
			flash(
				becoming
					? `You are a citizen of ${detail.name}. Step two: a home — found a settlement on free land, or use an invite link.`
					: `${heartsText.trim()} hearts became ${detail.heartsToken} in ${detail.name}'s treasury.`
			);
			heartsText = '';
			await refresh();
			selected = { kind: 'place', detail };
		});

	const doFoundCity = () =>
		act(async () => {
			if (selected?.kind !== 'land') return;
			await mintPending();
			const detail = await api.foundCity({ name: foundName.trim(), pitch: foundPitch.trim(), tile: selected.tile, hearts: foundHearts.trim() });
			flash(`${detail.name} is founded, and you are its first citizen. Step two: found your settlement on its island.`);
			if (!tourOff) welcomed = detail.name;
			foundName = '';
			foundPitch = '';
			await refresh();
			await enter(detail.slug);
		});

	const doFoundSettlement = () =>
		act(async () => {
			if (selected?.kind !== 'cell') return;
			await mintPending();
			const detail = await api.foundSettlement({ name: foundName.trim(), pitch: foundPitch.trim(), cell: selected.cell, hearts: foundHearts.trim() });
			flash(`${detail.name} is founded — your home, for good. Invite people with a link.`);
			foundName = '';
			foundPitch = '';
			await refresh();
			selected = { kind: 'place', detail };
		});

	const doInviteLink = () =>
		act(async () => {
			if (!place) return;
			const inv = await api.createInvite(place.slug);
			inviteLink = `${location.origin}${base}/games/sandbox-2/?invite=${inv.token}`;
		});

	const copyInvite = async () => {
		await navigator.clipboard?.writeText(inviteLink).catch(() => {});
		flash('Invite link copied. It admits one person, for a week.');
	};

	/** Step one of an invite, for someone who is not yet a citizen: the city. */
	const doInviteCity = () =>
		act(async () => {
			if (selected?.kind !== 'invite') return;
			await mintPending();
			await api.invest(selected.invite.city.slug, coopPolicy.city.citizenshipMinHearts);
			if (!tourOff) welcomed = selected.invite.city.name;
			await refresh();
		});

	/** Step two: move into the settlement; the link is spent. */
	const doInviteSettle = () =>
		act(async () => {
			if (selected?.kind !== 'invite') return;
			const inv = selected.invite;
			await mintPending();
			await api.acceptInvite(inv.token, coopPolicy.settlement.joinMinHearts);
			try {
				sessionStorage.removeItem(INVITE_KEY);
			} catch {}
			history.replaceState(null, '', location.pathname);
			flash(`Welcome home to ${inv.settlement.name}.`);
			await refresh();
			await enter(inv.city.slug, inv.settlement.slug);
		});

	/** One panel on the right at a time: a list, or the chosen card. */
	function openSheet(which: 'cities' | 'ledger') {
		selected = null;
		sheet = sheet === which ? null : which;
	}

	async function openLedger() {
		openSheet('ledger');
		if (sheet !== 'ledger') return;
		ledgerData = await api.ledger().catch(() => null);
	}

	// On the planet the chosen card wears a ring for as long as its sheet is open.
	$effect(() => {
		if (insideSlug) return;
		world?.setChosen(selected?.kind === 'land' ? selected.tile : place ? place.tile : -1);
	});

	let tick: ReturnType<typeof setInterval>;
	let poll: ReturnType<typeof setInterval>;

	onMount(() => {
		tick = setInterval(() => (now = new Date()), 1000);
		try {
			tourOff = localStorage.getItem(TOUR_KEY) === 'done';
		} catch {
			tourOff = false;
		}
		poll = setInterval(() => void api.city().then((c) => ((cityData = c), world?.setCities(markers()))).catch(() => {}), 30_000);

		// An invite link: keep it through a sign-up, and open it once the planet is up.
		let token = new URLSearchParams(location.search).get('invite');
		try {
			if (token) sessionStorage.setItem(INVITE_KEY, token);
			else token = sessionStorage.getItem(INVITE_KEY);
		} catch {}

		const url = (f: string) => `${base}/sandbox-2/map/${f}`;
		const quiet = <T,>(p: Promise<T>) => p.catch(() => undefined);
		void (async () => {
			await refresh().catch(() => flash('The city is not answering right now.'));
			const [{ mountWorld }, isLand, kindOf, isMountain, depthOf] = await Promise.all([
				import('$lib/sandbox-2/world/world'),
				quiet(loadLandMask(url('land.json'))),
				quiet(loadBiomeMap(url('biomes.json'))),
				quiet(loadMountainMask(url('mountains.geojson'))),
				quiet(loadDepthMap(url('depth.json')))
			]);
			world = mountWorld(stage, { cities: markers(), onTile: (p) => void onTile(p), isLand, kindOf, isMountain, depthOf });
			loading = false;
			if (token) {
				const inv = await api.invite(token).catch((e) => (flash((e as Error).message), null));
				if (inv) {
					const city = cityData?.cities.find((c) => c.slug === inv.city.slug);
					if (city) world.focus(city.tile, visibleMiddle(), 0.62);
					selected = { kind: 'invite', invite: inv };
				}
			}
		})();
	});

	onDestroy(() => {
		clearInterval(tick);
		clearInterval(poll);
		world?.dispose();
	});
</script>

<svelte:head>
	<title>avenCITY Sandbox 2 · maiaCITY</title>
	<meta name="description" content="The planet and its cities: found or join a city, make your home in one of its settlements, and watch your hearts become the city's own currency." />
</svelte:head>

<div class="game">
	<div class="stage" class:hidden={!!insideSlug} bind:this={stage}></div>

	{#if inside}
		<Island
			bind:this={islandView}
			seed={inside.island}
			settlements={inside.settlements.map((s) => ({ cell: s.cell ?? '', level: s.level }))}
			focus={inside.settlements.find((s) => s.slug === homeSettlement)?.cell ?? inside.settlements[0]?.cell ?? undefined}
			onpick={(t) => void onCell(t)}
		/>
	{/if}

	{#if diving}<div class="dive" aria-hidden="true"></div>{/if}

	{#if loading}
		<div class="loading" role="status"><span>Growing the planet…</span></div>
	{/if}

	<!-- top left: where you are, and when -->
	<div class="corner tl">
		{#if inside}
			<button class="pill back" onclick={leave} aria-label="Back to the planet">←</button>
			<button class="pill brand" onclick={() => show(inside!.slug)}>
				<strong>{inside.name}</strong>
				<span class="dim">{inside.citizens} {inside.citizens === 1 ? 'citizen' : 'citizens'} · {inside.settlements.length} {inside.settlements.length === 1 ? 'settlement' : 'settlements'} · {clock}</span>
			</button>
		{:else}
			<a class="pill back" href="{base}/games" aria-label="Back to games">←</a>
			<div class="pill brand">
				<strong>avenCITY Sandbox 2</strong>
				{#if cityData}<span class="dim">{cityData.calendarLabel} · {clock}</span>{/if}
			</div>
		{/if}
	</div>

	<!-- top right: the planet, then you -->
	<div class="corner tr">
		{#if !inside}
			<button class="pill" data-tour="cities" onclick={() => openSheet('cities')}>
				Cities · {cityData?.cities.length ?? 0}
			</button>
			{#if cityData}
				<span class="pill dim">{settlementCount} {settlementCount === 1 ? 'settlement' : 'settlements'} · {cityData.players} {cityData.players === 1 ? 'player' : 'players'} · {cityData.buildable.toLocaleString('en-US')} land cards</span>
			{/if}
		{/if}
		{#if me}
			{#if me.city}
				<button class="pill home" data-tour="home" onclick={() => enter(me!.city!.slug, me!.settlement?.slug)}>
					<span>{#if me.settlement}Home: <strong>{me.settlement.name}</strong>, {me.city.name}{:else}Citizen of <strong>{me.city.name}</strong>{/if}</span>
				</button>
			{/if}
			<div class="pill wallet">
				<span class="dim">{me.token}</span>
				<strong>{me.balanceLabel}</strong>
			</div>
			<button class="pill" onclick={openLedger}>Ledger</button>
		{:else}
			<a class="pill cta" data-tour="join" href="{base}/join/">Join to mint & invest</a>
		{/if}
	</div>

	<!-- bottom centre: the one action -->
	{#if me}
		<div class="corner bc">
			<button class="mint" data-tour="mint" onclick={doMint} disabled={busy || claimable < 10n ** 16n}>
				<strong>Mint</strong>
				<span>+{format(claimable)} {me.token}</span>
			</button>
		</div>
	{/if}

	{#if toast}<div class="toast" role="status">{toast}</div>{/if}

	<Tour step={tourStep} onskip={endTour} ondone={endTour} />

	{#if walking}
		<DomeInterior kind={walking.kind} place={walking.place} onclose={() => (walking = null)} />
	{/if}

	{#if selected}
		<aside class="sheet right">
			<button class="close" onclick={() => (selected = null)} aria-label="Close">×</button>

			{#if selected.kind === 'land'}
				<!-- an empty card of the planet -->
				<p class="eyebrow">Card {selected.tile.toLocaleString('en-US')} · unclaimed land</p>
				<h2>No city stands here yet.</h2>
				{#if !me}
					<p class="lede">Anyone can look around. To found a city or join one, <a href="{base}/join/">sign up</a> — your first mint carries {format(STARTING, 0)} hearts.</p>
				{:else if me.city}
					<p class="lede">You are a citizen of {me.city.name}, and that is for good: every player founds or joins one city.</p>
					<button class="secondary" onclick={() => enter(me!.city!.slug)}>Go to {me.city.name}</button>
				{:else if can('city:create')}
					<p class="lede">
						Found a city here: a name, one line on what it is for, and at least {format(CITIZENSHIP, 0)} of your own hearts.
						They become its first HEARTS, named after it, and you become its first citizen — for good. The card opens as the city's island.
					</p>
					<form data-tour="found-city" onsubmit={(e) => { e.preventDefault(); doFoundCity(); }}>
						<label for="fname">City name</label>
						<input id="fname" bind:value={foundName} maxlength="24" placeholder="e.g. Maia" />
						{#if foundName.trim().length >= 3}
							<p class="hint">Its money: <strong>{foundName.trim().toLowerCase()}HEARTS</strong> and <strong>{foundName.trim().toLowerCase()}MINDS</strong>.</p>
						{/if}
						<label for="fpitch">What it is for</label>
						<textarea id="fpitch" bind:value={foundPitch} maxlength="280" rows="3" placeholder="e.g. A city of a million co-founders."></textarea>
						<label for="fhearts">Your hearts</label>
						<input id="fhearts" bind:value={foundHearts} inputmode="decimal" placeholder="e.g. 25000" />
						<button class="primary" disabled={busy || foundName.trim().length < 3 || !foundPitch.trim()}>
							{busy ? 'Founding…' : `Found this city — ${foundHearts || 0}♥`}
						</button>
						{#if foundName.trim().length < 3}
							<p class="hint">Give it a name of at least three letters.</p>
						{:else if !foundPitch.trim()}
							<p class="hint">Add one line on what it is for.</p>
						{/if}
					</form>
				{/if}
			{:else if selected.kind === 'cell' && inside}
				<!-- a free cell of a city's island -->
				<p class="eyebrow">{inside.name} · open land</p>
				<h2>Nobody lives here yet.</h2>
				{#if !me}
					<p class="lede">To make a home here, <a href="{base}/join/">sign up</a> first.</p>
				{:else if homeCity !== inside.slug}
					{#if homeCity}
						<p class="lede">You are a citizen of {me.city?.name}, for good. Your home is on its island.</p>
					{:else}
						<p class="lede">A home in {inside.name} starts with citizenship: at least {format(CITIZENSHIP, 0)} of your own hearts into the city. Then this land can be yours.</p>
						<button class="secondary" onclick={() => show(inside!.slug)}>Become a citizen of {inside.name}</button>
					{/if}
				{:else if homeSettlement}
					<p class="lede">You live in {me.settlement?.name}, and that is for good.</p>
				{:else}
					<p class="lede">
						Step two: found your settlement here — a dome cluster that starts as a camp of tents and grows with every settler.
						At least {format(SETTLING, 0)} of your hearts become its first {inside.slug}HEARTS. Others join only with an invite link from a settler.
					</p>
					<form onsubmit={(e) => { e.preventDefault(); doFoundSettlement(); }}>
						<label for="sname">Settlement name</label>
						<input id="sname" bind:value={foundName} maxlength="24" placeholder="e.g. Riverside" />
						<label for="spitch">What it is for</label>
						<textarea id="spitch" bind:value={foundPitch} maxlength="280" rows="2" placeholder="e.g. Domes by the river, a food forest all round."></textarea>
						<label for="shearts">Your hearts</label>
						<input id="shearts" bind:value={foundHearts} inputmode="decimal" placeholder="e.g. 5000" />
						<button class="primary" disabled={busy || foundName.trim().length < 3 || !foundPitch.trim()}>
							{busy ? 'Founding…' : `Found this settlement — ${foundHearts || 0}♥`}
						</button>
						{#if foundName.trim().length < 3}
							<p class="hint">Give it a name of at least three letters.</p>
						{:else if !foundPitch.trim()}
							<p class="hint">Add one line on what it is for.</p>
						{/if}
					</form>
				{/if}
			{:else if selected.kind === 'invite'}
				{@const inv = selected.invite}
				<p class="eyebrow">An invitation · {inv.city.name}</p>
				<h2>{inv.invitedBy} invites you to {inv.settlement.name}.</h2>
				{#if !inv.usable}
					<p class="lede">{inv.reason}</p>
				{:else if !me}
					<p class="lede">
						{inv.settlement.name} is a settlement in {inv.city.name}. To move in, <a href="{base}/join/">sign up</a> — your first mint carries
						{format(STARTING, 0)} hearts — then come back to this page.
					</p>
				{:else if homeCity && homeCity !== inv.city.slug}
					<p class="lede">You are a citizen of {me.city?.name}, for good. {inv.settlement.name} is in {inv.city.name}.</p>
				{:else if homeSettlement}
					<p class="lede">You already live in {me.settlement?.name}, and that is for good.</p>
				{:else}
					<p class="lede">Moving in takes two steps, and both are for good.</p>
					<ol class="steps">
						<li class:done={homeCity === inv.city.slug}>
							<strong>Citizen of {inv.city.name}</strong> — {format(CITIZENSHIP, 0)} of your hearts become {inv.city.slug}HEARTS.
							{#if homeCity !== inv.city.slug}
								<button class="primary" onclick={doInviteCity} disabled={busy}>{busy ? 'Joining…' : `Become a citizen — ${format(CITIZENSHIP, 0)}♥`}</button>
							{/if}
						</li>
						<li>
							<strong>Home in {inv.settlement.name}</strong> — {format(SETTLING, 0)} more of your hearts, and the link is spent.
							{#if homeCity === inv.city.slug}
								<button class="primary" onclick={doInviteSettle} disabled={busy}>{busy ? 'Moving in…' : `Move in — ${format(SETTLING, 0)}♥`}</button>
							{/if}
						</li>
					</ol>
				{/if}
			{:else if place}
				{@const c = place}
				<p class="eyebrow">
					<span class="phase {c.phase.toLowerCase()}">{c.phase}</span>
					· {c.kind === 'city' ? 'city' : `settlement · level ${c.level}`}
					{#if c.kind !== 'city'}in <button class="link" onclick={() => show(c.city.slug)}>{c.city.name}</button>{/if}
					· by {c.founder}
				</p>
				<h2>{c.name}</h2>
				<p class="lede">{c.pitch}</p>

				<div class="tabs">
					<button class:on={tab === 'overview'} onclick={() => (tab = 'overview')}>Overview</button>
					{#if c.kind === 'city'}<button class:on={tab === 'settlements'} onclick={() => (tab = 'settlements')}>Settlements · {c.settlements.length}</button>{/if}
					<button class:on={tab === 'schedule'} onclick={() => (tab = 'schedule')}>Emission</button>
				</div>

				{#if tab === 'overview'}
					<dl class="stats">
						{#if c.kind === 'city'}
							<div><dt>Citizens</dt><dd>{c.citizens}</dd></div>
						{:else}
							<div><dt>Settlers</dt><dd>{c.settlers} <small>level {c.level} of 12</small></dd></div>
						{/if}
						<div><dt>In the treasury</dt><dd>{c.treasuryLabel} <small>{c.heartsToken}</small></dd></div>
						<div><dt>Supply</dt><dd>{c.supplyLabel} <small>{c.mindToken}</small></dd></div>
						<div><dt>Raised</dt><dd>{c.raisedLabel}♥</dd></div>
					</dl>

					{#if c.kind === 'settlement'}
						<p class="dim small village">
							{#if c.nextLevelAt}Level {c.level + 1} at {c.nextLevelAt} settlers{:else}Complete: every dome built, the food forest planted{/if}{#if c.inMasterDome > 0}{" · "}{c.inMasterDome} live in the master dome{/if}
						</p>
					{/if}
					<p class="milestone">{c.milestoneOf}</p>
					<div class="bar" aria-label="Progress of this milestone"><span style:width="{c.fill}%"></span></div>
					<p class="dim small">{c.priceLabel} · {c.nextLabel}</p>

					{#if me && c.myMindsLabel && c.myMindsLabel !== '0.00'}
						<p class="yours">You own <strong>{c.myMindsLabel} {c.mindToken}</strong></p>
					{/if}

					{#if c.kind === 'settlement' && domesOf(c.level).length}
						<div class="inside">
							<span class="dim small">Step inside</span>
							{#each domesOf(c.level) as d (d.kind)}
								<button class="secondary" onclick={() => (walking = { kind: d.kind, place: c.name })}>{d.label}</button>
							{/each}
						</div>
					{/if}

					{#if c.kind === 'city' && !insideSlug}
						<button class="secondary" onclick={() => enter(c.slug)}>Enter {c.name}'s island</button>
					{/if}

					{#if c.soldOut}
						<p class="dim">Sold out — every MIND this will ever have is out.</p>
					{:else if !me}
						<p class="lede small">To {c.kind === 'city' ? `become a citizen of ${c.name}` : `live in ${c.name}`}, <a href="{base}/join/">sign up</a> — your first mint carries {format(STARTING, 0)} hearts.</p>
					{:else if canBack}
						<form data-tour={joining ? 'join-form' : undefined} onsubmit={(e) => { e.preventDefault(); doInvest(); }}>
							<label for="hearts">
								{#if joining}Step one: become a citizen of {c.name} — at least {c.entryLabel} of your {me.token}, for good{:else}Invest your {me.token}{/if}
							</label>
							<div class="row">
								<input id="hearts" bind:value={heartsText} inputmode="decimal" placeholder={joining ? `e.g. ${c.entryLabel}` : 'e.g. 100'} />
								<button class="primary" disabled={busy || !preview || 'error' in preview}>
									{busy ? 'Investing…' : joining ? 'Become a citizen' : 'Invest'}
								</button>
							</div>
							{#if preview && 'minds' in preview}
								<p class="preview">
									You receive <strong>{preview.minds} {c.mindToken}</strong>. Your {preview.hearts} {me.token}
									become {preview.hearts} {c.heartsToken} in {c.name}'s treasury.
								</p>
							{:else if preview && 'error' in preview}
								<p class="bad small">{preview.error}</p>
							{/if}
						</form>
						{#if c.kind === 'city' && homeCity === c.slug && !homeSettlement}
							<p class="hint">Step two: a home. Choose free land on the island to found a settlement, or open an invite link from a settler.</p>
						{/if}
						{#if c.kind === 'settlement'}
							<h3>Invite someone</h3>
							<p class="lede small">{c.name} grows by invitation. A link admits one person, for a week.</p>
							{#if inviteLink}
								<div class="row">
									<input readonly value={inviteLink} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
									<button class="primary" onclick={copyInvite}>Copy</button>
								</div>
							{:else}
								<button class="secondary" onclick={doInviteLink} disabled={busy}>Create an invite link</button>
							{/if}
						{/if}
					{:else if c.kind === 'city'}
						<p class="lede small">You are a citizen of {me.city?.name}, for good. You back your own city.</p>
					{:else if homeSettlement}
						<p class="lede small">You live in {me.settlement?.name}. You back your own settlement.</p>
					{:else}
						<p class="lede small">{c.name} grows by invitation. Ask one of its settlers for an invite link — or found your own settlement on free land.</p>
					{/if}
				{:else if tab === 'settlements'}
					{#if c.settlements.length}
						<ul class="list">
							{#each c.settlements as k (k.slug)}
								<li>
									<button onclick={() => (insideSlug === c.slug ? openSettlement(k.slug) : enter(c.slug, k.slug))}>
										<span><strong>{k.name}</strong> <span class="dim">by {k.founder}</span></span>
										<span class="dim small">level {k.level} · {k.settlers} {k.settlers === 1 ? 'settler' : 'settlers'} · {k.raisedLabel}♥</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="lede small">No settlements in {c.name} yet. The first citizen to choose free land on the island founds one.</p>
					{/if}
				{:else}
					<div class="schedule">
						<table>
							<thead><tr><th>#</th><th>MINDS</th><th>price</th><th>supply</th></tr></thead>
							<tbody>
								{#each c.schedule as row (row.milestone)}
									{#if row.phaseHeading}
										<tr class="phase-row"><td colspan="4"><span class="phase {row.phase}">{row.phaseHeading}</span></td></tr>
									{/if}
									<tr class={row.state}>
										<td>{row.milestone}</td>
										<td>{row.minds}</td>
										<td>{row.price}</td>
										<td>{row.cumulativeMinds}</td>
									</tr>
									{#if row.progress}
										<tr class="current progress"><td colspan="4">
											<div class="bar"><span style:width="{row.fill}%"></span></div>
											<span class="small">{row.progress}</span>
										</td></tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}

			{#if error}<p class="bad">{error}</p>{/if}
		</aside>
	{/if}

	<!-- the lists -->
	{#if sheet}
		<aside class="sheet right">
			<button class="close" onclick={() => (sheet = null)} aria-label="Close">×</button>

			{#if sheet === 'cities'}
				<p class="eyebrow">The cities</p>
				<h2>{cityData?.cities.length ? 'Where people live' : 'No cities yet'}</h2>
				{#if !cityData?.cities.length}
					<p class="lede">The planet is empty. Whoever founds the first city can choose from all {cityData?.buildable.toLocaleString('en-US')} cards of land.</p>
				{/if}
				<ul class="list" data-tour="cities-list">
					{#each cityData?.cities ?? [] as c (c.slug)}
						<li>
							<button onclick={() => enter(c.slug)}>
								<span><strong>{c.name}</strong> <span class="dim">{c.citizens} {c.citizens === 1 ? 'citizen' : 'citizens'} · {c.settlements.length} {c.settlements.length === 1 ? 'settlement' : 'settlements'}</span></span>
								<span class="dim small">{c.phase} · milestone {c.milestone} · {c.raisedLabel}♥ · by {c.founder}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if sheet === 'ledger'}
				<p class="eyebrow">Your ledger</p>
				<h2>What you hold</h2>
				{#if ledgerData}
					<ul class="holdings">
						{#each ledgerData.holdings as h (h.token)}
							<li class={h.kind}><span>{h.token}</span><strong>{h.balanceLabel}</strong></li>
						{:else}
							<li class="dim">Nothing yet — mint your first hearts.</li>
						{/each}
					</ul>
					<h3>What happened</h3>
					<ul class="txs">
						{#each ledgerData.transactions as t (t.id)}
							<li>
								<span>{t.title}</span>
								<strong class={t.sign === '+' ? 'plus' : 'minus'}>{t.sign}{t.figure} <small>{t.token}</small></strong>
							</li>
						{:else}
							<li class="dim">No transactions yet.</li>
						{/each}
					</ul>
				{:else}
					<p class="dim">Loading…</p>
				{/if}
			{/if}
		</aside>
	{/if}
</div>

<style>
	/* The MIND sign ☉ is missing from the page fonts; borrow it, a touch larger, from the system's symbol font. */
	@font-face {
		font-family: 'Sun';
		src: local('Apple Symbols'), local('Segoe UI Symbol'), local('Noto Sans Symbols'), local('DejaVu Sans');
		unicode-range: U+2609;
		size-adjust: 135%;
	}

	.game {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #f2efe7;
		font-family: 'Sun', var(--font-body, system-ui, sans-serif);
		color: #1f2a23;
	}

	.stage {
		position: absolute;
		inset: 0;
	}

	.stage :global(canvas) {
		display: block;
	}

	.stage :global(.hud-reticle) {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 8px;
		height: 8px;
		margin: -4px 0 0 -4px;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.9);
		pointer-events: none;
	}

	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: linear-gradient(180deg, #d9e2ea, #f2efe7);
		font-size: 0.8rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #5b6660;
	}

	.corner {
		position: absolute;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		max-width: calc(100vw - 2rem);
	}

	.tl { top: calc(1rem + env(safe-area-inset-top, 0px)); left: 1rem; }
	.tr { top: calc(1rem + env(safe-area-inset-top, 0px)); right: 1rem; justify-content: flex-end; }
	.bl { bottom: calc(1rem + env(safe-area-inset-bottom, 0px)); left: 1rem; }

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.9rem;
		border: 1px solid rgb(31 42 35 / 0.08);
		border-radius: 999px;
		background: rgb(250 248 242 / 0.88);
		backdrop-filter: blur(10px);
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
		text-decoration: none;
		cursor: pointer;
		box-shadow: 0 6px 18px -12px rgb(31 42 35 / 0.4);
	}

	.pill:disabled { opacity: 0.5; cursor: default; }
	.pill.back { padding-inline: 0.8rem; }
	.pill.brand strong { font-family: 'Sun', var(--font-display, serif); font-weight: 500; }
	.pill.cta { background: #1f2a23; color: #f2efe7; }
	.pill.home strong { font-weight: 600; }
	.inside { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin: 0.8rem 0; }
	.inside .secondary { margin: 0; padding: 0.45rem 0.9rem; font-size: 0.82rem; }
	.stage.hidden { visibility: hidden; }
	.dive { position: absolute; inset: 0; background: #f2efe7; animation: dive 1.1s ease-in forwards; pointer-events: none; }
	@keyframes dive { 0% { opacity: 0; } 70% { opacity: 0.2; } 100% { opacity: 1; } }
	.steps { margin: 0.8rem 0 0; padding-left: 1.2rem; display: grid; gap: 0.9rem; }
	.steps li { line-height: 1.5; }
	.steps li.done { color: #7b857a; }
	.steps li.done strong::after { content: ' ✓'; color: #4f7a52; }
	.steps .primary { display: block; margin-top: 0.5rem; }
	.pill.brand { cursor: pointer; font: inherit; font-size: 0.85rem; }
	.link { padding: 0; border: 0; background: none; font: inherit; color: #c8744f; text-decoration: underline; cursor: pointer; }
	.secondary { margin-top: 0.8rem; padding: 0.6rem 1.1rem; border: 1px solid rgb(31 42 35 / 0.15); border-radius: 999px; background: transparent; font: inherit; cursor: pointer; }
	.bc { bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%); }

	.mint {
		display: inline-flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.85rem 1.6rem;
		border: 0;
		border-radius: 999px;
		background: #1f2a23;
		color: #f2efe7;
		font: inherit;
		font-size: 1rem;
		cursor: pointer;
		box-shadow: 0 14px 30px -14px rgb(31 42 35 / 0.7);
	}
	.mint strong { color: #f0a47c; font-weight: 600; }
	.mint span { font-variant-numeric: tabular-nums; }
	.mint:disabled { opacity: 0.55; cursor: default; }
	.pill.wallet strong { font-variant-numeric: tabular-nums; }

	.dim { color: #7b857a; }
	.small { font-size: 0.8rem; }
	.bad { color: #9c3b26; font-size: 0.9rem; }
	.hint { margin: 0.5rem 0 0; color: #7b857a; font-size: 0.82rem; }

	.toast {
		position: absolute;
		bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		max-width: min(32rem, calc(100vw - 2rem));
		padding: 0.7rem 1.1rem;
		border-radius: 14px;
		background: #1f2a23;
		color: #f2efe7;
		font-size: 0.88rem;
		text-align: center;
	}

	.sheet {
		position: absolute;
		top: calc(4.5rem + env(safe-area-inset-top, 0px));
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		width: min(26rem, calc(100vw - 2rem));
		padding: 1.4rem 1.4rem 1.6rem;
		overflow-y: auto;
		border-radius: 22px;
		background: rgb(250 248 242 / 0.96);
		backdrop-filter: blur(14px);
		box-shadow: 0 20px 50px -24px rgb(31 42 35 / 0.5);
	}

	.sheet.right { right: 1rem; }

	.close {
		position: absolute;
		top: 0.8rem;
		right: 0.9rem;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 50%;
		background: rgb(31 42 35 / 0.06);
		font-size: 1.1rem;
		cursor: pointer;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.7rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: #4d5d51;
	}

	h2 {
		margin: 0.5rem 2rem 0.6rem 0;
		font-family: 'Sun', var(--font-display, serif);
		font-weight: 400;
		font-size: 1.6rem;
		line-height: 1.15;
	}

	h3 {
		margin: 1.4rem 0 0.4rem;
		font-size: 0.75rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #4d5d51;
	}

	.lede { margin: 0 0 1rem; line-height: 1.55; color: #4d5d51; }
	.lede a { color: #c8744f; }

	.phase {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #e7e1d3;
		font-size: 0.65rem;
		letter-spacing: 0.12em;
	}
	.phase.idea { background: #efe2b8; }
	.phase.test { background: #dbe7c9; }
	.phase.build { background: #cfe0e6; }
	.phase.scale { background: #e2d6ec; }
	.phase.hero { background: #f0cdbd; }

	.tabs { display: flex; gap: 0.3rem; margin: 0.4rem 0 1rem; }
	.tabs button {
		padding: 0.4rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font: inherit;
		font-size: 0.82rem;
		color: #4d5d51;
		cursor: pointer;
	}
	.tabs button.on { background: #1f2a23; color: #f2efe7; }

	.stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
		margin: 0 0 1rem;
	}
	.stats div { padding: 0.7rem 0.8rem; border-radius: 14px; background: #f1ede3; }
	.stats dt { font-size: 0.7rem; color: #7b857a; }
	.stats dd { margin: 0.2rem 0 0; font-family: 'Sun', var(--font-display, serif); font-size: 1.2rem; font-variant-numeric: tabular-nums; }
	.stats small { font-family: 'Sun', var(--font-body, sans-serif); font-size: 0.7rem; color: #7b857a; }

	.milestone { margin: 0 0 0.4rem; font-size: 0.85rem; }

	.bar { height: 6px; border-radius: 999px; background: #e7e1d3; overflow: hidden; margin: 0 0 0.4rem; }
	.bar span { display: block; height: 100%; background: #c8744f; }

	.yours { margin: 1rem 0 0; padding: 0.7rem 0.8rem; border-radius: 14px; background: #efe6dc; font-size: 0.9rem; }

	form { display: flex; flex-direction: column; gap: 0.45rem; margin-top: 1.1rem; }
	label { font-size: 0.78rem; color: #4d5d51; }
	input, textarea {
		padding: 0.65rem 0.8rem;
		border: 1px solid #dcd5c4;
		border-radius: 12px;
		background: #fff;
		font: inherit;
		color: inherit;
	}
	textarea { resize: vertical; }
	input::placeholder, textarea::placeholder { color: #a9b0a6; font-style: italic; opacity: 1; }
	.row { display: flex; gap: 0.5rem; }
	.row input { flex: 1; min-width: 0; }

	.primary {
		align-self: flex-start;
		padding: 0.65rem 1.15rem;
		border: 0;
		border-radius: 999px;
		background: #1f2a23;
		color: #f2efe7;
		font: inherit;
		font-weight: 500;
		cursor: pointer;
	}
	.primary:disabled { opacity: 0.45; cursor: default; }

	.preview { margin: 0.2rem 0 0; font-size: 0.85rem; line-height: 1.5; color: #4d5d51; }

	.schedule { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
	th { text-align: left; padding: 0.3rem 0.4rem; font-weight: 500; color: #7b857a; }
	td { padding: 0.3rem 0.4rem; border-top: 1px solid #ebe5d7; }
	tr.filled td { color: #7b857a; }
	tr.current td { font-weight: 600; }
	tr.locked td { color: #a5ac9f; }
	tr.phase-row td { border-top: 0; padding-top: 0.8rem; }
	tr.progress td { border-top: 0; }

	.list, .holdings, .txs { list-style: none; margin: 0; padding: 0; }
	.list li + li, .txs li + li, .holdings li + li { border-top: 1px solid #ebe5d7; }
	.list button {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		width: 100%;
		padding: 0.8rem 0.2rem;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.citizen { display: flex; justify-content: space-between; align-items: center; padding: 0.7rem 0.2rem; }
	.small-btn {
		padding: 0.35rem 0.7rem;
		border: 1px solid #dcd5c4;
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.holdings li, .txs li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.6rem 0.1rem; font-size: 0.9rem; }
	.holdings li.own strong { color: #c8744f; }
	.holdings li.city strong { color: #3f7a6b; }
	.txs strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
	.txs .plus { color: #3f7a4d; }
	.txs .minus { color: #9c3b26; }
	.txs small { font-weight: 400; color: #7b857a; }

	/* Too narrow for both corners on one line: yours drops below the city's. */
	@media (max-width: 1180px) {
		.tr { top: calc(4rem + env(safe-area-inset-top, 0px)); }
		.sheet { top: calc(7.5rem + env(safe-area-inset-top, 0px)); }
	}

	@media (max-width: 640px) {
		.sheet { top: auto; bottom: 0; left: 0; right: 0; width: 100%; max-height: 72vh; border-radius: 22px 22px 0 0; }
		.corner.bc { bottom: calc(0.9rem + env(safe-area-inset-bottom, 0px)); }
	}
</style>
