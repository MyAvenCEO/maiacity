<!--
	The Proposals view: MIPs, MaiaCity improvement proposals. A config is everything the valley runs on, as config cards
	(values, data, QuickJS code); a MIP is a title, a description in prose and the cards as they would be. Once the admin
	accepts it, its cards go into the config as they are and the config gets a new version. A new world is a MIP too:
	every setting it starts with, and what differs from the world it follows; accepting it makes the world.
	MIPs are one global list, and each belongs to a world: the one it was proposed in (Samuel, 2026-10-09). Nobody
	proposes from this page: agents and people propose over the studio's MCP; here the admin reads, accepts and rejects.
-->
<script>
	import { onMount } from 'svelte';
	import { loadMips, decide, withdraw } from './store.js';
	import ConfigCard from './ConfigCard.svelte';
	import { HOOKS } from '../../../game/economy/params.js';

	/** @type {{ acct: any, configs: any[], worlds: any[], here: string | null, playing: { id: string | null, name: string, version: number } | null, onworld: (made: any) => void, onamend?: (done: any) => void, onreload: () => void }} */
	let { acct, configs, worlds, here, playing, onworld, onamend = () => {}, onreload } = $props();

	let mips = $state(/** @type {any[]} */ ([]));
	let error = $state('');
	let busy = $state(false);
	let notes = $state(/** @type {Record<number, string>} */ ({}));
	// every world's MIPs, always (Samuel, 2026-10-10: no filter), each saying which world it belongs to
	// svelte-ignore state_referenced_locally
	const only = false;

	const mine = (/** @type {any} */ m) => !only || !here || m.world_id === here || m.result?.world === here;
	// what waits for the admin first, then every decided MIP, the latest decision first, folded to one line
	const open = $derived(mips.filter((m) => m.status === 'open' && mine(m)));
	const decided = $derived(mips.filter((m) => m.status !== 'open' && mine(m)).sort((a, b) => String(b.decided ?? '').localeCompare(String(a.decided ?? ''))));
	let unfolded = $state(/** @type {Record<number, boolean>} */ ({}));
	// the world MIP that made this world: its own cards sit on top of the config it runs on
	const madeBy = $derived(here ? mips.find((m) => m.action === 'world' && m.status === 'accepted' && m.result?.world === here) : null);
	const hereName = $derived(worlds.find((w) => w.id === here)?.name ?? 'this world');

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

	/** @param {any} m @param {boolean} accept */
	async function judge(m, accept) {
		busy = true;
		try {
			const r = await decide(m.number, accept, notes[m.number] ?? '');
			await refresh();
			if (accept && r?.world) onworld(r);
			if (accept && r?.amended) onamend(r);
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
	/** the world a MIP belongs to, in words */
	const worldOf = (/** @type {any} */ m) =>
		m.world_id ? `in ${m.world_name ?? 'a deleted world'}` : m.action === 'world' && !m.world?.after ? 'a world from scratch' : 'from before MIPs had a world';
	/** a card the MIP carries as it already was: its values, data and code all the same */
	const sameCard = (/** @type {any} */ c, /** @type {any} */ b) =>
		!!b && JSON.stringify(c.values ?? {}) === JSON.stringify(b.values ?? {}) && (c.code ?? '') === (b.code ?? '') && JSON.stringify(c.data ?? null) === JSON.stringify(b.data ?? null);
	/** @param {any} m */
	function what(m) {
		if (m.action === 'create') return `Creates the config ${m.config} ("${m.name}") from ${m.from ?? "the catalogue's defaults"}`;
		if (m.action === 'delete') return `Deletes the config ${m.config}`;
		if (m.action === 'amend') return `Amends ${m.world?.name ?? m.world_name ?? 'its world'}'s own rules while it runs: the cards below, from when it is accepted`;
		if (m.action === 'world') return `Starts a new world${m.world?.name ? ` "${m.world.name}"` : ''} on ${configs.find((c) => c.id === m.config)?.name ?? m.config}${m.cards.length || m.remove.length ? ' with the cards below' : ''}, its avens asking ${m.world?.model === 'qwen' ? 'Qwen' : 'd1'}`;
		return `Changes the config ${m.config}${m.base_version ? ` (proposed on version ${m.base_version})` : ''}${m.name ? `, renamed "${m.name}"` : ''}`;
	}
</script>

<div class="mips">
	<header class="top">
		<div>
			<h2>Proposals</h2>
			<p>MIPs, MaiaCity improvement proposals: one list, numbered in order, each belonging to the world it was proposed in. A config is everything the valley runs on, as config cards: values, data and the QuickJS code that goes with them. A MIP is a title, a description and the cards as they would be; a new world is a MIP too, with every setting it starts with, and so is a change to a running world's own rules (amend). MIPs are proposed over the studio's MCP. Once the admin accepts one here, its cards go into the config as a new version, the new world appears under Worlds, or the world amended plays on its new rules.</p>
		</div>
	</header>

	{#if !acct?.play}
		<section><p class="note">{acct?.note || 'Connecting…'}</p></section>
	{:else}
		{#if error}<p class="err">{error}</p>{/if}

		<section>
			<h3>Open</h3>
			{#each open as m (m.number)}{@render mip(m)}{:else}<p class="sub">No MIP waits for a decision{only && here ? ` in ${hereName}` : ''}.</p>{/each}
		</section>
		<section>
			<h3>History</h3>
			{#each decided as m (m.number)}{@render mip(m)}{:else}<p class="sub">No MIP decided yet{only && here ? ` in ${hereName}` : ''}.</p>{/each}
		</section>

		<section>
			<h3>Configs</h3>
			<p class="sub">{#if playing}This world runs on <b>{playing.name}</b> (version {playing.version}){#if madeBy && (madeBy.cards.length || madeBy.remove.length)}, with its own cards (MIP-{madeBy.number} changed: {[...madeBy.cards.map((/** @type {any} */ c) => c.name || c.id), ...madeBy.remove.map((/** @type {string} */ id) => `${id} taken out`)].join(', ')}){/if}.{' '}{/if}A world keeps the cards it started with. A new world starts from the world it follows: every card and value it played with, and its avens' brains; its MIP changes only the cards it carries.</p>
			<table>
				<tbody>
					{#each configs as c (c.id)}
						<tr class:on={c.id === playing?.id}>
							<td><b>{c.name}</b> <code>{c.id}</code><br /><small>{c.description}</small></td>
							<td class="num">v{c.version}</td>
							<td class="num">{c.cards.length} cards</td>
							<td class="num">{#if c.id === playing?.id}<span class="chip">this world</span>{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<details class="hooks">
				<summary>What a MIP's card code can change</summary>
				<p>Every rule of the valley is a hook in a card's code, and each card's code runs in its own QuickJS sandbox: no page, no network, no keys, 8 MB and 25 ms a call. The card that owns a rule runs first (its own code, else the default, shown under Policies and World); any other card exporting the same hook is given what it made of it as <code>value</code>. A hook returns plain JSON, which the valley checks and keeps within bounds. A hook that throws, runs too long or answers nothing stops for the world, and the valley uses its own copy of the default rule.</p>
				<table><tbody>{#each HOOKS as h (h.name)}<tr><td><code>{h.name}</code></td><td>{h.when}; given <code>{h.given}</code></td><td>returns {h.returns}</td></tr>{/each}</tbody></table>
				<p><code>aven</code>: id, name, alive, hearts, health, grows, produce, harvest, stock, body {'{'} water, food {'}'}, memo (what its body rule kept from last night), need, keep, reserveDays, ask, bid, flex, yesterday, minted, decayed. <code>valley</code>: day, values (every value by key, e.g. <code>valley.values.mint</code>), avens, alive, hearts, prices, weather.</p>
			</details>
		</section>
	{/if}
</div>

{#snippet mip(/** @type {any} */ m)}
	<article class="mip {m.status}">
		<div class="mip-head">
			<b>MIP-{m.number} · {m.title}</b>
			<span class="status">{m.status}</span>
		</div>
		<div class="by">{worldOf(m)} · by {m.author_name ?? m.author ?? 'someone'}{m.via === 'mcp' ? ', through the MCP' : ''} · {when(m.created)}</div>
		<div class="what">{what(m)}</div>
		{#if m.status === 'open' || unfolded[m.number]}
			{#if m.description}<p class="prose">{m.description}</p>{/if}
			{#if m.world}
				<div class="world-diff">
					{#if Object.keys(m.world.values ?? {}).length}<p><b>Values on top:</b> {Object.entries(m.world.values).map(([k, v]) => `${k} ${v}`).join(', ')}</p>{/if}
					{#if m.world.after_name || m.world.amends}
						<p class="against"><b>What changes against {m.world.after_name ?? m.world.name}</b>{m.world.diff?.length ? '' : ': nothing, the same settings.'}</p>
						{#if m.world.diff?.length}<div class="chips">{#each m.world.diff as d (d)}<span class="chip">{d}</span>{/each}</div>{/if}
					{:else}<p>The first world: nothing to compare it with.</p>{/if}
				</div>
			{/if}
			{@const changed = m.cards.filter((/** @type {any} */ c) => !sameCard(c, m.base?.[c.id]))}
			{@const same = m.cards.filter((/** @type {any} */ c) => sameCard(c, m.base?.[c.id]))}
			{#each changed as card (card.id)}<ConfigCard {card} base={m.base?.[card.id] ?? null} />{/each}
			{#each m.remove as id (id)}{#if m.base?.[id]}<ConfigCard card={m.base[id]} removed />{/if}{/each}
			{#if same.length}
				<details class="same-cards">
					<summary>{same.length} card{same.length === 1 ? '' : 's'} the same: {same.map((/** @type {any} */ c) => c.name || c.id).join(', ')}</summary>
					{#each same as card (card.id)}<ConfigCard {card} base={m.base?.[card.id] ?? null} />{/each}
				</details>
			{/if}
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
			<div class="decided">{m.status === 'withdrawn' ? 'Withdrawn' : m.status === 'accepted' ? 'Accepted' : 'Rejected'} {when(m.decided)}{m.result?.version ? `: ${m.result.config} is now version ${m.result.version}` : m.result?.deleted ? `: ${m.result.config} is deleted` : m.result?.world ? `: ${m.result.name} is made` : m.result?.amended ? `: ${m.result.name}'s rules are amended` : ''}{m.note ? ` · "${m.note}"` : ''} <button class="link" onclick={() => (unfolded[m.number] = !unfolded[m.number])}>{unfolded[m.number] ? 'Fold' : 'What it changed'}</button>{#if m.result?.world && m.result.world !== here} · <button class="link" onclick={() => onworld(m.result)}>Open it</button>{/if}</div>
		{/if}
	</article>
{/snippet}

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
	input {
		font: inherit;
		color: #1f2a23;
		border: 1px solid #1f2a2333;
		border-radius: 6px;
		padding: 0.3rem 0.4rem;
		background: #fff;
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
