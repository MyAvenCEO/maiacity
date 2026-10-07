<!--
	Sandbox 6 · the building tree: every chain of the valley on one screen, a row each (./tree.js, read from the rules):
	the hex a chain stands on and the land it works, every stage its building grows through with its recipes of the
	crafting engine (what building it or growing to it takes, its upkeep a week in gold, the energy standing uses a
	week, and what it makes a week), the ware it makes and what that is for; then energy, the village center's stages (a logistics hub that grows into the
	village center and its geothermal plant) and every dome's solar cells; then the homes, one dome through its eight sizes. All in units: a tonne, a MWh, a gold. A stage you have
	is marked; click a first stage to build it (later stages grow on the building's card).
-->
<script>
	import { WARES } from './rules.js';
	import { GRID_EUR_KWH, EUR_PER_GOLD } from './market.js';
	import { CHAINS, CENTRES, HOMES, SUN } from './tree.js';
	import { UNIT_OF, craftLine, fmt, side, ware } from './units.js';

	/** @type {{ stock: Record<string, number>, owned: Record<string, number>, onBuild: (type: string) => void, onClose: () => void }} */
	let { stock, owned, onBuild, onClose } = $props();

	const label = (/** @type {string} */ w) => WARES[w]?.label ?? w;
	/** a recipe side as a list: "10 planks, 5 steel, 1.5 energy" @param {Record<string, number>} m */
	const list = (m) => side(m, ', ');
	/** a stage's recipes, as its title says them @param {{ label: string, build: any, keep: any, use: any, make: any, does?: string }} s @param {boolean} up */
	const titleOf = (s, up) =>
		`${s.label}\n${up ? 'Grow to it' : 'Build it'}: ${list(s.build.in)}\nKeep it, a week: ${list(s.keep.in)}\nIt uses, a week: ${list(s.use.in)}\nMake, a week: ${s.make && Object.keys(s.make.out).length ? craftLine(s.make) : (s.does ?? 'nothing')}`;
</script>

<section class="tree" aria-label="Building tree">
	<button class="close" onclick={onClose} aria-label="Close">×</button>
	<p class="eyebrow">How the valley works</p>
	<h2>Building tree</h2>
	<p class="about">Each row runs from the hex it stands on to what it is for, through every stage its building grows. Every stage has its recipes: <b>build</b>, what building it or growing to it takes once (↑ for an upgrade); <b>keep</b>, its upkeep a week, always in gold (2% a year of what it is built of, at world prices); <b>use</b>, the energy standing takes a week; <b>make</b>, what its land and energy make a week. A green stage is one you have. Click a first stage to build it; the next ones grow on its card.</p>
	<p class="units">1 of anything is a real unit: a ware, land or food {UNIT_OF.ware} · water {UNIT_OF.water} · energy {UNIT_OF.energy} · gold {UNIT_OF.gold}</p>

	<div class="scroll">
		<div class="grid">
			<p class="head">Hex and land</p>
			<p class="head stages">Stages, each an upgrade of the one before</p>
			<p class="head">Makes</p>
			<p class="head">For</p>

			{#each CHAINS as c (c.type)}
				<div class="node land"><strong>{c.hex}</strong><span><b>{c.land}</b>: {c.landNote}</span></div>
				{#each [0, 1, 2, 3] as k (k)}
					{@const s = c.stages[k]}
					{#if s}
						<button class="node b" class:have={owned[`${c.type}:${s.level}`]} class:first={k === 0} onclick={() => k === 0 && onBuild(c.type)} title={titleOf(s, k > 0)}>
							<strong>{s.label}{#if owned[`${c.type}:${s.level}`]}<em>×{owned[`${c.type}:${s.level}`]}</em>{/if}</strong>
							<span class="r make"><b>make</b>{Object.keys(s.make.out).length ? craftLine(s.make) : s.does}</span>
							<span class="r"><b>keep</b>{list(s.keep.in)}</span>
							<span class="r"><b>use</b>{list(s.use.in)}</span>
							<span class="r cost"><b>{k ? '↑ build' : 'build'}</b>{list(s.build.in)}</span>
						</button>
					{:else}
						<div class="gap"></div>
					{/if}
				{/each}
				<div class="node w"><strong><i style:background={WARES[c.ware].color}></i>{label(c.ware)}<em>{ware(stock[c.ware] ?? 0)}</em></strong><span>in your stores</span></div>
				<div class="node use"><strong>{c.use}</strong><span>{c.useNote}</span></div>
			{/each}

			<div class="node land"><strong>A village's middle hex</strong><span><b>hot rock</b>: 5.5 km down, 175 °C</span></div>
			{#each CENTRES as s, k (s.level)}
				<button class="node b e" class:have={owned[`centre:${s.level}`]} class:first={k === 0} onclick={() => k === 0 && onBuild('centre')} title={titleOf(s, k > 0)}>
					<strong>{s.label}{#if owned[`centre:${s.level}`]}<em>×{owned[`centre:${s.level}`]}</em>{/if}</strong>
					{#if s.mw}<span>with its geothermal plant, {fmt(s.mw)} MW</span>{/if}
					<span class="r make"><b>make</b>{Object.keys(s.make.out).length ? list(s.make.out) : s.does}</span>
					<span class="r"><b>keep</b>{list(s.keep.in)}</span>
					<span class="r"><b>use</b>{list(s.use.in)}</span>
					<span class="r cost"><b>{k ? '↑ build' : 'build'}</b>{list(s.build.in)}</span>
				</button>
			{/each}
			{#each { length: 4 - CENTRES.length } as _, k (k)}<div class="gap"></div>{/each}
			<div class="node w e"><strong><i class="bolt"></i>Energy</strong><span>a flow, never stored</span></div>
			<div class="node use"><strong>People, domes, factories</strong><span>the rest to the grid, {fmt((GRID_EUR_KWH * 1000) / EUR_PER_GOLD)} gold an energy</span></div>

			<div class="node land"><strong>Every dome</strong><span><b>sun</b>: through its glass</span></div>
			<div class="node b e wide"><strong>Its solar cells</strong><span class="r make"><b>make</b>{fmt(SUN.make)} energy a bed a week over the year, most in summer</span><span class="r"><b>use</b>its climate, {fmt(SUN.climate)} energy a bed a week</span></div>
			<div class="gap"></div>
			<div class="gap"></div>
			<div class="node w e"><strong><i class="bolt"></i>Energy</strong><span>a flow, never stored</span></div>
			<div class="node use"><strong>People at home</strong><span>and the domes' fans and pumps</span></div>
		</div>
	</div>

	<p class="label">Homes: one dome that grows</p>
	<div class="homes">
		{#each HOMES as h, k (h.level)}
			<button class="node b" class:have={owned[`house:${h.level}`]} class:first={k === 0} onclick={() => k === 0 && onBuild('house')} title={titleOf(h, k > 0)}>
				<strong>{h.label} · {h.beds} beds{#if owned[`house:${h.level}`]}<em>×{owned[`house:${h.level}`]}</em>{/if}</strong>
				<span class="r make"><b>make</b>{list(h.make.out)}</span>
				<span class="r"><b>keep</b>{list(h.keep.in)}</span>
				<span class="r"><b>use</b>{list(h.use.in)}</span>
				<span class="r cost"><b>{k ? '↑ build' : 'build'}</b>{list(h.build.in)}</span>
			</button>
		{/each}
	</div>
	<p class="small">Make, keep and use are a week's, as on the village card. Food and water are not wares: each hex's food forest grows food, the domes' roofs catch rain, and the world market sells the rest and buys what you have spare, for gold. What a village's treasury lacks it borrows, up to 125 gold a villager.</p>
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
	.units {
		margin: 0 0 0.5rem;
		font-size: 0.7rem;
		color: #6b736d;
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
		grid-template-columns: 8rem repeat(4, 10rem) 6.4rem 7.6rem;
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
		gap: 0.1rem;
		min-height: 3.3rem;
		padding: 0.3rem 0.5rem;
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
	.node.land span b {
		font-weight: 600;
		color: #3f5a2a;
	}
	/* a stage's recipe line: its kind, then its wares and energy */
	.node .r {
		display: grid;
		grid-template-columns: 2.6rem 1fr;
		column-gap: 0.25rem;
	}
	.node .r b {
		font-weight: 600;
		font-size: 0.58rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #8a928c;
		padding-top: 0.05rem;
	}
	.node .r.make {
		color: #1f2a23;
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
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
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
