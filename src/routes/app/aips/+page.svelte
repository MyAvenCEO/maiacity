<!--
	Proposals: the AIPs, Aven Improvement Proposals, of every vault and game, in one app of their own next to Ledger and
	Coops (Samuel 2026-10-17: proposals leave the game and sandbox screens completely). Every AIP goes the same way: an
	idea, then its objective (what it must deliver, metrics in Lean, measured as it is worked on), then proposed
	(waiting for its vault's yes), then archived as applied or rejected. Samuel 2026-10-20: the page is the four stages
	as one tab bar and nothing else, no filter and no way to write one here: agents make proposals through the MCP for
	now. Samuel 2026-10-21: the stages as a kanban board, open only signed in (no sign-in box here), a column of cards each; a narrow screen keeps the tab bar and
	shows one column. MaiaCity V1's MIPs ($lib/proposals/aips.js) show the AIP way among them.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { me } from '$lib/auth/client';
	import { liveGame } from '$lib/maiacity-v1/live.svelte.js';
	import { STAGES, allOf, when } from '$lib/proposals/aips.js';
	import V1Aip from '$lib/proposals/V1Aip.svelte';
	import AvendbAip from '$lib/proposals/AvendbAip.svelte';
	import { session } from '$lib/avendb/session.svelte.js';
	import { aips } from '$lib/avendb/aips.svelte.js';

	const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
	let stage = $state(STAGES.some((s) => s.id === q.get('stage')) ? q.get('stage') : 'proposed');
	let open = $state(q.get('aip') ?? '');

	const g = liveGame();
	let acct = $state({ id: null });
	// avenDB's AIPs: every vault this device holds, read again each time its world changes, one read at a time, the
	// read the HITL stack shares ($lib/avendb/aips.svelte.js): until the device answered, the tabs say they read
	const loadAvendb = () => aips.again(true);
	$effect(() => {
		session.world;
		aips.again();
	});
	onMount(() => session.boot());

	onMount(() => {
		me()
			.then((f) => (acct = { id: f.id }))
			.catch(() => {});
	});

	const all = $derived(allOf(g.view, aips.list, session.world));
	const count = (id) => all.filter((a) => a.stage === id).length;
	const current = $derived(all.find((a) => a.key === open) ?? null);
	// with avenDB open, only its answer is waited for: MaiaCity V1's MIPs join them once its game loads
	const avendbOn = $derived(session.phase === 'loading' || session.phase === 'open');
	const loading = $derived(avendbOn ? !aips.read && !aips.why : !!acct.id && !g.loaded);

	// the tab and the AIP open are kept in the address, so a link (a HITL card's) opens on them
	$effect(() => {
		const p = new URLSearchParams();
		if (stage !== 'proposed') p.set('stage', stage);
		if (open) p.set('aip', open);
		history.replaceState(history.state, '', `${location.pathname}${p.size ? `?${p}` : ''}`);
	});
	// an AIP opened by a link shows under its own stage's tab
	$effect(() => {
		if (current && current.stage !== stage) stage = current.stage;
	});
	function show(a) {
		open = a.key;
		stage = a.stage;
		scrollTo({ top: 0 });
	}
	const outcome = (a) => (a.stage !== 'archived' ? a.stage : a.outcome === 'applied' ? 'applied' : a.why === 'withdrawn' ? 'withdrawn' : 'rejected');
	const progress = (a) => (a.aip?.objective && !a.aip.objective.error ? ` · ${a.aip.objective.met} of ${a.aip.objective.total} met` : '');
	const EMPTY = {
		idea: 'No ideas. An idea is an AIP an agent opened over its proposals through the MCP, before it states its objective.',
		objective: 'Nothing at the objective stage. Here an AIP states what it must deliver, metrics in Lean, and measures its own progress while its agent works on it.',
		proposed: 'Nothing waits for a yes.',
		archived: 'Nothing archived yet.'
	};
</script>

<svelte:head>
	<title>Proposals · maiaCITY</title>
</svelte:head>

<main class="app-page">
	<h1 class="sr">Proposals</h1>
	<nav class="tabs" class:hide={!current} aria-label="Stage">
		{#each STAGES as s (s.id)}<button class:on={!current && stage === s.id} onclick={() => ((stage = s.id), (open = ''))}>{s.label} <small>{count(s.id)}</small></button>{/each}
	</nav>

	{#if current}
		<section class="detail">
			<button class="back link" onclick={() => (open = '')}>← All proposals</button>
			<p class="eyebrow">{current.where} · {current.label}{current.was && current.was !== current.label ? ` · was ${current.was}` : ''}</p>
			<h2>{current.title} <span class="status {outcome(current)}">{outcome(current)}</span></h2>
			<p class="by">By {current.author}{current.via === 'mcp' ? ', through the MCP' : ''} · {when(current.created)}{current.decided ? ` · decided ${when(current.decided)}` : ''} · {current.policy}{current.stage === 'proposed' ? ` (${current.signed} of ${current.needs} so far)` : ''}</p>
			{#if current.text}<p class="prose">{current.text}</p>{/if}
			<!-- an avenDB AIP shows what it changes in a section of its own that opens (AvendbAip) -->
			{#if current.changes.length && current.source !== 'avendb'}
				<h3>What it changes</h3>
				<ul class="changes">{#each current.changes as c, i (i)}<li>{c}</li>{/each}</ul>
			{/if}
			{#if current.source === 'avendb'}
				<AvendbAip a={current} onchanged={loadAvendb} />
			{:else if g.view}
				<V1Aip m={current.mip} {g} />
			{/if}
		</section>
	{:else}
		{#if loading}
			<p class="dim center">{session.phase === 'loading' ? 'Opening avenDB…' : 'Reading the AIPs of your vaults…'}</p>
		{:else if aips.why && !aips.read}
			<p class="dim center">avenDB's AIPs didn't read: {aips.why}. <button class="link" onclick={loadAvendb}>Read again</button></p>
		{:else}
			<!-- the board: a column per stage, side by side; on a narrow screen the stage bar picks the one column shown -->
			<div class="board">
				{#each STAGES as s (s.id)}
					<section class="col" class:on={stage === s.id} aria-label={s.label}>
						<h2 class="col-head">{s.label} <small>{count(s.id)}</small></h2>
						<ul class="cards">
							{#each all.filter((a) => a.stage === s.id) as a (a.key)}
								<li>
									<button onclick={() => show(a)}>
										<span class="where">{a.where} · {a.label}</span>
										<b>{a.title}</b>
										{#if a.changes.length}<span class="sum">{a.changes.slice(0, 2).join(' · ')}{a.changes.length > 2 ? ` · +${a.changes.length - 2} more` : ''}</span>{/if}
										<span class="foot">
											<span class="meta">{a.author}{a.decided || a.created ? ` · ${when(a.decided || a.created)}` : ''}{progress(a)}{a.stage === 'proposed' ? ` · ${a.signed} of ${a.needs} signed` : ''}</span>
											{#if a.stage === 'archived'}<span class="status {outcome(a)}">{outcome(a)}</span>{/if}
										</span>
									</button>
								</li>
							{:else}
								<li class="dim empty">{EMPTY[s.id]}</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		{/if}
		{#if g.error}<p class="dim small">MaiaCity V1: {g.error}</p>{/if}
	{/if}
</main>

<style>
	.app-page {
		max-width: 84rem;
		margin: 0 auto;
		padding: 1.6rem clamp(1rem, 4vw, 2rem) 6rem;
	}
	.dim {
		color: var(--muted);
	}
	.small {
		font-size: 0.85rem;
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
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem;
		margin: 0.4rem 0 1rem;
	}
	.tabs button {
		padding: 0.4rem 0.85rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: #fff;
	}
	.tabs button.on {
		background: #24452f;
		border-color: #24452f;
		color: #f4f1e8;
	}
	.tabs small {
		opacity: 0.7;
	}
	.board {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.8rem;
		align-items: start;
	}
	.col {
		padding: 0.6rem;
		border-radius: 14px;
		background: rgb(31 42 35 / 0.04);
		min-height: 12rem;
	}
	.col-head {
		margin: 0.1rem 0.3rem 0.6rem;
		font-family: inherit;
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #24452f;
	}
	.col-head small {
		margin-left: 0.2rem;
		padding: 0 0.4rem;
		border-radius: 999px;
		background: #24452f18;
		font-size: 0.72rem;
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.cards li > button {
		display: grid;
		gap: 0.3rem;
		width: 100%;
		text-align: left;
		padding: 0.65rem 0.75rem;
		border: 1px solid rgb(31 42 35 / 0.1);
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 1px 2px rgb(31 42 35 / 0.06);
	}
	.cards li > button:hover {
		border-color: #24452f;
	}
	.cards b {
		font-size: 0.92rem;
		line-height: 1.3;
	}
	.where {
		font-size: 0.68rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.foot {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: center;
	}
	.meta,
	.sum {
		font-size: 0.78rem;
		color: var(--muted);
	}
	.sum {
		color: #24452f;
	}
	.empty {
		font-size: 0.8rem;
		padding: 0.8rem 0.3rem;
	}
	/* wide: the four columns, no stage bar; narrow: the stage bar, one column */
	@media (min-width: 901px) {
		.tabs.hide {
			display: none;
		}
	}
	@media (max-width: 900px) {
		.tabs {
			flex-wrap: nowrap;
			gap: 0.25rem;
		}
		.tabs button {
			flex: 1 1 0;
			min-width: 0;
			padding: 0.3rem 0.35rem;
			font-size: 0.8rem;
			white-space: nowrap;
		}
		.board {
			grid-template-columns: 1fr;
		}
		.col {
			display: none;
			background: none;
			padding: 0;
			min-height: 0;
		}
		.col.on {
			display: block;
		}
		.col-head {
			display: none;
		}
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
	.status.objective {
		background: #24452f18;
		color: #24452f;
	}
	.status.rejected,
	.status.withdrawn {
		background: #1f2a2314;
		color: #6b6a66;
	}
	.detail {
		max-width: 60rem;
		margin: 1rem auto 0;
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
	.center {
		text-align: center;
		padding: 1.4rem 0;
	}
</style>
