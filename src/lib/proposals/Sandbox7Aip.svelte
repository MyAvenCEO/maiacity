<!--
	One Sandbox 7 proposal in the Proposals app: what it changes in full, as Sandbox 7's Proposals page showed it before
	proposals left the game (Samuel 2026-10-17). A config is everything the valley runs on, as config cards (values,
	data, QuickJS code); a MIP is a title, a description in prose and the cards as they would be. A new world is one
	too: every setting it starts with, and what differs from the world it follows. Once the admin accepts it, it lands
	in the repo (code/) within minutes, and then its cards go into the config, the world is made, or the world amended
	plays on its new rules. Proposed over the studio's MCP, never here.
-->
<script>
	import { base } from '$app/paths';
	import { decide, withdraw, linkPrs, setForget, loadMinds } from '$lib/sandbox-8/store.js';
	import { memoryOf } from '$lib/sandbox-8/mind.js';
	import ConfigCard from '$lib/sandbox-8/ConfigCard.svelte';

	/** @type {{ m: any, acct: any, configs: any[], onchanged: () => void }} */
	let { m, acct, configs, onchanged } = $props();

	let error = $state('');
	let busy = $state(false);
	let note = $state('');

	/** @param {() => Promise<any>} fn @param {string} failed */
	async function run(fn, failed) {
		busy = true;
		try {
			await fn();
			error = '';
			onchanged();
		} catch (e) {
			error = /** @type {any} */ (e)?.message || failed;
		} finally {
			busy = false;
		}
	}
	// accepting changes nothing yet: the MIP lands from the repo within minutes
	const judge = (/** @type {boolean} */ accept) => run(() => decide(m.number, accept, note), 'It could not be decided.');
	const takeBack = () => run(() => withdraw(m.number), 'It could not be withdrawn.');

	// the GitHub PRs a MIP needs (Samuel, 2026-10-10): what changed in the engine's code between worlds, beside what
	// changed in its cards; its author or the admin links them, here or over the MCP
	const REPO = 'https://github.com/MyAvenCEO/maiacity/pull/';
	let editing = $state(/** @type {string | null} */ (null));
	const canLink = $derived(acct.admin || m.author === acct.id);
	function savePrs() {
		// numbers, #numbers or whole PR links; the titles already known stay
		const nums = [...new Set([...(editing ?? '').matchAll(/\d+/g)].map((x) => Number(x[0])))];
		const prs = nums.map((number) => ({ number, title: (m.prs ?? []).find((/** @type {any} */ p) => p.number === number)?.title ?? null }));
		run(() => linkPrs(m.number, prs).then(() => (editing = null)), 'The PRs could not be linked.');
	}

	// ---- the brains a new world starts with (Samuel, 2026-10-10): each aven's copy from the world it follows, every
	// memory listed, and what the MIP has it forget (its author or an admin marks an entry while the MIP is open) ----
	let brains = $state(/** @type {any} */ (null));
	async function loadBrains() {
		if (brains) return;
		brains = 'loading';
		try {
			brains = await loadMinds(m.world.after, true);
		} catch (e) {
			brains = { error: /** @type {any} */ (e)?.message || 'could not be read' };
		}
	}
	const forgotten = (/** @type {string} */ aven, /** @type {string} */ list, /** @type {any} */ ref) =>
		(m.world?.forget?.[aven] ?? []).some((/** @type {any} */ f) => f.list === list && String(f.ref) === String(ref));
	const forgetCount = $derived(Object.values(m.world?.forget ?? {}).reduce((n, l) => n + /** @type {any[]} */ (l).length, 0));
	/** mark one memory to forget in the new world, or keep it after all */
	function toggleForget(/** @type {string} */ aven, /** @type {string} */ list, /** @type {any} */ ref) {
		const all = JSON.parse(JSON.stringify(m.world?.forget ?? {}));
		const mine = (all[aven] ??= []);
		const i = mine.findIndex((/** @type {any} */ f) => f.list === list && String(f.ref) === String(ref));
		if (i >= 0) mine.splice(i, 1);
		else mine.push({ list, ref });
		run(() => setForget(m.number, all), 'Could not change what its brains forget.');
	}

	/** a card the MIP carries as it already was: its values, data and code all the same */
	const sameCard = (/** @type {any} */ c, /** @type {any} */ b) =>
		!!b && JSON.stringify(c.values ?? {}) === JSON.stringify(b.values ?? {}) && (c.code ?? '') === (b.code ?? '') && JSON.stringify(c.data ?? null) === JSON.stringify(b.data ?? null);
	const changed = $derived(m.cards.filter((/** @type {any} */ c) => !sameCard(c, m.base?.[c.id])));
	const same = $derived(m.cards.filter((/** @type {any} */ c) => sameCard(c, m.base?.[c.id])));
	const where = $derived(m.world_id ? `In ${m.world_name ?? 'a deleted world'}` : m.action === 'world' && !m.world?.after ? 'A world from scratch' : 'From before MIPs had a world');
	const what = $derived.by(() => {
		if (m.action === 'create') return `Creates the config ${m.config} ("${m.name}") from ${m.from ?? "the catalogue's defaults"}`;
		if (m.action === 'delete') return `Deletes the config ${m.config}`;
		if (m.action === 'amend') return `Amends ${m.world?.name ?? m.world_name ?? 'its world'}'s own rules while it runs: the cards below, from when it is accepted`;
		if (m.action === 'world') return `Starts a new world${m.world?.name ? ` "${m.world.name}"` : ''} on ${configs.find((c) => c.id === m.config)?.name ?? m.config}${m.cards.length || m.remove.length ? ' with the cards below' : ''}, its avens asking ${m.world?.model === 'qwen' ? 'Qwen' : 'd1'}`;
		return `Changes the config ${m.config}${m.base_version ? ` (proposed on version ${m.base_version})` : ''}${m.name ? `, renamed "${m.name}"` : ''}`;
	});
	const result = $derived.by(() => {
		const r = m.result;
		if (!r) return '';
		if (r.landing === 'waiting') return 'It lands from the repo within minutes.';
		if (r.landing === 'failed') return `It could not land: ${r.error}`;
		if (r.version) return `${r.config} is now version ${r.version}.`;
		if (r.deleted) return `${r.config} is deleted.`;
		if (r.world) return `${r.name} is made.`;
		if (r.amended) return `${r.name}'s rules are amended.`;
		return '';
	});
