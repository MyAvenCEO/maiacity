<!--
	avenCITY Sandbox 2 — the planet, and the first economy on it.

	The globe is avenCITY's three.js renderer, unchanged. The HUD is new: it
	reads the public city without an account, and signs minting, founding and
	investing with the same passkey session as /join.

	The economy is Day 09's: personal hearts minted as income; invested hearts
	converted one for one into maiaHEARTS in a coop's treasury; the investor
	receiving the coop's MINDs.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { accrued, format, gameClock, parse } from '../../../../game/time';
	import { STARTING } from '../../../../game/policy';
	import { mindsFor, room } from '../../../../game/coops';
	import { loadBiomeMap, loadDepthMap, loadLandMask, loadMountainMask } from '../../../../game/map';
	import * as api from '$lib/sandbox-2/api';
	import type { WorldHandle } from '$lib/sandbox-2/world/world';

	let stage: HTMLDivElement;
	let world: WorldHandle | null = null;
	let loading = $state(true);

	let cityData = $state<api.City | null>(null);
	let me = $state<api.Account | null>(null);
	let now = $state(new Date());

	type Selection = { kind: 'coop'; detail: api.CoopDetail } | { kind: 'land'; tile: number } | null;
	let selected = $state<Selection>(null);
	let sheet = $state<'coops' | 'ledger' | 'citizens' | null>(null);
	let tab = $state<'overview' | 'schedule'>('overview');
	let toast = $state('');

	let heartsText = $state('');
	let foundName = $state('');
	let foundPitch = $state('');
	let busy = $state(false);
	let error = $state('');

	let ledgerData = $state<api.LedgerView | null>(null);
	let citizenList = $state<api.Citizen[]>([]);

	const can = (cap: string) => !!me?.caps.includes(cap);

	/* The income ticks on the client with the same function the server mints with. */
	const claimable = $derived(
		me ? accrued(new Date(me.lastClaimAt), now) + (me.startingPending ? STARTING : 0n) : 0n
	);
	const clock = $derived(gameClock(now).label);

	/* What an investment would do, computed with the same rule the server applies. */
	const preview = $derived.by(() => {
		if (selected?.kind !== 'coop' || !heartsText.trim()) return null;
		try {
			const hearts = parse(heartsText);
			if (hearts <= 0n) return null;
			const raised = BigInt(selected.detail.raised);
			if (hearts > room(raised)) return { error: `Only ${format(room(raised), 0)}♥ of room left.` };
			const out = mindsFor(raised, hearts);
			return { minds: format(out.investor), hearts: format(hearts, 2) };
		} catch {
			return { error: 'Not an amount.' };
		}
	});

	function markers() {
		return (cityData?.coops ?? []).map((c) => ({ slug: c.slug, tile: c.tile, milestone: c.milestone }));
	}

	async function refresh() {
		const [c, a] = await Promise.all([api.city(), api.account().catch(() => null)]);
		cityData = c;
		me = a;
		world?.setCoops(markers());
	}

	function flash(message: string) {
		toast = message;
		setTimeout(() => (toast === message ? (toast = '') : null), 3200);
	}

	async function onTile(pick: { tile: number; biome: 'land' | 'water'; coop: string | null }) {
		sheet = null;
		error = '';
		heartsText = '';
		tab = 'overview';
		if (pick.coop) {
			try {
				selected = { kind: 'coop', detail: await api.coop(pick.coop) };
			} catch (e) {
				flash((e as Error).message);
			}
		} else if (pick.biome === 'land') {
			selected = { kind: 'land', tile: pick.tile };
		} else {
			selected = null;
			flash('Open sea. Coops stand on land.');
		}
	}

	/** The middle of what the panel leaves visible: above the bottom sheet on a phone, left of the side panel elsewhere. */
	function visibleMiddle() {
		const w = window.innerWidth;
		if (w <= 640) return { x: 0, y: 0.6 };
		const panel = Math.min(26 * 16, w - 32) + 16;
		return { x: -panel / w, y: 0 };
	}

	async function openCoop(slug: string) {
		sheet = null;
		// Chosen from the list: fly to its card, so you see where it stands.
		const tile = cityData?.coops.find((c) => c.slug === slug)?.tile;
		if (tile != null) world?.focus(tile, visibleMiddle());
		await onTile({ tile: tile ?? -1, biome: 'land', coop: slug });
	}

	async function doMint() {
		busy = true;
		try {
			const r = await api.mint();
			flash(`Minted ${r.claimedLabel} ${me?.token ?? '♥'}`);
			await refresh();
		} catch (e) {
			flash((e as Error).message);
		} finally {
			busy = false;
		}
	}

	async function doInvest() {
		if (selected?.kind !== 'coop') return;
		busy = true;
		error = '';
		try {
			const slug = selected.detail.slug;
			await mintPending();
			const detail = await api.invest(slug, heartsText.trim());
			flash(`${heartsText.trim()} hearts became maiaHEARTS in ${detail.name}'s treasury.`);
			selected = { kind: 'coop', detail };
			heartsText = '';
			await refresh();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function doFound() {
		if (selected?.kind !== 'land') return;
		busy = true;
		error = '';
		try {
			await mintPending();
			const detail = await api.found({ name: foundName.trim(), pitch: foundPitch.trim(), tile: selected.tile });
			flash(`${detail.name} is founded. Your stake is its first maiaHEARTS.`);
			foundName = '';
			foundPitch = '';
			await refresh();
			selected = { kind: 'coop', detail };
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	/** One panel on the right at a time: a list, or the chosen card. */
	function openSheet(which: 'coops' | 'ledger' | 'citizens') {
		selected = null;
		sheet = sheet === which ? null : which;
	}

	async function openLedger() {
		openSheet('ledger');
		if (sheet !== 'ledger') return;
		ledgerData = await api.ledger().catch(() => null);
	}

	async function openCitizens() {
		openSheet('citizens');
		if (sheet !== 'citizens') return;
		citizenList = await api.citizens().catch(() => []);
	}

	async function toggleRole(c: api.Citizen) {
		await api.setRole(c.id, c.role === 'founder' ? 'citizen' : 'founder');
		citizenList = await api.citizens();
	}

	// The chosen card wears a ring on the globe for as long as its sheet is open.
	$effect(() => {
		world?.setChosen(selected?.kind === 'land' ? selected.tile : selected?.kind === 'coop' ? selected.detail.tile : -1);
	});

	/** Spending starts with collecting: what has accrued is minted first, so it can be spent. */
	async function mintPending() {
		if (claimable >= 10n ** 16n) await api.mint();
	}

	let tick: ReturnType<typeof setInterval>;
	let poll: ReturnType<typeof setInterval>;

	onMount(() => {
		tick = setInterval(() => (now = new Date()), 1000);
		poll = setInterval(() => void api.city().then((c) => ((cityData = c), world?.setCoops(markers()))).catch(() => {}), 30_000);

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
			world = mountWorld(stage, { coops: markers(), onTile: (p) => void onTile(p), isLand, kindOf, isMountain, depthOf });
			loading = false;
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
	<meta name="description" content="The planet, and the first economy on it: mint your hearts, back a coop, watch them become maiaHEARTS." />
</svelte:head>

<div class="game">
	<div class="stage" bind:this={stage}></div>

	{#if loading}
		<div class="loading" role="status"><span>Growing the planet…</span></div>
	{/if}

	<!-- top left: where you are, and when -->
	<div class="corner tl">
		<a class="pill back" href="{base}/games" aria-label="Back to games">←</a>
		<div class="pill brand">
			<strong>avenCITY Sandbox 2</strong>
			{#if cityData}<span class="dim">{cityData.calendarLabel} · {clock}</span>{/if}
		</div>
	</div>

	<!-- top right: the city, then you -->
	<div class="corner tr">
		<button class="pill" onclick={() => openSheet('coops')}>
			Coops · {cityData?.coops.length ?? 0}
		</button>
		{#if cityData}
			<span class="pill dim">{cityData.citizens} citizens · {cityData.buildable.toLocaleString('en-US')} land cards</span>
		{/if}
		{#if me}
			<div class="pill wallet">
				<span class="dim">{me.token}</span>
				<strong>{me.balanceLabel}</strong>
			</div>
			<button class="pill" onclick={openLedger}>Ledger</button>
			{#if can('citizen:promote')}<button class="pill" onclick={openCitizens}>Citizens</button>{/if}
		{:else}
			<a class="pill cta" href="{base}/join/">Join to mint & invest</a>
		{/if}
	</div>

	<!-- bottom centre: the one action -->
	{#if me}
		<div class="corner bc">
			<button class="mint" onclick={doMint} disabled={busy || claimable < 10n ** 16n}>
				<strong>Mint</strong>
				<span>+{format(claimable)} {me.token}</span>
			</button>
		</div>
	{/if}

	{#if toast}<div class="toast" role="status">{toast}</div>{/if}

	<!-- the selected card -->
	{#if selected}
		<aside class="sheet right">
			<button class="close" onclick={() => (selected = null)} aria-label="Close">×</button>

			{#if selected.kind === 'land'}
				<p class="eyebrow">Card {selected.tile.toLocaleString('en-US')} · unclaimed land</p>
				<h2>Nobody has founded a coop here yet.</h2>
				{#if can('coop:create')}
					<p class="lede">Found one: a name, one line on what it is for, and your stake of 500 hearts as its first investment — which becomes its first 500 maiaHEARTS.</p>
					<form onsubmit={(e) => { e.preventDefault(); doFound(); }}>
						<label for="fname">Name</label>
						<input id="fname" bind:value={foundName} maxlength="24" placeholder="e.g. Solar" />
						<label for="fpitch">What, for whom, why now</label>
						<textarea id="fpitch" bind:value={foundPitch} maxlength="280" rows="3" placeholder="e.g. Panels for every dome cell, made next door."></textarea>
						<button class="primary" disabled={busy || foundName.trim().length < 3 || !foundPitch.trim()}>
							{busy ? 'Founding…' : 'Found this coop — 500♥'}
						</button>
						{#if foundName.trim().length < 3}
							<p class="hint">Give it a name of at least three letters.</p>
						{:else if !foundPitch.trim()}
							<p class="hint">Add one line on what it is for.</p>
						{/if}
					</form>
				{:else if me}
					<p class="lede">Founding a coop needs the coop founder role, which the city's admin grants. Everyone can invest in the coops that exist.</p>
				{:else}
					<p class="lede">Anyone can look around. To found or back a coop, <a href="{base}/join/">join as a founder</a>.</p>
				{/if}
			{:else}
				{@const c = selected.detail}
				<p class="eyebrow"><span class="phase {c.phase.toLowerCase()}">{c.phase}</span> · by {c.founder}</p>
				<h2>{c.name}</h2>
				<p class="lede">{c.pitch}</p>

				<div class="tabs">
					<button class:on={tab === 'overview'} onclick={() => (tab = 'overview')}>Overview</button>
					<button class:on={tab === 'schedule'} onclick={() => (tab = 'schedule')}>Emission</button>
				</div>

				{#if tab === 'overview'}
					<dl class="stats">
						<div><dt>Raised</dt><dd>{c.raisedLabel}♥</dd></div>
						<div><dt>In the treasury</dt><dd>{c.treasuryLabel} <small>{c.treasuryToken}</small></dd></div>
						<div><dt>Supply</dt><dd>{c.supplyLabel} <small>{c.mindToken}</small></dd></div>
						<div><dt>Backers</dt><dd>{c.backers}</dd></div>
					</dl>

					<p class="milestone">{c.milestoneOf}</p>
					<div class="bar" aria-label="Progress of this milestone"><span style:width="{c.fill}%"></span></div>
					<p class="dim small">{c.priceLabel} · {c.nextLabel}</p>

					{#if me && c.myMindsLabel}
						<p class="yours">You own <strong>{c.myMindsLabel} {c.mindToken}</strong></p>
					{/if}

					{#if c.soldOut}
						<p class="dim">Sold out — every MIND this coop will ever have is out.</p>
					{:else if can('coop:invest')}
						<form onsubmit={(e) => { e.preventDefault(); doInvest(); }}>
							<label for="hearts">Invest your {me?.token}</label>
							<div class="row">
								<input id="hearts" bind:value={heartsText} inputmode="decimal" placeholder="e.g. 100" />
								<button class="primary" disabled={busy || !preview || 'error' in preview}>
									{busy ? 'Investing…' : 'Invest'}
								</button>
							</div>
							{#if preview && 'minds' in preview}
								<p class="preview">
									You receive <strong>{preview.minds} {c.mindToken}</strong>. Your {preview.hearts} {me?.token}
									become {preview.hearts} maiaHEARTS in {c.name}'s treasury.
								</p>
							{:else if preview && 'error' in preview}
								<p class="bad small">{preview.error}</p>
							{/if}
						</form>
					{:else}
						<p class="lede small">To back {c.name}, <a href="{base}/join/">join as a founder</a> — your first mint carries 500 hearts.</p>
					{/if}
				{:else}
					<div class="schedule">
						<table>
							<thead><tr><th>#</th><th>MINDs</th><th>price</th><th>supply</th></tr></thead>
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

			{#if sheet === 'coops'}
				<p class="eyebrow">The coops</p>
				<h2>{cityData?.coops.length ? 'Where the hearts are going' : 'No coops yet'}</h2>
				{#if !cityData?.coops.length}
					<p class="lede">The planet is empty. The first coop founded here will be the first place the city's money is made.</p>
				{/if}
				<ul class="list">
					{#each cityData?.coops ?? [] as c (c.slug)}
						<li>
							<button onclick={() => openCoop(c.slug)}>
								<span><strong>{c.name}</strong> <span class="dim">by {c.founder}</span></span>
								<span class="dim small">{c.phase} · milestone {c.milestone} · {c.raisedLabel}♥ · {c.backers} backers</span>
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
			{:else if sheet === 'citizens'}
				<p class="eyebrow">Citizens</p>
				<h2>Who may found coops</h2>
				<p class="lede small">Every citizen mints and invests. Coop founders can also open a coop on an empty card.</p>
				<ul class="list">
					{#each citizenList as c (c.id)}
						<li class="citizen">
							<span><strong>{c.name}</strong> <span class="dim">#{c.number}</span></span>
							{#if c.role === 'admin'}
								<span class="dim small">admin</span>
							{:else}
								<button class="small-btn" onclick={() => toggleRole(c)}>
									{c.role === 'founder' ? 'Coop founder ✓' : 'Make coop founder'}
								</button>
							{/if}
						</li>
					{/each}
				</ul>
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
