<!--
	The studio's history: every signed edit this browser holds, the database's history, as a database studio lists its
	logs, in the layout every avenDB view has (./Frame.svelte). On the left a search of the edits, those that concern
	the vault or all of them, and their kinds (writes and marks, keys, shares, vaults and devices), each with its count;
	in the middle the edits found, newest first, each with its place in the order the browser took them, what it does
	in words, who signed it and how (an SLH-DSA signature, post-quantum, on every edit, and a passkey's WebAuthn
	assertion beside its own), its causal depth and its size; on the right the edit picked, every field and signature,
	who stands behind it and the edits it builds on, each to pick in turn. What an edit seals, a write's body, a cap's
	slice or a key's boxes, shows by its size alone, as avenDB's server sees it; a cap's slice shows in words where this
	browser reads it. A write the ops of the caps it relies on don't allow, or that builds on one, says so: no reader of
	its entry counts it.
-->
<script>
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { describe, GROUPS, KIND_NAMES } from './db.js';
	import { chainSteps, count, list, short, size } from './vaults.js';

	/**
	 * @type {{ s: import('./db.js').Studio, log: { edits: import('./db.js').SignedEdit[] } | null, failed: string,
	 *   vault: string }}
	 */
	let { s, log, failed, vault } = $props();

	let scope = $state(/** @type {'vault' | 'all'} */ ('vault'));
	let group = $state('all');
	let query = $state('');
	let shown = $state(200);
	/** the edit picked, shown on the right */
	let open = $state('');
	/** which side slides in, where the screen is narrow */
	let side = $state(/** @type {'' | 'nav' | 'aside'} */ (''));

	/** @typedef {import('svelte').ComponentProps<typeof Icon>['name']} IconName */
	/** each kind's icon on the left, by its group's id @type {Record<string, IconName>} */
	const KIND_ICONS = { all: 'board', writes: 'note', keys: 'key', shares: 'share', vaults: 'users' };

	const edits = $derived(log?.edits ?? []);
	const byId = $derived(new Map(edits.map((e) => [e.id, e])));
	/** the edits that concern the vault */
	const ours = $derived(edits.filter((e) => e.vaults.includes(vault)));
	const scoped = $derived(scope === 'all' ? edits : ours);
	const said = $derived(new Map(scoped.map((e) => [e.id, describe(e, s, (id) => byId.get(id))])));
	/** @param {string} id */
	const kindsOf = (id) => /** @type {readonly string[]} */ (GROUPS.find(([g]) => g === id)?.[2] ?? []);
	const counts = $derived(
		new Map(
			GROUPS.map(([id]) => {
				const kinds = kindsOf(id);
				return [id, kinds.length ? scoped.filter((e) => kinds.includes(e.kind)).length : scoped.length];
			})
		)
	);
	const found = $derived.by(() => {
		const kinds = kindsOf(group);
		const q = query.trim().toLowerCase();
		const hit = (/** @type {import('./db.js').SignedEdit} */ e) =>
			!q || `${said.get(e.id)} ${e.kind} ${KIND_NAMES[e.kind]} ${e.id} ${s.signer(e.author)}`.toLowerCase().includes(q);
		return scoped.filter((e) => (!kinds.length || kinds.includes(e.kind)) && hit(e)).reverse();
	});
	const page = $derived(found.slice(0, shown));
	const picked = $derived(open ? byId.get(open) : undefined);

	/** Show edit `id` on the right, sliding it in where the screen is narrow. @param {string} id */
	const show = (id) => ([open, side] = [id, 'aside']);

	/** A passkey's WebAuthn assertion beside its signature, as its chip names it. @param {import('./db.js').SigView} sig */
	const webauthn = (sig) =>
		sig.webauthn === 'batch' ? `WebAuthn, one for ${sig.batch}` : sig.webauthn === 'pass' ? 'WebAuthn pass' : 'WebAuthn';
	/** what a passkey's assertion shows */
	const PRESENCE = 'Its passkey’s WebAuthn assertion: a person was there. Only the SLH-DSA signature counts';
	/** why the device doesn't count a write */
	const CUT = 'Its signer was removed before it: the removal cuts what it wrote after';

	/** Who signed edit `e`: its author, then its cosigners. @param {import('./db.js').SignedEdit} e */
	const signers = (e) => list([e.author, ...e.cosigners].map(s.signer));

	/** why a write's entry's readers don't count it, where the ops of its caps don't allow it */
	const NOT_ALLOWED =
		'the ops of the shares it relies on don’t allow what it changes, or what it builds on: no reader counts it';
	/** why they don't, where what it makes of the entry's record breaks the schemas the entry was written under */
	const UNFIT = 'what it makes of its entry’s record breaks the entry’s schema: no reader counts it';
	/** why they don't, where it merges into main through a share and the vault hasn't accepted what it brings in */
	const NOT_ACCEPTED =
		'it merges into main through a share, and the vault hasn’t accepted what it brings in: no reader counts it';
	/** what an edit its readers don't count shows, and why @param {import('./db.js').SignedEdit} e */
	const uncounted = (e) =>
		e.why === 'unfit'
			? { chip: 'breaks its schema', why: UNFIT }
			: e.why === 'policy'
				? { chip: 'not accepted', why: NOT_ACCEPTED }
				: { chip: 'not allowed', why: NOT_ALLOWED };
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = '')} />

