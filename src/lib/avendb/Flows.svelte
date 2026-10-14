<!--
	A vault's flows, as a recipe draws its steps: each flow its entries of the kinds it names can go through, its stages
	as nodes where they sit, an arrow to each stage one goes on to, each stage with how many of the vault's entries are
	in it and whether it is public (one Public share of the vault on the stage's tag reaches every entry in it). Under
	each stage, the functions that run as an entry enters it or leaves it, with their code, as QuickJS runs it on the
	device that moves the entry (./flows.js, ./functions.js): the vault's own, avenCEO GmbH's, then the app's.
-->
<script>
	import Icon from './Icon.svelte';
	import { flowsFor, functionsOf, publicShare, stageOf, stageTag } from './flows.js';
	import { count, nameOf, reads } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string }} */
	let { world, vault, actor } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const flows = $derived(
		[...new Set(['article', ...world.entries.filter((e) => e.vault === vault).map((e) => e.type ?? '')])]
			.flatMap((type) => flowsFor(world, vault, type))
			.filter((f, i, all) => all.findIndex((g) => g.key === f.key) === i)
	);
	const entries = $derived(world.entries.filter((e) => e.vault === vault && reads(e, actor) && !e.deleted));

	/** whose a flow or a function is, in words: a vault's, or built into every app @param {{ vault?: string }} x */
	const from = (x) => (x.vault ? `${nameOf(byId.get(x.vault))}’s` : 'built in');

	// the drawing: each stage a node on a grid, an arrow to each next
	const [W, H, GAP_X, GAP_Y, PAD] = [168, 64, 72, 48, 16];
	/** @param {import('./flows.js').Stage} s */
	const at = (s) => ({ x: PAD + s.x * (W + GAP_X), y: PAD + s.y * (H + GAP_Y) });
	/** @param {import('./flows.js').Flow} f */
	const size = (f) => ({
		w: PAD * 2 + (Math.max(...f.stages.map((s) => s.x)) + 1) * (W + GAP_X) - GAP_X,
		h: PAD * 2 + (Math.max(...f.stages.map((s) => s.y)) + 1) * (H + GAP_Y) - GAP_Y
	});
	/**
	 * The arrow from stage `a` to stage `b`: along the row, above it going forward and below going back, so a pair
	 * of stages that go to each other shows two.
	 * @param {import('./flows.js').Stage} a @param {import('./flows.js').Stage} b
	 */
	function arrow(a, b) {
		const [p, q] = [at(a), at(b)];
		const forward = q.x > p.x || (q.x === p.x && q.y > p.y);
		const dy = forward ? -12 : 12;
		if (p.y === q.y) {
			const [x1, x2] = forward ? [p.x + W, q.x] : [p.x, q.x + W];
			const y = p.y + H / 2 + dy;
			return `M ${x1} ${y} L ${x2 - (forward ? 6 : -6)} ${y}`;
		}
		const [x, y1, y2] = [p.x + W / 2 + dy, forward ? p.y + H : p.y, forward ? q.y : q.y + H];
		return `M ${x} ${y1} L ${x} ${y2 - (forward ? 6 : -6)}`;
	}
</script>

<p class="lead soft">
	Flows are recipes of stages any entry can be in: an article goes from its idea to a draft to published. An entry is
	in a stage while it carries the stage’s tag, so moving it swaps one tag. A public stage is one Public share of the
	vault on that tag, which reaches every entry in it and lets go of one moved out. Functions react to a move: each runs
	in QuickJS on the device that moves the entry and asks for the changes it makes, which the vault makes as any other,
	by its shares.
</p>

