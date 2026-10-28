<!--
	A vault's flows, as a recipe draws its steps, in the layout every avenDB view has (./Frame.svelte): on the left
	each flow its entries of the kinds it names can go through, with how many of the vault's entries are in it; in the
	middle the one picked, its stages as nodes where they sit, an arrow to each stage one goes on to, each stage with
	how many of the vault's entries are in it and whether it is public (one Public share of the vault on the stage's
	tag reaches every entry in it), and under each stage the functions that run as an entry enters it or leaves it
	(./flows.js): the vault's own, Maia City's, then the app's, each a link to Functions, which shows how it is
	wired and its code (./Functions.svelte); on the right whose the flow is, the entry that keeps it and its version,
	the kinds of entries it is for, and how many stages, entries and functions it has.
-->
<script>
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { flowsFor, functionsOf, publicShare, stageOf, stageTag } from './flows.js';
	import { ago, count, list, nameOf, reads, short } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string }} */
	let { world, vault, actor } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const flows = $derived(
		[...new Set(['article', ...world.entries.filter((e) => e.vault === vault).map((e) => e.type ?? '')])]
			.flatMap((type) => flowsFor(world, vault, type))
			.filter((f, i, all) => all.findIndex((g) => g.key === f.key) === i)
	);
	const entries = $derived(world.entries.filter((e) => e.vault === vault && reads(e, actor) && !e.deleted));

	/** the flow picked on the left, by its key: the first listed until one is */
	let picked = $state('');
	const flow = $derived(flows.find((f) => f.key === picked) ?? flows[0]);
	const fns = $derived(flow ? functionsOf(world, vault, flow.key) : []);
	/** the entry that keeps the flow shown, as this device holds it: none for one the app knows by heart */
	const kept = $derived(flow?.entry ? world.entries.find((e) => e.entry === flow.entry) : undefined);

	/** How many of the vault's entries are in flow `f`, in any of its stages. @param {import('./flows.js').Flow} f */
	const inFlow = (f) => entries.filter((e) => stageOf(e, f)).length;
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

<!-- the flows down the left, each with how many of the vault's entries are in it -->
{#snippet shelf()}
	<h3 class="nav-group">Flows</h3>
	{#each flows as f (f.key)}
		<button
			class="nav-item"
			class:on={flow?.key === f.key}
			aria-pressed={flow?.key === f.key}
			data-pick
			title="{count(inFlow(f), 'entry', 'entries')} in it"
			onclick={() => (picked = f.key)}><Icon name="flow" size={16} /><span>{f.name}</span><small>{inFlow(f)}</small></button
		>
	{/each}
{/snippet}

<!-- on the right, the one place for the flow shown: whose it is, its entry and version, what it holds -->
{#snippet about()}
	{#if flow}
		<header class="about-head">
			<small>Flow</small>
			<h3>{flow.name}</h3>
		</header>
		<h4 class="side-head">Where it is kept</h4>
		<dl>
			<dt>Whose</dt>
			<dd>{flow.vault ? nameOf(byId.get(flow.vault)) : 'Built into every app'}</dd>
			<dt>Entry</dt>
			{#if flow.entry}
				<dd class="mono" title={flow.entry}>{short(flow.entry)}</dd>
			{:else}
				<dd>None: the app knows it by heart</dd>
			{/if}
			<dt>Version</dt>
			<dd>{kept ? `Edit #${kept.edits}` : 'The app’s own'}</dd>
			{#if kept?.created}
				<dt>Made</dt>
				<dd>{ago(kept.created)}</dd>
			{/if}
		</dl>
		<h4 class="side-head">What it holds</h4>
		<dl>
			<dt>For</dt>
			<dd>{list(flow.types.map((t) => `${t} entries`))}</dd>
			<dt>Stages</dt>
			<dd>{flow.stages.length}, {flow.stages.filter((s) => s.public).length} of them public</dd>
			<dt>In it</dt>
			<dd>{count(inFlow(flow), 'entry', 'entries')} of {nameOf(here)}</dd>
			<dt>Functions</dt>
			<dd>{fns.length ? count(fns.length, 'function') : 'None'}</dd>
		</dl>
	{/if}
{/snippet}

<Frame
	nav={flows.length ? shelf : undefined}
	aside={flow ? about : undefined}
	navLabel="{nameOf(here)}’s flows"
	asideLabel="The flow’s details"
	navIcon="flow"
	asideIcon="info"
>
	<p class="lead soft">
		Flows are recipes of stages any entry can be in: an article goes from its idea to a draft to published. An entry is
		in a stage while it carries the stage’s tag, so moving it swaps one tag. A public stage is one Public share of the
		vault on that tag, which reaches every entry in it and lets go of one moved out. Functions react to a move: each runs
		in QuickJS on the device that moves the entry and asks for the changes it makes, which the vault makes as any other,
		by its shares. <a href="#functions">Functions</a> shows each, how it is wired and its code.
	</p>

	{#if flow}
		{@const f = flow}
		{@const box = size(f)}
		<section class="flow">
			<h3><Icon name="flow" size={18} /> {f.name}</h3>
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
					{@const fnsHere = fns.filter((x) => x.stage === s.key)}
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
						{#each fnsHere as fn (fn.name)}
							<a class="fn" href="#functions" title="How it is wired, and its code, on Functions">
								<Icon name="fn" size={14} />
								<span class="name">{fn.name}</span>
								<span class="chip">{fn.on === 'leave' ? 'as it leaves' : 'as it enters'}</span>
								{#if fn.enabled === false}<span class="chip">Off</span>{/if}
								<small class="soft">{from(fn)}</small>
							</a>
						{/each}
					</article>
				{/each}
			</div>
		</section>
	{:else}
		<p class="empty">No flow is for the kinds of entries {nameOf(here)} holds yet.</p>
	{/if}
</Frame>

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.flow h3 {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.3rem;
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
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.5rem;
		border-top: 1px solid var(--edge);
		padding-top: 0.45rem;
		color: inherit;
		text-decoration: none;
	}

	.fn:hover .name {
		text-decoration: underline;
	}

	/* the right side: the flow's name, then what it is, in two lists */
	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head h3 {
		margin: 0.15rem 0 0;
		font-size: 1.15rem;
		overflow-wrap: anywhere;
	}

	.side-head {
		margin: 1.3rem 0 0.5rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.3rem 0.8rem;
		margin: 0;
		font-size: 0.8rem;
	}

	dt {
		opacity: 0.6;
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
