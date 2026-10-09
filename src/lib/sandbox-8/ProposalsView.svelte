<!--
	The Proposals view: MIPs, MaiaCity improvement proposals. A config is everything the valley runs on, as config cards
	(values, data, QuickJS code); a MIP is a title, a description in prose and the cards as they would be. Once the admin
	accepts it, its cards go into the config as they are and the config gets a new version. MIPs come from this page
	(your local changes, as cards) or from an agent over the studio's MCP. Also here: the configs, to play another.
-->
<script>
	import { onMount } from 'svelte';
	import { CONFIG, changedCards } from './rules.js';
	import { loadMips, propose, decide, withdraw } from './store.js';
	import ConfigCard from './ConfigCard.svelte';

	/** @type {{ acct: any, configs: any[], playing: { id: string | null, name: string, version: number, local: number }, draft?: boolean, onplay: (cfg: any) => void, onreload: () => void }} */
	let { acct, configs, playing, draft = false, onplay, onreload } = $props();

	let mips = $state(/** @type {any[]} */ ([]));
	let show = $state('open');
	let error = $state('');
	let busy = $state(false);
	let notes = $state(/** @type {Record<number, string>} */ ({}));

	// the new MIP: starts from your local changes, as whole cards, each with its code for the QuickJS sandbox
	// svelte-ignore state_referenced_locally
	let open = $state(draft); // only how it opens
	let title = $state('');
	let description = $state('');
	let action = $state('edit');
	let newId = $state('');
	let newName = $state('');
	let from = $state(CONFIG.id ?? '');
	let cards = $state(changedCards());
	let asJson = $state(false);
	let jsonText = $state('');
	let jsonError = $state('');
	let removeText = $state('');
	let formError = $state('');

	const target = $derived(action === 'create' ? newId.trim() : CONFIG.id);
	const baseCards = $derived(action === 'create' ? configs.find((c) => c.id === from)?.cards ?? null : CONFIG.cards);

	function editJson() {
		jsonText = JSON.stringify(cards, null, 2);
		jsonError = '';
		asJson = !asJson;
	}
	/** @param {string} v */
	function fromJson(v) {
		jsonText = v;
		try {
			const x = JSON.parse(v || '[]');
			if (!Array.isArray(x)) throw new Error('they are a list: [ { "id": …, "kind": …, "values": { … }, "code": "…" } ]');
			cards = x;
			jsonError = '';
		} catch (e) {
			jsonError = `The cards aren't JSON yet: ${/** @type {any} */ (e).message}`;
		}
	}
	function startOver() {
		cards = changedCards();
		jsonText = JSON.stringify(cards, null, 2);
		open = true;
	}
	const removing = $derived(removeText.split(/[\s,]+/).filter(Boolean));
	const shown = $derived(show === 'open' ? mips.filter((m) => m.status === 'open') : mips);

	async function refresh() {
		if (!acct?.play) return;
		try {
			mips = (await loadMips()).mips;
			error = '';
		} catch (e) {
			error = /** @type {any} */ (e)?.message || 'The MIPs could not be loaded.';
		}
	}
	onMount(refresh);

	async function submit() {
		formError = '';
		if (!title.trim()) return (formError = 'Give it a title.');
		if (action !== 'delete' && asJson && jsonError) return (formError = jsonError);
		busy = true;
		try {
			await propose({
				title,
				description,
				config: target,
				action,
				...(action === 'create' ? { name: newName || newId, from: from || null } : {}),
				cards: action === 'delete' ? [] : $state.snapshot(cards),
				remove: action === 'delete' ? [] : removing
			});
			title = description = removeText = '';
			cards = [];
			asJson = false;
			open = false;
			show = 'open';
			await refresh();
		} catch (e) {
			formError = /** @type {any} */ (e)?.message || 'It could not be proposed.';
		} finally {
			busy = false;
		}
	}

	/** @param {any} m @param {boolean} accept */
	async function judge(m, accept) {
		busy = true;
		try {
			await decide(m.number, accept, notes[m.number] ?? '');
			await refresh();
			if (accept) onreload();
		} catch (e) {
			error = /** @type {any} */ (e)?.message || 'It could not be decided.';
		} finally {
			busy = false;
		}
	}
	/** @param {any} m */
	async function takeBack(m) {
		busy = true;
		try {
			await withdraw(m.number);
			await refresh();
		} catch (e) {
			error = /** @type {any} */ (e)?.message || 'It could not be withdrawn.';
		} finally {
			busy = false;
		}
	}

	const when = (/** @type {string} */ t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
	/** @param {any} m */
	function what(m) {
		if (m.action === 'create') return `Creates the config ${m.config} ("${m.name}") from ${m.from ?? "the catalogue's defaults"}`;
		if (m.action === 'delete') return `Deletes the config ${m.config}`;
		return `Changes the config ${m.config}${m.base_version ? ` (proposed on version ${m.base_version})` : ''}${m.name ? `, renamed "${m.name}"` : ''}`;
	}
</script>

<div class="mips">
	<header class="top">
		<div>
			<h2>Proposals</h2>
			<p>MIPs, MaiaCity improvement proposals. A config is everything the valley runs on, as config cards: values, data and the QuickJS code that goes with them. A MIP is a title, a description and the cards as they would be. Once the admin accepts it, its cards go into the config as they are, as a new version. Agents propose too, over the studio's MCP.</p>
		</div>
		{#if acct?.play}<div class="actions">{#if open}<button onclick={() => (open = false)}>Close</button>{:else}<button class="go" onclick={startOver}>New MIP</button>{/if}</div>{/if}
	</header>

	{#if !acct?.play}
		<section><p class="note">{acct?.note || 'Connecting…'}</p></section>
	{:else}
		{#if error}<p class="err">{error}</p>{/if}

		<section>
			<h3>Configs</h3>
			<p class="sub">The valley runs on <b>{playing.name}</b> (version {playing.version}){playing.local ? `, with ${playing.local} change${playing.local === 1 ? '' : 's'} of your own on top` : ''}. Pick another to play it; the valley starts again.</p>
			<table>
				<tbody>
					{#each configs as c (c.id)}
						<tr class:on={c.id === playing.id}>
							<td><b>{c.name}</b> <code>{c.id}</code><br /><small>{c.description}</small></td>
							<td class="num">v{c.version}</td>
							<td class="num">{c.cards.length} cards</td>
							<td class="num">{#if c.id === playing.id}<span class="chip">playing</span>{:else}<button onclick={() => onplay(c)}>Play this</button>{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		{#if open}
			<section class="form">
				<h3>New MIP</h3>
				<label>Title <input bind:value={title} maxlength="160" placeholder="e.g. Mint more, melt faster" /></label>
				<label>Description <textarea bind:value={description} rows="4" placeholder="What it changes and why, in plain words."></textarea></label>
				<div class="row">
					<label>It <select bind:value={action}>
						<option value="edit">changes {CONFIG.name}</option>
						<option value="create">creates a new config</option>
						<option value="delete">deletes {CONFIG.name}</option>
					</select></label>
					{#if action === 'create'}
						<label>id <input bind:value={newId} placeholder="dry-valley" /></label>
						<label>Name <input bind:value={newName} placeholder="Dry valley" /></label>
						<label>from <select bind:value={from}>
							{#each configs as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
							<option value="">the catalogue's defaults</option>
						</select></label>
					{/if}
				</div>
				{#if action !== 'delete'}
					<div class="cards-head">
						<span>Config cards: each one whole, as it goes in once accepted{cards.length ? ', filled in from your changes' : ''}</span>
						<button onclick={editJson}>{asJson ? 'Back to the cards' : 'Edit as JSON'}</button>
					</div>
					{#if asJson}
						<textarea class="code" value={jsonText} oninput={(e) => fromJson(e.currentTarget.value)} rows="16" spellcheck="false"></textarea>
						{#if jsonError}<p class="err">{jsonError}</p>{/if}
					{:else}
						{#each cards as card, i (i)}
							<ConfigCard editing card={$state.snapshot(card)} base={baseCards ? baseCards.find((/** @type {any} */ c) => c.id === card?.id) ?? null : undefined} />
							<label class="codebox">Code for the QuickJS sandbox ({card.id}), optional
								<textarea class="code" bind:value={card.code} rows="4" spellcheck="false" placeholder="export function mint(aven, valley) {'{'} return valley.values.mint; {'}'}"></textarea>
							</label>
						{:else}
							<p class="sub">No cards yet: change values under Policies or World and come back, or add cards with Edit as JSON (values, data, code).</p>
						{/each}
					{/if}
					<label>Cards to take out <input bind:value={removeText} placeholder="card ids, e.g. harvests" /></label>
					{#each removing as id (id)}{@const c = baseCards?.find((/** @type {any} */ x) => x.id === id)}{#if c}<ConfigCard card={c} removed />{/if}{/each}
				{/if}
				{#if formError}<p class="err">{formError}</p>{/if}
				<div class="actions"><button class="go" disabled={busy} onclick={submit}>Propose</button></div>
			</section>
		{/if}

		<section>
			<h3>
				MIPs
				<span class="filter">
					<button class:on={show === 'open'} onclick={() => (show = 'open')}>Open</button>
					<button class:on={show === 'all'} onclick={() => (show = 'all')}>All</button>
				</span>
			</h3>
			{#each shown as m (m.number)}
				<article class="mip {m.status}">
					<div class="mip-head">
						<b>MIP-{m.number} · {m.title}</b>
						<span class="status">{m.status}</span>
					</div>
					<div class="by">by {m.author_name ?? m.author ?? 'someone'}{m.via === 'mcp' ? ', through the MCP' : ''} · {when(m.created)}</div>
					<div class="what">{what(m)}</div>
					{#if m.description}<p class="prose">{m.description}</p>{/if}
					{#each m.cards as card (card.id)}<ConfigCard {card} base={m.base?.[card.id] ?? null} />{/each}
					{#each m.remove as id (id)}{#if m.base?.[id]}<ConfigCard card={m.base[id]} removed />{/if}{/each}
					{#if m.status === 'open'}
						<div class="decide">
							{#if acct.admin}
								<input placeholder="A note (optional)" bind:value={notes[m.number]} />
								<button class="go" disabled={busy} onclick={() => judge(m, true)}>Accept</button>
								<button disabled={busy} onclick={() => judge(m, false)}>Reject</button>
							{/if}
							{#if m.author === acct.id}<button disabled={busy} onclick={() => takeBack(m)}>Withdraw</button>{/if}
							{#if !acct.admin}<small>Only the admin accepts MIPs for now.</small>{/if}
						</div>
					{:else}
						<div class="decided">{m.status === 'withdrawn' ? 'Withdrawn' : m.status === 'accepted' ? 'Accepted' : 'Rejected'} {when(m.decided)}{m.result?.version ? `: ${m.result.config} is now version ${m.result.version}` : m.result?.deleted ? `: ${m.result.config} is deleted` : ''}{m.note ? ` · "${m.note}"` : ''}</div>
					{/if}
				</article>
			{:else}
				<p class="sub">{show === 'open' ? 'No open MIPs.' : 'No MIPs yet.'}</p>
			{/each}
		</section>
	{/if}
</div>

<style>
	.mips {
		height: 100%;
		overflow-y: auto;
		background: #f4f1e8;
		color: #1f2a23;
		padding: 0.8rem 1rem var(--nav-room, 6rem);
		box-sizing: border-box;
		font-size: 0.85rem;
	}
	.top {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	h2,
	h3 {
		font-family: inherit;
		letter-spacing: normal;
	}
	h2 {
		margin: 0 0 0.2rem;
		font-size: 1.15rem;
	}
	.top p {
		margin: 0;
		max-width: 60rem;
		color: #52514e;
	}
	h3 {
		margin: 0.1rem 0 0.4rem;
		font-size: 0.95rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	section {
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		padding: 0.6rem 0.9rem;
		margin-top: 0.8rem;
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
	.actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}
	.sub,
	.note {
		margin: 0 0 0.5rem;
		color: #52514e;
	}
	.err {
		color: #a03224;
		margin: 0.4rem 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}
	td {
		padding: 0.35rem 0.4rem;
		border-top: 1px solid #1f2a2312;
		vertical-align: top;
	}
	td.num {
		text-align: right;
		white-space: nowrap;
	}
	td small {
		color: #6b6a66;
	}
	td code {
		font-size: 0.7rem;
		color: #6b6a66;
	}
	tr.on td {
		background: #24452f0d;
	}
	.chip {
		font-size: 0.7rem;
		background: #24452f;
		color: #f4f1e8;
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
	}
	.form label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-top: 0.5rem;
		color: #52514e;
		font-size: 0.78rem;
	}
	.form .row {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	input,
	textarea,
	select {
		font: inherit;
		color: #1f2a23;
		border: 1px solid #1f2a2333;
		border-radius: 6px;
		padding: 0.3rem 0.4rem;
		background: #fff;
	}
	textarea.code {
		font-family: ui-monospace, Menlo, monospace;
		font-size: 0.72rem;
		width: 100%;
		box-sizing: border-box;
	}
	.cards-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.7rem;
		color: #52514e;
		font-size: 0.78rem;
	}
	.cards-head button {
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
	}
	.form label.codebox {
		margin: 0.2rem 0 0.4rem 0.8rem;
	}
	.filter {
		display: flex;
		gap: 0.2rem;
		margin-left: auto;
	}
	.filter button {
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
	}
	.filter button.on {
		background: #24452f;
		color: #f4f1e8;
	}
	.mip {
		border-top: 1px solid #1f2a231f;
		padding: 0.7rem 0;
	}
	.mip:first-of-type {
		border-top: 0;
	}
	.mip-head {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
	}
	.status {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		background: #eda10022;
		color: #8a5a00;
	}
	.accepted .status {
		background: #1baf7a22;
		color: #136b4b;
	}
	.rejected .status,
	.withdrawn .status {
		background: #1f2a2314;
		color: #6b6a66;
	}
	.by,
	.what {
		font-size: 0.75rem;
		color: #6b6a66;
		margin-top: 0.15rem;
	}
	.what {
		color: #24452f;
	}
	.prose {
		white-space: pre-wrap;
		margin: 0.4rem 0 0;
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
		font-size: 0.75rem;
		color: #52514e;
	}
	@media (max-width: 760px) {
		.mips {
			padding: 0.6rem 0.6rem var(--nav-room, 6rem);
		}
	}
</style>
