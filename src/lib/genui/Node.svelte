<!--
	One component of a declarative view, drawn by our own markup: only the catalog's types (game/genui/views.js), every
	string set as text (never {@html}), colours only by tone name. A button or slider hands the page a named event and
	nothing more; what it does is the view's logic, in QuickJS.
-->
<script>
	// @ts-nocheck — plain JS
	import Node from './Node.svelte';

	let { id, byId, data, onevent, depth = 0 } = $props();
	const c = $derived(byId[id]);

	/** a prop's value: plain, or bound to the data model with {$data: 'a.b'} */
	const read = (v) => {
		if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$data === 'string') return v.$data.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
		return v;
	};
	const p = $derived(Object.fromEntries(Object.entries(c ?? {}).map(([k, v]) => [k, k === 'children' ? v : read(v)])));
	const text = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
	const tone = (t) => (['accent', 'good', 'warn', 'bad', 'muted'].includes(t) ? t : 'default');
	const gap = (g) => ({ s: '0.5rem', m: '0.9rem', l: '1.4rem' })[g] ?? '0.7rem';
	const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
	const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en', { maximumFractionDigits: 2 }) : text(v));
	const barMax = $derived(Math.max(1, ...(Array.isArray(p.items) ? p.items.map((i) => num(i?.value)) : [1])));
</script>

