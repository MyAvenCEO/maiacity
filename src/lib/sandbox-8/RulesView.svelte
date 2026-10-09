<!--
	The Policies and World views: every number the valley runs on, in plain words, each one adjustable. Policies are
	what people choose (HEARTS, prices, trading); World is how the valley works (needs, bodies, rot, land, harvests,
	weather), plus every resource and every recipe the night runs, as sentences and as the JSON itself.
-->
<script>
	import { PARAMS, RULES, DEFAULTS, CONFIG, setRule, resetRules, changedRules } from './rules.js';
	import { RESOURCES, RECIPES } from './recipes.js';
	import { GOOD_LABEL } from './rules.js';

	/** @type {{ view: 'policy' | 'world', onrestart: () => void, onchange: () => void, onpropose: () => void }} */
	let { view, onrestart, onchange, onpropose } = $props();

	let vals = $state({ ...RULES });
	let showJson = $state(false);

	const params = $derived(PARAMS.filter((p) => p.view === view));
	const sections = $derived([...new Set(params.map((p) => p.section))]);
	const changed = $derived(Object.keys(vals).filter((k) => vals[k] !== DEFAULTS[k] && PARAMS.find((p) => p.key === k)?.view === view));
	const waiting = $derived(changed.filter((k) => PARAMS.find((p) => p.key === k)?.reset));
	// the resource and recipe lists, rebuilt whenever a value changes
	const resources = $derived.by(() => {
		void vals;
		return RESOURCES();
	});
	const recipes = $derived.by(() => {
		void vals;
		return RECIPES();
	});

	/** @param {string} key @param {string} raw */
	function set(key, raw) {
		setRule(key, Number(raw));
		vals = { ...RULES };
		onchange();
	}
	function defaults() {
		resetRules();
		vals = { ...RULES };
		onchange();
	}

	const name = (/** @type {string} */ id) => GOOD_LABEL[id] ?? id.replace('_', ' ');
	const list = (/** @type {Record<string, any>} */ o) =>
		Object.entries(o)
			.map(([k, v]) => `${Array.isArray(v) ? `${v[0]}–${v[1]}` : v === 'capacity' ? "the land's capacity of" : v} ${name(k)}`)
			.join(', ');
	/** a recipe in plain words @param {any} r */
	function say(r) {
		const who = r.by === 'aven' ? 'each living aven' : r.id === 'rain' ? 'every land' : 'every land that grows it';
		const when = r.chance != null ? `${Math.round(r.chance * 100)}% of nights` : 'every night';
		const takes = Object.keys(r.in).length ? `takes ${list(r.in)}` : 'takes nothing';
		const stage = r.stage ? `, ${r.stage.name} for ${r.stage.nights} night${r.stage.nights === 1 ? '' : 's'},` : '';
		const makes = Object.entries(r.out)
			.map(([k, v]) => (typeof v === 'number' && k.endsWith('reserve') ? `+${v} ${name(k)}` : list({ [k]: v })))
			.join(', ');
		const short = r.short ? `; for every unit missing: ${Object.entries(r.short).map(([k, v]) => `${v} ${name(k)}`).join(', ')}` : '';
		const vary = r.vary ? ` A normal night gives ×${r.vary.normal[0]}–${r.vary.normal[1]}; ${Math.round(r.vary.bad.chance * 100)}% of nights ×${r.vary.bad.of.join('–')}, ${Math.round(r.vary.rich.chance * 100)}% ×${r.vary.rich.of.join('–')}${r.vary.dry_spell ? `; in a dry spell ×${r.vary.dry_spell.of.map((/** @type {number} */ x) => Math.round(x * 100) / 100).join('–')}` : ''}.` : '';
		return `${when[0].toUpperCase()}${when.slice(1)}, ${who} ${takes}${stage} and makes ${makes}${short}.${vary}`;
	}
</script>

