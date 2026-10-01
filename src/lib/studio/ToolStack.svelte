<!--
	A stack of grading tools, each drawn from the one registry (game/film/grade-tools.js): its name, on or off, up and
	down, off the stack; its controls as the registry gives them (a slider, three for a CDL's channels, a choice, a
	switch, the points of a curve). A window or a colour key is a group: its own tools, applied only inside it, are a
	stack of their own here, as deep as the registry lets them nest. New tools come from the menu, by group.
-->
<script>
	import ToolStack from './ToolStack.svelte';
	import { TOOL, TOOLS, TOOL_GROUPS, newTool, toolText } from '../../../game/film/grade-tools.js';
	import { fine } from './fine.js';

	/** @typedef {import('$lib/auth/client').GradeTool} GradeTool */
	/** @type {{ tools: GradeTool[], onchange: (tools: GradeTool[]) => void, depth?: number }} */
	let { tools, onchange, depth = 0 } = $props();

	/** which cards are folded (their index on this stack) @type {number[]} */
	let folded = $state([]);
	/** which CDLs show their three channels @type {number[]} */
	let channels = $state([]);
	let adding = $state(false);
	const MAX_DEPTH = 3;

	/** @param {number} i @param {(t: any) => any} f */
	const put = (i, f) => onchange(tools.map((t, j) => (j === i ? f(structuredClone($state.snapshot(t))) : t)));
	/** @param {number} i @param {-1 | 1} d */
	const move = (i, d) => {
		const j = i + d;
		if (j < 0 || j >= tools.length) return;
		const next = [...tools];
		[next[i], next[j]] = [next[j], next[i]];
		onchange(next);
	};
	/** @param {number} i */
	const drop = (i) => onchange(tools.filter((_, j) => j !== i));
	/** @param {string} id */
	const add = (id) => {
		adding = false;
		onchange([...tools, newTool(id)]);
	};
	/** @template T @param {T[]} list @param {T} x */
	const toggle = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
	/** @param {number} v @param {number} step */
	const show = (v, step) => (Number.isFinite(v) ? v.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0) : '—');
	const groups = TOOL_GROUPS.map((g) => ({ group: g, tools: TOOLS.filter((t) => t.group === g && (depth < MAX_DEPTH - 1 || t.kind !== 'mask')) })).filter((g) => g.tools.length);
</script>

