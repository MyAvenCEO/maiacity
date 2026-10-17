<!--
	One MaiaCity V1 proposal in the Proposals app: its signatures, a look at any screen it brings (drawn in the one view
	host, sealed like every screen of the game) and, for a player at their seat, signing or rejecting it. It needs as
	many signatures as the game's setting says and applies at once, in the same game.
-->
<script>
	// @ts-nocheck — plain JS
	import { base } from '$app/paths';
	import { SEATS } from '../../../game/maiacity-v1/engine.js';
	import ViewHost from '$lib/sandbox/ViewHost.svelte';
	import { viewOfCard } from '$lib/sandbox/view-host.js';
	import { screenDataOf } from '$lib/maiacity-v1/screen.js';

	/** g: the live game ($lib/maiacity-v1/live.svelte.js) */
	let { m, g } = $props();

	const view = $derived(g.view);
	const seat = $derived(g.mySeat);
	let preview = $state('');
	const data = $derived(screenDataOf(view, seat, g.now));
</script>

<div class="v1">
	{#each m.views ?? [] as v (v.id)}
		<div class="buttons"><button onclick={() => (preview = preview === v.id ? '' : v.id)}>{preview === v.id ? 'Close the screen' : `Look at the screen “${v.name}”`}</button></div>
		{#if preview === v.id}{#key v}<ViewHost view={viewOfCard(v, 400)} {data} />{/key}{/if}
	{/each}
	<p class="sigs">
		{#each SEATS as s (s)}<span class:ok={m.signatures.includes(s)}>{m.signatures.includes(s) ? '✓' : '○'} {view.players[s].name}</span>{/each}
	</p>
	{#if m.status === 'open'}
		{#if seat}
			<div class="buttons">
				{#if !m.signatures.includes(seat)}<button class="primary" disabled={g.busy} onclick={() => g.move(seat, { type: 'sign', number: m.number })}>Sign as {view.players[seat].name}</button>{/if}
				<button disabled={g.busy} onclick={() => g.move(seat, { type: 'reject', number: m.number })}>{m.by === seat ? 'Withdraw' : 'Reject'}</button>
			</div>
		{:else}
			<p class="dim">Only the game's two players sign. Take a seat in <a href="{base}/app/maiacity-v1/">MaiaCity V1</a> to sign.</p>
		{/if}
	{/if}
	{#if g.error}<p class="err">{g.error}</p>{/if}
</div>

<style>
	.v1 {
		font-size: 0.85rem;
	}
	.sigs {
		display: flex;
		gap: 0.8rem;
		margin: 0.5rem 0;
	}
	.sigs .ok {
		color: #3d7a4a;
		font-weight: 600;
	}
	.buttons {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin: 0.4rem 0;
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
	.dim {
		color: var(--muted);
	}
	.err {
		color: #a03224;
	}
</style>
