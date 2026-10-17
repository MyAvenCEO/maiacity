<!--
	A new MaiaCity V1 proposal, in the Proposals app (it was the game's own Proposals panel until 2026-10-17): any
	setting, a COOP's name and the assets it owns, payouts from a COOP treasury to any wallet. The player who proposes
	signs it at once; it applies when it has the signatures the game's setting asks for.
-->
<script>
	// @ts-nocheck — plain JS
	import { MINDS, PAYEES, PAYERS, SETTING_LIMITS, SETTING_NAMES, TOKEN_LABEL, nameOf } from '../../../game/maiacity-v1/engine.js';

	/** g: the live game; payout: one to start with (a COOP's "Propose a payout"); ondone: after it is proposed or cancelled */
	let { g, payout = null, ondone } = $props();

	const view = $derived(g.view);
	const seat = $derived(g.mySeat);
	// svelte-ignore state_referenced_locally
	let draft = $state({ title: payout ? `Payout from the ${nameOf(g.view, payout.from)}` : '', description: '', settings: { ...g.view.settings }, coops: Object.fromEntries(Object.values(g.view.coops).map((c) => [c.id, { name: c.name, assets: c.assets.map((x) => `${x.name} | ${x.kind}`).join('\n') }])), payouts: payout ? [payout] : [] });

	async function propose() {
		const settings = Object.fromEntries(Object.entries(draft.settings).filter(([k, v]) => Number(v) !== view.settings[k]));
		const payouts = draft.payouts.filter((x) => Number(x.amount) > 0).map((x) => ({ ...x, amount: Number(x.amount) }));
		// a COOP's assets are written one a line, "name | kind"; only what differs goes into the proposal
		const coops = {};
		for (const [id, c] of Object.entries(draft.coops)) {
			const now = view.coops[id];
			const assets = c.assets.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
				const [name, ...kind] = l.split('|');
				const known = now.assets.find((x) => x.name === name.trim());
				return { id: known?.id ?? '', name: name.trim(), kind: kind.join('|').trim() };
			});
			const change = {};
			if (c.name.trim() !== now.name) change.name = c.name.trim();
			if (JSON.stringify(assets.map((x) => [x.name, x.kind])) !== JSON.stringify(now.assets.map((x) => [x.name, x.kind]))) change.assets = assets;
			if (Object.keys(change).length) coops[id] = change;
		}
		if (await g.move(seat, { type: 'propose', mip: { title: draft.title, description: draft.description, settings, coops, payouts } })) ondone(true);
	}
</script>

<div class="draft">
	<input class="full" placeholder="Title" bind:value={draft.title} />
	<textarea class="full" rows="4" placeholder="Why, in prose: what changes and what we expect to see" bind:value={draft.description}></textarea>
	<p class="eyebrow">Settings</p>
	<dl class="settings">
		{#each Object.keys(SETTING_LIMITS) as k (k)}
			<dt class:changed={Number(draft.settings[k]) !== view.settings[k]}>{SETTING_NAMES[k]}</dt>
			<dd><input type="number" step="any" min={SETTING_LIMITS[k][0]} max={SETTING_LIMITS[k][1]} bind:value={draft.settings[k]} /></dd>
		{/each}
	</dl>
	<p class="eyebrow">COOPs and what they own</p>
	{#each Object.values(view.coops) as c (c.id)}
		<div class="coopdraft">
			<input class="full" class:changed={draft.coops[c.id].name.trim() !== c.name} bind:value={draft.coops[c.id].name} />
			<textarea class="full" rows={Math.max(2, c.assets.length + 1)} placeholder="One asset a line: name | kind" bind:value={draft.coops[c.id].assets}></textarea>
		</div>
	{/each}
	<p class="small">One asset a line, its name and kind split by “|”.</p>
	<p class="eyebrow">Payouts</p>
	{#each draft.payouts as x, i (i)}
		<div class="payout">
			<select bind:value={x.from}>{#each PAYERS as id (id)}<option value={id}>{nameOf(view, id)}</option>{/each}</select>
			<span>→</span>
			<select bind:value={x.to}>{#each PAYEES as id (id)}<option value={id}>{nameOf(view, id)}</option>{/each}</select>
			<input type="number" min="0" step="0.1" bind:value={x.amount} />
			<select bind:value={x.token}>{#each MINDS as t (t)}<option value={t}>{TOKEN_LABEL[t]}</option>{/each}</select>
			<button class="link" onclick={() => draft.payouts.splice(i, 1)}>Remove</button>
		</div>
	{/each}
	<button class="link" onclick={() => draft.payouts.push({ from: 'coop:maia', to: `player:${seat}`, token: 'MAIA', amount: 1 })}>+ Add a payout</button>
	<div class="buttons">
		<button class="primary" disabled={g.busy || !draft.title.trim()} onclick={propose}>Propose and sign as {view.players[seat].name}</button>
		<button onclick={() => ondone(false)}>Cancel</button>
	</div>
	{#if g.error}<p class="err">{g.error}</p>{/if}
</div>

<style>
	.draft {
		margin: 0.4rem 0 0.6rem;
		padding: 0.8rem;
		border-radius: 12px;
		background: rgb(31 42 35 / 0.05);
		font-size: 0.85rem;
	}
	.eyebrow {
		margin: 0.8rem 0 0.3rem;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.full {
		width: 100%;
		box-sizing: border-box;
		margin-bottom: 0.35rem;
	}
	input,
	textarea,
	select {
		font: inherit;
		border: 1px solid #1f2a2333;
		border-radius: 6px;
		padding: 0.3rem 0.4rem;
		background: #fff;
	}
	.settings {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.2rem 0.8rem;
		margin: 0;
	}
	dt.changed {
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	.settings dd input {
		width: 5.5rem;
		text-align: right;
	}
	.coopdraft {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}
	.coopdraft input.changed {
		outline: 2px solid #d7a53a;
	}
	.payout {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 0.3rem;
		align-items: center;
		margin-bottom: 0.4rem;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid rgb(31 42 35 / 0.08);
	}
	.payout input,
	.payout select {
		min-width: 0;
	}
	.small {
		font-size: 0.78rem;
		color: var(--muted);
	}
	.buttons {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.8rem;
	}
	button {
		font: inherit;
		padding: 0.45rem 0.8rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
	}
	button.primary {
		background: #24452f;
		border-color: #24452f;
		color: #f4f1e8;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		text-decoration: underline;
	}
	.err {
		color: #a03224;
	}
</style>