<div class="stack" class:inner={depth > 0}>
	{#each tools as t, i (i)}
		{@const def = TOOL[t.tool]}
		{@const open = !folded.includes(i)}
		<article class="tool" class:off={t.on === false} class:mask={def?.kind === 'mask'}>
			<header>
				<button class="fold" onclick={() => (folded = toggle(folded, i))} aria-label={open ? 'Fold' : 'Unfold'}>{open ? '▾' : '▸'}</button>
				<label class="onoff" title={t.on === false ? 'Off: on the stack, doing nothing' : 'On'}>
					<input type="checkbox" checked={t.on !== false} onchange={(e) => put(i, (x) => (e.currentTarget.checked ? (delete x.on, x) : { ...x, on: false }))} />
				</label>
				<b title={def?.what ?? ''}>{def?.label ?? t.tool}</b>
				{#if !open}<span class="sum">{toolText(t).slice((def?.label ?? '').length)}</span>{/if}
				<span class="acts">
					<button onclick={() => move(i, -1)} disabled={i === 0} aria-label="Up">↑</button>
					<button onclick={() => move(i, 1)} disabled={i === tools.length - 1} aria-label="Down">↓</button>
					<button onclick={() => drop(i)} aria-label="Take it off">×</button>
				</span>
			</header>
			{#if open && def}
				<div class="params">
					{#each def.params as p (p.key)}
						{#if p.type === 'number'}
							<label class="sl" title="{p.unit ?? ''} — double-click: {p.def}">
								<span>{p.label}</span>
								<input {@attach fine()} type="range" min={p.min} max={p.max} step={p.step} value={/** @type {number} */ (t[p.key] ?? p.def)} oninput={(e) => put(i, (x) => ({ ...x, [p.key]: Number(e.currentTarget.value) }))} ondblclick={() => put(i, (x) => ({ ...x, [p.key]: p.def }))} />
								<output>{show(/** @type {number} */ (t[p.key] ?? p.def), p.step ?? 0.01)}</output>
							</label>
						{:else if p.type === 'trio'}
							{@const v = /** @type {number[]} */ (t[p.key] ?? p.def)}
							{@const mean = (v[0] + v[1] + v[2]) / 3}
							<label class="sl" title="all three channels together — double-click: {p.def[0]}">
								<span>{p.label}</span>
								<input {@attach fine()} type="range" min={p.min} max={p.max} step={p.step} value={mean} oninput={(e) => { const d = Number(e.currentTarget.value) - mean; put(i, (x) => ({ ...x, [p.key]: v.map((c) => +(c + d).toFixed(4)) })); }} ondblclick={() => put(i, (x) => ({ ...x, [p.key]: [...p.def] }))} />
								<output>{show(mean, p.step ?? 0.01)}</output>
							</label>
							{#if channels.includes(i)}
								{#each ['red', 'green', 'blue'] as ch, k (ch)}
									<label class="sl ch {ch}">
										<span>{ch}</span>
										<input {@attach fine()} type="range" min={p.min} max={p.max} step={p.step} value={v[k]} oninput={(e) => put(i, (x) => ({ ...x, [p.key]: v.map((c, n) => (n === k ? Number(e.currentTarget.value) : c)) }))} />
										<output>{show(v[k], p.step ?? 0.01)}</output>
									</label>
								{/each}
							{/if}
						{:else if p.type === 'choice'}
							<div class="sl choice">
								<span>{p.label}</span>
								<div class="seg">
									{#each p.choices ?? [] as c (c)}
										<button class:on={(t[p.key] ?? p.def) === c} onclick={() => put(i, (x) => ({ ...x, [p.key]: c }))}>{c || 'none'}</button>
									{/each}
								</div>
							</div>
						{:else if p.type === 'flag'}
							<label class="sl flag">
								<span>{p.label}</span>
								<input type="checkbox" checked={!!(t[p.key] ?? p.def)} onchange={(e) => put(i, (x) => ({ ...x, [p.key]: e.currentTarget.checked }))} />
							</label>
						{:else if p.type === 'curve'}
							{@const pts = /** @type {[number, number][]} */ (t[p.key] ?? [])}
							{@const flat = p.key === 'hue_sat' ? 1 : 0}
							<div class="curve">
								<div class="curve-head"><span>{p.label}</span><button onclick={() => put(i, (x) => ({ ...x, [p.key]: [...pts, [pts.length ? (pts[pts.length - 1][0] + 30) % 360 : 120, flat]] }))}>+ point</button></div>
								{#each pts as q, k (k)}
									<div class="pt">
										<input {@attach fine()} type="range" min="0" max="359" step="1" value={q[0]} title="hue {q[0]}°" oninput={(e) => put(i, (x) => ({ ...x, [p.key]: pts.map((r, n) => (n === k ? [Number(e.currentTarget.value), r[1]] : r)) }))} />
										<output>{Math.round(q[0])}°</output>
										<input {@attach fine()} type="range" min={p.min} max={p.max} step={p.step} value={q[1]} title="{p.label}: {q[1]}" oninput={(e) => put(i, (x) => ({ ...x, [p.key]: pts.map((r, n) => (n === k ? [r[0], Number(e.currentTarget.value)] : r)) }))} />
										<output>{show(q[1], p.step ?? 0.01)}</output>
										<button onclick={() => put(i, (x) => ({ ...x, [p.key]: pts.filter((_, n) => n !== k) }))} aria-label="Take the point off">×</button>
									</div>
								{/each}
							</div>
						{:else if p.type === 'hash'}
							<label class="sl hash">
								<span>{p.label}</span>
								<input type="text" placeholder="the .cube file's hash" value={/** @type {string} */ (t[p.key] ?? '')} onchange={(e) => put(i, (x) => ({ ...x, [p.key]: e.currentTarget.value.trim() }))} />
							</label>
						{/if}
					{/each}
					{#if def.params.some((p) => p.type === 'trio')}
						<button class="link" onclick={() => (channels = toggle(channels, i))}>{channels.includes(i) ? 'all channels together' : 'red, green, blue'}</button>
					{/if}
				</div>
				{#if def.kind === 'mask'}
					<div class="inside">
						<p class="inside-head">Inside the {def.label.toLowerCase()}</p>
						<ToolStack tools={/** @type {GradeTool[]} */ (t.tools ?? [])} depth={depth + 1} onchange={(inner) => put(i, (x) => ({ ...x, tools: inner }))} />
					</div>
				{/if}
			{/if}
		</article>
	{:else}
		<p class="empty">{depth ? 'Nothing inside yet.' : 'No tools on this stack yet.'}</p>
	{/each}

	<div class="add">
		<button class="add-btn" onclick={() => (adding = !adding)}>{adding ? 'Close' : depth ? '+ Tool inside' : '+ Add tool'}</button>
		{#if adding}
			<div class="menu">
				{#each groups as g (g.group)}
					<div class="group">
						<span>{g.group}</span>
						{#each g.tools as d (d.id)}<button onclick={() => add(d.id)} title={d.what}>{d.label}</button>{/each}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.stack.inner {
		gap: 0.35rem;
	}

	.tool {
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: var(--bg);
	}

	.tool.mask {
		border-color: var(--edge-strong);
	}

	.tool.off {
		opacity: 0.55;
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.5rem;
	}

	header b {
		font-size: 0.8rem;
		font-weight: 600;
	}

	.sum {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.68rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--dim);
	}

	.acts {
		display: flex;
		gap: 0.1rem;
		margin-left: auto;
	}

	header button,
	.curve button,
	.link {
		padding: 0 0.3rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.75rem;
		color: var(--dim);
		cursor: pointer;
	}

	header button:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.onoff input {
		accent-color: var(--accent);
	}

	.params {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0 0.6rem 0.5rem;
	}

	.sl {
		display: grid;
		grid-template-columns: 6.2rem minmax(3rem, 1fr) 2.9rem;
		gap: 0.45rem;
		align-items: center;
		font-size: 0.72rem;
		color: var(--ink-soft);
	}

	.sl input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}

	.sl output,
	.pt output {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.68rem;
		text-align: right;
		color: var(--ink);
	}

	.sl.ch span {
		padding-left: 0.6rem;
	}

	.sl.ch.red input {
		accent-color: #e0685a;
	}

	.sl.ch.green input {
		accent-color: #6fc28b;
	}

	.sl.ch.blue input {
		accent-color: #6f9fe8;
	}

	.sl.flag input {
		justify-self: start;
		accent-color: var(--accent);
	}

	.sl.hash input {
		grid-column: 2 / span 2;
		padding: 0.15rem 0.3rem;
		border: 1px solid var(--edge);
		border-radius: 4px;
		background: var(--raised);
		font: inherit;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.65rem;
		color: var(--ink);
	}

	.seg {
		grid-column: 2 / span 2;
		display: flex;
		gap: 0.2rem;
	}

	.seg button {
		padding: 0.05rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		font-size: 0.68rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.seg button.on {
		border-color: var(--accent);
		color: var(--ink);
	}

	.curve {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 0.2rem;
		font-size: 0.72rem;
		color: var(--ink-soft);
	}

	.curve-head {
		display: flex;
		justify-content: space-between;
	}

	.pt {
		display: grid;
		grid-template-columns: minmax(2rem, 1fr) 2.2rem minmax(2rem, 1fr) 2.6rem 1rem;
		gap: 0.3rem;
		align-items: center;
	}

	.pt input {
		width: 100%;
		accent-color: var(--accent);
	}

	.link {
		align-self: flex-start;
		padding: 0;
		font-size: 0.68rem;
		text-decoration: underline;
	}

	.inside {
		margin: 0 0.5rem 0.5rem;
		padding: 0.4rem 0.5rem 0.5rem;
		border-left: 2px solid var(--accent);
		background: var(--lane);
	}

	.inside-head {
		margin: 0 0 0.3rem;
		font-size: 0.64rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.empty {
		margin: 0;
		font-size: 0.74rem;
		color: var(--dim);
	}

	.add-btn {
		padding: 0.2rem 0.7rem;
		border: 1px dashed var(--edge-strong);
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.72rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.menu {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.4rem;
		padding: 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: var(--raised);
	}

	.group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}

	.group span {
		width: 4.2rem;
		font-size: 0.62rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.group button {
		padding: 0.1rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--bg);
		font: inherit;
		font-size: 0.7rem;
		color: var(--ink);
		cursor: pointer;
	}
</style>
