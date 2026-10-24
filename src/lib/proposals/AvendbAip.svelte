<!--
	One avenDB AIP in the Proposals app: where it stands, idea → objective → proposed → archived; its objective, what
	it must deliver as metrics in Lean, each measured against the readings recorded on it (./Objective.svelte); the assets it proposes, in 3D, built from the files on their lines
	($lib/avendb/ProposedAssets.svelte); then, in a section that opens, what it changes, a line per part, and every line
	it bundles (a note, an asset, a view, a game config, any type of entry), each with what it changes field by field as
	its schema reads it (the `aip` read's diff, derived, never typed); the reviews so far, and what the person may do with it, acting as the vault the device says: promote it once it holds an objective
	(the objective stage) and withdraw it (its author or its vault), and accept, decline or ask for a revision of a proposed one (its vault
	alone, and only that review counts). Accepting merges every line at once; a new entry's line (a draft) lands in main
	only then, every field of it shown as added. Who accepts it measures it too, on this device: where its objective
	names measuring logic, Measure runs that logic on its lines here and records the numbers as the vault's readings
	(./measure.js), which its `measured "name"` metrics count; and in theOS on a Mac, with Lean got there (Get Lean,
	which names its sizes), Measure checks the objective with real Lean too and records its verdict (./lean.js).
-->
<script>
	// @ts-nocheck — plain JS
	import { base } from '$app/paths';
	import { linkHref } from '$lib/markdown/index.js';
	import ProposedAssets from '$lib/avendb/ProposedAssets.svelte';
	import Objective from './Objective.svelte';
	import { session } from '$lib/avendb/session.svelte.js';
	import { syncing, share } from '$lib/avendb/sync.svelte.js';
	import { acting, authorsLine, nameOf } from '$lib/avendb/vaults.js';
	import { when } from './aips.js';
	import { measureAip, readingsOf } from './measure.js';
	import { leanDue, mb, verdictOf } from './lean.js';

	/** a: the AIP in the app's shape (./aips.js fromAvendb); onchanged: after a change, to read the list again */
	let { a, onchanged } = $props();

	const aip = $derived(a.aip);
	const world = $derived(session.world);
	const as = $derived(world ? acting(world, aip.vault).as : '');
	const ownVault = $derived(!!as && as === aip.vault);
	const mine = $derived(!!as && as === aip.author);
	const vaultName = (id) => nameOf(world?.vaults.find((v) => v.id === id));
	// who answered a review: the people whose devices signed it (its `authors`, after the coop's aven), not its `by`,
	// which names who started the AIP
	const answeredBy = (r) =>
		authorsLine(world, (r.authors ?? []).filter((a) => a.kind === 'human')) ||
		authorsLine(world, r.authors, vaultName(aip.vault));

	// the lines with their diffs: the `aip` read, once per AIP shown and version of its lines, not again for each new
	// answer of the `aips` read (a bare proposal has no entry of its own to read)
	let lines = $state(null);
	const entry = $derived(aip.entry);
	const heads = $derived(aip.lines.map((l) => l.heads.join()).join(';'));
	$effect(() => {
		heads;
		lines = null;
		if (!entry) return;
		const selected = entry;
		return session.observe(() => ({ op: 'aip', entry: selected }),
			(got) => { lines = got?.ok?.lines ?? []; }, () => { lines = []; });
	});
	const shown = $derived(lines ?? aip.lines);

	let text = $state('');
	// what it does, as the page's toast says it, names the AIP (AIP-n), so a toast that stays shows which one waits
	async function act(what, op) {
		const done = await session.run(`${what} ${aip.label ?? 'the idea'}`, { ...op, entry: aip.entry, as });
		if (done) (text = ''), onchanged();
	}
	// a review names every line's heads as the page shows them, so a line written after it was drawn is never accepted unseen
	const review = (what, verdict) => act(what, { op: 'aip_review', verdict, text, heads: shown.flatMap((l) => l.heads ?? []) });
	const show = (v) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
	// the AIP and the version of its lines: its assets are read again when a line moves
	const key = $derived(`${aip.entry ?? ''}/${aip.lines.map((l) => l.heads.join()).join(';')}`);
	const readFile = (root, size, from, to) => session.api.readFile(root, size, from, to);
	const VERDICT = { accepted: 'Accepted', declined: 'Declined', revise: 'Asked for a revision' };
	// the four stages, and how far this AIP is along them
	const STEPS = [
		{ id: 'idea', label: 'Idea' },
		{ id: 'objective', label: 'Objective' },
		{ id: 'proposed', label: 'Proposed' },
		{ id: 'archived', label: 'Archived' }
	];
	const at = $derived(STEPS.findIndex((s) => s.id === aip.stage));

	// measuring it here: its vault, as the person acts for it, never its author, while it is worked on or proposed
	const measurable = $derived(
		!aip.bare && ownVault && as !== aip.author && !!aip.objective?.measures?.length && ['objective', 'proposed'].includes(aip.stage)
	);
	// checking it with real Lean (N3): in theOS alone, by its vault, never its author, an objective that reads
	const checkable = $derived(
		!!session.mac && !aip.bare && ownVault && as !== aip.author && !!aip.objective && !aip.objective.error && ['objective', 'proposed'].includes(aip.stage)
	);
	/** what Lean is on this Mac (avendb-device's `leanEngine`): `{can, here, download, kept, getting, failed, engine}` */
	let lean = $state(null);
	const readLean = async () => (lean = (await session.mac?.call('leanEngine').catch(() => null)) ?? lean);
	$effect(() => {
		if (checkable && !lean) readLean();
	});
	const leanHere = $derived(checkable && !!lean?.here);
	const measureWhat = $derived(
		measurable && leanHere
			? 'Runs its measuring logic on its lines and checks its objective with Lean'
			: measurable
				? 'Runs its measuring logic on its lines'
				: 'Checks its objective with Lean'
	);
	async function getLean() {
		const what = 'Getting Lean for this Mac';
		const poll = setInterval(async () => {
			const at = (await readLean())?.getting;
			if (at && session.doing.startsWith(what)) session.doing = `${what}: ${mb(at.at)} of ${mb(at.of)}`;
		}, 1000);
		try {
			await session.attempt(what, async () => (lean = await session.mac.call('leanGet')));
		} finally {
			clearInterval(poll);
			await readLean();
		}
	}
	/** what the last Measure found: a line per logic and side, Lean's verdict, or that nothing was new */
	let found = $state(null);
	const asked = async (op) => {
		const r = await session.ask(op);
		if (!r || !('ok' in r)) throw new Error(r?.why ?? 'avenDB didn’t answer');
		return r.ok;
	};
	async function measure() {
		const label = aip.label ?? 'the idea';
		let rows = [];
		let checked = null;
		const ran = await session.attempt(`Measuring ${label} on this ${session.mac ? 'Mac' : 'device'}`, async () => {
			if (measurable) rows = await measureAip({ ask: asked, a: aip, vault: aip.vault, me: as });
			if (leanHere && leanDue(aip.objective, as)) checked = await session.mac.call('leanCheck', aip.objective.lean);
		});
		if (!ran) return;
		found = [
			...rows.map((r) => `${r.logic}${r.side ? ` on ${r.side === 'main' ? 'main' : 'the proposal'}` : ''}: ${r.error ?? r.readings.map(([n, v]) => `${n} ${v}`).join(', ')}`),
			...(checked
				? [checked.ok ? `Lean accepts its objective (${checked.ms} ms)` : `Lean rejects its objective at ${checked.error.line}:${checked.error.column}: ${checked.error.message}`]
				: [])
		];
		if (!found.length) found = ['Nothing new to measure: it was measured on these lines already.'];
		const ops = [...readingsOf(aip.entry, rows, as), ...(checked ? [verdictOf(aip.entry, checked, as)] : [])];
		if (ops.length && (await session.runAll(`Recording what ${label} measured`, ops))) onchanged();
	}
</script>

<div class="av">
	{#if !aip.bare}
		<ol class="steps" aria-label="Stage">
			{#each STEPS as s, i (s.id)}
				<li class:done={i < at} class:now={i === at}>{s.id === 'archived' && aip.outcome ? (aip.outcome === 'applied' ? 'Applied' : 'Rejected') : s.label}</li>
			{/each}
		</ol>
		<section class="target">
			<h3>Objective</h3>
			<Objective o={aip.objective} />
			{#if measurable || leanHere}
				<div class="measure">
					<button disabled={!!session.doing} onclick={measure}>Measure</button>
					<small class="dim">{measureWhat} here, on this {session.mac ? 'Mac' : 'device'}, and records what it finds.</small>
				</div>
				{#if found}<ul class="found">{#each found as f, i (i)}<li>{f}</li>{/each}</ul>{/if}
			{/if}
			{#if checkable && lean?.can && !lean.here}
				<div class="measure">
					<button disabled={!!session.doing} onclick={getLean}>Get Lean</button>
					<small class="dim"
						>Lean {lean.version} checks objectives on this Mac, locked away from your files and the network: {mb(lean.download)} read from
						Maia City in avenDB (<a href="{base}/app/#code/lean">Code</a>), {mb(lean.kept)} kept on this Mac.{lean.failed ? ` The last try failed: ${lean.failed}` : ''}</small
					>
				</div>
			{/if}
		</section>
	{/if}
	<ProposedAssets lines={aip.lines} ask={(op) => session.ask(op)} read={readFile} {key} />

	<details class="changes">
		<summary>What it changes <small>{shown.length} part{shown.length === 1 ? '' : 's'}</small></summary>
		{#if a.changes.length}
			<ul class="summary">{#each a.changes as c, i (i)}<li>{c}</li>{/each}</ul>
		{/if}
		{#each shown as l, i (i)}
			<section class="line">
				<p class="head"><b>{l.title ?? l.name ?? 'An entry'}</b> <small>{l.type ?? 'entry'}{l.new ? ' · new' : ''}{l.merged ? ' · merged' : ''}{l.public && !l.merged ? ' · goes public on Accept' : ''}</small></p>
				{#if l.diff?.length}
					<ul class="diff">
						{#each l.diff as d, j (j)}
							<li class={d.kind}>
								<span class="label">{d.label ?? d.path?.join(' › ')}</span>
								{#if l.new}<span class="new">+ {show(d.new)}</span>
								{:else if d.kind === 'text'}<span class="old">{show(d.old)}</span><span class="new">{show(d.new)}</span>
								{:else if d.kind === 'add'}<span class="new">+ {show(d.new)}</span>
								{:else if d.kind === 'remove'}<span class="old">− {show(d.old)}</span>
								{:else}<span class="old">{show(d.old)}</span> → <span class="new">{show(d.new)}</span>{/if}
							</li>
						{/each}
					</ul>
				{:else if lines}
					<p class="dim">No field changes against main.</p>
				{/if}
			</section>
		{/each}
	</details>

	{#if aip.links?.length}
		<p class="links">{#each aip.links as l (l.id)}<a href={linkHref(l.url)} target="_blank" rel="noopener">{l.name || l.url} ↗</a>{/each}</p>
	{/if}

	{#if aip.reviews.length}
		<h3>Reviews</h3>
		<ul class="reviews">
			{#each aip.reviews as r (r.review)}
				<li><b>{VERDICT[r.verdict]}</b> by {answeredBy(r)} · {when(r.at)}{r.current ? '' : ' · on an older version'}{#if r.text}<br /><span class="dim">“{r.text}”</span>{/if}</li>
			{/each}
		</ul>
	{/if}

	{#if !aip.bare && aip.stage !== 'archived'}
		<div class="actions">
			{#if aip.stage === 'proposed' && ownVault}
				<input placeholder="A note (needed for a revision)" bind:value={text} />
				<button class="go" disabled={!!session.doing} onclick={() => review('Accepting', 'accepted')}>Accept</button>
				<button disabled={!!session.doing} onclick={() => review('Declining', 'declined')}>Decline</button>
				<button disabled={!!session.doing || !text.trim()} onclick={() => review('Asking for a revision of', 'revise')}>Revise</button>
			{/if}
			{#if aip.stage === 'objective' && (mine || ownVault)}
				<button class="go" disabled={!!session.doing} onclick={() => act('Proposing', { op: 'aip_promote' })}>Propose it</button>
			{:else if aip.stage === 'idea' && (mine || ownVault)}
				<small class="dim">It is proposed once it states its objective.</small>
			{/if}
			{#if mine || ownVault}
				<button disabled={!!session.doing} onclick={() => act('Withdrawing', { op: 'aip_withdraw' })}>Withdraw</button>
			{/if}
			{#if aip.stage === 'proposed' && !ownVault}<small class="dim">Only {vaultName(aip.vault)} accepts it, acting as itself.</small>{/if}
		</div>
	{:else if aip.bare}
		<p class="dim">A proposal no AIP names yet: it becomes one when its author or the vault opens an AIP over it.</p>
	{/if}
	{#if session.doing}<p class="dim">{session.doing}…</p>{:else if syncing() && aip.stage !== 'archived'}<p class="dim">This device is still syncing ({Math.floor(share() * 100)} %). If this AIP changed on your other devices, it’s brought up to date before your answer counts.</p>{/if}
	{#if session.error}<p class="err">{session.error}</p>{/if}
</div>

<style>
	.av {
		font-size: 0.88rem;
	}
	.steps {
		display: flex;
		gap: 0.3rem;
		list-style: none;
		margin: 0.6rem 0 0.4rem;
		padding: 0;
		counter-reset: step;
	}
	.steps li {
		flex: 1;
		padding: 0.3rem 0.4rem 0.35rem;
		border-top: 3px solid #1f2a2314;
		color: var(--muted);
		font-size: 0.78rem;
		counter-increment: step;
	}
	.steps li::before {
		content: counter(step) ' ';
		font-weight: 600;
	}
	.steps li.done {
		border-color: #24452f;
		color: #24452f;
	}
	.steps li.now {
		border-color: #eda100;
		color: #1f2a23;
		font-weight: 600;
	}
	.target {
		margin: 0.4rem 0 0.8rem;
	}
	.measure {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.found {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.82rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.changes {
		margin: 0.6rem 0;
	}
	.changes > summary {
		cursor: pointer;
		font-weight: 600;
		color: #24452f;
	}
	.changes > summary small {
		margin-left: 0.3rem;
		font-weight: 400;
		color: var(--muted);
	}
	.summary {
		margin: 0.5rem 0;
		padding-left: 1.1rem;
		overflow-wrap: anywhere;
	}
	.line {
		margin: 0.6rem 0;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: #f4f1e8;
	}
	.head {
		margin: 0 0 0.3rem;
	}
	.head small {
		color: var(--muted);
	}
	.diff {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.25rem;
	}
	.diff li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: baseline;
	}
	.label {
		min-width: 9rem;
		color: #24452f;
		font-weight: 600;
	}
	.old {
		color: #8a3a2a;
		text-decoration: line-through;
		white-space: pre-wrap;
	}
	.add .new,
	.new {
		color: #136b4b;
		white-space: pre-wrap;
	}
	.text .old,
	.text .new {
		display: block;
		width: 100%;
	}
	.reviews {
		margin: 0;
		padding-left: 1.1rem;
	}
	h3 {
		margin: 1rem 0 0.3rem;
		font-size: 0.95rem;
	}
	.links {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		align-items: center;
		margin-top: 0.9rem;
	}
	.actions input {
		flex: 1;
		min-width: 12rem;
		font: inherit;
		padding: 0.35rem 0.5rem;
		border: 1px solid #1f2a2333;
		border-radius: 8px;
	}
	button {
		font: inherit;
		padding: 0.4rem 0.8rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
	}
	button.go {
		background: #24452f;
		border-color: #24452f;
		color: #f4f1e8;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.dim {
		color: var(--muted);
	}
	.err {
		color: #a03224;
	}
</style>