</script>

<div class="s7">
	<p class="what"><b>{where}.</b> {what}.</p>
	{#if editing != null}
		<div class="prs edit">
			<span>Code:</span>
			<input placeholder="PR numbers or links, e.g. #408 #413" bind:value={editing} onkeydown={(e) => e.key === 'Enter' && savePrs()} />
			<button class="go" disabled={busy} onclick={savePrs}>Save</button>
			<button disabled={busy} onclick={() => (editing = null)}>Cancel</button>
		</div>
	{:else if m.prs?.length || canLink}
		<div class="prs">
			<span>Code:</span>
			{#each m.prs ?? [] as p (p.number)}<a class="pr" href={REPO + p.number} target="_blank" rel="noopener" title="Open PR #{p.number} on GitHub"><b>#{p.number}</b>{p.title ? ` ${p.title}` : ''} ↗</a>{:else}<small>no engine changes linked</small>{/each}
			{#if canLink}<button class="link" onclick={() => (editing = (m.prs ?? []).map((/** @type {any} */ p) => `#${p.number}`).join(' '))}>{m.prs?.length ? 'Edit' : 'Link a PR'}</button>{/if}
		</div>
	{/if}
	{#if m.world}
		<div class="world-diff">
			{#if Object.keys(m.world.values ?? {}).length}<p><b>Values on top:</b> {Object.entries(m.world.values).map(([k, v]) => `${k} ${v}`).join(', ')}</p>{/if}
			{#if m.world.after_name || m.world.amends}
				<p class="against"><b>What changes against {m.world.after_name ?? m.world.name}</b>{m.world.diff?.length ? '' : ': nothing, the same settings.'}</p>
				{#if m.world.diff?.length}<div class="chips">{#each m.world.diff as d (d)}<span class="chip">{d}</span>{/each}</div>{/if}
			{:else}<p>The first world: nothing to compare it with.</p>{/if}
		</div>
		{#if m.action === 'world' && m.world.after}
			{@const edits = m.status === 'open' && canLink}
			<details class="brains" ontoggle={(e) => /** @type {HTMLDetailsElement} */ (e.currentTarget).open && loadBrains()}>
				<summary>Brains: each aven starts with its brain from {m.world.after_name ?? 'the world it follows'}{forgetCount ? `, forgetting ${forgetCount} ${forgetCount === 1 ? 'memory' : 'memories'}` : ', every memory kept'}</summary>
				{#if brains === 'loading'}<p class="sub">Loading…</p>
				{:else if brains?.error}<p class="sub">The brains could not be read ({brains.error}).</p>
				{:else if brains}
					{#each Object.entries(brains).sort(([a], [b]) => a.localeCompare(b)) as [aven, brain] (aven)}
						<div class="brain">
							<b>{aven}</b>
							{#each memoryOf(brain) as list (list.key)}
								<p class="list">{list.label}</p>
								<ul>
									{#each list.entries as e, i (i)}
										{@const gone = forgotten(aven, list.key, e.ref)}
										<li class:gone>{e.text}{#if e.world} <small>{e.world}</small>{/if}{#if edits}<button class="drop" disabled={busy} onclick={() => toggleForget(aven, list.key, e.ref)}>{gone ? 'keep' : 'forget'}</button>{:else if gone} <small>forgotten</small>{/if}</li>
									{/each}
								</ul>
							{:else}<p class="sub">Nothing remembered yet.</p>{/each}
						</div>
					{:else}<p class="sub">No brains kept there: the avens start fresh.</p>{/each}
				{/if}
			</details>
		{/if}
	{/if}
	{#each changed as card (card.id)}<ConfigCard {card} base={m.base?.[card.id] ?? null} />{/each}
	{#each m.remove as id (id)}{#if m.base?.[id]}<ConfigCard card={m.base[id]} removed />{/if}{/each}
	{#if same.length}
		<details class="same-cards">
			<summary>{same.length} card{same.length === 1 ? '' : 's'} the same: {same.map((/** @type {any} */ c) => c.name || c.id).join(', ')}</summary>
			{#each same as card (card.id)}<ConfigCard {card} base={m.base?.[card.id] ?? null} />{/each}
		</details>
	{/if}
	{#if m.status === 'open'}
		<div class="decide">
			{#if acct.admin}
				<input placeholder="A note (optional)" bind:value={note} />
				<button class="go" disabled={busy} onclick={() => judge(true)}>Accept</button>
				<button disabled={busy} onclick={() => judge(false)}>Reject</button>
			{/if}
			{#if m.author === acct.id}<button disabled={busy} onclick={takeBack}>Withdraw</button>{/if}
			{#if !acct.admin}<small>Only the admin accepts Sandbox 7 proposals for now.</small>{/if}
		</div>
	{:else if result || m.note || m.result?.world}
		<p class="decided">{result}{m.note ? ` "${m.note}"` : ''}{#if m.result?.world} <a href="{base}/app/games/sandbox-8/?world={m.result.world}">Open the world</a>{/if}</p>
	{/if}
	{#if error}<p class="err">{error}</p>{/if}
</div>

<style>
	.s7 {
		font-size: 0.85rem;
	}
	.what {
		margin: 0.3rem 0;
		color: #24452f;
	}
	.sub {
		margin: 0 0 0.5rem;
		color: #52514e;
	}
	.err {
		color: #a03224;
		margin: 0.4rem 0;
	}
	.brains {
		margin: 0.5rem 0;
		font-size: 0.82rem;
	}
	.brains summary {
		cursor: pointer;
		font-weight: 600;
	}
	.brains .brain {
		margin: 0.5rem 0 0.7rem;
	}
	.brains .list {
		margin: 0.3rem 0 0.1rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.6;
	}
	.brains ul {
		margin: 0;
		padding-left: 1.1rem;
	}
	.brains li.gone {
		text-decoration: line-through;
		opacity: 0.5;
	}
	.brains .drop {
		margin-left: 0.4rem;
		background: none;
		border: 0;
		padding: 0;
		color: #b3261e;
		cursor: pointer;
		font: inherit;
		font-size: 0.72rem;
	}
	.world-diff {
		background: #f4f1e8;
		border-radius: 8px;
		padding: 0.4rem 0.7rem;
		margin: 0.4rem 0;
	}
	.world-diff p {
		margin: 0.2rem 0;
	}
	.world-diff .against {
		font-size: 0.85rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.3rem 0 0.15rem;
	}
	.chip {
		font-size: 0.75rem;
		background: #eda10024;
		color: #6b4600;
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
	}
	.same-cards {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: #6b6a66;
	}
	.same-cards summary {
		cursor: pointer;
		padding: 0.35rem 0.1rem;
	}
	input {
		font: inherit;
		color: #1f2a23;
		border: 1px solid #1f2a2333;
		border-radius: 6px;
		padding: 0.3rem 0.4rem;
		background: #fff;
	}
	button {
		font: inherit;
		border: 1px solid #1f2a2333;
		background: #fff;
		border-radius: 8px;
		padding: 0.3rem 0.6rem;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	button.go {
		background: #24452f;
		color: #f4f1e8;
		border-color: #24452f;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
	.prs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
		font-size: 0.75rem;
		color: #6b6a66;
		margin-top: 0.3rem;
	}
	.pr {
		border: 1px solid #1f2a2322;
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		color: #24452f;
		background: #f6f8fa;
		text-decoration: none;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pr:hover {
		border-color: #24452f;
	}
	.prs.edit input {
		flex: 1;
		min-width: 10rem;
	}
	.decide {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.6rem;
	}
	.decide input {
		flex: 1;
		min-width: 10rem;
	}
	.decide small {
		color: #6b6a66;
	}
	.decided {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: #52514e;
	}
</style>
