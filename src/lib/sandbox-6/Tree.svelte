<!--
	Sandbox 6 · the building tree: every chain of the valley on one screen, from the land to the last ware (laid out by
	./tree.js from the rules). A building shows what it costs, where it finds its work and how many you have; a ware
	shows what you hold, whether people live on it, and who in the valley has plenty of it. Click a building to build it.
-->
<script>
	import { BUILDINGS, WARES } from './rules.js';
	import { LIVED_ON, OTHERS, SOURCE, TRADE_NOTE, chainTree } from './tree.js';

	/** @type {{ stock: Record<string, number>, owned: Record<string, number>, onBuild: (type: string) => void, onClose: () => void }} */
	let { stock, owned, onBuild, onClose } = $props();

	const W = 138, H = 40, COL = 156, ROW = 50, PAD = 14;
	const tree = chainTree(COL, ROW);
	const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
	const label = (/** @type {string} */ w) => WARES[w]?.label ?? w;
	const costOf = (/** @type {string} */ t) =>
		Object.entries(BUILDINGS[t].cost)
			.map(([w, n]) => `${n} ${label(w).toLowerCase()}`)
			.join(' · ');
	/** a curve from the right of one node to the left of the next */
	const path = (/** @type {{ from: string, to: string }} */ e) => {
		const a = byId[e.from], b = byId[e.to];
		const x1 = a.x + W + PAD, y1 = a.y + H / 2 + PAD, x2 = b.x + PAD, y2 = b.y + H / 2 + PAD;
		const mid = (x1 + x2) / 2;
		return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
	};
	let hover = $state('');
	/** what a hovered node touches */
	const lit = $derived(new Set(hover ? tree.edges.filter((e) => e.from === hover || e.to === hover).flatMap((e) => [e.from, e.to]) : []));
</script>

<section class="tree" aria-label="Building tree">
	<button class="close" onclick={onClose} aria-label="Close">×</button>
	<p class="eyebrow">How the valley works</p>
	<h2>Building tree</h2>
	<p class="about">From the land on the left to the last ware on the right: each building takes the wares that lead into it and makes the ware it points to. <b>♥</b> marks what people's homes are built of. Click a building to build it.</p>
	<div class="scroll">
		<svg width={tree.width + PAD * 2} height={tree.height + PAD * 2} role="img" aria-label="The chains of buildings and wares">
			{#each tree.edges as e (e.from + e.to)}
				<path d={path(e)} class:alt={e.alt} class:lit={lit.has(e.from) && lit.has(e.to) && (e.from === hover || e.to === hover)} />
			{/each}
			{#each tree.nodes as n (n.id)}
				{@const id = n.id.slice(2)}
				<g transform="translate({n.x + PAD},{n.y + PAD})" class:dim={hover && !lit.has(n.id) && hover !== n.id} onmouseenter={() => (hover = n.id)} onmouseleave={() => (hover = '')} role="presentation">
					{#if n.kind === 'building'}
						<foreignObject width={W} height={H}>
							<button class="node b" class:have={owned[id]} onclick={() => onBuild(id)} title="{BUILDINGS[id].about} Costs {costOf(id)}.{BUILDINGS[id].inputs?.length ? ` Needs ${BUILDINGS[id].inputs?.map((s) => s.map(label).join(' or ')).join(' + ')}.` : ''}">
								<strong>{BUILDINGS[id].label}{#if owned[id]}<em> ×{owned[id]}</em>{/if}</strong>
								<span>{SOURCE[id] ? `${SOURCE[id]} · ` : ''}{costOf(id)}</span>
							</button>
						</foreignObject>
					{:else}
						<foreignObject width={W} height={H}>
							<div class="node w" title={TRADE_NOTE[id] ?? ''}>
								<strong><i style:background={WARES[id].color}></i>{label(id)}{#if LIVED_ON.has(id)}<b class="heart">♥</b>{/if}<em>{stock[id] ?? 0}</em></strong>
								<span>{TRADE_NOTE[id] ?? ''}</span>
							</div>
						</foreignObject>
					{/if}
				</g>
			{/each}
		</svg>
	</div>
	<p class="label">Also to build</p>
	<div class="others">
		{#each OTHERS as b (b.id)}
			<button class="node b" class:have={owned[b.id]} onclick={() => onBuild(b.id)} title={b.about}>
				<strong>{b.label}{#if owned[b.id]}<em> ×{owned[b.id]}</em>{/if}</strong>
				<span>{b.about.split('.')[0]} · {costOf(b.id)}</span>
			</button>
		{/each}
	</div>
	<p class="small">Food and water are not wares: the food forests grow food, the roofs catch rain, and the world market sells the rest and buys what you have spare.</p>
</section>

<style>
	.tree {
		position: absolute;
		z-index: 5;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: calc(9rem + env(safe-area-inset-left, 0px));
		right: calc(17.5rem + env(safe-area-inset-right, 0px));
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
		padding: 0.7rem 0.8rem;
		border-radius: 16px;
		background: rgb(250 248 242 / 0.94);
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
		opacity: 0.6;
	}
	.about,
	.small {
		margin: 0 0 0.5rem;
		font-size: 0.76rem;
		line-height: 1.35;
		opacity: 0.8;
	}
	.label {
		margin: 0.6rem 0 0.3rem;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.scroll {
		overflow-x: auto;
		border-radius: 12px;
		background: rgb(31 42 35 / 0.04);
	}
	svg {
		display: block;
	}
	path {
		fill: none;
		stroke: rgb(31 42 35 / 0.28);
		stroke-width: 1.6;
	}
	path.alt {
		stroke-dasharray: 4 3;
	}
	path.lit {
		stroke: #24452f;
		stroke-width: 2.4;
	}
	g.dim {
		opacity: 0.35;
	}
	.node {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.1rem;
		width: 100%;
		height: 100%;
		padding: 0.2rem 0.5rem;
		border-radius: 10px;
		font: inherit;
		font-size: 0.72rem;
		text-align: left;
		color: #1f2a23;
		overflow: hidden;
	}
	.node strong {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
	}
	.node em {
		margin-left: auto;
		font-style: normal;
		font-weight: 500;
		opacity: 0.7;
	}
	.node span {
		font-size: 0.64rem;
		opacity: 0.65;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.node.b {
		border: 1px solid rgb(31 42 35 / 0.15);
		background: #fff;
		cursor: pointer;
	}
	.node.b:hover {
		border-color: #24452f;
	}
	.node.b.have {
		border-color: #3d8f4a;
		box-shadow: inset 3px 0 0 #3d8f4a;
	}
	.node.w {
		border: 1px dashed rgb(31 42 35 / 0.2);
		background: rgb(255 255 255 / 0.55);
	}
	.heart {
		color: #b8442e;
		font-size: 0.7rem;
	}
	i {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 3px;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
		flex: none;
	}
	.others {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.4rem;
	}
	.others .node {
		height: auto;
		min-height: 2.6rem;
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
