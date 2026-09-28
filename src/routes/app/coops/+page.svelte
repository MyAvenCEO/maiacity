<!--
	Coops: the cities and their settlements, on their own — no globe. The list on the left (yours marked), the chosen
	one on the right: what it is, its numbers, where its current milestone stands, what an investment would buy (the
	same rule the server applies), invite links for a settlement, and its emission schedule. The same data as Sandbox
	2's coop card. Founding a city or a settlement needs a place on the map, so that stays in Sandbox 2.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import * as api from '$lib/sandbox-2/api';
	import type { Account, City, CoopDetail } from '$lib/sandbox-2/api';
	import { accrued, format, parse } from '../../../../game/time';
	import { ONE, STARTING } from '../../../../game/policy';
	import { coopPolicy, mindsFor, room } from '../../../../game/coops';

	const CITIZENSHIP = BigInt(coopPolicy.city.citizenshipMinHearts) * ONE;

	let world = $state<City | null>(null);
	let me = $state<Account | null>(null);
	let chosen = $state<CoopDetail | null>(null);
	let tab = $state<'overview' | 'settlements' | 'schedule'>('overview');
	let heartsText = $state('');
	let inviteLink = $state('');
	let busy = $state(false);
	let note = $state('');
	let error = $state('');
	let phase = $state<'loading' | 'ready'>('loading');

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
		chosen = await api.coop(slug).catch((e) => ((error = (e as Error).message), null));
		replaceState(`${base}/app/coops/?coop=${encodeURIComponent(slug)}`, {});
	}

	onMount(async () => {
		[world, me] = await Promise.all([api.city().catch(() => null), api.account().catch(() => null)]);
		phase = 'ready';
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
				? `You are a citizen of ${detail.name}. Step two, a home: found a settlement on free land in Sandbox 2, or use an invite link.`
				: `${heartsText.trim()} hearts became ${detail.heartsToken} in ${detail.name}'s treasury.`;
			heartsText = '';
			chosen = detail;
			[world, me] = await Promise.all([api.city(), api.account()]);
		});

	const makeInvite = () =>
		act(async () => {
			if (!chosen) return;
			const inv = await api.createInvite(chosen.slug);
			// an invite is accepted where the home is: on the island, in Sandbox 2
			inviteLink = `${location.origin}${base}/app/games/sandbox-2/?invite=${inv.token}`;
		});

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
						<li class="dim">No cities yet. The first one is founded on the map, in Sandbox 2.</li>
					{/each}
				</ul>
			{:else}
				<p class="bad">The cities could not be loaded.</p>
			{/if}
		</aside>

		<section class="detail">
			{#if chosen}
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
							<p class="dim small">{c.name} grows by invitation. A link admits one person, for a week; they move in on the island, in Sandbox 2.</p>
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
						<p class="dim">{c.name} grows by invitation: ask one of its settlers for an invite link — or found your own settlement on free land in Sandbox 2.</p>
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
							<li class="dim">No settlements in {c.name} yet.</li>
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
