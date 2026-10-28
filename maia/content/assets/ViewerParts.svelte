<!--
	WHAT EVERY ASSET VIEWER DRAWS ROUND ITS STAGE, THE SAME WAY — the repo's own viewer (./AssetViewer.svelte) and a
	vault's (./VaultAsset.svelte) each lay these out in their turntable ($lib/app/Turntable.svelte), with what is theirs
	alone round them; the stage itself is ./viewer.js's. Each is a snippet, handed what it shows and what a click does:

	  paramTabs   a parameter with named steps (a plant's stages) as tabs in the bar
	  moveChips   the moves it plays, one at a time
	  viewChips   the views it is looked at in, any at once
	  builtRows   what its recipe is built with, changed here and built anew (inside the viewer's own "Built with")
	  labRows     its solver's sliders, and how it is computed
	  slider      one slider, its name and its reading over it
	  heroReading its solver's reading, large, with its meter
	  longNote    its note, a long one cut to a few lines until it is tapped
	  scaleBar    the scale, a bar of a round length
	  tagLines    the labels' leader lines and names over the canvas
-->
<script module>
	// @ts-nocheck — plain JS
	import { num, tabbed } from './viewer.js';

	export { paramTabs, moveChips, viewChips, builtRows, labRows, slider, heroReading, longNote, scaleBar, tagLines };
</script>

{#snippet paramTabs(params, values, choose)}
	{#each params.filter(tabbed) as p (p.id)}
		<span class="label">{p.label}</span>
		{#each p.names as n, k (k)}
			<button class="chip" class:on={Math.round(values[p.id]) === p.min + k} onclick={() => choose(p.id, p.min + k)}>{n}</button>
		{/each}
	{/each}
{/snippet}

{#snippet moveChips(moves, isOn, lab, play)}
	{#if moves.length}
		<span class="label">Moves</span>
		{#each moves as [k, label] (k)}
			<button class="chip" class:on={isOn(k)} title={lab?.moves?.[k]?.note} onclick={() => play(k)}>{label}</button>
		{/each}
	{/if}
{/snippet}

{#snippet viewChips(views, isOn, set)}
	{#if views.length}
		<span class="label">Views</span>
		{#each views as [k, label] (k)}
			<button class="chip" class:on={isOn(k)} onclick={() => set(k)}>{label}</button>
		{/each}
	{/if}
{/snippet}

<!-- `orValue`: a slider's reading is its parameter's own value where none is given -->
{#snippet builtRows(params, values, setParam, freshSeed, orValue = true)}
	{#each params.filter((p) => !tabbed(p)) as p (p.id)}
		{#if p.type === 'string'}
			<label class="param">
				<span>{p.label}</span>
				<input value={values[p.id] ?? p.value} maxlength={p.maxLength ?? 80} onchange={(e) => setParam(p.id, e.currentTarget.value.trim() || p.value)} />
				{#if p.id === 'seed'}<button class="chip" onclick={freshSeed}>New seed</button>{/if}
			</label>
		{:else}
			{@render slider(p.label, orValue ? (values[p.id] ?? p.value) : values[p.id], { min: p.min, max: p.max, step: p.step ?? (p.type === 'integer' ? 1 : 'any'), value: values[p.id] ?? p.value, onchange: (e) => setParam(p.id, e.currentTarget.value) })}
		{/if}
	{/each}
{/snippet}

{#snippet labRows(lab, sliders, slide)}
	{#each Object.entries(lab.controls) as [k, c] (k)}
		{@render slider(c.label, `${num(sliders[k] ?? c.value, c.digits ?? 0)} ${c.unit ?? ''}`, { min: c.min, max: c.max, step: c.step ?? 'any', value: sliders[k] ?? c.value, oninput: (e) => slide(k, +e.currentTarget.value) }, c.ends)}
	{/each}
	{#if lab.how}
		<details class="how">
			<summary><b>How it is computed</b></summary>
			<p>{lab.how.text}</p>
			{#each lab.how.eqs ?? [] as q (q)}<code>{q}</code>{/each}
		</details>
	{/if}
{/snippet}

<!-- `input` the range's own attributes (min, max, step, value, and oninput or onchange); `ends` what each end means -->
{#snippet slider(label, out, input, ends)}
	<label class="slider">
		<span>{label}</span>
		<output>{out}</output>
		<input type="range" {...input} />
		{#if ends}<small><span>{ends[0]}</span><span>{ends[1]}</span></small>{/if}
	</label>
{/snippet}

{#snippet heroReading(lab, reading)}
	<div class="hero" class:bad={reading.bad}>
		<span class="label">{lab.hero.label}</span>
		<b>{num(reading.value, lab.hero.digits ?? 0)}<small> {lab.hero.unit}</small></b>
		<i class="meter"><i style:width="{Math.min(100, (Math.max(0, reading.value) / (lab.hero.max || 1)) * 100)}%"></i></i>
		<span class="state">{reading.state}</span>
		<small>{reading.sub}</small>
	</div>
{/snippet}

<!-- `always`: an empty note keeps its line -->
{#snippet longNote(text, more, toggle, always = false)}
	{#if text.length > 160}
		<button class="note" class:more title={more ? 'Show less' : 'Show all of it'} onclick={toggle}>{text}</button>
	{:else if text || always}
		<small>{text}</small>
	{/if}
{/snippet}

{#snippet scaleBar(scale)}
	<span class="scale"><i style:width="{scale[0]}px"></i>{scale[1]}</span>
{/snippet}

{#snippet tagLines(tags)}
	<svg class="tags" aria-hidden="true">
		{#each tags as t, i (i)}
			{@const left = t.side === 'left'}
			<g opacity={t.on}>
				<polyline points="{t.x},{t.y} {t.lx + (left ? 16 : -16)},{t.ly} {t.lx},{t.ly}" />
				<circle cx={t.x} cy={t.y} r="2.6" />
				<text x={t.lx + (left ? -5 : 5)} y={t.ly - 2} text-anchor={left ? 'end' : 'start'} class="name">{t.text}</text>
				{#if t.value}<text x={t.lx + (left ? -5 : 5)} y={t.ly + 12} text-anchor={left ? 'end' : 'start'} class="value">{t.value}</text>{/if}
			</g>
		{/each}
	</svg>
{/snippet}

<style>
	.param {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.4rem;
		align-items: center;
	}

	.param input {
		min-width: 0;
		font: inherit;
		padding: 0.2rem 0.4rem;
	}

	.slider {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.15rem 0.5rem;
		align-items: baseline;
	}

	.slider input {
		grid-column: 1 / -1;
		width: 100%;
		accent-color: #ff7a1a;
	}

	.slider output {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.slider small {
		grid-column: 1 / -1;
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		opacity: 0.55;
	}

	.how summary {
		cursor: pointer;
	}

	.how p {
		margin: 0.35rem 0;
		font-size: 0.78rem;
		line-height: 1.45;
		opacity: 0.8;
	}

	.how code {
		display: block;
		font-size: 0.72rem;
		padding: 0.12rem 0;
		white-space: pre-wrap;
		opacity: 0.85;
	}

	.hero {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding-bottom: 0.5rem;
		margin-bottom: 0.3rem;
		border-bottom: 1px solid rgb(0 0 0 / 0.08);
	}

	.hero b {
		font-size: 2rem;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
	}

	.hero b small {
		font-size: 0.9rem;
		font-weight: 500;
		opacity: 0.6;
	}

	.hero .meter {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: rgb(0 0 0 / 0.08);
		overflow: hidden;
	}

	.hero .meter i {
		display: block;
		height: 100%;
		background: #ff7a1a;
		transition: width 0.12s linear;
	}

	.hero .state {
		font-weight: 600;
	}

	.hero.bad .state,
	.hero.bad b {
		color: #b3261e;
	}

	.hero.bad .meter i {
		background: #b3261e;
	}

	.hero small {
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}

	button.note {
		all: unset;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
		font-size: 0.78rem;
		line-height: 1.45;
		opacity: 0.7;
		cursor: pointer;
	}

	button.note.more {
		display: block;
	}

	.scale {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		opacity: 0.7;
	}

	.scale i {
		display: block;
		height: 6px;
		border: 1.5px solid currentColor;
		border-top: 0;
	}

	.tags {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}

	.tags polyline {
		fill: none;
		stroke: #1f2a23;
		stroke-width: 1;
		opacity: 0.7;
	}

	.tags circle {
		fill: #ff7a1a;
		stroke: #fff;
		stroke-width: 1.2;
	}

	.tags text {
		font-size: 12px;
		fill: #1f2a23;
		paint-order: stroke;
		stroke: rgb(243 242 238 / 0.9);
		stroke-width: 3px;
	}

	.tags .name {
		font-weight: 600;
	}

	.tags .value {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}
</style>
