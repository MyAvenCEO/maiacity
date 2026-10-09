<!--
	The Proposals view: MIPs, MaiaCity improvement proposals. A config is everything the valley runs on, as config cards
	(values, data, QuickJS code); a MIP is a title, a description in prose and the cards as they would be. Once the admin
	accepts it, its cards go into the config as they are and the config gets a new version. A new world is a MIP too
	(Samuel, 2026-10-09): every setting it starts with, and what differs from the world it follows; accepting it makes the
	world. MIPs come from this page (your local changes) or from an agent over the studio's MCP.
-->
<script>
	import { onMount } from 'svelte';
	import { CONFIG, changedCards, changedRules } from './rules.js';
	import { loadMips, propose, decide, withdraw } from './store.js';
	import ConfigCard from './ConfigCard.svelte';
	import { testCard } from './sandbox.js';
	import { HOOKS, fullCards } from '../../../game/economy/params.js';

	/** @type {{ acct: any, configs: any[], playing: { id: string | null, name: string, version: number, local: number }, draft?: boolean | string, draftConfig?: string, here: { id: string | null, name: string, model: string }, sample: () => any, onworld: (made: any) => void, onreload: () => void }} */
	let { acct, configs, playing, draft = false, draftConfig = '', here, sample, onworld, onreload } = $props();

	let mips = $state(/** @type {any[]} */ ([]));
	let show = $state('open');
	let error = $state('');
	let busy = $state(false);
	let notes = $state(/** @type {Record<number, string>} */ ({}));

	// the new MIP: starts from your local changes, as whole cards, each with its code for the QuickJS sandbox
	// svelte-ignore state_referenced_locally
	let open = $state(!!draft); // only how it opens
	// svelte-ignore state_referenced_locally
	let title = $state(draft === 'world' ? 'A new world' : '');
	let description = $state('');
	// svelte-ignore state_referenced_locally
	let action = $state(draft === 'world' ? 'world' : 'edit');
	// a new world: its name, the config it starts on, the model, a seed, and the values tried on top (yours, to start)
	let worldName = $state('');
	// svelte-ignore state_referenced_locally
	let worldCfg = $state(draftConfig || CONFIG.id || 'valley');
	// svelte-ignore state_referenced_locally
	let worldModel = $state(here?.model === 'qwen' ? 'qwen' : 'd1');
	let worldSeed = $state('');
	let valuesText = $state(JSON.stringify(changedRules(), null, 1));
	let newId = $state('');
	let newName = $state('');
	let from = $state(CONFIG.id ?? '');
	// svelte-ignore state_referenced_locally
	let cards = $state(draft === 'world' ? [] : changedCards());
	let asJson = $state(false);
	let jsonText = $state('');
	let jsonError = $state('');
	let removeText = $state('');
	let formError = $state('');

	const target = $derived(action === 'create' ? newId.trim() : action === 'world' ? worldCfg : CONFIG.id);
	const baseCards = $derived(action === 'create' ? configs.find((c) => c.id === from)?.cards ?? null : action === 'world' ? configs.find((c) => c.id === worldCfg)?.cards ?? null : CONFIG.cards);
	/** a world on a config: a fresh draft of it, with your changed values on top */
	function newWorld(/** @type {string} */ cfg) {
		action = 'world';
		worldCfg = cfg;
		title = title || 'A new world';
		cards = [];
		valuesText = JSON.stringify(changedRules(), null, 1);
		open = true;
	}

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
	/** a card to change, whole, with the code it runs now (its own, or its rules' default) to edit */
	function pick(/** @type {string} */ id) {
		const c = baseCards && fullCards(baseCards).find((/** @type {any} */ x) => x.id === id);
		if (c) cards = [...cards, JSON.parse(JSON.stringify(c))];
	}
	function startOver() {
		cards = changedCards();
		jsonText = JSON.stringify(cards, null, 2);
		open = true;
	}
	// "Test the code": the card's hooks, each called once in the sandbox with where the valley stands now
	let tests = $state(/** @type {Record<number, any>} */ ({}));
	/** @param {number} i */
	async function test(i) {
		const { valley, sample: s } = sample();
		tests[i] = { busy: true };
		tests[i] = await testCard($state.snapshot(cards[i]), valley, s).catch((e) => ({ hooks: [], error: e?.message || String(e) }));
	}
	/** a long answer (a brain's whole state) cut to a glance */
	const clip = (/** @type {string} */ s) => (s?.length > 140 ? `${s.slice(0, 140)}… (${s.length} characters)` : s);
	const removing = $derived(removeText.split(/[\s,]+/).filter(Boolean));
	// Open: what waits for the admin. History (Samuel): every decided MIP, the latest decision first, folded to one line
	const shown = $derived(show === 'open' ? mips.filter((m) => m.status === 'open') : mips.filter((m) => m.status !== 'open').sort((a, b) => String(b.decided ?? '').localeCompare(String(a.decided ?? ''))));
	let unfolded = $state(/** @type {Record<number, boolean>} */ ({}));

	async function refresh() {
		if (!acct?.play) return;
		try {
			mips = (await loadMips()).mips;
			error = '';
		} catch (e) {
			error = /** @type {any} */ (e)?.message || 'The MIPs could not be loaded.';
		}
	}
	// a MIP an agent proposes over the MCP shows up while the page is open: the list reloads every 15 s, and when the
	// window comes back
	onMount(() => {
		refresh();
		const every = setInterval(refresh, 15000);
		window.addEventListener('focus', refresh);
		return () => (clearInterval(every), window.removeEventListener('focus', refresh));
	});

	async function submit() {
		formError = '';
		if (!title.trim()) return (formError = 'Give it a title.');
		if (action !== 'delete' && asJson && jsonError) return (formError = jsonError);
		/** @type {any} */
		let values = {};
		if (action === 'world')
			try {
				values = JSON.parse(valuesText.trim() || '{}');
			} catch (e) {
				return (formError = `The values aren't JSON yet: ${/** @type {any} */ (e).message}`);
			}
		busy = true;
		try {
			await propose({
				title,
				description,
				config: target,
				action,
				...(action === 'create' ? { name: newName || newId, from: from || null } : {}),
				...(action === 'world' ? { world: { name: worldName, values, model: worldModel, seed: worldSeed === '' ? null : Number(worldSeed), after: here?.id ?? null } } : {}),
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
			const r = await decide(m.number, accept, notes[m.number] ?? '');
			await refresh();
			if (accept && r?.world) onworld(r);
			else if (accept) onreload();
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
		if (m.action === 'world') return `Starts a new world${m.world?.name ? ` "${m.world.name}"` : ''} on ${configs.find((c) => c.id === m.config)?.name ?? m.config}${m.cards.length || m.remove.length ? ' with the cards below' : ''}, its avens asking ${m.world?.model === 'qwen' ? 'Qwen' : 'd1'}`;
		return `Changes the config ${m.config}${m.base_version ? ` (proposed on version ${m.base_version})` : ''}${m.name ? `, renamed "${m.name}"` : ''}`;
	}
</script>

<div class="mips">
	<header class="top">
		<div>
			<h2>Proposals</h2>
			<p>MIPs, MaiaCity improvement proposals. A config is everything the valley runs on, as config cards: values, data and the QuickJS code that goes with them. A MIP is a title, a description and the cards as they would be. Once the admin accepts it, its cards go into the config as they are, as a new version. Agents propose too, over the studio's MCP.</p>
		</div>
		{#if acct?.play}<div class="actions">{#if open}<button onclick={() => (open = false)}>Close</button>{:else}<button onclick={() => newWorld(CONFIG.id ?? 'valley')}>New world</button><button class="go" onclick={startOver}>New MIP</button>{/if}</div>{/if}
	</header>

	{#if !acct?.play}
		<section><p class="note">{acct?.note || 'Connecting…'}</p></section>
	{:else}
		{#if error}<p class="err">{error}</p>{/if}

		<section>
			<h3>Configs</h3>
			<p class="sub">The valley runs on <b>{playing.name}</b> (version {playing.version}){playing.local ? `, with ${playing.local} change${playing.local === 1 ? '' : 's'} of your own on top` : ''}. A new world, on any of them, is a MIP: it carries every setting the world starts with.</p>
			<table>
				<tbody>
					{#each configs as c (c.id)}
						<tr class:on={c.id === playing.id}>
							<td><b>{c.name}</b> <code>{c.id}</code><br /><small>{c.description}</small></td>
							<td class="num">v{c.version}</td>
							<td class="num">{c.cards.length} cards</td>
							<td class="num">{#if c.id === playing.id}<span class="chip">playing</span>{:else}<button onclick={() => newWorld(c.id)}>Start a world on this</button>{/if}</td>
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
						<option value="world">starts a new world</option>
					</select></label>
					{#if action === 'world'}
						<label>Name <input bind:value={worldName} maxlength="80" placeholder="World N" /></label>
						<label>on <select bind:value={worldCfg}>{#each configs as c (c.id)}<option value={c.id}>{c.name} (v{c.version})</option>{/each}</select></label>
						<label>Model <select bind:value={worldModel}><option value="d1">d1</option><option value="qwen">Qwen</option></select></label>
						<label>Seed <input bind:value={worldSeed} inputmode="numeric" placeholder="any" /></label>
					{/if}
					{#if action === 'create'}
						<label>id <input bind:value={newId} placeholder="dry-valley" /></label>
						<label>Name <input bind:value={newName} placeholder="Dry valley" /></label>
						<label>from <select bind:value={from}>
							{#each configs as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
							<option value="">the catalogue's defaults</option>
						</select></label>
					{/if}
				</div>
				{#if action === 'world'}
					<label>Values on top of the config, by key (yours to start: what you changed under Policies and World)
						<textarea class="code" bind:value={valuesText} rows="5" spellcheck="false" placeholder={'{ "mint": 30, "waterDays": 4 }'}></textarea>
					</label>
					<p class="sub">It follows {here?.name || 'the world kept last'}: proposed, it lists every setting that differs from there. Its avens start with copies of their latest brains, told what changed.</p>
				{/if}
				{#if action !== 'delete'}
					<div class="cards-head">
						<span>Config cards: each one whole, as it goes in once accepted{cards.length ? ', filled in from your changes' : ''}</span>
						<span>
							{#if !asJson && baseCards}
								<select aria-label="Change a card" value="" onchange={(e) => { pick(e.currentTarget.value); e.currentTarget.value = ''; }}>
									<option value="">Change a card…</option>
									{#each fullCards(baseCards).filter((/** @type {any} */ c) => !cards.some((x) => x.id === c.id)) as c (c.id)}<option value={c.id}>{c.name || c.id}</option>{/each}
								</select>
							{/if}
							<button onclick={editJson}>{asJson ? 'Back to the cards' : 'Edit as JSON'}</button>
						</span>
					</div>
					{#if asJson}
						<textarea class="code" value={jsonText} oninput={(e) => fromJson(e.currentTarget.value)} rows="16" spellcheck="false"></textarea>
						{#if jsonError}<p class="err">{jsonError}</p>{/if}
					{:else}
						{#each cards as card, i (i)}
							<ConfigCard editing card={$state.snapshot(card)} base={baseCards ? baseCards.find((/** @type {any} */ c) => c.id === card?.id) ?? null : undefined} />
							<label class="codebox">Code for the QuickJS sandbox ({card.id}), optional
								<textarea class="code" bind:value={card.code} oninput={() => delete tests[i]} rows="4" spellcheck="false" placeholder={'export function mint({ aven, valley, value }) {\n  return aven.hearts < 200 ? value * 1.5 : value;\n}'}></textarea>
							</label>
							{#if card.code?.trim()}
								<div class="test">
									<button disabled={tests[i]?.busy} onclick={() => test(i)}>Test the code</button>
									{#if tests[i]?.error}<span class="bad">{tests[i].error}</span>
									{:else if tests[i]?.hooks}{#each tests[i].hooks as h (h.name)}<span class:bad={h.error}>{h.name}{h.good ? ` (${h.good})` : ''}: {h.error ?? `${clip(h.value)} → ${h.answer === h.value ? 'the same' : clip(h.answer)}`}</span>{/each}{/if}
								</div>
							{/if}
						{:else}
							<p class="sub">No cards yet: change values under Policies or World and come back, or add cards with Edit as JSON (values, data, code).</p>
						{/each}
					{/if}
					<details class="hooks">
						<summary>What card code can change</summary>
						<p>Every rule of the valley is a hook in a card's code, and each card's code runs in its own QuickJS sandbox: no page, no network, no keys, 8 MB and 25 ms a call. The card that owns a rule runs first (its own code, else the default, shown under Policies and World); any other card exporting the same hook is given what it made of it as <code>value</code>. A hook returns plain JSON, which the valley checks and keeps within bounds. A hook that throws, runs too long or answers nothing stops for the world, and the valley uses its own copy of the default rule.</p>
						<table><tbody>{#each HOOKS as h (h.name)}<tr><td><code>{h.name}</code></td><td>{h.when}; given <code>{h.given}</code></td><td>returns {h.returns}</td></tr>{/each}</tbody></table>
						<p><code>aven</code>: id, name, alive, hearts, health, grows, produce, harvest, stock, body {'{'} water, food {'}'}, need, keep, reserveDays, ask, bid, flex, yesterday, minted, decayed. <code>valley</code>: day, values (every value by key, e.g. <code>valley.values.mint</code>), avens, alive, hearts, prices, weather.</p>
					</details>
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
					<button class:on={show === 'history'} onclick={() => (show = 'history')}>History</button>
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
					{#if m.status === 'open' || unfolded[m.number]}
						{#if m.description}<p class="prose">{m.description}</p>{/if}
						{#if m.world}
							<div class="world-diff">
								{#if Object.keys(m.world.values ?? {}).length}<p><b>Values on top:</b> {Object.entries(m.world.values).map(([k, v]) => `${k} ${v}`).join(', ')}</p>{/if}
								{#if m.world.after_name}
									<p><b>Against {m.world.after_name}:</b> {m.world.diff?.length ? '' : 'the same settings.'}</p>
									{#if m.world.diff?.length}<ul>{#each m.world.diff as d (d)}<li>{d}</li>{/each}</ul>{/if}
								{:else}<p>The first world: nothing to compare it with.</p>{/if}
							</div>
						{/if}
						{#each m.cards as card (card.id)}<ConfigCard {card} base={m.base?.[card.id] ?? null} />{/each}
						{#each m.remove as id (id)}{#if m.base?.[id]}<ConfigCard card={m.base[id]} removed />{/if}{/each}
					{/if}
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
						<div class="decided">{m.status === 'withdrawn' ? 'Withdrawn' : m.status === 'accepted' ? 'Accepted' : 'Rejected'} {when(m.decided)}{m.result?.version ? `: ${m.result.config} is now version ${m.result.version}` : m.result?.deleted ? `: ${m.result.config} is deleted` : m.result?.world ? `: ${m.result.name} is made` : ''}{m.note ? ` · "${m.note}"` : ''} <button class="link" onclick={() => (unfolded[m.number] = !unfolded[m.number])}>{unfolded[m.number] ? 'Fold' : 'What it changed'}</button>{#if m.result?.world}<button class="link" onclick={() => onworld(m.result)}>Open it</button>{/if}</div>
					{/if}
				</article>
			{:else}
				<p class="sub">{show === 'open' ? 'No open MIPs.' : 'No MIP decided yet.'}</p>
			{/each}
		</section>
	{/if}
</div>

<style>
	.world-diff {
		background: #f4f1e8;
		border-radius: 8px;
		padding: 0.4rem 0.7rem;
		margin: 0.4rem 0;
	}
	.world-diff p {
		margin: 0.2rem 0;
	}
	.world-diff ul {
		margin: 0.2rem 0 0.2rem 1.1rem;
		padding: 0;
	}
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
	.test {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.7rem;
		align-items: center;
		margin: 0.3rem 0 0.2rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.test span {
		background: #1baf7a14;
		color: #136b4b;
		border-radius: 6px;
		padding: 0.1rem 0.4rem;
	}
	.test span.bad {
		background: #c0392b14;
		color: #a03224;
	}
	details.hooks {
		margin: 0.6rem 0 0.2rem;
		font-size: 0.78rem;
		color: #52514e;
	}
	details.hooks summary {
		cursor: pointer;
		color: #1f2a23;
	}
	details.hooks table {
		width: 100%;
		border-collapse: collapse;
	}
	details.hooks td {
		padding: 0.2rem 0.3rem;
		border-top: 1px solid #1f2a2312;
		vertical-align: top;
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
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
</style>
