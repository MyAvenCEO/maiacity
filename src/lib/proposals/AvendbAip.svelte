<!--
	One avenDB AIP in the Proposals app: every line it bundles (a note, an asset, a view, a game config, any type of
	entry), each with what it changes field by field as its schema reads it (the `aip` read's diff, derived, never
	typed), the reviews so far, and what the person may do with it, acting as the vault the device says: promote an idea
	and withdraw it (its author or its vault), and accept, decline or ask for a revision of a proposed one (its vault
	alone, and only that review counts). Accepting merges every line at once; a new entry's line (a draft) lands in main
	only then, every field of it shown as added.
-->
<script>
	// @ts-nocheck — plain JS
	import { session } from '$lib/avendb/session.svelte.js';
	import { acting, authorsLine, nameOf } from '$lib/avendb/vaults.js';
	import { when } from './aips.js';

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

	// the lines with their diffs: the `aip` read, once per AIP shown (a bare proposal has no entry of its own to read)
	let lines = $state(null);
	let read = 0;
	$effect(() => {
		const n = ++read;
		lines = null;
		if (!aip.entry) return;
		session.ask({ op: 'aip', entry: aip.entry }).then((got) => n === read && (lines = got?.ok?.lines ?? []));
	});
	const shown = $derived(lines ?? aip.lines);

	let text = $state('');
	async function act(what, op) {
		const done = await session.run(what, { ...op, entry: aip.entry, as });
		if (done) (text = ''), onchanged();
	}
	// a review names every line's heads as the page shows them, so a line written after it was drawn is never accepted unseen
	const review = (what, verdict) => act(what, { op: 'aip_review', verdict, text, heads: shown.flatMap((l) => l.heads ?? []) });
	const show = (v) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
	const VERDICT = { accepted: 'Accepted', declined: 'Declined', revise: 'Asked for a revision' };
</script>

<div class="av">
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

	{#if aip.links?.length}
		<p class="links">{#each aip.links as l (l.id)}<a href={l.url} target="_blank" rel="noopener">{l.name || l.url} ↗</a>{/each}</p>
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
				<button class="go" disabled={!!session.doing} onclick={() => review('Accepting the AIP', 'accepted')}>Accept</button>
				<button disabled={!!session.doing} onclick={() => review('Declining the AIP', 'declined')}>Decline</button>
				<button disabled={!!session.doing || !text.trim()} onclick={() => review('Asking for a revision', 'revise')}>Revise</button>
			{/if}
			{#if aip.stage === 'idea' && (mine || ownVault)}
				<button class="go" disabled={!!session.doing} onclick={() => act('Promoting the AIP', { op: 'aip_promote' })}>Propose it</button>
			{/if}
			{#if mine || ownVault}
				<button disabled={!!session.doing} onclick={() => act('Withdrawing the AIP', { op: 'aip_withdraw' })}>Withdraw</button>
			{/if}
			{#if aip.stage === 'proposed' && !ownVault}<small class="dim">Only {vaultName(aip.vault)} accepts it, acting as itself.</small>{/if}
		</div>
	{:else if aip.bare}
		<p class="dim">A proposal no AIP names yet: it becomes one when its author or the vault opens an AIP over it.</p>
	{/if}
	{#if session.doing}<p class="dim">{session.doing}…</p>{/if}
	{#if session.error}<p class="err">{session.error}</p>{/if}
</div>

<style>
	.av {
		font-size: 0.88rem;
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