<!-- the left: a search, which edits, and their kinds, each with its count -->
{#snippet filters()}
	<input class="nav-search" type="search" placeholder="Search edits" bind:value={query} aria-label="Search edits" />
	<h3 class="nav-group">Which edits</h3>
	<button class="nav-item" class:on={scope === 'vault'} aria-pressed={scope === 'vault'} data-pick onclick={() => ([scope, shown] = ['vault', 200])}
		><Icon name="history" size={16} /><span>{s.vaultName(vault)}’s</span><small>{ours.length}</small></button
	>
	<button class="nav-item" class:on={scope === 'all'} aria-pressed={scope === 'all'} data-pick onclick={() => ([scope, shown] = ['all', 200])}
		><Icon name="sync" size={16} /><span>All this browser holds</span><small>{edits.length}</small></button
	>
	<h3 class="nav-group">Kinds</h3>
	{#each GROUPS as [id, label] (id)}
		<button class="nav-item" class:on={group === id} aria-pressed={group === id} data-pick onclick={() => ([group, shown] = [id, 200])}
			><Icon name={KIND_ICONS[id] ?? 'history'} size={16} /><span>{label}</span><small>{counts.get(id)}</small></button
		>
	{/each}
{/snippet}

<!-- the right: the edit picked, every field and signature, and the edits behind it, each to pick in turn -->
{#snippet edit()}
	{#if picked}
		<header class="about-head">
			<small>Edit #{picked.n}</small>
			<h3>{KIND_NAMES[picked.kind] ?? picked.kind}</h3>
		</header>
		<p class="said">{said.get(picked.id) ?? describe(picked, s, (id) => byId.get(id))}</p>
		<dl>
			<dt>Edit</dt>
			<dd class="mono">{picked.id}</dd>
			<dt>Signed by</dt>
			<dd>{signers(picked)}</dd>
			<dt>Depth</dt>
			<dd>{picked.depth}, after {count(picked.parents.length, 'edit')} of its log</dd>
			<dt>Size</dt>
			<dd>{size(picked.bytes)} on the wire</dd>
			<dt>Concerns</dt>
			<dd>{list(picked.vaults.map(s.vaultName)) || 'no vault this browser knows'}</dd>
			{#if picked.counted !== null}
				<dt>Counted</dt>
				<dd>{picked.counted ? 'Yes: no removal cuts it' : `No: ${CUT.toLowerCase()}`}</dd>
			{/if}
			{#if picked.allowed !== null}
				<dt>Allowed</dt>
				{#if picked.allowed}
					<dd>Yes: it fits its schema, and the ops of its shares allow it</dd>
				{:else}
					<dd>No: {uncounted(picked).why}</dd>
				{/if}
			{/if}
		</dl>
		{#if picked.chain}
			<h4 class="side-head">Who stands behind it</h4>
			<ol class="chain">
				{#each chainSteps(s.world, picked.chain) as step, i (i)}
					{@const made = step.edit ? byId.get(step.edit) : undefined}
					<li>
						{step.says}
						{#if step.edit}
							<button class="btn quiet" disabled={!made} onclick={() => (open = step.edit ?? '')}>
								<span class="mono">{short(step.edit)}</span>{made ? ` · ${KIND_NAMES[made.kind] ?? made.kind} #${made.n}` : ''}
							</button>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
		<h4 class="side-head">Signatures</h4>
		<ul class="sig-list">
			{#each picked.sigs as sig, i (i)}
				<li>
					<b>{s.signer(sig.signer)}</b>, its {sig.by}:
					<span class="chip ok">SLH-DSA, {size(sig.pq)}</span>
					{#if sig.webauthn}<span class="chip" title={PRESENCE}>{webauthn(sig)}</span>{/if}
				</li>
			{/each}
		</ul>
		{#if picked.parents.length}
			<h4 class="side-head">Builds on</h4>
			<div class="parents">
				{#each picked.parents as p (p)}
					{@const parent = byId.get(p)}
					<button class="btn quiet" disabled={!parent} onclick={() => (open = p)}>
						<span class="mono">{short(p)}</span>{parent ? ` · ${KIND_NAMES[parent.kind] ?? parent.kind} #${parent.n}` : ''}
					</button>
				{/each}
			</div>
		{/if}
		<details open>
			<summary>Its fields</summary>
			<pre class="json">{JSON.stringify(picked.fields, null, 2)}</pre>
		</details>
	{/if}
{/snippet}

<Frame
	nav={log && !failed ? filters : undefined}
	aside={picked ? edit : undefined}
	bind:open={side}
	navLabel="Which edits"
	asideLabel="The edit picked"
	navIcon="search"
	asideIcon="info"
>
	{#if failed}
		<p class="error">Reading the history failed: {failed}</p>
	{:else if !log}
		<p class="soft">Reading the history…</p>
	{:else}
		<div class="grid" role="region" aria-label="Edits" tabindex="-1">
			<table>
				<thead>
					<tr>
						<th class="num">#</th>
						<th>Edit</th>
						<th>Kind</th>
						<th>What it does</th>
						<th>Signed by</th>
						<th>Signatures</th>
						<th class="num">Depth</th>
						<th class="num">Size</th>
					</tr>
				</thead>
				<tbody>
					{#each page as e (e.id)}
						<!-- the row opens on a click anywhere; its id's button takes the keyboard's -->
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
						<tr class="rec {e.kind}" class:on={open === e.id} onclick={() => show(e.id)}>
							<td class="num soft">{e.n}</td>
							<td><button class="open mono" title={e.id}>{short(e.id)}</button></td>
							<td><span class="chip k">{KIND_NAMES[e.kind] ?? e.kind}</span></td>
							<td class="what">
								{said.get(e.id)}
								{#if e.counted === false}<span class="chip warn" title={CUT}>cut by a removal</span>{/if}
								{#if e.allowed === false}
									<span class="chip warn" title={uncounted(e).why}>{uncounted(e).chip}</span>
								{/if}
							</td>
							<td>{signers(e)}</td>
							<td><span class="sigs">
								{#each e.sigs as sig, i (i)}
									<span class="chip ok" title="SLH-DSA: post-quantum">SLH-DSA {size(sig.pq)}</span>
									{#if sig.webauthn}<span class="chip" title={PRESENCE}>{webauthn(sig)}</span>{/if}
								{/each}
							</span></td>
							<td class="num">{e.depth}</td>
							<td class="num">{size(e.bytes)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if !page.length}<p class="nothing">No edit {query ? 'matches' : 'here'}.</p>{/if}
		</div>
		<footer class="foot">
			<span>{page.length < found.length ? `${page.length} of ${count(found.length, 'edit')}` : count(found.length, 'edit')}, newest first</span>
			{#if page.length < found.length}<button class="btn" onclick={() => (shown += 200)}>Show 200 more</button>{/if}
			<span class="soft">{count(edits.length, 'signed edit')} held in all; what each seals shows by its size alone.</span>
		</footer>
	{/if}
</Frame>

<style>
	.grid {
		max-height: max(16rem, calc(100dvh - 22rem));
		overflow: auto;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
	}

	table {
		min-width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid #ecebe6;
		text-align: left;
		white-space: nowrap;
	}

	th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: #f6f5f1;
		color: var(--soft);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.num {
		text-align: right;
	}

	.what {
		min-width: 16rem;
		white-space: normal;
	}

	.rec {
		cursor: pointer;
	}

	.rec:hover td,
	.rec.on td {
		background: #f4f8f6;
	}

	.open {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font-size: 0.76rem;
		cursor: pointer;
	}

	.k {
		background: #eceae4;
	}

	.write .k,
	.mark .k {
		background: #d6e8e4;
		color: #1f4f47;
	}

	.keys .k {
		background: #efe3c8;
		color: #6a4b12;
	}

	.share .k {
		background: #dcebd9;
		color: #2b5a37;
	}

	.revoke .k {
		background: #f3d6cc;
		color: #7a2f1c;
	}

	.sigs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.nothing {
		margin: 0;
		padding: 1.4rem;
		color: var(--soft);
		text-align: center;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1rem;
		margin-top: 0.5rem;
		font-size: 0.78rem;
	}

	/* the right side: the edit picked */
	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head h3 {
		margin: 0.15rem 0 0;
		font-size: 1.15rem;
		overflow-wrap: anywhere;
	}

	.said {
		margin: 0.6rem 0 1rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.3rem 0.8rem;
		margin: 0 0 1rem;
		font-size: 0.82rem;
	}

	dt {
		color: var(--soft);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.side-head {
		margin: 1.3rem 0 0.5rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.sig-list {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.84rem;
		line-height: 1.9;
	}

	/* who stands behind it, one link a line, each with the edit that made it so */
	.chain {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.84rem;
		line-height: 1.5;
	}

	.chain .btn {
		margin-left: 0.2rem;
		padding: 0.05rem 0.4rem;
		font-size: 0.74rem;
	}

	.parents {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	summary {
		margin-top: 1rem;
		color: var(--accent);
		font-size: 0.82rem;
		cursor: pointer;
	}

	.json {
		max-height: 22rem;
		overflow: auto;
		margin: 0.4rem 0 0;
		padding: 0.6rem 0.7rem;
		border-radius: 8px;
		background: #23302a;
		color: #e8efe6;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		line-height: 1.5;
	}
</style>
