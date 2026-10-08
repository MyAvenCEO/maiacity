<!--
	avenCITY Sandbox 6 — one hex at its real size: the living hex (eight Dome50 homes of 12, five Dome100 homes of 36, two
	Dome150 tropical food forests and a Dome150 of utilities) and the tower hex next to it (Tower250 or Tower200, the
	village's one factory building and utilities center, with eight Dome100 factories round it and the fields, woods
	and pits that feed them). Every overlay on the world and every panel of numbers can be switched on and off; a
	click on a building opens its card. The numbers: ./specs.js, ./layout.js, ./stats.js.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WorldBar } from '$lib/sandbox-kit';
	import { LIVING, TOWER_HEXES, USES, landOf } from './layout.js';
	import { hexStats, siteCard } from './stats.js';
	import { ENERGY, NORTH, PRICES, SOURCES, TOWERS } from './specs.js';
	import { FLOOR_COLOURS } from './scene.js';

	/** @type {HTMLDivElement | undefined} */
	let stage = $state();
	/** @type {HTMLDivElement | undefined} */
	let labelLayer = $state();
	/** @type {ReturnType<typeof import('./world.js').mountWorld> | null} */
	let world = null;
	let loading = $state('Laying out the hexes');

	/** which hex the numbers are about, and which tower stands in the tower hex */
	let hex = $state(/** @type {'living' | 'tower'} */ ('living'));
	let tower = $state('t250');
	const plan = $derived(hex === 'living' ? LIVING : TOWER_HEXES[tower]);
	// the land is counted once a plan
	/** @type {Map<string, any>} */
	const statsCache = new Map();
	const stats = $derived.by(() => {
		const k = hex === 'living' ? 'living' : tower;
		if (!statsCache.has(k)) statsCache.set(k, hexStats(plan, landOf(plan)));
		return statsCache.get(k);
	});

	/** the overlays on the world */
	const OVERLAYS = [
		{ id: 'landuse', label: 'Land use' },
		{ id: 'labels', label: 'Labels' },
		{ id: 'dims', label: 'Dimensions' },
		{ id: 'shell', label: 'Glass & hemp shells' },
		{ id: 'inside', label: 'Inside' },
		{ id: 'plants', label: 'Plants' },
		{ id: 'outline', label: 'Hex lines' }
	];
	let overlay = $state(/** @type {Record<string, boolean>} */ ({ landuse: false, labels: true, dims: false, shell: true, inside: true, plants: true, outline: true }));
	/** the panels of numbers */
	const PANELS = [
		{ id: 'land', label: 'Land' },
		{ id: 'buildings', label: 'Buildings' },
		{ id: 'cost', label: 'Materials & cost' },
		{ id: 'people', label: 'People' },
		{ id: 'food', label: 'Food' },
		{ id: 'energy', label: 'Energy' },
		{ id: 'floors', label: 'Tower floors', tower: true },
		{ id: 'raw', label: 'Raw materials', tower: true },
		{ id: 'sources', label: 'Sources' }
	];
	let panel = $state(/** @type {Record<string, boolean>} */ ({ land: true, buildings: false, cost: true, people: false, food: false, energy: false, floors: true, raw: false, sources: false }));
	const panels = $derived(PANELS.filter((p) => !p.tower || hex === 'tower'));

	/** the building picked, and its card */
	let picked = $state(/** @type {{ id: string, hex: string } | null} */ (null));
	const card = $derived(picked ? siteCard(picked.hex === 'living' ? LIVING : TOWER_HEXES[tower], picked.id) : null);

	let narrow = $state(false);
	let sheetOpen = $state(false);

	// ── numbers on the page ──
	const n0 = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US');
	const n1 = (/** @type {number} */ n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
	const ha = (/** @type {number} */ n) => (n >= 10 ? n1(n) : (Math.round(n * 100) / 100).toFixed(2));
	const eur = (/** @type {number} */ e) => (Math.abs(e) >= 1e6 ? `${n1(e / 1e6)} M€` : Math.abs(e) >= 1e3 ? `${n0(e / 1e3)} k€` : `${n0(e)} €`);
	const gwh = (/** @type {number} */ kwh) => (Math.abs(kwh) >= 1e6 ? `${(kwh / 1e6).toFixed(2)} GWh` : `${n0(kwh / 1e3)} MWh`);
	const tonnes = (/** @type {number} */ t) => (t >= 100 ? n0(t) : n1(t));

	/** the land by group, for the bar and the summary */
	const groups = $derived.by(() => {
		/** @type {Map<string, { label: string, ha: number, pct: number, color: string }>} */
		const g = new Map();
		for (const u of stats.uses) {
			const key = u.group;
			const row = g.get(key) ?? { label: key, ha: 0, pct: 0, color: u.map };
			row.ha += u.ha;
			row.pct += u.pct;
			g.set(key, row);
		}
		return [...g.values()];
	});
	const sum = (/** @type {string[]} */ ids) => stats.uses.filter((/** @type {any} */ u) => ids.includes(u.id)).reduce((/** @type {number} */ a, /** @type {any} */ u) => a + u.pct, 0);

	function setOverlay(/** @type {string} */ id) {
		overlay[id] = !overlay[id];
		world?.set(id, overlay[id]);
	}
	function setHex(/** @type {'living' | 'tower'} */ h) {
		hex = h;
		picked = null;
		world?.pick(null, null);
		world?.focus(h);
	}
	function setTower(/** @type {string} */ id) {
		tower = id;
		picked = null;
		world?.setTower(id);
	}

	onMount(() => {
		const mq = matchMedia('(max-width: 720px), (max-height: 500px)');
		const fit = () => (narrow = mq.matches);
		fit();
		mq.addEventListener('change', fit);
		import('./world.js').then(({ mountWorld }) => {
			if (!stage || !labelLayer) return;
			world = mountWorld(stage, labelLayer, {
				onPick: (id, h) => {
					picked = id && h ? { id, hex: h } : null;
					if (h) hex = h === 'living' ? 'living' : 'tower';
				},
				onProgress: (l) => (loading = l)
			});
			for (const [k, on] of Object.entries(overlay)) world.set(k, on);
			loading = '';
		});
		return () => mq.removeEventListener('change', fit);
	});
	onDestroy(() => world?.dispose());
</script>

{#snippet toggles()}
	<div class="group">
		<p class="head">Hex</p>
		<div class="seg">
			<button class:on={hex === 'living'} onclick={() => setHex('living')}>Living hex</button>
			<button class:on={hex === 'tower'} onclick={() => setHex('tower')}>Tower hex</button>
		</div>
		{#if hex === 'tower'}
			<div class="seg">
				{#each Object.values(TOWERS) as T (T.id)}
					<button class:on={tower === T.id} onclick={() => setTower(T.id)}>{T.label}</button>
				{/each}
			</div>
		{/if}
	</div>
	<div class="group">
		<p class="head">On the world</p>
		<div class="chips">
			{#each OVERLAYS as o (o.id)}
				<button class:on={overlay[o.id]} onclick={() => setOverlay(o.id)}>{o.label}</button>
			{/each}
		</div>
	</div>
	<div class="group">
		<p class="head">Numbers</p>
		<div class="chips">
			{#each panels as p (p.id)}
				<button class:on={panel[p.id]} onclick={() => (panel[p.id] = !panel[p.id])}>{p.label}</button>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet bar(/** @type {{ pct: number, color: string, label: string }[]} */ rows)}
	<div class="bar">
		{#each rows as r (r.label)}<span style:width="{r.pct}%" style:background={r.color} title="{r.label}: {n1(r.pct)}%"></span>{/each}
	</div>
{/snippet}

{#snippet panelsView()}
	{#if card && picked}
		<section class="panel card">
			<button class="x" aria-label="Close" onclick={() => { picked = null; world?.pick(null, null); }}>×</button>
			<h2>{card.title}</h2>
			<p class="note">{card.note}</p>
			<dl>
				{#each card.facts as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
			</dl>
			<h3>{card.kind === 'tower250' ? 'Floors' : 'Its floor'}</h3>
			<table>
				<tbody>
					{#each card.zones.filter((/** @type {any} */ z) => z.m2 > 0) as z, k (k)}
						<tr>
							<td><i style:background={card.kind === 'tower250' ? FLOOR_COLOURS[/** @type {keyof typeof FLOOR_COLOURS} */ (z.use)] : USES[z.use]?.map}></i>{z.label}{#if z.note}<small>{z.note}</small>{/if}</td>
							<td class="num">{n0(z.m2)} m²</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<h3>Its shell</h3>
			<table>
				<tbody>
					<tr><td>Glulam struts and cassettes</td><td class="num">{n0(card.shell.m.timber)} m³ · {tonnes(card.shell.t.timber)} t</td></tr>
					<tr><td>Steel hubs, ring, connectors</td><td class="num">{tonnes(card.shell.t.steel)} t</td></tr>
					<tr><td>Laminated double glazing</td><td class="num">{n0(card.shell.m.glass)} m² · {tonnes(card.shell.t.glass)} t</td></tr>
					<tr><td>Hemp fibre, north third</td><td class="num">{n0(card.shell.m.hemp)} m³ · {tonnes(card.shell.t.hemp)} t</td></tr>
					<tr><td>Lime footing</td><td class="num">{n0(card.shell.m.lime)} m³ · {tonnes(card.shell.t.lime)} t</td></tr>
					<tr class="total"><td>Shell materials at today’s prices</td><td class="num">{eur(card.eur)}</td></tr>
				</tbody>
			</table>
			<button class="link" onclick={() => picked && world?.focusSite(picked.id, picked.hex)}>Fly to it</button>
		</section>
	{/if}

	{#if panel.land}
		<section class="panel">
			<h2>Land <span class="sub">{n1(stats.hexHa)} ha, 666 m across</span></h2>
			{@render bar(groups)}
			<ul class="keys">
				{#each groups as g (g.label)}<li><i style:background={g.color}></i>{g.label} <b>{n1(g.pct)}%</b></li>{/each}
			</ul>
			<table>
				<thead><tr><th>Under glass ({ha(stats.glassHa)} ha, {n1((100 * stats.glassHa) / stats.hexHa)}%)</th><th class="num">ha</th><th class="num">%</th></tr></thead>
				<tbody>
					{#each stats.uses.filter((/** @type {any} */ u) => u.inside) as u (u.id)}
						<tr><td><i style:background={u.map}></i>{u.label}</td><td class="num">{ha(u.ha)}</td><td class="num">{n1(u.pct)}</td></tr>
					{/each}
				</tbody>
				<thead><tr><th>Outdoors</th><th></th><th></th></tr></thead>
				<tbody>
					{#each stats.uses.filter((/** @type {any} */ u) => !u.inside) as u (u.id)}
						<tr><td><i style:background={u.map}></i>{u.label}</td><td class="num">{ha(u.ha)}</td><td class="num">{n1(u.pct)}</td></tr>
					{/each}
				</tbody>
			</table>
			{#if hex === 'living'}
				<p class="small">Food forest under glass {n1(sum(['indoorFood', 'tropical']))}% · outdoors {n1(sum(['foodForest']))}% · commercial growing {n1(sum(['commercial']))}% · homes {n1(sum(['living']))}% of the land ({n0(stats.buildings.reduce((/** @type {number} */ a, /** @type {any} */ b) => a + (b.gfa ?? 0) * b.count, 0))} m² of floor on two storeys) · nature {n1(sum(['nature']))}%.</p>
			{:else}
				<p class="small">Raw-material fields and woods {n1(sum(['hemp', 'bamboo', 'woodland']))}% · open pits {n1(sum(['mine']))}% (no domes over them: only the works are under glass) · nature {n1(sum(['nature']))}%.</p>
			{/if}
			<p class="tip">Turn on “Land use” to paint these colours on the ground.</p>
		</section>
	{/if}

	{#if panel.buildings}
		<section class="panel">
			<h2>Buildings</h2>
			<table>
				<thead><tr><th></th><th class="num">Ø m</th><th class="num">high</th><th class="num">floor m²</th><th class="num">shell m²</th></tr></thead>
				<tbody>
					{#each stats.buildings as b (b.kind)}
						<tr><td>{b.count} × {b.label}{#if b.people}<small>{b.people} people each</small>{/if}</td><td class="num">{b.D}</td><td class="num">{n1(b.h)}</td><td class="num">{n0(b.floor)}</td><td class="num">{n0(b.shell)}</td></tr>
					{/each}
				</tbody>
			</table>
			<p class="small">Every dome is a geodesic cap a third as high as it is wide (the 150 m dome’s 50 m), struts about 6 m long. Its north third ({n0(NORTH * 100)}% of the shell, north-west to north-east) is closed with solid hemp-fibre triangles in timber cassettes, the rest is laminated glass with see-through solar cells.</p>
		</section>
	{/if}

	{#if panel.cost}
		<section class="panel">
			<h2>Materials & cost</h2>
			<table>
				<thead><tr><th></th><th class="num">amount</th><th class="num">t</th><th class="num">cost</th></tr></thead>
				<tbody>
					{#each stats.materials as m (m.id)}
						<tr><td>{m.label}<small>{m.price.eur.toLocaleString('en-US')} €/{m.price.unit} ({m.price.range})</small></td><td class="num">{n0(m.qty)} {m.unit}</td><td class="num">{m.t ? tonnes(m.t) : ''}</td><td class="num">{eur(m.eur)}</td></tr>
					{/each}
					<tr class="total"><td>All materials</td><td></td><td class="num">{n0(stats.materials.reduce((/** @type {number} */ a, /** @type {any} */ m) => a + m.t, 0))}</td><td class="num">{eur(stats.materials.reduce((/** @type {number} */ a, /** @type {any} */ m) => a + m.eur, 0))}</td></tr>
				</tbody>
			</table>
			<h3>What the hex costs</h3>
			<table>
				<tbody>
					{#each stats.cost as c (c.label)}<tr><td>{c.label}</td><td class="num">{eur(c.eur)}</td></tr>{/each}
					<tr class="total"><td>All told</td><td class="num">{eur(stats.total)}</td></tr>
					{#if hex === 'living'}<tr><td>A resident’s share</td><td class="num">{eur(stats.total / stats.residents)}</td></tr>{/if}
				</tbody>
			</table>
			<details>
				<summary>The machines</summary>
				<ul class="plain">{#each stats.equipment as e (e.label)}<li>{e.label}: <b>{eur(e.eur)}</b> <small>{e.note}</small></li>{/each}</ul>
			</details>
		</section>
	{/if}

	{#if panel.people}
		<section class="panel">
			<h2>People</h2>
			<table>
				<tbody>
					{#each stats.people as p (p.label)}<tr><td>{p.label}<small>{p.note}</small></td><td class="num">{n0(p.n)}</td></tr>{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if panel.food}
		<section class="panel">
			<h2>Food <span class="sub">a year</span></h2>
			<table>
				<tbody>
					{#each stats.food.rows as r (r.label)}<tr><td>{r.label}</td><td class="num">{ha(r.ha)} ha</td><td class="num">{n0(r.t)} t</td></tr>{/each}
					<tr class="total"><td>Grown here</td><td></td><td class="num">{n0(stats.food.grown)} t</td></tr>
					<tr><td>Eaten by {n0(stats.food.eaters)} people (508 kg each)</td><td></td><td class="num">{n0(stats.food.need)} t</td></tr>
				</tbody>
			</table>
			<p class="small">{stats.food.grown >= stats.food.need ? `The hex grows ${n0((100 * stats.food.grown) / stats.food.need)}% of what its people eat: ${n0(stats.food.grown - stats.food.need)} t a year to sell or to feed the tower hex.` : `The hex grows ${n0((100 * stats.food.grown) / stats.food.need)}% of what its people eat; the living hexes round it grow the rest.`} Fresh weight; yields are mid-range values from the sources.</p>
		</section>
	{/if}

	{#if panel.energy}
		<section class="panel">
			<h2>Energy <span class="sub">a year</span></h2>
			<table>
				<thead><tr><th>Makes</th><th></th></tr></thead>
				<tbody>{#each stats.energy.makes as m (m.label)}<tr><td>{m.label}</td><td class="num">{gwh(m.kwh)}</td></tr>{/each}</tbody>
				<thead><tr><th>Uses</th><th></th></tr></thead>
				<tbody>
					{#each stats.energy.uses as m (m.label)}<tr><td>{m.label}</td><td class="num">{gwh(m.kwh)}</td></tr>{/each}
					<tr class="total"><td>{stats.energy.net >= 0 ? 'Left to sell' : 'To buy'} (at {ENERGY.eurMWh} €/MWh: {eur((Math.abs(stats.energy.net) / 1000) * ENERGY.eurMWh)})</td><td class="num">{gwh(Math.abs(stats.energy.net))}</td></tr>
				</tbody>
				<thead><tr><th>Heat</th><th></th></tr></thead>
				<tbody>
					<tr><td>The domes need beyond their fish ponds</td><td class="num">{gwh(stats.energy.heat)}</td></tr>
					{#each stats.energy.heatFrom as m (m.label)}<tr><td>{m.label}</td><td class="num">{gwh(m.kwh)}</td></tr>{/each}
				</tbody>
			</table>
		</section>
	{/if}

	{#if hex === 'tower' && panel.floors}
		{@const floors = stats.floors}
		{@const T = TOWERS[tower]}
		<section class="panel">
			<h2>{T.label} floors <span class="sub">{T.D} m across, {T.H} m high</span></h2>
			<svg class="section" viewBox="{-T.D / 2 - 6} {-T.H - 6} {T.D + 12} {T.H + 18}" role="img" aria-label="A section through the tower">
				<path d={`M ${-T.D / 2} 0 ` + Array.from({ length: 41 }, (_, k) => { const y = (k / 40) * T.H; return `L ${-Math.max(0.1, radiusAt(T, y))} ${-y}`; }).join(' ') + Array.from({ length: 41 }, (_, k) => { const y = T.H - (k / 40) * T.H; return ` L ${Math.max(0.1, radiusAt(T, y))} ${-y}`; }).join('') + ' Z'} class="glass" />
				{#each floors as f (f.id)}
					{#if f.id === 'factory' || f.id === 'base'}
						<rect x={-(f.id === 'base' ? (f.r ?? 60) : T.D / 2 - 2)} y={-(f.y + f.h)} width={2 * (f.id === 'base' ? (f.r ?? 60) : T.D / 2 - 2)} height={f.h} fill={FLOOR_COLOURS[/** @type {keyof typeof FLOOR_COLOURS} */ (f.use)]} />
					{:else if f.id === 'deck'}
						<rect x={-T.D / 2 + 4} y={-12.8} width={T.D - 8} height={1.6} fill={FLOOR_COLOURS.park} />
					{:else}
						<rect x={-T.stack} y={-(f.y + f.n * f.h)} width={2 * T.stack} height={f.n * f.h} fill={FLOOR_COLOURS[/** @type {keyof typeof FLOOR_COLOURS} */ (f.use)]} opacity="0.85" />
					{/if}
				{/each}
				<line x1={-T.D / 2 - 6} x2={T.D / 2 + 6} y1="0" y2="0" class="ground" />
			</svg>
			<table>
				<tbody>
					{#each floors as f (f.id)}
						<tr><td><i style:background={FLOOR_COLOURS[/** @type {keyof typeof FLOOR_COLOURS} */ (f.use)]}></i>{f.label}<small>{f.y < 0 ? 'below ground' : f.h ? `${f.y}–${f.y + f.n * f.h} m` : `at ${f.y} m`}{f.n > 1 ? ` · ${f.n} floors` : ''} · {f.note}</small></td><td class="num">{n0(f.m2)} m²</td></tr>
					{/each}
					<tr class="total"><td>All floors</td><td class="num">{n0(floors.reduce((/** @type {number} */ a, /** @type {any} */ f) => a + f.m2, 0))} m²</td></tr>
				</tbody>
			</table>
			<p class="small">The floors stack round a 9 m core, {T.stack} m out at most; between the garden deck and the glass the shoulder is one great winter garden. A building this size could hold more floors in its shoulder, but they would be far from daylight.</p>
		</section>
	{/if}

	{#if hex === 'tower' && panel.raw}
		<section class="panel">
			<h2>Raw materials <span class="sub">from the hex, a year</span></h2>
			<table>
				<tbody>
					{#each stats.raw as r (r.id)}<tr><td>{r.label}<small>{r.note}</small></td><td class="num">{ha(r.ha)} ha</td><td class="num">{r.per ? `${n0(r.yearly)} ${r.unit}` : ''}</td></tr>{/each}
				</tbody>
			</table>
			<h3>The eight factory domes</h3>
			<ul class="plain">
				{#each plan.sites.filter((s) => s.kind === 'factory100') as s (s.id)}
					{@const run = stats.factoryRun[s.factory ?? '']}
					<li><b>{s.name}</b>: {run.t.toLocaleString('en-US')} {run.unit} a year <small>{run.note}</small></li>
				{/each}
			</ul>
			<p class="small">The hex’s own fields give a part of what the works use; the rest comes from the farms and forests round the village.</p>
		</section>
	{/if}

	{#if panel.sources}
		<section class="panel">
			<h2>Sources & assumptions</h2>
			<ul class="plain">
				{#each Object.values(SOURCES) as s (s.label)}<li><b>{#if s.url}<a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>{:else}{s.label}{/if}</b>: {s.note}</li>{/each}
			</ul>
			<h3>Prices used</h3>
			<ul class="plain">
				{#each Object.values(PRICES) as p (p.label)}<li>{p.label}: <b>{p.eur.toLocaleString('en-US')} €/{p.unit}</b> <small>({p.range})</small></li>{/each}
			</ul>
		</section>
	{/if}
{/snippet}

<script module>
	import { towerRadius } from './specs.js';
	/** the tower's radius at a height, for the section */
	const radiusAt = (/** @type {import('./specs.js').Tower} */ T, /** @type {number} */ y) => towerRadius(T, y);
</script>

<div class="hexplan">
	<div class="stage" bind:this={stage}></div>
	<div class="labels" bind:this={labelLayer}></div>
	<WorldBar title="avenCITY #S6" subtitle="One hex at its real size" clock={{ day: 'A day in June', hour: '11:30', about: 'On Auto the sky stands at late morning; Manual sets the hour' }} />

	{#if loading}<div class="loading">{loading}…</div>{/if}

	{#if !narrow}
		<aside class="left panel">{@render toggles()}</aside>
		<aside class="right">{@render panelsView()}</aside>
	{:else}
		<button class="fab" onclick={() => (sheetOpen = !sheetOpen)} aria-label="Hex, overlays and numbers">{sheetOpen ? '×' : '☰'}</button>
		{#if sheetOpen || picked}
			<div class="sheet">
				{#if sheetOpen}<div class="panel">{@render toggles()}</div>{/if}
				{@render panelsView()}
			</div>
		{/if}
	{/if}
	<TouchStick move={(x, y, hurry) => world?.move(x, y, hurry)} {stage} taps=".panel button, .fab, .lbl" />
</div>

<style>
	.hexplan {
		position: fixed;
		inset: 0;
		background: #2d5a6a;
		color: #1f2a23;
		font-size: 0.8rem;
	}
	.stage {
		position: absolute;
		inset: 0;
	}
	.labels {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}
	.labels :global(.lbl) {
		position: absolute;
		left: 0;
		top: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.2rem 0.5rem;
		border-radius: 10px;
		background: rgb(250 248 242 / 0.82);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
		font-size: 0.68rem;
		line-height: 1.2;
		white-space: nowrap;
		pointer-events: auto;
		cursor: pointer;
	}
	.labels :global(.lbl span),
	.labels :global(.lbl em) {
		opacity: 0.7;
		font-style: normal;
	}
	.labels :global(.lbl.on) {
		background: #24452f;
		color: #f4f1e8;
	}
	.panel {
		background: rgb(250 248 242 / 0.9);
		border: 1px solid rgb(255 255 255 / 0.5);
		-webkit-backdrop-filter: blur(14px) saturate(1.2);
		backdrop-filter: blur(14px) saturate(1.2);
		box-shadow: 0 4px 18px rgb(0 0 0 / 0.12);
		border-radius: 16px;
		padding: 0.7rem 0.8rem;
	}
	button {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.left {
		position: absolute;
		z-index: 2;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: calc(1rem + env(safe-area-inset-left, 0px));
		width: 15rem;
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
	}
	.right {
		position: absolute;
		z-index: 2;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		right: calc(1rem + env(safe-area-inset-right, 0px));
		width: 24rem;
		max-height: calc(100vh - 7rem - var(--nav-room, 4rem));
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 0.5rem;
	}
	.group + .group {
		margin-top: 0.7rem;
	}
	.head {
		margin: 0 0 0.35rem;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		opacity: 0.6;
	}
	.seg {
		display: flex;
		gap: 0.2rem;
		padding: 0.2rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.07);
	}
	.seg + .seg {
		margin-top: 0.35rem;
	}
	.seg button {
		flex: 1;
		padding: 0.35rem 0.5rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
	}
	.seg button.on,
	.chips button.on {
		background: #24452f;
		color: #f4f1e8;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.chips button {
		padding: 0.3rem 0.6rem;
		border: 1px solid rgb(31 42 35 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.6);
		font-size: 0.72rem;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
	}
	h3 {
		margin: 0.7rem 0 0.25rem;
		font-size: 0.85rem;
	}
	.sub {
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 0.72rem;
		opacity: 0.65;
	}
	.note,
	.small {
		margin: 0.3rem 0;
		font-size: 0.72rem;
		opacity: 0.8;
		line-height: 1.35;
	}
	.tip {
		margin: 0.3rem 0 0;
		font-size: 0.68rem;
		opacity: 0.55;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.72rem;
	}
	th {
		text-align: left;
		font-weight: 600;
		padding: 0.4rem 0 0.15rem;
	}
	td {
		padding: 0.18rem 0;
		vertical-align: top;
		border-top: 1px solid rgb(31 42 35 / 0.06);
	}
	td small,
	li small {
		display: block;
		opacity: 0.6;
		font-size: 0.64rem;
		line-height: 1.3;
	}
	.num {
		text-align: right;
		white-space: nowrap;
		padding-left: 0.5rem;
		font-variant-numeric: tabular-nums;
	}
	tr.total td {
		font-weight: 650;
		border-top: 1px solid rgb(31 42 35 / 0.25);
	}
	i {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		margin-right: 0.35rem;
		border-radius: 3px;
		vertical-align: -0.05rem;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
	}
	.bar {
		display: flex;
		height: 0.8rem;
		border-radius: 999px;
		overflow: hidden;
		margin: 0.2rem 0 0.4rem;
	}
	.bar span {
		height: 100%;
	}
	.keys {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.7rem;
		margin: 0 0 0.3rem;
		padding: 0;
		list-style: none;
		font-size: 0.7rem;
	}
	.plain {
		margin: 0.2rem 0;
		padding-left: 1rem;
		font-size: 0.72rem;
		line-height: 1.35;
	}
	.plain li + li {
		margin-top: 0.3rem;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 0.6rem;
		margin: 0.3rem 0;
		font-size: 0.72rem;
	}
	dt {
		opacity: 0.6;
	}
	dd {
		margin: 0;
	}
	.card {
		position: relative;
	}
	.x {
		position: absolute;
		top: 0.4rem;
		right: 0.5rem;
		border: 0;
		background: none;
		font-size: 1.2rem;
		opacity: 0.6;
	}
	.link {
		margin-top: 0.5rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.6);
		font-size: 0.72rem;
	}
	details {
		margin-top: 0.5rem;
		font-size: 0.72rem;
	}
	.section {
		width: 100%;
		max-height: 15rem;
		margin: 0.2rem 0 0.4rem;
	}
	.section .glass {
		fill: rgb(170 214 226 / 0.35);
		stroke: #6b5236;
		stroke-width: 0.8;
	}
	.section .ground {
		stroke: #6b5236;
		stroke-width: 1.2;
	}
	.loading {
		position: absolute;
		z-index: 3;
		left: 50%;
		top: 45%;
		transform: translate(-50%, -50%);
		padding: 0.6rem 1rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.9);
	}
	.fab {
		position: absolute;
		z-index: 4;
		left: calc(1rem + env(safe-area-inset-left, 0px));
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px) + var(--nav-room, 3.5rem));
		width: 3rem;
		height: 3rem;
		border: 0;
		border-radius: 999px;
		background: #24452f;
		color: #f4f1e8;
		font-size: 1.2rem;
		box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
	}
	/* upright: the panels in a sheet up from the foot, at most half the screen */
	.sheet {
		position: absolute;
		z-index: 3;
		left: 0;
		right: 0;
		bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px) + var(--nav-room, 3.5rem));
		max-height: 50vh;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0 0.6rem;
	}
	/* on its side: a slide-in aside on the right, the button on the lower left */
	@media (max-height: 500px) {
		.sheet {
			left: auto;
			top: calc(3.6rem + env(safe-area-inset-top, 0px));
			bottom: 0;
			width: min(24rem, 55vw);
			max-height: none;
			padding: 0 calc(0.6rem + env(safe-area-inset-right, 0px)) 0.6rem 0.6rem;
		}
		.fab {
			bottom: calc(0.8rem + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
