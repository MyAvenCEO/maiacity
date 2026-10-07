<!--
	Sandbox 6 · the building tree: every chain of the valley on one screen, a row each (./tree.js, read from the rules):
	the land a building works, every stage it grows through with what it makes and uses a year and what growing to it
	costs, the ware it makes and what that is for; then energy, the village center's geothermal stages and every dome's
	solar cells; then the homes, one dome through its eight sizes. A stage you have is marked; click a first stage to
	build it (later stages grow on the building's card).
-->
<script>
	import { ENERGY, WARES } from './rules.js';
	import { GRID_EUR_KWH, GLASS_EUR_T } from './market.js';
	import { CHAINS, GEOTHERMAL, HOMES } from './tree.js';

	/** @type {{ stock: Record<string, number>, owned: Record<string, number>, onBuild: (type: string) => void, onClose: () => void }} */
	let { stock, owned, onBuild, onClose } = $props();

	const label = (/** @type {string} */ w) => WARES[w]?.label ?? w;
	const num = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US');
	/** energy: kWh, MWh or GWh */
	const kwh = (/** @type {number} */ n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} GWh` : n >= 1e4 ? `${num(n / 1000)} MWh` : `${num(n)} kWh`);
	/** a cost in loads, short */
	const costOf = (/** @type {Record<string, number>} */ c) =>
		Object.entries(c)
			.map(([w, n]) => `${n} ${label(w).toLowerCase()}`)
			.join(', ') || 'nothing';
</script>

<section class="tree" aria-label="Building tree">
	<button class="close" onclick={onClose} aria-label="Close">×</button>
	<p class="eyebrow">How the valley works</p>
	<h2>Building tree</h2>
	<p class="about">Each row runs from the land to what it is for, through every stage its building grows: what a stage makes and uses a year, and what growing to it costs (in loads of 5 t). A green stage is one you have. Click a first stage to build it; the next ones grow on its card.</p>

	<div class="scroll">
		<div class="grid">
			<p class="head">Land</p>
			<p class="head stages">Stages, each an upgrade of the one before</p>
			<p class="head">Makes</p>
			<p class="head">For</p>

			{#each CHAINS as c (c.type)}
				<div class="node land"><strong>{c.land}</strong><span>{c.landNote}</span></div>
				{#each [0, 1, 2, 3] as k (k)}
					{@const s = c.stages[k]}
					{#if s}
						<button class="node b" class:have={owned[`${c.type}:${s.level}`]} class:first={k === 0} onclick={() => k === 0 && onBuild(c.type)} title={k === 0 ? `Build a ${s.label.toLowerCase()}: ${costOf(s.cost)}` : `Upgrade a ${c.stages[k - 1].label.toLowerCase()} on its card: ${costOf(s.cost)}`}>
							<strong>{s.label}{#if owned[`${c.type}:${s.level}`]}<em>×{owned[`${c.type}:${s.level}`]}</em>{/if}</strong>
							<span>{s.t ? `${num(s.t)} t a year · ${kwh(s.kwh)}` : 'plants young trees, cuts none'}</span>
							<span class="cost">{k ? '↑ ' : ''}{costOf(s.cost)}</span>
						</button>
					{:else}
						<div class="gap"></div>
					{/if}
				{/each}
				<div class="node w"><strong><i style:background={WARES[c.ware].color}></i>{label(c.ware)}<em>{Math.floor(stock[c.ware] ?? 0)}</em></strong><span>in your stores, loads</span></div>
				<div class="node use"><strong>{c.use}</strong><span>{c.useNote}</span></div>
			{/each}

			<div class="node land"><strong>Hot rock</strong><span>5.5 km down, 175 °C</span></div>
			{#each GEOTHERMAL as s, k (s.level)}
				<button class="node b e" class:have={owned[`centre:${s.level}`]} class:first={k === 0} onclick={() => k === 0 && onBuild('centre')} title={k === 0 ? `Found a village: its center stands on geothermal wells, one injector and two producers (${num(s.eur)} €, your first village's come with the valley)` : `Drill two more producers on its village center's card: ${num(s.eur)} €`}>
					<strong>{s.label}{#if owned[`centre:${s.level}`]}<em>×{owned[`centre:${s.level}`]}</em>{/if}</strong>
					<span>{s.mw.toFixed(1)} MW · {kwh(s.kwh)} a year</span>
					<span class="cost">{k ? '↑ ' : ''}{num(s.eur / 1e6)} M €{k ? '' : ' for a new village'}</span>
				</button>
			{/each}
			<div class="gap"></div>
			<div class="node w e"><strong><i class="bolt"></i>Energy</strong><span>kWh, a flow</span></div>
			<div class="node use"><strong>People, domes, factories</strong><span>the rest to the grid, {num(GRID_EUR_KWH * 1000)} € a MWh</span></div>

			<div class="node land"><strong>Sun</strong><span>through the domes' glass</span></div>
			<div class="node b e wide"><strong>Every dome's solar cells</strong><span>{kwh(ENERGY.sunBed)} a bed a year, most in summer; its climate uses {kwh(ENERGY.climateBed)}</span></div>
			<div class="gap"></div>
			<div class="gap"></div>
			<div class="node w e"><strong><i class="bolt"></i>Energy</strong><span>kWh, a flow</span></div>
			<div class="node use"><strong>People at home</strong><span>{num(ENERGY.home)} kWh a year each</span></div>
		</div>
	</div>

	<p class="label">Homes: one dome that grows</p>
	<div class="homes">
		{#each HOMES as h, k (h.level)}
			<button class="node b" class:have={owned[`house:${h.level}`]} class:first={k === 0} onclick={() => k === 0 && onBuild('house')} title={k === 0 ? `Build a hut of ${h.beds}: ${costOf(h.cost)} and ${num(h.glass)} t of glass, ${num(h.glass * GLASS_EUR_T)} € from the world market` : `Enlarge on the house's card: ${costOf(h.cost)} and ${num(h.glass)} t of glass, ${num(h.glass * GLASS_EUR_T)} €`}>
				<strong>{h.label} · {h.beds}{#if owned[`house:${h.level}`]}<em>×{owned[`house:${h.level}`]}</em>{/if}</strong>
				<span>sun {kwh(h.sun)} a year</span>
				<span class="cost">{k ? '↑ ' : ''}{costOf(h.cost)}, {num(h.glass)} t glass</span>
			</button>
		{/each}
	</div>
	<p class="small">Food and water are not wares: each hex's food forest grows food, the domes' roofs catch rain, and the world market sells the rest and buys what you have spare. Glass comes from the world market, paid in gold as a dome is begun.</p>
</section>

<style>
	.tree {
		position: absolute;
		z-index: 5;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: calc(9rem + env(safe-area-inset-left, 0px));
		right: calc(18.6rem + env(safe-area-inset-right, 0px));
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
		padding: 0.7rem 0.8rem;
		border-radius: 16px;
		background: rgb(250 248 242 / 0.96);
		border: 1px solid rgb(255 255 255 / 0.5);
		-webkit-backdrop-filter: blur(14px) saturate(1.2);
		backdrop-filter: blur(14px) saturate(1.2);
		box-shadow: 0 4px 18px rgb(0 0 0 / 0.12);
	}
	h2 {
		margin: 0.15rem 0 0.3rem;
		font-size: 1.15rem;
	}
	.close {
		position: absolute;
		top: 0.4rem;
		right: 0.5rem;
		border: 0;
		background: none;
		font-size: 1.2rem;
		cursor: pointer;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6b736d;
	}
	.about,
	.small {
		margin: 0 0 0.5rem;
		font-size: 0.76rem;
		line-height: 1.35;
		color: #47504a;
	}
	.label {
		margin: 0.6rem 0 0.3rem;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.scroll {
		overflow-x: auto;
		padding: 0.5rem;
		border-radius: 12px;
		background: rgb(31 42 35 / 0.04);
	}
	.grid {
		display: grid;
		grid-template-columns: 6.6rem repeat(4, 7.6rem) 6.4rem 7.6rem;
		column-gap: 1rem;
		row-gap: 0.5rem;
		width: max-content;
	}
	.head {
		margin: 0;
		font-size: 0.64rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #6b736d;
	}
	.head.stages {
		grid-column: span 4;
	}
	.node {
		position: relative;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.05rem;
		min-height: 3.3rem;
		padding: 0.25rem 0.5rem;
		border-radius: 10px;
		font: inherit;
		font-size: 0.72rem;
		text-align: left;
		color: #1f2a23;
	}
	/* an arrow from the node before */
	.node:not(.land)::before {
		content: '→';
		position: absolute;
		left: -0.9rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 0.7rem;
		color: #8a928c;
	}
	.gap {
		align-self: center;
		height: 0;
		border-top: 1px dashed rgb(31 42 35 / 0.25);
		margin: 0 -1rem;
	}
	.node strong {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.74rem;
	}
	.node em {
		margin-left: auto;
		font-style: normal;
		font-weight: 600;
		color: #3d8f4a;
	}
	.node span {
		font-size: 0.64rem;
		line-height: 1.25;
		color: #5c645e;
	}
	.node .cost {
		color: #7b6a4a;
	}
	.node.land {
		background: rgb(159 196 106 / 0.18);
		border: 1px solid rgb(95 130 60 / 0.25);
	}
	.node.b {
		border: 1px solid rgb(31 42 35 / 0.15);
		background: #fff;
		cursor: default;
	}
	.node.b.first {
		cursor: pointer;
	}
	.node.b.first:hover {
		border-color: #24452f;
	}
	.node.b.have {
		border-color: #3d8f4a;
		box-shadow: inset 3px 0 0 #3d8f4a;
	}
	.node.b.e {
		background: #fffbea;
	}
	.node.wide {
		grid-column: span 2;
	}
	.node.w {
		border: 1px dashed rgb(31 42 35 / 0.25);
		background: rgb(255 255 255 / 0.6);
	}
	.node.use {
		border: 1px solid rgb(31 42 35 / 0.08);
		background: rgb(31 42 35 / 0.05);
	}
	i {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 3px;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
		flex: none;
	}
	i.bolt {
		background: #e8b730;
	}
	.homes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8.4rem, 1fr));
		gap: 0.5rem 1rem;
	}
	.homes .node:first-child::before {
		content: none;
	}
	@media (max-width: 720px) {
		.tree {
			top: calc(7rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			right: 0.5rem;
			max-height: 70vh;
		}
	}
</style>
