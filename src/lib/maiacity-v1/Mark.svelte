<!--
	A wallet's mark in MaiaCity V1, as avenDB marks a vault: initials on a colour, a circle for a player, a rounded square
	for a COOP, a hexagon for the pool; the mint, the melt and the MIPs get their own sign. The wallet bar of the Ledger
	app and every transaction's counterparty show it.
-->
<script>
	// @ts-nocheck — plain JS
	import { TOKEN_COLOUR } from '../../../game/maiacity-v1/engine.js';

	let { view, id, size = 44 } = $props();

	const m = $derived.by(() => {
		const [kind, k] = String(id ?? '').split(':');
		if (kind === 'player' && view.players[k]) return { shape: 'human', text: (view.players[k].name || k).slice(0, 2), bg: `hsl(${k === 'A' ? 28 : 205} 38% 42%)` };
		if (kind === 'coop' && view.coops[k]) return { shape: 'coop', text: view.coops[k].name.replace(/ COOP$/, '').slice(0, 2), bg: TOKEN_COLOUR[view.coops[k].mind] };
		if (kind === 'pool') return { shape: 'aven', text: 'AMM', bg: '#8a7a55' };
		if (kind === 'mint') return { shape: 'human', text: '❤︎', bg: '#d9a441' };
		if (kind === 'melt') return { shape: 'human', text: '≈', bg: '#9a9488' };
		return { shape: 'coop', text: 'MIP', bg: '#3b4a40' };
	});
</script>

<span class="mark {m.shape}" style="--size:{size}px; background:{m.bg}" aria-hidden="true">{m.text}</span>

<style>
	.mark {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		color: #fff;
		font-size: calc(var(--size) * 0.32);
		font-weight: 600;
		line-height: 1;
		user-select: none;
		transition: transform 0.15s ease;
	}
	.mark.coop {
		border-radius: 28%;
	}
	.mark.aven {
		border-radius: 0;
		font-size: calc(var(--size) * 0.24);
		clip-path: polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%);
	}
</style>