{#if c && depth < 24}
	{#if c.type === 'Column' || c.type === 'Row'}
		<div class={c.type === 'Row' ? 'row' : 'col'} class:wrap={p.wrap} style:gap={gap(p.gap)} style:align-items={['start', 'center', 'end'].includes(p.align) ? p.align : null}>
			{#each c.children as k (k)}<Node id={k} {byId} {data} {onevent} depth={depth + 1} />{/each}
		</div>
	{:else if c.type === 'Grid'}
		<div class="grid" style:gap={gap(p.gap)} style:--cols={Math.min(6, Math.max(1, Math.round(num(p.columns, 2))))}>
			{#each c.children as k (k)}<Node id={k} {byId} {data} {onevent} depth={depth + 1} />{/each}
		</div>
	{:else if c.type === 'Card'}
		<section class="card {tone(p.tone)}">
			{#if p.title}<h3>{text(p.title)}</h3>{/if}
			{#if p.subtitle}<p class="sub">{text(p.subtitle)}</p>{/if}
			{#each c.children as k (k)}<Node id={k} {byId} {data} {onevent} depth={depth + 1} />{/each}
		</section>
	{:else if c.type === 'Heading'}
		{#if num(p.level, 2) <= 2}<h2>{text(p.text)}</h2>{:else}<h4>{text(p.text)}</h4>{/if}
	{:else if c.type === 'Text'}
		<p class="text {tone(p.tone)} {p.size === 's' ? 'small' : p.size === 'l' ? 'large' : ''}">{text(p.text)}</p>
	{:else if c.type === 'Metric'}
		<div class="metric {tone(p.tone)}">
			<span class="label">{text(p.label)}</span>
			<b>{fmt(p.value)}{#if p.unit}<small>{text(p.unit)}</small>{/if}</b>
			{#if p.delta != null}<span class="delta">{text(p.delta)}</span>{/if}
		</div>
	{:else if c.type === 'Badge'}
		<span class="badge {tone(p.tone)}">{text(p.text)}</span>
	{:else if c.type === 'Progress'}
		<div class="progress {tone(p.tone)}">
			<span class="label">{text(p.label)} <b>{fmt(num(p.value))}{num(p.max, 100) === 100 ? ' %' : ` / ${fmt(num(p.max))}`}</b></span>
			<span class="track"><i style:width="{Math.min(100, Math.max(0, (num(p.value) / Math.max(1e-9, num(p.max, 100))) * 100))}%"></i></span>
		</div>
	{:else if c.type === 'Bars'}
		<div class="bars">
			{#if p.label}<span class="label">{text(p.label)}</span>{/if}
			{#each Array.isArray(p.items) ? p.items.slice(0, 40) : [] as it, i (i)}
				<div class="bar"><span>{text(it?.label)}</span><span class="track"><i style:width="{(num(it?.value) / barMax) * 100}%"></i></span><b>{fmt(num(it?.value))}{p.unit ? ` ${text(p.unit)}` : ''}</b></div>
			{/each}
		</div>
	{:else if c.type === 'Table'}
		<div class="table">
			<table>
				<thead><tr>{#each Array.isArray(p.columns) ? p.columns.slice(0, 12) : [] as h, i (i)}<th>{text(h)}</th>{/each}</tr></thead>
				<tbody>
					{#each Array.isArray(p.rows) ? p.rows.slice(0, 200) : [] as r, i (i)}
						<tr>{#each Array.isArray(r) ? r.slice(0, 12) : [] as v, j (j)}<td>{fmt(v)}</td>{/each}</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if c.type === 'List'}
		<ul>{#each Array.isArray(p.items) ? p.items.slice(0, 100) : [] as it, i (i)}<li>{text(it)}</li>{/each}</ul>
	{:else if c.type === 'Button'}
		<button class="btn {tone(p.tone)}" class:on={p.value != null && data && Object.values(data).includes(p.value)} onclick={() => onevent({ name: text(p.event).slice(0, 40), value: p.value ?? null })}>{text(p.label)}</button>
	{:else if c.type === 'Slider'}
		<label class="slider">
			<span class="label">{text(p.label)} <b>{fmt(num(p.value))}{p.unit ? ` ${text(p.unit)}` : ''}</b></span>
			<input type="range" min={num(p.min)} max={num(p.max, 100)} step={num(p.step, 1)} value={num(p.value)} oninput={(e) => onevent({ name: text(p.event).slice(0, 40), value: Number(e.currentTarget.value) })} />
		</label>
	{:else if c.type === 'Divider'}
		<hr />
	{/if}
{/if}

<style>
	.col { display: flex; flex-direction: column; }
	.row { display: flex; flex-direction: row; align-items: center; }
	.wrap { flex-wrap: wrap; }
	.grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); }
	@media (max-width: 520px) { .grid { grid-template-columns: repeat(min(var(--cols), 2), minmax(0, 1fr)); } }
	.card { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
	.card.accent { border-color: color-mix(in srgb, var(--mustard) 60%, var(--line)); }
	h2, h3, h4 { margin: 0; font-family: var(--font-display); }
	h3 { font-size: 1.15rem; }
	.sub { margin: -0.35rem 0 0; color: var(--muted); font-size: 0.9rem; }
	.text { margin: 0; line-height: 1.45; }
	.small { font-size: 0.85rem; }
	.large { font-size: 1.15rem; }
	.muted { color: var(--muted); }
	.metric { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 0.7rem 0.85rem; display: flex; flex-direction: column; gap: 0.15rem; }
	.metric b { font-size: 1.6rem; font-family: var(--font-display); }
	.metric small { margin-left: 0.25rem; font-size: 0.8rem; color: var(--muted); font-family: var(--font-body); }
	.metric.accent b { color: #2f6f5e; }
	.label { font-size: 0.78rem; color: var(--muted); letter-spacing: 0.04em; }
	.label b { color: var(--ink); }
	.badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 99px; font-size: 0.78rem; background: var(--cream); }
	.good { --tone: #3f8a52; } .warn { --tone: #c98a2b; } .bad { --tone: #c0473b; } .accent { --tone: #2f6f5e; } .default { --tone: var(--ink); }
	.badge.good, .badge.warn, .badge.bad, .badge.accent { color: #fff; background: var(--tone); }
	.progress { display: flex; flex-direction: column; gap: 0.35rem; }
	.track { display: block; height: 10px; background: var(--cream); border-radius: 99px; overflow: hidden; }
	.track i { display: block; height: 100%; background: var(--tone, #2f6f5e); border-radius: 99px; transition: width 0.25s; }
	.bars { display: flex; flex-direction: column; gap: 0.4rem; background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 0.9rem 1rem; }
	.bar { display: grid; grid-template-columns: 5.5rem 1fr 3.5rem; align-items: center; gap: 0.6rem; font-size: 0.88rem; }
	.bar b { text-align: right; }
	.table { overflow-x: auto; }
	table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
	th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--line); }
	ul { margin: 0; padding-left: 1.1rem; }
	.btn { font: inherit; font-size: 0.9rem; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 0.45rem 0.85rem; border-radius: 99px; cursor: pointer; }
	.btn.on { background: var(--ink); color: #fff; border-color: var(--ink); }
	.slider { display: flex; flex-direction: column; gap: 0.3rem; }
	.slider input { width: 100%; accent-color: #2f6f5e; }
	hr { border: 0; border-top: 1px solid var(--line); margin: 0.2rem 0; width: 100%; }
</style>