<div class="rules">
	<header class="top">
		<div>
			<h2>{view === 'policy' ? 'Policies' : 'World rules'}</h2>
			<p>{view === 'policy' ? 'What the valley chooses: how HEARTS are made and melt, how free prices are, how trading works.' : 'How the valley works: what bodies need, what rots, how land is shared out, harvests and weather. Below: every resource and every recipe the night runs.'} The values are the config's, <b>{CONFIG.name}</b>{CONFIG.id ? ` (version ${CONFIG.version})` : ''}; your changes stay in this browser and apply at once, and the ones marked <span class="tag">on Reset</span> shape the valley itself and wait for a new one. To change the config itself, propose your changes as a MIP.</p>
		</div>
		<div class="actions">
			<button onclick={defaults} disabled={!Object.keys(changedRules()).length && !changed.length}>Back to the config</button>
			<button onclick={onpropose} disabled={!Object.keys(changedRules()).length && !changed.length}>Propose as a MIP</button>
			<button class="go" onclick={onrestart}>Propose a new world with these{waiting.length ? ` (${waiting.length} waiting)` : ''}</button>
		</div>
	</header>

	{#each sections as sec (sec)}
		<section>
			<h3>{sec}</h3>
			{#each params.filter((p) => p.section === sec) as p (p.key)}
				<div class="param" class:changed={vals[p.key] !== DEFAULTS[p.key]}>
					<div class="text">
						<b>{p.label}</b>
						{#if p.reset}<span class="tag">on Reset</span>{/if}
						<p>{p.say(vals[p.key])}</p>
					</div>
					<div class="input">
						<input type="range" min={p.min} max={Math.min(p.max, Math.max(p.value * 4, p.min + p.step * 20))} step={p.step} value={vals[p.key]} oninput={(e) => set(p.key, e.currentTarget.value)} aria-label={p.label} />
						<input type="number" min={p.min} max={p.max} step={p.step} value={vals[p.key]} onchange={(e) => set(p.key, e.currentTarget.value)} aria-label="{p.label}, {p.unit}" />
						<span class="unit">{p.unit}</span>
						{#if vals[p.key] !== DEFAULTS[p.key]}<button class="undo" title="Back to {DEFAULTS[p.key]}" onclick={() => set(p.key, String(DEFAULTS[p.key]))}>↺ {DEFAULTS[p.key]}</button>{/if}
					</div>
				</div>
			{/each}
		</section>
	{/each}

	{#if view === 'world'}
		<section>
			<h3>Resources <button class="json" onclick={() => (showJson = !showJson)}>{showJson ? 'Hide JSON' : 'Show as JSON'}</button></h3>
			<p class="sub">Everything is a resource with its own decay rule. Goods sit in an aven's store, HEARTS in its wallet, the two reserves in its body.</p>
			{#if showJson}<pre>{JSON.stringify(resources, null, 2)}</pre>{:else}
				<table>
					<thead><tr><th>Resource</th><th>Held in</th><th>Decay a night</th><th>Bounds</th><th>Rule</th></tr></thead>
					<tbody>
						{#each resources as r (r.id)}<tr><td><b>{r.label}</b></td><td>{r.held}</td><td class="num">{r.decay ? `${Math.round(r.decay * 1e5) / 1e3}%` : '—'}</td><td>{r.max != null ? `${r.min}–${r.max}${r.dies_at != null ? `, dies at ${r.dies_at}` : ''}` : '≥ 0'}</td><td>{r.note}</td></tr>{/each}
					</tbody>
				</table>
			{/if}
		</section>
		<section>
			<h3>Recipes</h3>
			<p class="sub">Every change in the valley is a recipe: inputs in, a stage in between, outputs out, once a night. Trading is the only thing that moves resources between avens.</p>
			{#if showJson}<pre>{JSON.stringify(recipes, null, 2)}</pre>{:else}
				{#each recipes as r (r.id)}
					<div class="recipe">
						<div class="flow">
							<span class="box">{Object.keys(r.in).length ? list(r.in) : '—'}</span>
							<span class="arrow">→{#if r.stage} <i>{r.stage.name} {r.stage.nights} night</i> →{/if}</span>
							<span class="box out">{Object.entries(r.out).map(([k, v]) => (typeof v === 'number' && k.endsWith('reserve') ? `+${v} ${name(k)}` : list({ [k]: v }))).join(', ')}</span>
						</div>
						<b>{r.label}</b> <code>{r.id}</code>
						<p>{say(r)}</p>
					</div>
				{/each}
			{/if}
		</section>
	{/if}
</div>

<style>
	.rules {
		height: 100%;
		overflow-y: auto;
		background: #f4f1e8;
		color: #1f2a23;
		padding: 0.8rem 1rem var(--nav-room, 6rem);
		box-sizing: border-box;
		font-size: 0.85rem;
	}
	.top {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	h2,
	h3 {
		font-family: inherit;
		letter-spacing: normal;
	}
	h2 {
		margin: 0 0 0.2rem;
		font-size: 1.15rem;
	}
	.top p {
		margin: 0;
		max-width: 60rem;
		color: #52514e;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	button {
		font: inherit;
		border: 1px solid #1f2a2333;
		background: #fff;
		border-radius: 8px;
		padding: 0.3rem 0.6rem;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	button.go {
		background: #24452f;
		color: #f4f1e8;
		border-color: #24452f;
	}
	section {
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		padding: 0.6rem 0.9rem;
		margin-top: 0.8rem;
	}
	h3 {
		margin: 0.1rem 0 0.4rem;
		font-size: 0.95rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.param {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.3rem 1rem;
		align-items: center;
		padding: 0.45rem 0;
		border-top: 1px solid #1f2a2312;
	}
	.param:first-of-type {
		border-top: 0;
	}
	.param.changed {
		box-shadow: inset 3px 0 0 #eda100;
		padding-left: 0.6rem;
	}
	.text p {
		margin: 0.1rem 0 0;
		color: #52514e;
	}
	.tag {
		font-size: 0.65rem;
		background: #eda10022;
		color: #8a5a00;
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
		margin-left: 0.3rem;
		white-space: nowrap;
	}
	.input {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	input[type='range'] {
		width: 9rem;
		accent-color: #24452f;
	}
	input[type='number'] {
		width: 6rem;
		font: inherit;
		padding: 0.2rem 0.3rem;
		border: 1px solid #1f2a2333;
		border-radius: 6px;
		text-align: right;
	}
	.unit {
		font-size: 0.7rem;
		color: #6b6a66;
		min-width: 5.5rem;
	}
	.undo {
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
	}
	.json {
		font-size: 0.7rem;
		padding: 0.1rem 0.5rem;
	}
	.sub {
		margin: 0 0 0.5rem;
		color: #52514e;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}
	th {
		text-align: left;
		font-weight: 600;
		color: #52514e;
		padding: 0.2rem 0.4rem;
	}
	td {
		padding: 0.25rem 0.4rem;
		border-top: 1px solid #1f2a2312;
	}
	td.num {
		font-variant-numeric: tabular-nums;
	}
	pre {
		background: #1f2a23;
		color: #e8efe9;
		border-radius: 8px;
		padding: 0.7rem;
		font-size: 0.72rem;
		overflow: auto;
		max-height: 32rem;
	}
	.recipe {
		padding: 0.5rem 0;
		border-top: 1px solid #1f2a2312;
	}
	.recipe p {
		margin: 0.15rem 0 0;
		color: #52514e;
	}
	.recipe code {
		font-size: 0.7rem;
		color: #6b6a66;
	}
	.flow {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-bottom: 0.25rem;
	}
	.box {
		background: #f4f1e8;
		border-radius: 6px;
		padding: 0.15rem 0.5rem;
		font-size: 0.75rem;
	}
	.box.out {
		background: #1baf7a1f;
	}
	.arrow {
		color: #6b6a66;
		font-size: 0.75rem;
	}
	@media (max-width: 760px) {
		.rules {
			padding: 0.6rem 0.6rem var(--nav-room, 6rem);
		}
		.param {
			grid-template-columns: 1fr;
		}
		.input {
			justify-content: flex-start;
		}
		input[type='range'] {
			flex: 1;
		}
	}
</style>