{#each flows as f (f.key)}
	{@const box = size(f)}
	{@const fns = functionsOf(world, vault, f.key)}
	<section class="flow">
		<h3>
			<Icon name="flow" size={18} />
			{f.name}
			<small class="soft">for {f.types.join(', ')} · {from(f)}</small>
		</h3>
		{#if f.about}<p class="soft about">{f.about}</p>{/if}
		<div class="canvas">
			<svg viewBox="0 0 {box.w} {box.h}" width={box.w} height={box.h} role="img" aria-label="{f.name}: its stages">
				<defs>
					<marker id="head-{f.key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
						<path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8a84" />
					</marker>
				</defs>
				{#each f.stages as s (s.id)}
					{#each s.next as n (n)}
						{@const to = f.stages.find((x) => x.key === n)}
						{#if to}<path class="wire" d={arrow(s, to)} marker-end="url(#head-{f.key})" />{/if}
					{/each}
				{/each}
				{#each f.stages as s (s.id)}
					{@const p = at(s)}
					{@const inIt = entries.filter((e) => stageOf(e, f)?.key === s.key).length}
					<g class="node" class:open={s.public}>
						<rect x={p.x} y={p.y} width={W} height={H} rx="10" />
						<text x={p.x + 14} y={p.y + 26} class="name">{s.name}</text>
						<text x={p.x + 14} y={p.y + 46} class="meta">
							{count(inIt, 'entry', 'entries')} · {s.public ? 'Public' : 'Private'}
						</text>
					</g>
				{/each}
			</svg>
		</div>
		<div class="stages">
			{#each f.stages as s (s.id)}
				{@const tag = stageTag(f.key, s.key)}
				{@const share = s.public ? publicShare(world, vault, tag) : undefined}
				{@const here = fns.filter((x) => x.stage === s.key)}
				<article class="stage">
					<header>
						<b>{s.name}</b>
						<code class="soft">{tag}</code>
						{#if s.public}
							<span class="chip" class:ok={!!share}>
								{share ? 'Public: shared' : 'Public once an entry enters it'}
							</span>
						{/if}
					</header>
					{#if s.next.length}
						<p class="soft">
							Goes on to {s.next.map((n) => f.stages.find((x) => x.key === n)?.name ?? n).join(' or ')}.
						</p>
					{/if}
					{#each here as fn (fn.name)}
						<details class="fn">
							<summary>
								<Icon name="code" size={14} />
								<span>{fn.name}</span>
								<span class="chip">{fn.on === 'leave' ? 'as it leaves' : 'as it enters'}</span>
								{#if fn.enabled === false}<span class="chip">Off</span>{/if}
								<small class="soft">{from(fn)}</small>
							</summary>
							{#if fn.about}<p class="soft">{fn.about}</p>{/if}
							<pre class="code">{fn.code}</pre>
						</details>
					{/each}
				</article>
			{/each}
		</div>
	</section>
{/each}

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.flow {
		margin-bottom: 2rem;
	}

	.flow h3 {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.3rem;
	}

	.flow h3 small {
		font-weight: 400;
		font-size: 0.8rem;
	}

	.about {
		max-width: 46rem;
		margin: 0 0 0.7rem;
		font-size: 0.86rem;
	}

	.canvas {
		overflow-x: auto;
		padding: 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background-color: #f8f7f3;
		background-image: radial-gradient(rgb(0 0 0 / 0.09) 1px, transparent 1px);
		background-size: 14px 14px;
	}

	.canvas svg {
		display: block;
		max-width: none;
	}

	.wire {
		fill: none;
		stroke: #8b8a84;
		stroke-width: 1.6;
	}

	.node rect {
		fill: #fff;
		stroke: rgb(0 0 0 / 0.18);
		stroke-width: 1;
	}

	.node.open rect {
		fill: #eef6f1;
		stroke: #1f7a52;
	}

	.node .name {
		font-size: 14px;
		font-weight: 600;
		fill: #1d1d1b;
	}

	.node .meta {
		font-size: 12px;
		fill: #6b6a65;
	}

	.stages {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 0.7rem;
		margin-top: 0.8rem;
	}

	.stage {
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
		font-size: 0.86rem;
	}

	.stage header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.stage p {
		margin: 0.4rem 0 0;
	}

	.fn {
		margin-top: 0.5rem;
		border-top: 1px solid var(--edge);
		padding-top: 0.45rem;
	}

	.fn summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		cursor: pointer;
	}

	.code {
		overflow-x: auto;
		margin: 0.4rem 0 0;
		padding: 0.6rem;
		border-radius: 8px;
		background: #1e1e1c;
		color: #f1efe8;
		font-size: 0.76rem;
		line-height: 1.45;
	}
</style>
