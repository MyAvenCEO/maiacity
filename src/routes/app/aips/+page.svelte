<!--
	Proposals: the AIPs, Aven Improvement Proposals, of every vault and game, in one app of their own next to Ledger and
	Coops (Samuel 2026-10-17: proposals leave the game and sandbox screens completely). Every AIP goes the same way: an
	idea, then its objective (what it must deliver, metrics in Lean, measured as it is worked on), then proposed
	(waiting for its vault's yes), then archived as applied or rejected. Samuel 2026-10-20: the page is the four stages
	as one tab bar and nothing else, no filter and no way to write one here: agents make proposals through the MCP for
	now. MaiaCity V1's MIPs ($lib/proposals/aips.js) show the AIP way among them.
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
	import Unlock from '$lib/avendb/Unlock.svelte';

	const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
	let stage = $state(STAGES.some((s) => s.id === q.get('stage')) ? q.get('stage') : 'proposed');
	let open = $state(q.get('aip') ?? '');

	const g = liveGame();
	let acct = $state({ id: null });
	// avenDB's AIPs: every vault this device holds, read again each time its world changes (as the HITL stack reads them)
	let avendb = $state([]);
	// whether this device answered `aips` yet, and why it didn't, if it refused: until then the tabs say they read
	let read = $state(false);
	let why = $state('');
	let reading = 0;
	function loadAvendb() {
		if (session.phase !== 'open') return;
		const n = ++reading;
		session
			.ask({ op: 'aips' })
			.then((got) => {
				if (n !== reading) return;
				if (Array.isArray(got?.ok)) [avendb, read, why] = [got.ok, true, ''];
				else why = got?.why ?? got?.refused ?? 'avenDB did not answer';
			})
			.catch((e) => n === reading && (why = String(e?.message ?? e)));
	}
	$effect(() => {
		session.world;
		loadAvendb();
	});
	onMount(() => session.boot());

	onMount(() => {
		me()
			.then((f) => (acct = { id: f.id }))
			.catch(() => {});
	});

	const all = $derived(allOf(g.view, avendb, session.world));
	const shown = $derived(all.filter((a) => a.stage === stage));
	const count = (id) => all.filter((a) => a.stage === id).length;
	const current = $derived(all.find((a) => a.key === open) ?? null);
	const loading = $derived((acct.id && !g.loaded) || ((session.phase === 'loading' || session.phase === 'open') && !read && !why));

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
	<nav class="tabs" aria-label="Stage">
		{#each STAGES as s (s.id)}<button class:on={stage === s.id} onclick={() => ((stage = s.id), (open = ''))}>{s.label} <small>{count(s.id)}</small></button>{/each}
	</nav>

	{#if current}
		<section class="detail">
			<button class="back link" onclick={() => (open = '')}>← All {STAGES.find((s) => s.id === stage)?.label.toLowerCase()}</button>
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
			<p class="dim center">Reading the AIPs of your vaults…</p>
		{:else if why && !read}
			<p class="dim center">avenDB's AIPs didn't read: {why}. <button class="link" onclick={loadAvendb}>Read again</button></p>
		{:else}
			<ul class="list">
				{#each shown as a (a.key)}
					<li>
						<button onclick={() => show(a)}>
							<span class="head"><b>{a.title}</b><span class="status {outcome(a)}">{outcome(a)}</span></span>
							<span class="meta">{a.where} · {a.label}{a.source === 'avendb' ? '' : ` (was ${a.was})`} · by {a.author}{a.decided || a.created ? ` · ${when(a.decided || a.created)}` : ''}{progress(a)}{a.stage === 'proposed' ? ` · ${a.signed} of ${a.needs} signatures` : ''}</span>
							{#if a.changes.length}<span class="sum">{a.changes.slice(0, 3).join(' · ')}{a.changes.length > 3 ? ` · +${a.changes.length - 3} more` : ''}</span>{/if}
						</button>
					</li>
				{:else}
					<li class="dim empty">{EMPTY[stage]}</li>
				{/each}
			</ul>
		{/if}
		{#if session.phase !== 'open' && session.phase !== 'loading'}<div class="unlock"><p class="dim small">The AIPs of your avenDB vaults show here once avenDB is open in this tab.</p><Unlock /></div>{/if}
		{#if g.error}<p class="dim small">MaiaCity V1: {g.error}</p>{/if}
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
	.empty,
	.center {
		text-align: center;
		padding: 1.4rem 0;
	}
</style>
