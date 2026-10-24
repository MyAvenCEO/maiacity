<!--
	Proposals: the AIPs, Aven Improvement Proposals, of every game, in one app of their own next to Ledger and Coops
	(Samuel 2026-10-17: proposals leave the game and sandbox screens completely). Every AIP goes the same way: an idea,
	then proposed (waiting for the signatures its game's policy asks for), then archived as applied or rejected; each is
	a readable text plus the changes it makes. Until they live in avenDB (plan: /mnt/project-files/game-caps/plan.md),
	the app reads today's MIPs where they are kept ($lib/maiacity-v2/aips.js) and shows each the AIP way, with the number
	it had ("was MIP-42"). A game links here; its own screens show no proposal.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { me } from '$lib/auth/client';
	import { liveGame } from '$lib/maiacity-v2/live.svelte.js';
	import { GAMES, STAGES, allOf, when } from '$lib/maiacity-v2/aips.js';
	import V1Aip from '$lib/maiacity-v2/V1Aip.svelte';
	import V1Draft from '$lib/maiacity-v2/V1Draft.svelte';
	import AvendbAip from '$lib/proposals/AvendbAip.svelte';
	import { session } from '$lib/avendb/session.svelte.js';
	import { aips } from '$lib/avendb/aips.svelte.js';
	import Unlock from '$lib/avendb/Unlock.svelte';
	import { nameOf } from '$lib/avendb/vaults.js';

	const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
	let game = $state(q.get('game') ?? '');
	let stage = $state(q.get('stage') ?? 'proposed');
	let open = $state(q.get('aip') ?? '');
	// "Propose a change" or "Propose a payout" in MaiaCity V2 lands here on a new proposal
	let drafting = $state(q.get('new') === '1' && q.get('game') === 'maiacity-v2');
	const payout = q.get('from') ? { from: q.get('from'), to: q.get('to'), token: q.get('token'), amount: Number(q.get('amount') ?? 1) } : null;

	const g = liveGame();
	let acct = $state({ id: null });
	const avendb = $derived(aips.list);
	const loadAvendb = () => aips.again();
	onMount(() => aips.hold());
	onMount(() => session.boot());

	onMount(() => {
		me()
			.then((f) => (acct = { id: f.id }))
			.catch(() => {});
	});

	const all = $derived(allOf(g.view, avendb, session.world));
	// the filter: a game ('maiacity-v2'), or an avenDB vault ('vault:<id>') for AIPs about anything
	const inGame = $derived(all.filter((a) => !game || (game.startsWith('vault:') ? a.vault === game.slice(6) : a.game === game)));
	const vaults = $derived([...new Set(avendb.map((a) => a.vault))].map((id) => ({ id, name: nameOf(session.world?.vaults.find((v) => v.id === id)) })));
	const shown = $derived(inGame.filter((a) => a.stage === stage));
	const count = (id) => inGame.filter((a) => a.stage === id).length;
	const current = $derived(all.find((a) => a.key === open) ?? null);
	const loading = $derived(acct.id && !g.loaded);

	// the filter, the tab and the AIP open are kept in the address, so a link (a game's, a HITL card's) opens on them
	$effect(() => {
		const p = new URLSearchParams();
		if (game) p.set('game', game);
		if (stage !== 'proposed') p.set('stage', stage);
		if (open) p.set('aip', open);
		history.replaceState(history.state, '', `${location.pathname}${p.size ? `?${p}` : ''}`);
	});
	function show(a) {
		open = a.key;
		stage = a.stage;
		scrollTo({ top: 0 });
	}
	const outcome = (a) => (a.stage !== 'archived' ? (a.stage === 'proposed' ? 'proposed' : 'idea') : a.outcome === 'applied' ? 'applied' : a.why === 'withdrawn' ? 'withdrawn' : 'rejected');
	const canDraft = $derived(!!g.view && !!g.mySeat && (!game || game === 'maiacity-v2'));
	function drafted(done) {
		drafting = false;
		if (done) (game = 'maiacity-v2'), (stage = 'proposed');
	}
</script>

<svelte:head>
	<title>Proposals · maiaCITY</title>
</svelte:head>

<main class="app-page">
	<header>
		<p class="eyebrow">AIPs · Aven Improvement Proposals</p>
		<h1>Proposals</h1>
		<p class="dim">Every change to a game's rules, settings or screens is a proposal: a text to read, plus exactly what it changes. It starts as an idea, is proposed and waits for the signatures its game asks for, and ends in the archive, applied or rejected. Today's MIPs are shown here the same way, each with the number it had.</p>
	</header>

	<nav class="filters" aria-label="Game">
		<button class:on={!game} onclick={() => ((game = ''), (open = ''))}>All games</button>
		{#each Object.entries(GAMES) as [id, x] (id)}<button class:on={game === id} onclick={() => ((game = id), (open = ''))}>{x.label}</button>{/each}
		{#each vaults as v (v.id)}<button class:on={game === `vault:${v.id}`} onclick={() => ((game = `vault:${v.id}`), (open = ''))}>{v.name}</button>{/each}
		{#if canDraft && !drafting}<button class="new" onclick={() => ((drafting = true), (open = ''))}>New proposal</button>{/if}
	</nav>

	{#if drafting && g.view && g.mySeat}
		<section class="detail">
			<p class="eyebrow">New proposal · MaiaCity V2</p>
			<V1Draft {g} {payout} ondone={drafted} />
		</section>
	{:else if drafting && g.loaded}
		<p class="dim">Only the three players of MaiaCity V2 propose for it. Take a seat in <a href="{base}/app/maiacity-v2/">the game</a> first.</p>
	{/if}

	{#if current}
		<section class="detail">
			<button class="back link" onclick={() => (open = '')}>← All {STAGES.find((s) => s.id === stage)?.label.toLowerCase()}</button>
			<p class="eyebrow">{current.where} · {current.label}{current.was && current.was !== current.label ? ` · was ${current.was}` : ''}</p>
			<h2>{current.title} <span class="status {outcome(current)}">{outcome(current)}</span></h2>
			<p class="by">By {current.author}{current.via === 'mcp' ? ', through the MCP' : ''} · {when(current.created)}{current.decided ? ` · decided ${when(current.decided)}` : ''} · {current.policy}{current.stage === 'proposed' ? ` (${current.signed} of ${current.needs} so far)` : ''}</p>
			{#if current.text}<p class="prose">{current.text}</p>{/if}
			{#if current.changes.length}
				<h3>What it changes</h3>
				<ul class="changes">{#each current.changes as c, i (i)}<li>{c}</li>{/each}</ul>
			{/if}
			{#if current.source === 'avendb'}
				<AvendbAip a={current} onchanged={loadAvendb} />
			{:else if g.view}
				<V1Aip m={current.mip} {g} />
			{/if}
		</section>
	{:else if !drafting}
		<nav class="tabs" aria-label="Stage">
			{#each STAGES as s (s.id)}<button class:on={stage === s.id} onclick={() => (stage = s.id)}>{s.label} <small>{count(s.id)}</small></button>{/each}
		</nav>
		{#if loading}
			<p class="dim">One moment…</p>
		{:else if stage === 'idea' && !shown.length}
			<p class="dim">No ideas yet. An idea is an AIP in avenDB not yet proposed: anyone with a share to suggest in a vault, and their agents, gather and edit it freely under an id of its own until it is proposed and gets its number. Today's MIPs have no ideas: MaiaCity V2's are proposed straight away.</p>
		{:else}
			<ul class="list">
				{#each shown as a (a.key)}
					<li>
						<button onclick={() => show(a)}>
							<span class="head"><b>{a.title}</b><span class="status {outcome(a)}">{outcome(a)}</span></span>
							<span class="meta">{a.where} · {a.label}{a.source === 'avendb' ? '' : ` (was ${a.was})`} · by {a.author}{a.decided || a.created ? ` · ${when(a.decided || a.created)}` : ''}{a.stage === 'proposed' ? ` · ${a.signed} of ${a.needs} signatures` : ''}</span>
							{#if a.changes.length}<span class="sum">{a.changes.slice(0, 3).join(' · ')}{a.changes.length > 3 ? ` · +${a.changes.length - 3} more` : ''}</span>{/if}
						</button>
					</li>
				{:else}
					<li class="dim">Nothing here{game && GAMES[game] ? ` for ${GAMES[game].label}` : ''}.</li>
				{/each}
			</ul>
		{/if}
		{#if session.phase !== 'open' && session.phase !== 'loading'}<div class="unlock"><p class="dim small">The AIPs of your avenDB vaults show here once avenDB is open in this tab.</p><Unlock /></div>{/if}
		{#if g.error && (!game || game === 'maiacity-v2')}<p class="dim small">MaiaCity V2: {g.error}</p>{/if}
	{/if}
</main>

<style>
	.app-page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.6rem clamp(1rem, 4vw, 2rem) 6rem;
	}
	.dim {
		color: var(--muted);
	}
	.small {
		font-size: 0.85rem;
	}
	a {
		color: var(--ink);
		text-decoration-color: var(--mustard);
		text-underline-offset: 3px;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		margin: 0.2rem 0 0.4rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 2.8rem);
	}
	h2 {
		margin: 0.2rem 0 0.4rem;
		font-family: var(--font-display);
		font-size: 1.6rem;
	}
	h3 {
		margin: 1rem 0 0.3rem;
		font-size: 0.95rem;
	}
	button {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.filters,
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 1.2rem 0 0.4rem;
	}
	.filters button,
	.tabs button {
		padding: 0.4rem 0.85rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: #fff;
	}
	.filters button.on,
	.tabs button.on {
		background: #24452f;
		border-color: #24452f;
		color: #f4f1e8;
	}
	.filters .new {
		margin-left: auto;
		background: #24452f;
		border-color: #24452f;
		color: #f4f1e8;
	}
	.tabs small {
		opacity: 0.7;
	}
	.list {
		list-style: none;
		margin: 0.6rem 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.list li > button {
		display: grid;
		gap: 0.2rem;
		width: 100%;
		text-align: left;
		padding: 0.7rem 0.9rem;
		border: 1px solid rgb(31 42 35 / 0.1);
		border-radius: 12px;
		background: #fff;
	}
	.list li > button:hover {
		border-color: #24452f;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		align-items: baseline;
	}
	.meta,
	.sum {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.sum {
		color: #24452f;
	}
	.status {
		flex: none;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-family: inherit;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		vertical-align: middle;
		background: #eda10022;
		color: #8a5a00;
	}
	.status.applied {
		background: #1baf7a22;
		color: #136b4b;
	}
	.status.rejected,
	.status.withdrawn {
		background: #1f2a2314;
		color: #6b6a66;
	}
	.detail {
		margin-top: 1rem;
		padding: 1rem 1.1rem;
		border-radius: 14px;
		background: #fff;
		border: 1px solid rgb(31 42 35 / 0.1);
	}
	.back {
		margin-bottom: 0.6rem;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		text-decoration: underline;
	}
	.by {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.prose {
		white-space: pre-wrap;
		margin: 0.8rem 0;
	}
	.changes {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.9rem;
	}
	.unlock {
		margin-top: 1.2rem;
	}
	@media (max-width: 600px) {
		.filters .new {
			margin-left: 0;
		}
	}
</style>
