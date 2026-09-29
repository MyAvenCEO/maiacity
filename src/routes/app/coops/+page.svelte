<!--
	Coops: the cities and their settlements, on their own — no globe. This is where the communities are made: a city is
	founded here, a citizenship taken, a settlement founded or joined with an invite link. None of it needs a map; the
	communities outlive every sandbox, and a sandbox only gives them a place — its founder chooses a card in Sandbox 2.

	The list on the left (yours marked), the chosen one on the right: what it is, its numbers, where it stands in which
	world, where its current milestone stands, what an investment would buy (the same rule the server applies), invite
	links for a settlement, and its emission schedule.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import * as api from '$lib/sandbox-2/api';
	import { PLAY, released } from '$lib/app/places';
	import type { Founder } from '$lib/auth/client';
	import type { Account, City, CoopDetail } from '$lib/sandbox-2/api';
	import { accrued, format, parse } from '../../../../game/time';
	import { ONE, STARTING } from '../../../../game/policy';
	import { coopPolicy, mindsFor, room } from '../../../../game/coops';

	const CITIZENSHIP = BigInt(coopPolicy.city.citizenshipMinHearts) * ONE;
	const SETTLING = BigInt(coopPolicy.settlement.joinMinHearts) * ONE;
	const INVITE_KEY = 'coops.invite';
	const SANDBOX_2 = `${base}/app/games/sandbox-2/`;

	let world = $state<City | null>(null);
	let me = $state<Account | null>(null);
	let chosen = $state<CoopDetail | null>(null);
	/** What the right side shows: a coop, a founding form, or an invitation. */
	let mode = $state<'coop' | 'found-city' | 'found-settlement' | 'invite'>('coop');
	let invitation = $state<api.Invite | null>(null);
	let foundName = $state('');
	let foundPitch = $state('');
	let foundHearts = $state('');
	let tab = $state<'overview' | 'settlements' | 'schedule'>('overview');
	let heartsText = $state('');
	let inviteLink = $state('');
	let busy = $state(false);
	let note = $state('');
	let error = $state('');
	let phase = $state<'loading' | 'ready'>('loading');

	const can = (cap: string) => !!me?.caps.includes(cap);
	/** Sandbox 2 is a draft: only those who may open it are sent there to place what they founded. */
	const sandboxOpen = $derived(!!me && released(me as unknown as Founder, PLAY.find((p) => p.href === SANDBOX_2)!));
	const homeCity = $derived(me?.city?.slug ?? null);
	const homeSettlement = $derived(me?.settlement?.slug ?? null);
	const joining = $derived(!!chosen && chosen.kind === 'city' && !!me && homeCity === null);
	const canBack = $derived(
		!!chosen && !!me && (chosen.kind === 'city' ? homeCity === null || homeCity === chosen.slug : homeSettlement === chosen.slug)
	);

	// what an investment would do, with the same rule the server applies
	const preview = $derived.by(() => {
		if (!chosen || !heartsText.trim()) return null;
		try {
			const hearts = parse(heartsText);
			if (hearts <= 0n) return null;
			if (joining && hearts < CITIZENSHIP) return { error: `Becoming a citizen takes at least ${format(CITIZENSHIP, 0)}♥.` };
			const raised = BigInt(chosen.raised);
			if (hearts > room(raised)) return { error: `Only ${format(room(raised), 0)}♥ of room left.` };
			return { minds: format(mindsFor(raised, hearts).investor), hearts: format(hearts, 2) };
		} catch {
			return { error: 'Not an amount.' };
		}
	});

	async function show(slug: string) {
		error = '';
		note = '';
		inviteLink = '';
		heartsText = '';
		tab = 'overview';
		mode = 'coop';
		chosen = await api.coop(slug).catch((e) => ((error = (e as Error).message), null));
		replaceState(`${base}/app/coops/?coop=${encodeURIComponent(slug)}`, {});
	}

	/** Open a founding form: a city, or a settlement in your city. */
	function found(what: 'city' | 'settlement') {
		error = '';
		note = '';
		foundName = '';
		foundPitch = '';
		foundHearts = what === 'city' ? coopPolicy.city.citizenshipMinHearts : coopPolicy.settlement.joinMinHearts;
		mode = what === 'city' ? 'found-city' : 'found-settlement';
		chosen = null;
		replaceState(`${base}/app/coops/?found=${what}`, {});
	}

	onMount(async () => {
		[world, me] = await Promise.all([api.city().catch(() => null), api.account().catch(() => null)]);
		phase = 'ready';

		// An invite link: keep it through a sign-up, and open it here, where joining happens.
		let token = page.url.searchParams.get('invite');
		try {
			if (token) sessionStorage.setItem(INVITE_KEY, token);
			else token = sessionStorage.getItem(INVITE_KEY);
		} catch {}
		if (token) {
			invitation = await api.invite(token).catch((e) => ((error = (e as Error).message), null));
			if (invitation) return void (mode = 'invite');
		}

		const founding = page.url.searchParams.get('found');
		if (me && founding === 'city' && !me.city) return found('city');
		if (me && founding === 'settlement' && me.city && !me.settlement) return found('settlement');

		const wanted = page.url.searchParams.get('coop') ?? homeSettlement ?? homeCity ?? world?.cities[0]?.slug;
		if (wanted) await show(wanted);
	});

	async function act(run: () => Promise<void>) {
		busy = true;
		error = '';
		note = '';
		try {
			await run();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	const invest = () =>
		act(async () => {
			if (!chosen) return;
			const becoming = joining;
			// spending starts with collecting: what has accrued is minted first, so it can be spent
			if (me && accrued(new Date(me.lastClaimAt), new Date()) + (me.startingPending ? STARTING : 0n) >= 10n ** 16n) await api.mint();
			const detail = await api.invest(chosen.slug, heartsText.trim());
			note = becoming
				? `You are a citizen of ${detail.name}. Step two, a home: found a settlement here, or use an invite link from a settler.`
				: `${heartsText.trim()} hearts became ${detail.heartsToken} in ${detail.name}'s treasury.`;
			heartsText = '';
			chosen = detail;
			[world, me] = await Promise.all([api.city(), api.account()]);
		});

	const makeInvite = () =>
		act(async () => {
			if (!chosen) return;
			const inv = await api.createInvite(chosen.slug);
			// an invite is accepted here, in Coops — no map needed
			inviteLink = `${location.origin}${base}/app/coops/?invite=${inv.token}`;
		});

	/** Spending starts with collecting: what has accrued is minted first, so it can be spent. */
	async function mintPending() {
		if (me && accrued(new Date(me.lastClaimAt), new Date()) + (me.startingPending ? STARTING : 0n) >= 10n ** 16n) await api.mint();
	}

	const doFound = () =>
		act(async () => {
			await mintPending();
			const input = { name: foundName.trim(), pitch: foundPitch.trim(), hearts: foundHearts.trim() };
			const detail = mode === 'found-city' ? await api.foundCity(input) : await api.foundSettlement(input);
			[world, me] = await Promise.all([api.city(), api.account()]);
			await show(detail.slug);
			note =
				detail.kind === 'city'
					? `${detail.name} is founded, and you are its first citizen. Step two: found your settlement — and whenever you like, give ${detail.name} its card in Sandbox 2.`
					: `${detail.name} is founded — your home, for good. Invite people with a link, and give it its cell in Sandbox 2 whenever you like.`;
		});

	const forgetInvite = () => {
		try {
			sessionStorage.removeItem(INVITE_KEY);
		} catch {}
	};

	/** Step one of an invite, for someone who is not yet a citizen: the city. */
	const doInviteCity = () =>
		act(async () => {
			if (!invitation) return;
			await mintPending();
			await api.invest(invitation.city.slug, coopPolicy.city.citizenshipMinHearts);
			me = await api.account();
			note = `You are a citizen of ${invitation.city.name}. Now move into ${invitation.settlement.name}.`;
		});

	/** Step two: move into the settlement; the link is spent. */
	const doInviteSettle = () =>
		act(async () => {
			if (!invitation) return;
			const inv = invitation;
			await mintPending();
			await api.acceptInvite(inv.token, coopPolicy.settlement.joinMinHearts);
			forgetInvite();
			invitation = null;
			[world, me] = await Promise.all([api.city(), api.account()]);
			await show(inv.settlement.slug);
			note = `Welcome home to ${inv.settlement.name}.`;
		});

	const dismissInvite = () => {
		forgetInvite();
		invitation = null;
		mode = 'coop';
		replaceState(`${base}/app/coops/`, {});
		const wanted = homeSettlement ?? homeCity ?? world?.cities[0]?.slug;
		if (wanted) void show(wanted);
	};

	/** Where it stands, world by world — today Sandbox 2's planet and islands. */
	const whereLabel = (c: CoopDetail) => {
		const spot = c.places[api.SANDBOX_2];
		if (spot === undefined) return '';
		return c.kind === 'city' ? `card ${Number(spot).toLocaleString('en-US')} of the planet` : `a cell of ${c.city.name}'s island`;
	};
	/** The founder of this city or settlement, looking at it. */
	const mineToPlace = (c: CoopDetail) =>
		!!me && ((c.kind === 'city' && me.city?.slug === c.slug && me.city.founded) || (c.kind === 'settlement' && me.settlement?.slug === c.slug && me.settlement.founded));

	const copy = async () => {
		await navigator.clipboard?.writeText(inviteLink).catch(() => {});
		note = 'Invite link copied. It admits one person, for a week.';
	};
</script>

<svelte:head>
	<title>Coops · maiaCITY</title>
</svelte:head>

<main class="coops">
	{#if phase === 'loading'}
		<p class="dim">One moment…</p>
	{:else}
		<aside class="list" aria-label="Cities and settlements">
			{#if world}
				<p class="eyebrow">{world.cities.length} {world.cities.length === 1 ? 'city' : 'cities'} · {world.players} {world.players === 1 ? 'player' : 'players'}</p>
				{#if me && !me.city && can('city:create')}
					<button class="quiet-btn found" class:on={mode === 'found-city'} onclick={() => found('city')}>+ Found a city</button>
				{:else if me?.city && !me.settlement && can('coop:create')}
					<button class="quiet-btn found" class:on={mode === 'found-settlement'} onclick={() => found('settlement')}>+ Found a settlement in {me.city.name}</button>
				{/if}
				<ul>
					{#each world.cities as c (c.slug)}
						<li>
							<button class="city" class:on={chosen?.slug === c.slug} class:mine={homeCity === c.slug} onclick={() => show(c.slug)}>
								<span class="nm">{c.name}{#if homeCity === c.slug}<em>yours</em>{/if}</span>
								<span class="dim">{c.citizens} {c.citizens === 1 ? 'citizen' : 'citizens'} · {c.settlements.length} {c.settlements.length === 1 ? 'settlement' : 'settlements'} · {c.raisedLabel}♥</span>
							</button>
							{#if c.settlements.length}
								<ul class="settlements">
									{#each c.settlements as k (k.slug)}
										<li>
											<button class:on={chosen?.slug === k.slug} class:mine={homeSettlement === k.slug} onclick={() => show(k.slug)}>
												<span class="nm">{k.name}{#if homeSettlement === k.slug}<em>home</em>{/if}</span>
												<span class="dim">level {k.level} · {k.settlers} {k.settlers === 1 ? 'settler' : 'settlers'}</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{:else}
						<li class="dim">No cities yet. Found the first one.</li>
					{/each}
				</ul>
			{:else}
				<p class="bad">The cities could not be loaded.</p>
			{/if}
		</aside>

		<section class="detail">
			{#if mode === 'invite' && invitation}
				{@const inv = invitation}
				<p class="eyebrow">An invitation · {inv.city.name}</p>
				<h1>{inv.invitedBy} invites you to {inv.settlement.name}.</h1>
				{#if note}<p class="ok">{note}</p>{/if}
				{#if error}<p class="bad">{error}</p>{/if}
				{#if !inv.usable}
					<p class="pitch">{inv.reason}</p>
				{:else if !me}
					<p class="pitch">
						{inv.settlement.name} is a settlement in {inv.city.name}. To move in, <a href="{base}/join/">sign up</a> — your first mint carries
						{format(STARTING, 0)} hearts — then come back to this page.
					</p>
				{:else if homeCity && homeCity !== inv.city.slug}
					<p class="pitch">You are a citizen of {me.city?.name}, for good. {inv.settlement.name} is in {inv.city.name}.</p>
				{:else if homeSettlement}
					<p class="pitch">You already live in {me.settlement?.name}, and that is for good.</p>
				{:else}
					<p class="pitch">Moving in takes two steps, and both are for good.</p>
					<ol class="steps">
						<li class:done={homeCity === inv.city.slug}>
							<strong>Citizen of {inv.city.name}</strong> — {format(CITIZENSHIP, 0)} of your hearts become {inv.city.slug}HEARTS.
							{#if homeCity !== inv.city.slug}
								<button class="pill-btn" onclick={doInviteCity} disabled={busy}>{busy ? 'Joining…' : `Become a citizen — ${format(CITIZENSHIP, 0)}♥`}</button>
							{/if}
						</li>
						<li>
							<strong>Home in {inv.settlement.name}</strong> — {format(SETTLING, 0)} more of your hearts, and the link is spent.
							{#if homeCity === inv.city.slug}
								<button class="pill-btn" onclick={doInviteSettle} disabled={busy}>{busy ? 'Moving in…' : `Move in — ${format(SETTLING, 0)}♥`}</button>
							{/if}
						</li>
					</ol>
				{/if}
				<button class="quiet-btn" onclick={dismissInvite}>Not now</button>
			{:else if mode === 'found-city' || mode === 'found-settlement'}
				{@const city = mode === 'found-city'}
				<p class="eyebrow">{city ? 'A new city' : `A new settlement in ${me?.city?.name}`}</p>
				<h1>{city ? 'Found a city' : 'Found a settlement'}</h1>
				<p class="pitch">
					{#if city}
						A name, one line on what it is for, and at least {format(CITIZENSHIP, 0)} of your own hearts. They become its first HEARTS, named after
						it, and you become its first citizen — for good. It needs no map: give it a card in Sandbox 2 whenever you like.
					{:else}
						Your home in {me?.city?.name} — a dome cluster that grows with every settler. At least {format(SETTLING, 0)} of your hearts become its
						first {me?.city?.slug}HEARTS, and it is your home for good. Others join with an invite link from a settler.
					{/if}
				</p>
				{#if error}<p class="bad">{error}</p>{/if}
				<form class="invest found-form" onsubmit={(e) => { e.preventDefault(); doFound(); }}>
					<label for="fname">{city ? 'City name' : 'Settlement name'}</label>
					<input id="fname" bind:value={foundName} maxlength="24" placeholder={city ? 'e.g. Maia' : 'e.g. Riverside'} />
					{#if foundName.trim().length >= 3}
						<p class="dim small">Its ownership: <strong>{foundName.trim().toLowerCase()}MINDS</strong>{#if city}, and its money <strong>{foundName.trim().toLowerCase()}HEARTS</strong>{/if}.</p>
					{/if}
					<label for="fpitch">What it is for</label>
					<textarea id="fpitch" bind:value={foundPitch} maxlength="280" rows="3" placeholder={city ? 'e.g. A city of a million co-founders.' : 'e.g. Domes by the river, a food forest all round.'}></textarea>
					<label for="fhearts">Your hearts</label>
					<input id="fhearts" bind:value={foundHearts} inputmode="decimal" placeholder={city ? `e.g. ${coopPolicy.city.citizenshipMinHearts}` : `e.g. ${coopPolicy.settlement.joinMinHearts}`} />
					<button class="pill-btn" disabled={busy || foundName.trim().length < 3 || !foundPitch.trim()}>
						{busy ? 'Founding…' : `Found ${foundName.trim() || (city ? 'this city' : 'this settlement')} — ${foundHearts || 0}♥`}
					</button>
				</form>
			{:else if chosen}
				{@const c = chosen}
				<p class="eyebrow">
					<span class="phase">{c.phase}</span>
					· {c.kind === 'city' ? 'city' : `settlement · level ${c.level}`}
					{#if c.kind !== 'city'}in <button class="link" onclick={() => show(c.city.slug)}>{c.city.name}</button>{/if}
					· by {c.founder}
				</p>
				<h1>{c.name}</h1>
				{#if c.pitch}<p class="pitch">{c.pitch}</p>{/if}

				<div class="tabs">
					<button class:on={tab === 'overview'} onclick={() => (tab = 'overview')}>Overview</button>
					{#if c.kind === 'city'}<button class:on={tab === 'settlements'} onclick={() => (tab = 'settlements')}>Settlements · {c.settlements.length}</button>{/if}
					<button class:on={tab === 'schedule'} onclick={() => (tab = 'schedule')}>Emission</button>
				</div>

				{#if note}<p class="ok">{note}</p>{/if}
				{#if error}<p class="bad">{error}</p>{/if}

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

					<p class="milestone">{c.milestoneOf}</p>
					<div class="bar" aria-label="Progress of this milestone"><span style:width="{c.fill}%"></span></div>
					<p class="dim small">{c.priceLabel} · {c.nextLabel}</p>

					{#if me && c.myMindsLabel && c.myMindsLabel !== '0.00'}
						<p class="yours">You own <strong>{c.myMindsLabel} {c.mindToken}</strong></p>
					{/if}

					<p class="stands small">
						{#if whereLabel(c)}
							Stands in {#if sandboxOpen}<a href={SANDBOX_2}>Sandbox 2</a>{:else}Sandbox 2{/if} on {whereLabel(c)}.
						{:else if mineToPlace(c) && sandboxOpen}
							{@const cityStands = c.kind === 'city' || !!world?.cities.find((x) => x.slug === c.city.slug)?.places[api.SANDBOX_2]}
							Stands in no world yet.
							{#if cityStands}<a href={SANDBOX_2}>Give it its {c.kind === 'city' ? 'card' : 'cell'} in Sandbox 2</a>.{:else}It gets its cell in Sandbox 2 once {c.city.name} stands there.{/if}
						{:else if mineToPlace(c)}
							Stands in no world yet. You choose where once Sandbox 2 is released.
						{:else}
							Stands in no world yet — its founder chooses where.
						{/if}
					</p>

					{#if c.soldOut}
						<p class="dim">Sold out — every MIND this will ever have is out.</p>
					{:else if !me}
						<p class="dim">Sign in to invest.</p>
					{:else if canBack}
						<form class="invest" onsubmit={(e) => { e.preventDefault(); invest(); }}>
							<label for="hearts">
								{#if joining}Become a citizen of {c.name} — at least {c.entryLabel} of your {me.token}, for good{:else}Invest your {me.token}{/if}
							</label>
							<div class="row">
								<input id="hearts" bind:value={heartsText} inputmode="decimal" placeholder={joining ? `e.g. ${c.entryLabel}` : 'e.g. 100'} />
								<button class="pill-btn" disabled={busy || !preview || 'error' in preview}>{busy ? 'Investing…' : joining ? 'Become a citizen' : 'Invest'}</button>
							</div>
							{#if preview && 'minds' in preview}
								<p class="preview">You receive <strong>{preview.minds} {c.mindToken}</strong>. Your {preview.hearts} {me.token} become {preview.hearts} {c.heartsToken} in {c.name}'s treasury.</p>
							{:else if preview && 'error' in preview}
								<p class="bad small">{preview.error}</p>
							{/if}
						</form>
						{#if c.kind === 'settlement'}
							<h2>Invite someone</h2>
							<p class="dim small">{c.name} grows by invitation. A link admits one person, for a week; they move in here, in Coops.</p>
							{#if inviteLink}
								<div class="row">
									<input readonly value={inviteLink} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
									<button class="pill-btn" onclick={copy}>Copy</button>
								</div>
							{:else}
								<button class="quiet-btn" onclick={makeInvite} disabled={busy}>Create an invite link</button>
							{/if}
						{/if}
					{:else if c.kind === 'city'}
						<p class="dim">You are a citizen of {me.city?.name}, for good. You back your own city.</p>
					{:else if homeSettlement}
						<p class="dim">You live in {me.settlement?.name}. You back your own settlement.</p>
					{:else}
						<p class="dim">
							{c.name} grows by invitation: ask one of its settlers for an invite link{#if homeCity === c.city.slug} — or <button class="link" onclick={() => found('settlement')}>found your own settlement</button>{/if}.
						</p>
					{/if}
				{:else if tab === 'settlements'}
					<ul class="rows">
						{#each c.settlements as k (k.slug)}
							<li>
								<button onclick={() => show(k.slug)}>
									<span><strong>{k.name}</strong> <span class="dim">by {k.founder}</span></span>
									<span class="dim small">level {k.level} · {k.settlers} {k.settlers === 1 ? 'settler' : 'settlers'} · {k.raisedLabel}♥</span>
								</button>
							</li>
						{:else}
							<li class="dim">No settlements in {c.name} yet.{#if homeCity === c.slug && !homeSettlement} <button class="link" onclick={() => found('settlement')}>Found the first one</button>.{/if}</li>
						{/each}
					</ul>
				{:else}
					<table class="schedule">
						<thead><tr><th>#</th><th>MINDS</th><th>price</th><th>supply</th></tr></thead>
						<tbody>
							{#each c.schedule as row (row.milestone)}
								{#if row.phaseHeading}<tr class="phase-row"><td colspan="4">{row.phaseHeading}</td></tr>{/if}
								<tr class={row.state}>
									<td>{row.milestone}</td>
									<td>{row.minds}</td>
									<td>{row.price}</td>
									<td>{row.cumulativeMinds}</td>
								</tr>
								{#if row.progress}
									<tr class="current"><td colspan="4"><div class="bar"><span style:width="{row.fill}%"></span></div><span class="small">{row.progress}</span></td></tr>
								{/if}
							{/each}
						</tbody>
					</table>
				{/if}
			{:else if world?.cities.length}
				<p class="dim">Choose a city or a settlement.</p>
			{:else if me && !me.city}
				<p class="dim">No city stands yet. <button class="link" onclick={() => found('city')}>Found the first one</button> — it needs no map.</p>
			{/if}
		</section>
	{/if}
</main>

<style>
	.coops {
		display: grid;
		grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr);
		gap: 1.8rem;
		max-width: 72rem;
		margin: 0 auto;
		padding: 1.6rem clamp(1rem, 4vw, 2rem) 0;
	}

	.dim {
		color: var(--muted);
	}

	.small {
		font-size: 0.85rem;
	}

	.ok {
		color: #2f6b45;
	}

	.bad {
		color: var(--terracotta);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list .eyebrow {
		margin: 0 0 0.6rem;
	}

	.list button {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 0.55rem 0.7rem;
		border: 1px solid transparent;
		border-radius: 12px;
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.list button:hover {
		background: var(--paper);
	}

	.list button.on {
		border-color: var(--line);
		background: var(--paper);
	}

	.list .nm {
		font-weight: 600;
	}

	.list em {
		margin-left: 0.4rem;
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--mustard);
		font-size: 0.66rem;
		font-style: normal;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.list .dim {
		font-size: 0.8rem;
	}

	.city {
		margin-top: 0.3rem;
	}

	.settlements {
		margin-left: 0.9rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--line);
	}

	.detail h1 {
		margin: 0.3rem 0 0;
		font-size: clamp(2rem, 4vw, 2.8rem);
	}

	.detail .eyebrow {
		margin: 0;
	}

	.phase {
		color: var(--terracotta);
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		text-decoration-color: var(--mustard);
		cursor: pointer;
	}

	.pitch {
		max-width: 40rem;
		color: var(--ink-soft);
	}

	.tabs {
		display: flex;
		gap: 0.4rem;
		margin: 1rem 0;
	}

	.tabs button {
		padding: 0.3rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.tabs button.on {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--paper);
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.8rem;
		margin: 0 0 1.2rem;
	}

	.stats div {
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--paper);
	}

	.stats dt {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.stats dd {
		margin: 0.2rem 0 0;
		font-family: var(--font-display);
		font-size: 1.35rem;
	}

	.stats small {
		font-family: var(--font-body);
		font-size: 0.75rem;
		color: var(--muted);
	}

	.milestone {
		margin: 0 0 0.4rem;
		font-weight: 600;
	}

	.bar {
		height: 8px;
		overflow: hidden;
		border-radius: 999px;
		background: var(--line);
	}

	.bar span {
		display: block;
		height: 100%;
		background: var(--mustard);
	}

	.yours {
		color: #2f6b45;
	}

	.invest {
		margin-top: 1.2rem;
		padding: 1rem 1.1rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--paper);
	}

	.invest label {
		font-size: 0.9rem;
		font-weight: 600;
	}

	.row {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.row input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font: inherit;
	}

	.preview {
		margin: 0.6rem 0 0;
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	h2 {
		margin: 1.6rem 0 0.2rem;
		font-size: 1.2rem;
	}

	.found {
		width: 100%;
		margin: 0 0 0.8rem;
		text-align: left;
	}

	.found.on {
		border-color: var(--ink);
	}

	.found-form {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.found-form input,
	.found-form textarea {
		padding: 0.55rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
		font: inherit;
	}

	.found-form textarea {
		resize: vertical;
	}

	.found-form .pill-btn {
		align-self: flex-start;
		margin-top: 0.4rem;
	}

	.stands {
		color: var(--muted);
	}

	.steps {
		margin: 1rem 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.9rem;
		line-height: 1.5;
	}

	.steps li.done {
		color: var(--muted);
	}

	.steps li.done strong::after {
		content: ' ✓';
		color: #2f6b45;
	}

	.steps .pill-btn {
		display: block;
		margin-top: 0.5rem;
	}

	.quiet-btn {
		margin-top: 0.4rem;
		padding: 0.45rem 1rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}

	.rows button {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 0.7rem 0.2rem;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.schedule {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
		font-variant-numeric: tabular-nums;
	}

	.schedule th,
	.schedule td {
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--line);
		text-align: left;
	}

	.schedule th {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.schedule .phase-row td {
		padding-top: 0.9rem;
		font-weight: 600;
		color: var(--terracotta);
	}

	.schedule .filled {
		color: var(--muted);
	}

	.schedule .current {
		background: rgb(239 181 77 / 0.12);
		font-weight: 600;
	}

	.schedule .locked {
		color: var(--ink-soft);
	}

	@media (max-width: 820px) {
		.coops {
			grid-template-columns: minmax(0, 1fr);
		}
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
