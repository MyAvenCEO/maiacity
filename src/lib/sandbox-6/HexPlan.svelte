<!--
	avenCITY Sandbox 6 — one village at its real size (Samuel, 2026-10-08): the tower hex in the middle (Tower180, the
	village's one factory building and utilities center, with eight Dome120 factories round it and the fields, woods and
	pits that feed them) and six living hexes round it, all alike (Dome40 and Dome80 homes in straight blocks, two Dome120
	food forests under glass and a Dome120 of utilities each), with the sun on every dome (./light.js). The numbers for
	the whole village, the tower hex or a living hex; every overlay on the world and every panel of numbers can be switched on and off; a click
	on a building opens its card. The numbers: ./specs.js, ./layout.js, ./stats.js.

	The build-out (Samuel, 2026-10-13): a month slider with a play button shows the village growing from its first two
	settlers to 1,500 people, dome by dome, as ./buildout.js plans it, in the village without the tower (the centre's
	middle one more Dome120 of utilities and community halls). Closed, the world is the finished village as before.
	?month=18 opens it at a month, &kit=starter with the starter kit, &hex=living-e over a hex.

	The design package (./specs.js DESIGN, 2026-10-13): from package 3 the eight works stand in plain portal-frame halls
	with solar on their south roofs instead of Dome120s; the cards, counts and panels follow it.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WorldBar } from '$lib/sandbox-kit';
	import { LIVING, TOWER_HEX, USES, VILLAGE, landOf } from './layout.js';
	import { hexStats, siteCard, villageStats } from './stats.js';
	import { DAYS, placeAll, sunShares } from './light.js';
	import { DAY, DF, DF_PARTS, DIET, DOME_FACTORY, ENERGY, FACTORIES, GROWN, HALLS, KINDS, LAND_PERSON, NORTH, PRICES, SOURCES, TOWER, worksCompare } from './specs.js';
	import { FLOOR_COLOURS } from './scene.js';
	import { BUILD_SOURCES, EUR_KINDS, KIT_GROUPS, LABOUR, RATES, buildPlan, monthAt, nowLine, phaseAt } from './buildout.js';

	/** @type {HTMLDivElement | undefined} */
	let stage = $state();
	/** @type {HTMLDivElement | undefined} */
	let labelLayer = $state();
	/** @type {ReturnType<typeof import('./world.js').mountWorld> | null} */
	let world = null;
	let loading = $state('Laying out the hexes');

	/** what the numbers are about: the whole village, the tower hex or a living hex */
	let hex = $state(/** @type {'village' | 'tower' | 'living'} */ ('village'));
	/** the living hex the camera last flew to */
	let lastLiving = 'living-e';
	// the land is counted once a plan, the village from the two
	const towerStats = hexStats(TOWER_HEX, landOf(TOWER_HEX));
	const livingStats = hexStats(LIVING, landOf(LIVING));
	const village = villageStats([
		{ key: 'tower', label: 'Tower hex', n: 1, stats: towerStats },
		{ key: 'living', label: 'Living hexes', n: VILLAGE.filter((h) => h.plan === LIVING).length, stats: livingStats }
	]);
	// the sun on every dome, with its neighbours and the tower
	const sun = sunShares(placeAll(VILLAGE));
	/** the eight works in Dome120s against the eight in halls: their solar, heat and climate power a year */
	const works = worksCompare();
	/** @type {any} */
	const stats = $derived(hex === 'village' ? village : hex === 'tower' ? towerStats : livingStats);
	/** the plan a hex of the village has */
	const planOf = (/** @type {string} */ key) => VILLAGE.find((h) => h.key === key)?.plan ?? TOWER_HEX;

	/** the overlays on the world */
	const OVERLAYS = [
		{ id: 'landuse', label: 'Land use' },
		{ id: 'labels', label: 'Labels' },
		{ id: 'dims', label: 'Dimensions' },
		{ id: 'shell', label: HALLS ? 'Shells & hall roofs' : 'Solar glass & hemp shells' },
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
		{ id: 'hexes', label: 'Hexes', village: true },
		{ id: 'floors', label: 'Tower floors', tower: true },
		{ id: 'raw', label: 'Raw materials', tower: true },
		{ id: 'sources', label: 'Sources' },
		{ id: 'buildout', label: 'Build-out', tl: true }
	];
	let panel = $state(/** @type {Record<string, boolean>} */ ({ buildout: true, hexes: true, land: true, buildings: false, cost: true, people: false, food: false, energy: false, floors: true, raw: false, sources: false }));
	const panels = $derived(PANELS.filter((p) => (!p.tower || hex === 'village' || hex === 'tower') && (!p.village || hex === 'village') && (!p.tl || tl)));

	/** the building picked, and its card */
	let picked = $state(/** @type {{ id: string, hex: string } | null} */ (null));
	const card = $derived(picked ? siteCard(planOf(picked.hex), picked.id) : null);
	const cardSun = $derived(picked ? sun.sites[`${picked.hex}/${picked.id}`] : null);

	let narrow = $state(false);
	let sheetOpen = $state(false);

	// ── the build-out timeline ──
	/** open: the village at a month of its build-out; closed: the finished village */
	let tl = $state(false);
	/** the kit: 'auto' (the cheapest that builds the village in six years) or 'starter' */
	let kitId = $state('auto');
	/** the month shown; a fraction runs within the month */
	let month = $state(0);
	let playing = $state(false);
	let worldReady = $state(false);
	/** @type {any} */
	const plan = $derived(tl ? buildPlan({ kit: kitId }) : null);
	/** the slider runs to the six years, or to the month the last dome stands if later */
	const maxMonth = $derived(plan ? Math.max(plan.options.months, plan.months.length) : 72);
	/** @type {any} */
	const mo = $derived(plan ? monthAt(plan, month) : null);
	const now = $derived(plan ? nowLine(plan, month) : '');
	/** the dome factory at the month shown: what it is doing, and the share of the month's dome parts it made (by their bought price) */
	const dfNow = $derived.by(() => {
		const T = plan?.totals.domeFactory;
		if (!T || !mo) return null;
		const d = mo.domeFactory;
		if (T.start === null || mo.m < T.start) return { text: 'Dome factory: begun once the camp stands' };
		if (!d?.stands) {
			const st = plan.steps.find((/** @type {any} */ x) => x.domeFactory);
			const ph = st ? phaseAt(st, month) : null;
			return { text: ph?.phase === 'inside' ? 'Dome factory: its lines and machines going in' : `Dome factory going up${ph && ph.phase !== 'none' ? ` (${st.phases.find((/** @type {any} */ x) => x.id === ph.phase)?.label ?? ph.phase})` : ''}` };
		}
		if (!d.runs) return { text: 'Dome factory: its lines start next month' };
		const keys = /** @type {(keyof typeof DF_PARTS)[]} */ (Object.keys(DF_PARTS));
		const want = keys.reduce((a, k) => a + (d.demand?.[k] ?? 0) * DF_PARTS[k].bought, 0);
		const got = keys.reduce((a, k) => a + (d.used?.[k] ?? 0) * DF_PARTS[k].bought, 0);
		return { text: want > 0 ? `Dome factory makes ${n0((100 * got) / want)}% of this month’s dome parts` : 'Dome factory running', pct: want > 0 ? got / want : null };
	});
	/** the dome factory's site, to fly to it */
	const dfSite = DOME_FACTORY ? TOWER_HEX.sites.find((s) => FACTORIES.find((f) => f.id === s.factory)?.dome) : null;
	const CAL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	/** the calendar month of month m from day 0 */
	const calOf = (/** @type {number} */ m) => {
		const o = plan?.options ?? { startYear: 2027, startMonth: 3 };
		const k = o.startMonth - 1 + Math.floor(m);
		return `${CAL[k % 12]} ${o.startYear + Math.floor(k / 12)}`;
	};
	/** the step that builds the picked building */
	const pickedStep = $derived(plan && picked ? plan.steps.find((/** @type {any} */ s) => s.hex === picked?.hex && s.site === picked?.id) : null);
	$effect(() => {
		if (worldReady) world?.setTime(plan, Math.min(month, maxMonth));
	});
	let raf = 0;
	function play() {
		if (playing) {
			playing = false;
			cancelAnimationFrame(raf);
			return;
		}
		if (month >= maxMonth - 0.01) month = 0;
		playing = true;
		// the whole build-out in about half a minute
		const speed = maxMonth / 30;
		let last = performance.now();
		const step = (/** @type {number} */ t) => {
			if (!playing) return;
			month = Math.min(maxMonth, month + Math.min(0.1, (t - last) / 1000) * speed);
			last = t;
			if (month >= maxMonth) playing = false;
			else raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
	}
	function openTimeline(/** @type {boolean} */ on) {
		tl = on;
		if (!on) {
			playing = false;
			cancelAnimationFrame(raf);
		}
		sheetOpen = false;
	}

	// ── numbers on the page ──
	const n0 = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US');
	const n1 = (/** @type {number} */ n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
	const ha = (/** @type {number} */ n) => (n >= 10 ? n1(n) : (Math.round(n * 100) / 100).toFixed(2));
	const eur = (/** @type {number} */ e) => (Math.abs(e) >= 1e6 ? `${n1(e / 1e6)} M€` : Math.abs(e) >= 1e3 ? `${n0(e / 1e3)} k€` : `${n0(e)} €`);
	const gwh = (/** @type {number} */ kwh) => (Math.abs(kwh) >= 1e6 ? `${(kwh / 1e6).toFixed(2)} GWh` : `${n0(kwh / 1e3)} MWh`);
	const tonnes = (/** @type {number} */ t) => (t >= 100 ? n0(t) : n1(t));
	const hexArea = $derived(hex === 'village' ? `${n1(stats.hexHa)} ha, seven hexes 666 m across` : `${n1(stats.hexHa)} ha, 666 m across`);

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
	function setHex(/** @type {'village' | 'tower' | 'living'} */ h) {
		hex = h;
		picked = null;
		world?.pick(null, null);
		world?.focusHex(h === 'living' ? lastLiving : h);
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
					if (h) {
						hex = planOf(h).id;
						if (hex === 'living') lastLiving = h;
					}
				},
				people: (k) => {
					const p = planOf(k);
					if (p.id === 'tower') return `${TOWER.label}, ${n0(towerStats.people[0].n * 2.2)} residents, ${n0(towerStats.people.slice(2).reduce((/** @type {number} */ a, /** @type {any} */ q) => a + q.n, 0))} desks and jobs`;
					return `${livingStats.residents} people in ${p.sites.filter((s) => s.kind.startsWith('dome')).length} home domes · winter sun ${n0(100 * (sun.hexes[k].homes?.winter ?? 0))}%`;
				},
				onProgress: (l) => (loading = l)
			});
			for (const [k, on] of Object.entries(overlay)) world.set(k, on);
			loading = '';
			worldReady = true;
		});
		// ?month=18 opens the build-out at that month; &kit=starter takes the starter kit
		const q = new URLSearchParams(location.search);
		const k = q.get('kit');
		if (k) kitId = k;
		if (q.has('month')) {
			tl = true;
			month = Math.max(0, Number(q.get('month')) || 0);
		}
		// ?hex=living-e flies to a hex once the world stands
		const h = q.get('hex');
		if (h && VILLAGE.some((x) => x.key === h)) {
			const go = function () {
				if (worldReady) world?.focusHex(h);
				else setTimeout(go, 200);
			};
			go();
		}
		return () => mq.removeEventListener('change', fit);
	});
	onDestroy(() => {
		cancelAnimationFrame(raf);
		world?.dispose();
	});
</script>

{#snippet toggles()}
	<div class="group">
		<p class="head">Build-out</p>
		<button class="grow" class:on={tl} onclick={() => openTimeline(!tl)}>{tl ? 'Back to the finished village' : '▶ From 2 settlers to 1,500, month by month'}</button>
	</div>
	<div class="group">
		<p class="head">Numbers for</p>
		<div class="seg">
			<button class:on={hex === 'village'} onclick={() => setHex('village')}>Village</button>
			<button class:on={hex === 'tower'} onclick={() => setHex('tower')}>Tower hex</button>
			<button class:on={hex === 'living'} onclick={() => setHex('living')}>Living hex</button>
		</div>
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

{#snippet buildCard()}
	{#if tl && picked && pickedStep}
		{@const s = pickedStep}
		{@const ph = phaseAt(s, Math.min(month, plan.months.length - 1))}
		<section class="panel card">
			<button class="x" aria-label="Close" onclick={() => { picked = null; world?.pick(null, null); }}>×</button>
			<h2>{s.label} <span class="sub">{s.hexLabel}</span></h2>
			<dl>
				<dt>Builder and owner</dt><dd>{s.coop}</dd>
				<dt>Built</dt><dd>{s.start === null ? 'not in the plan' : `${calOf(s.start)} to ${calOf(s.end)} (${s.months} months)`}</dd>
				<dt>At {calOf(month)}</dt><dd>{ph.phase === 'none' ? 'not begun' : ph.phase === 'done' ? 'standing' : `${s.phases.find((/** @type {any} */ p) => p.id === ph.phase)?.label ?? ph.phase}, ${n0(100 * ph.p)}% of its work done`}</dd>
				<dt>Crew</dt><dd>{n1(s.crew)} full-time on average, up to {s.crewMax}; {n0(s.hours)} crew-hours</dd>
				<dt>Lifting</dt><dd>{n1(s.craneDays)} crane-days{s.handlerDays ? `, ${n1(s.handlerDays)} telehandler-days` : ''}</dd>
				<dt>Materials</dt><dd>{Object.entries(s.t).filter(([, v]) => /** @type {number} */ (v) > 0).map(([k, v]) => `${k} ${tonnes(/** @type {number} */ (v))} t`).join(' · ')}{s.pvM2 ? ` · solar glass ${n0(s.pvM2)} m²` : ''}</dd>
				<dt>Bought</dt><dd>{eur(s.eur.total)}: materials {eur(s.eur.materials)}{s.eur.worksSaved ? ` (${eur(s.eur.worksSaved)} saved by the village’s own ${plan.totals.domeFactory ? 'dome factory and works' : 'works'})` : ''}{s.eur.machines ? `, machines ${eur(s.eur.machines)}` : ''}{s.eur.services ? `, services ${eur(s.eur.services)}` : ''}</dd>
				{#if plan.totals.domeFactory && s.domeFactory}<dt>Its own parts</dt><dd>bought finished ({eur(plan.totals.domeFactory.ownShellEur)}): it cannot make them before it stands; its materials also carry its parts store ({eur(plan.totals.domeFactory.leftoverEur)} of parts left at the end, spares for repairs)</dd>{:else if plan.totals.domeFactory && s.phases.some((/** @type {any} */ p) => p.id === 'shell')}<dt>Its parts</dt><dd>{s.fromDF > 0 ? `${n0(100 * s.fromDF)}% from our dome factory (by their bought price), the rest bought finished` : 'bought finished: the dome factory was not running yet'}</dd>{/if}
				{#if s.beds}<dt>Beds</dt><dd>{s.beds}</dd>{/if}
			</dl>
		</section>
	{/if}
{/snippet}

{#snippet buildPanel()}
	{#if tl && plan && panel.buildout}
		{@const F = plan.feasibility}
		{@const T = plan.totals}
		<section class="panel">
			<h2>Build-out <span class="sub">from 2 settlers to {n0(plan.options.targetPeople)} people, built by themselves</span></h2>
			<div class="seg">
				<button class:on={kitId === 'auto'} onclick={() => (kitId = 'auto')}>Six-year kit</button>
				<button class:on={kitId === 'starter'} onclick={() => (kitId = 'starter')}>Starter kit</button>
			</div>
			<p class="small"><b>Design package {plan.design.n} of 4:</b> {plan.design.note}. <small>Switch: ./specs.js DESIGN.</small></p>
			<p class="small"><b>Six years?</b> {F.statement}</p>
			<h3>What it costs <span class="sub">{plan.feasibility.kit.short}</span></h3>
			<table>
				<thead><tr><th></th><th class="num">by {calOf(month)}</th><th class="num">all told</th></tr></thead>
				<tbody>
					{#each Object.entries(EUR_KINDS) as [k, label] (k)}<tr><td>{label}</td><td class="num">{eur(mo?.cum[k] ?? 0)}</td><td class="num">{eur(T.eur[k])}</td></tr>{/each}
					<tr class="total"><td>Bootstrap bill</td><td class="num">{eur(mo?.cumTotal ?? 0)}</td><td class="num">{eur(T.total)}</td></tr>
					<tr><td>A resident’s share</td><td></td><td class="num">{eur(T.perPerson)}</td></tr>
				</tbody>
			</table>
			<p class="small">Materials are bought finished at Sandbox 6’s prices until the village’s own {T.domeFactory ? 'dome factory and works make' : 'works make'} them ({eur(T.worksSaved)} saved); the kit is bought once and moves on to each settlement; running it is {eur(plan.kit.running.eurYear)} a year (estimate).</p>
			{#if T.domeFactory}
				{@const D = T.domeFactory}
				{@const P = /** @type {Record<string, any>} */ (DF_PARTS)}
				<h3>The dome factory <span class="sub">the Village COOP’s, at the centre</span></h3>
				<p class="small">Begun {calOf(D.start)} as soon as the camp stood, its machines in by {calOf(D.stands)}; it makes parts from {calOf(D.runsFrom)}. <b>{D.domesFromDF} of the other {D.domes} domes</b> are built mostly from its parts{D.domesPartly ? ` (${D.domesPartly} more in part)` : ''}; the ones before it, and what its lines could not make in the busiest months, are bought finished.{mo?.domeFactory?.runs && dfNow ? ` In ${calOf(month)} ${dfNow.text.replace('Dome factory makes', 'it makes')}.` : ''}</p>
				<table>
					<thead><tr><th>Part</th><th class="num">made</th><th class="num">bought finished</th><th class="num">busiest year / line</th></tr></thead>
					<tbody>
						{#each Object.keys(D.made) as k (k)}<tr><td>{P[k].short}<small>{P[k].unit} · {n0(P[k].eur)} € from the border against {n0(P[k].bought)} € bought finished</small></td><td class="num">{n0(D.used[k])}</td><td class="num">{n0(D.bought[k])}</td><td class="num">{n0(100 * D.peak[k].share)}%</td></tr>{/each}
					</tbody>
				</table>
				<p class="small">Imports for its parts {eur(D.imports)} instead of {eur(D.imports + D.savedParts)} bought finished; {n0(D.hours / 1000)}k crew-hours of villagers and their Avens (no wages), taken from the building crew; {gwh(D.kwh)} of power ({gwh(D.gridKwh)} from the grid line before the geothermal plant, {eur(D.eurPower)}), upkeep {eur(D.eurUpkeep)}; machines {eur(D.machines)}, the grid line and certificates {eur(D.services)}. {#if Object.values(D.peak).some((/** @type {any} */ x) => x.share > 1)}In the busiest twelve months the domes take more than two shifts make on the {Object.values(D.peak).filter((/** @type {any} */ x) => x.share > 1).map((/** @type {any} */ x) => `${x.line.toLowerCase()} line (${n0(100 * x.share)}%)`).join(' and ')}: that much is bought finished, or a third shift there makes it.{:else}One dome factory keeps up: in the busiest twelve months no line needs more than its two shifts.{/if}</p>
			{/if}
			<table>
				<thead><tr><th>Year</th><th class="num">materials</th><th class="num">machines</th><th class="num">all</th></tr></thead>
				<tbody>
					{#each T.byYear as y (y.year)}<tr><td>{y.year} <small>{calOf((y.year - 1) * 12)}–{calOf(Math.min(y.year * 12 - 1, plan.months.length - 1))}</small></td><td class="num">{eur(y.materials)}</td><td class="num">{eur(y.machines)}</td><td class="num">{eur(y.total)}</td></tr>{/each}
				</tbody>
			</table>
			<h3>The settlements and their COOPs</h3>
			<table>
				<thead><tr><th></th><th class="num">founded</th><th class="num">built</th><th class="num">bill</th></tr></thead>
				<tbody>
					{#each plan.settlements as st (st.key)}<tr><td>{st.coop}<small>{st.domes} domes{st.beds ? `, ${n0(st.beds)} beds` : ''}{st.key === 'tower' ? ', the works and the geothermal plant' : ''}{st.eur.kit ? `; the kit ${eur(st.eur.kit)}` : ''}</small></td><td class="num">{st.founded === null ? '' : calOf(st.founded)}</td><td class="num">{st.done < 0 ? '' : calOf(st.done)}</td><td class="num">{eur(st.eur.total)}</td></tr>{/each}
				</tbody>
			</table>
			<p class="small">One COOP a settlement builds and owns its domes, rents beds to its residents and dome space to the business COOPs; the centre’s is the Village COOP, which owns the works and the geothermal plant. Each is founded in the month its settlement starts.</p>
			<h3>What makes six years</h3>
			<table>
				<thead><tr><th>Kit</th><th class="num">kit</th><th class="num">all built</th><th class="num">bill</th></tr></thead>
				<tbody>
					{#each F.ladder as r (r.id)}<tr class:pickedrow={r.id === plan.kitChoice}><td>{r.short}</td><td class="num">{eur(r.kitEur)}</td><td class="num">{r.doneMonth === null ? 'never' : `${n1(r.doneMonth / 12)} yrs`}</td><td class="num">{eur(r.total)}</td></tr>{/each}
				</tbody>
			</table>
			<details>
				<summary>One change at a time, from the starter kit</summary>
				<ul class="plain">{#each F.levers as l (l.label)}<li><b>{l.label}</b>: all built in {l.doneMonth === null ? 'never' : `${n1(l.doneMonth / 12)} years`}, {l.extraEur >= 0 ? '+' : '−'}{eur(Math.abs(l.extraEur))} <small>{l.change}</small></li>{/each}</ul>
			</details>
			<details>
				<summary>The kit, {eur(plan.kit.eur)}</summary>
				<table>
					<tbody>
						{#each plan.kit.items as k (k.id)}<tr><td>{k.n} × {k.label}<small>{KIT_GROUPS[/** @type {keyof typeof KIT_GROUPS} */ (k.group)]} · {n0(k.eur)} € each{k.est ? ' (estimate)' : ''}{k.note ? ` · ${k.note}` : ''}</small></td><td class="num">{eur(k.total)}</td></tr>{/each}
					</tbody>
				</table>
			</details>
			<details>
				<summary>How fast the work goes</summary>
				<ul class="plain">
					{#each Object.entries(/** @type {Record<string, any>} */ (RATES)) as [k, r] (k)}<li>{k}: <b>{r.v}</b> {r.unit}{r.est ? ' (estimate)' : ''}</li>{/each}
					{#each Object.entries(LABOUR) as [k, r] (k)}<li>{k}: <b>{r.v}</b> <small>{r.note}</small></li>{/each}
				</ul>
			</details>
			<details>
				<summary>Sources</summary>
				<ul class="plain">{#each Object.values(/** @type {Record<string, any>} */ (BUILD_SOURCES)) as src (src.label)}<li><b>{#if src.url}<a href={src.url} target="_blank" rel="noreferrer">{src.label}</a>{:else}{src.label}{/if}</b>: {src.note}</li>{/each}</ul>
			</details>
		</section>
	{/if}
{/snippet}

{#snippet panelsView()}
	{@render buildCard()}
	{@render buildPanel()}
	{#if card && picked}
		<section class="panel card">
			<button class="x" aria-label="Close" onclick={() => { picked = null; world?.pick(null, null); }}>×</button>
			<h2>{card.title}</h2>
			<p class="note">{card.note}</p>
			<dl>
				{#each card.facts as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
				{#if cardSun}<dt>{card.hall ? 'Sun on its south roof' : 'Sun on its south glass'}</dt><dd>{n0(100 * cardSun.winter)}% of the sunny day on {DAYS.winter.label} ({n1(cardSun.winter * sun.dayHours.winter)} of {n1(sun.dayHours.winter)} h), {n0(100 * cardSun.equinox)}% on {DAYS.equinox.label}</dd>{/if}
			</dl>
			{#if card.df}
				{@const F = card.df}
				<h3>Its lines <span class="sub">two shifts, villagers and their Avens</span></h3>
				<table>
					<thead><tr><th></th><th class="num">a year</th><th class="num">floor</th><th class="num">machines</th></tr></thead>
					<tbody>
						{#each F.lines as l (l.id)}<tr><td><i style:background={l.color}></i>{l.label}{#if l.part}<small>{l.part.h ? `${l.part.h} crew-h and ` : ''}{l.part.kwh} kWh a {l.part.unit}</small>{/if}</td><td class="num">{l.cap ? `${n0(l.cap)} ${l.unit}` : ''}</td><td class="num">{l.m2 ? `${n0(l.m2)} m²` : ''}</td><td class="num">{eur(l.eur)}</td></tr>{/each}
						<tr class="total"><td>The dome factory</td><td></td><td class="num">{n0(F.floor)} m²</td><td class="num">{eur(F.machines)}</td></tr>
					</tbody>
				</table>
				<details>
					<summary>The machines</summary>
					<ul class="plain">{#each F.lines as l (l.id)}{#each l.machines as x (x.label)}<li>{#if x.url}<a href={x.url} target="_blank" rel="noreferrer">{x.label}</a>{:else}{x.label}{/if}: <b>{eur(x.eur)}</b>{x.est ? ' (estimate)' : ''}</li>{/each}{/each}</ul>
				</details>
				<h3>What it buys at the border</h3>
				<table>
					<tbody>
						{#each F.imports as x (x.id)}<tr><td>{#if x.url}<a href={x.url} target="_blank" rel="noreferrer">{x.label}</a>{:else}{x.label}{/if}<small>{x.why}</small></td><td class="num">{x.eur < 1 ? x.eur.toFixed(3) : n1(x.eur)} €/{x.unit}{x.est ? '*' : ''}</td></tr>{/each}
					</tbody>
				</table>
				<h3>What a dome takes from the border</h3>
				<table>
					<thead><tr><th></th><th class="num">bought finished</th><th class="num">with the dome factory</th></tr></thead>
					<tbody>
						{#each F.domes as d (d.D)}<tr><td>Dome{d.D}<small>{n0(d.goods.lamellasM3)} m³ of lamellas, {n0(d.goods.plateT)} t of plate, {n0(d.goods.floatT)} t of float glass, {n0(d.goods.pvbM2)} m² of PVB, {n0(d.goods.cellsKwp)} kWp of cells, {n0(d.goods.kvhM3)} m³ of C24, {n0(d.goods.hempM3)} m³ of hemp batts</small></td><td class="num">{eur(d.beforeEur)}</td><td class="num">{eur(d.afterEur)}</td></tr>{/each}
					</tbody>
				</table>
				<p class="small">The shell’s parts only (the footing is the same either way). * an estimate from the sources; no labour is in any price.</p>
			{/if}
			{#if card.block && card.cap}
				{@const B = card.block}
				{@const c = /** @type {import("./specs.js").Cap} */ (card.cap)}
				{@const shell = (/** @type {number} */ off, /** @type {number} */ from, /** @type {number} */ to, /** @type {number} */ n) => Array.from({ length: n + 1 }, (_, k) => { const x = from + (k / n) * (to - from); return `L ${x} ${-(Math.sqrt(Math.max(0, c.R ** 2 - x * x - off * off)) - (c.R - c.h))}`; }).join(' ')}
				{@const edge = Math.sqrt(c.a ** 2 - B.front ** 2)}
				<h3>Its block</h3>
				<svg class="section" viewBox="{-edge - 2} {-c.h - 2} {2 * edge + 4} {c.h + 4}" role="img" aria-label="The block seen from the south">
					<path d={`M ${-edge} 0 ` + shell(B.front, -edge, edge, 48) + ' Z'} class="glass" />
					{#each B.levels as L (L.k)}
						<rect x={-L.half} y={-(L.y + L.h)} width={2 * L.half} height={L.h - 0.2} fill={USES.living.map} />
						{#if L.k > 0}{#each Array.from({ length: Math.floor((2 * L.half - 4) / 6) + 1 }, (_, i) => i) as i (i)}<rect x={-L.half + 1 + i * 6} y={-L.y - 0.1} width="4" height="1.1" class="balcony" />{/each}{/if}
					{/each}
					<line x1={-edge - 2} x2={edge + 2} y1="0" y2="0" class="ground" />
				</svg>
				<p class="small">From the south: {B.levels.length} storeys, {B.levels.map((/** @type {any} */ l) => Math.round(2 * l.half)).join(', ')} m long from the ground up, each as long as the shell lets it; a small balcony (green, {B.balcony} m deep) every 6 m on the south face.</p>
				<svg class="section" viewBox="{-c.a - 2} {-c.h - 2} {2 * c.a + 4} {c.h + 4}" role="img" aria-label="A section through the dome from south to north">
					<path d={`M ${-c.a} 0 ` + shell(0, -c.a, c.a, 48) + ' Z'} class="glass" />
					<path d={`M ${card.cut} 0 ` + shell(0, card.cut, c.a, 24)} class="hemp" />
					<rect x={B.pondIn} y="-0.4" width={B.pondOut - B.pondIn} height="1.6" fill="#3f86a6" />
					{#each B.levels as L (L.k)}
						<rect x={B.front} y={-(L.y + L.h)} width={B.depth} height={L.h - 0.2} fill={USES.living.map} />
						{#if L.k > 0}<rect x={B.front - B.balcony} y={-L.y - 0.1} width={B.balcony} height="1.1" class="balcony" />{/if}
					{/each}
					<line x1={-c.a - 2} x2={c.a + 2} y1="0" y2="0" class="ground" />
				</svg>
				<p class="small">South on the left, north on the right: the block {B.depth} m deep, its front {B.front} m north of the middle, the whole south of the dome left to the food garden; the pond behind it along the north rim, under the hemp (white).</p>
			{/if}
			<h3>{card.kind === 'tower' ? 'Floors' : 'Its floor'}</h3>
			<table>
				<tbody>
					{#each card.zones.filter((/** @type {any} */ z) => z.m2 > 0) as z, k (k)}
						<tr>
							<td><i style:background={z.color ?? (card.kind === 'tower' ? FLOOR_COLOURS[/** @type {keyof typeof FLOOR_COLOURS} */ (z.use)] : USES[z.use]?.map)}></i>{z.label}{#if z.note}<small>{z.note}</small>{/if}</td>
							<td class="num">{n0(z.m2)} m²</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if card.hall}
				{@const H = card.hall}
				<h3>The hall</h3>
				<table>
					<tbody>
						<tr><td>Spruce glulam frames and purlins<small>{H.frames} portal frames, {n0(H.m.glulam)} m³ and {n0(H.m.purlins)} m³ of purlins; {tonnes(H.m.steel)} t of steel connectors</small></td><td class="num">{tonnes(H.t.glulam)} t · {eur(H.eur.frame)}</td></tr>
						<tr><td>Sandwich panels, roof and walls<small>{n0(H.roof)} m² and {n0(H.walls)} m²</small></td><td class="num">{tonnes(H.t.panels)} t · {eur(H.eur.cladding)}</td></tr>
						<tr><td>Slab on gravel, footings<small>{n0(H.m.slab)} m³ of concrete, {tonnes(H.m.mesh)} t of mesh, {n0(H.columns)} footings</small></td><td class="num">{tonnes(H.t.concrete + H.t.gravel)} t · {eur(H.eur.slab)}</td></tr>
						<tr><td>Doors, rooflights, services</td><td class="num">{eur(H.eur.kit)}</td></tr>
						<tr><td>Solar on the south slope<small>{n0(H.m.modules)} m², {n0(H.m.kwp)} kWp</small></td><td class="num">{tonnes(H.t.modules)} t · {eur(H.eur.pv)}</td></tr>
						<tr class="total"><td>The hall at today’s prices</td><td class="num">{eur(card.eur)}</td></tr>
					</tbody>
				</table>
				<p class="small">Estimates: ./specs.js HALL and HALL_PRICES. The works’ machines are counted apart.</p>
			{:else}
				{@const sh = /** @type {any} */ (card.shell)}
				<h3>Its shell</h3>
				<table>
					<tbody>
						<tr><td>Glulam struts and cassettes</td><td class="num">{n0(sh.m.timber)} m³ · {tonnes(sh.t.timber)} t</td></tr>
						<tr><td>Steel hubs, ring, connectors</td><td class="num">{tonnes(sh.t.steel)} t</td></tr>
						<tr><td>Laminated double glazing</td><td class="num">{n0(sh.m.glass)} m² · {tonnes(sh.t.glass)} t</td></tr>
						<tr><td>Hemp fibre, north side</td><td class="num">{n0(sh.m.hemp)} m³ · {tonnes(sh.t.hemp)} t</td></tr>
						<tr><td>Lime footing</td><td class="num">{n0(sh.m.lime)} m³ · {tonnes(sh.t.lime)} t</td></tr>
						<tr class="total"><td>Shell materials at today’s prices</td><td class="num">{eur(card.eur)}</td></tr>
					</tbody>
				</table>
			{/if}
			<button class="link" onclick={() => picked && world?.focusSite(picked.id, picked.hex)}>Fly to it</button>
		</section>
	{/if}

	{#if hex === 'village' && panel.hexes}
		<section class="panel">
			<h2>The village <span class="sub">the tower hex and six living hexes round it</span></h2>
			<table>
				<thead><tr><th></th><th class="num">people</th><th class="num">food</th><th class="num">GWh</th><th class="num">sun</th><th class="num">cost</th></tr></thead>
				<tbody>
					{#each VILLAGE as h (h.key)}
						{@const s = h.plan === LIVING ? livingStats : towerStats}
						{@const hs = sun.hexes[h.key]}
						<tr><td><button class="row" onclick={() => world?.focusHex(h.key)}>{h.label.replace(' hex', '')}</button></td><td class="num">{n0(h.plan === LIVING ? s.residents : village.people[1].n)}</td><td class="num">{n0((100 * s.food.grown) / Math.max(1, s.food.need))}%</td><td class="num">{s.energy.net >= 0 ? '+' : '−'}{n1(Math.abs(s.energy.net) / 1e6)}</td><td class="num">{n0(100 * ((hs.homes ?? hs.domes)?.winter ?? 0))}%</td><td class="num">{eur(s.total)}</td></tr>
					{/each}
					<tr class="total"><td>The village</td><td class="num">{n0(village.residents)}</td><td class="num">{n0((100 * village.food.grown) / village.food.need)}%</td><td class="num">{village.energy.net >= 0 ? '+' : '−'}{n1(Math.abs(village.energy.net) / 1e6)}</td><td></td><td class="num">{eur(village.total)}</td></tr>
					<tr><td colspan="5">A resident’s share</td><td class="num">{eur(village.total / village.residents)}</td></tr>
				</tbody>
			</table>
			<p class="small">People: who lives there. Food: what the hex grows against what its people eat (the tower hex grows little; the living hexes feed it). GWh: the power it makes less what it uses, a year. Sun: the share of the sunny day on {DAYS.winter.label} that reaches the homes’ south glass (the tower hex: {HALLS ? 'its works halls’ south roofs' : 'its factory domes'}), with the neighbours’ domes and the tower’s long winter shadow counted. Click a hex to fly to it.</p>
		</section>
	{/if}

	{#if panel.land}
		<section class="panel">
			<h2>Land <span class="sub">{hexArea}</span></h2>
			{@render bar(groups)}
			<ul class="keys">
				{#each groups as g (g.label)}<li><i style:background={g.color}></i>{g.label} <b>{n1(g.pct)}%</b></li>{/each}
			</ul>
			<table>
				<thead><tr><th>{HALLS ? 'Under glass or a roof' : 'Under glass'} ({ha(stats.glassHa)} ha, {n1((100 * stats.glassHa) / stats.hexHa)}%)</th><th class="num">ha</th><th class="num">%</th></tr></thead>
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
			{#if hex !== 'tower'}
				<p class="small">Food forest under glass {n1(sum(['indoorFood']))}% · outdoors {n1(sum(['foodForest']))}% · homes {n1(sum(['living']))}% of the land ({n0(stats.buildings.reduce((/** @type {number} */ a, /** @type {any} */ b) => a + (b.gfa ?? 0) * b.count, 0))} m² of floor in blocks of {KINDS.dome40.storeys} and {KINDS.dome80.storeys} storeys) · nature {n1(sum(['nature']))}%.{#if hex === 'village'} Raw-material fields and woods {n1(sum(['hemp', 'bamboo', 'woodland']))}% · open pits {n1(sum(['mine']))}%.{/if}</p>
			{:else}
				<p class="small">Raw-material fields and woods {n1(sum(['hemp', 'bamboo', 'woodland']))}% · open pits {n1(sum(['mine']))}% (no domes over them: {HALLS ? 'only the works are indoors, in plain halls' : 'only the works are under glass'}) · nature {n1(sum(['nature']))}%.</p>
			{/if}
			<p class="tip">Turn on “Land use” to paint these colours on the ground.</p>
		</section>
	{/if}

	{#if panel.buildings}
		<section class="panel">
			<h2>Buildings</h2>
			<table>
				<thead><tr><th></th><th class="num">{HALLS ? 'Ø or size, m' : 'Ø m'}</th><th class="num">high</th><th class="num">floor m²</th><th class="num">shell m²</th></tr></thead>
				<tbody>
					{#each stats.buildings as b (b.kind)}
						<tr><td>{b.count} × {b.label}{#if b.people}<small>{b.people} people each</small>{/if}</td><td class="num">{b.size ?? b.D}</td><td class="num">{n1(b.h)}</td><td class="num">{n0(b.floor)}</td><td class="num">{n0(b.shell)}</td></tr>
					{/each}
				</tbody>
			</table>
			<p class="small">Every dome is a geodesic cap a third as high as it is wide (the 120 m dome’s 40 m). The homes are one straight block across the north of each dome, east to west: Dome40 {KINDS.dome40.storeys} storeys for {KINDS.dome40.people} people, Dome80 {KINDS.dome80.storeys} for {KINDS.dome80.people}, small balconies on the south face looking into the dome’s own food garden. Every panel is one of three: a white hemp triangle (solid, insulated) on the cold north side ({n0(NORTH * 100)}% of the shell), its edge one smooth line from the foot 70° west of north, over the north side below the crown, down to the foot 70° east of north; everywhere else glass and solar panels alternate like a chessboard, half each, so the plants keep half the light. The domes are Class I geodesics (frequency 7, 11 and 14: struts ~3–6 m), the tower a diagrid of triangles.{#if HALLS} The eight works stand in plain halls instead: spruce glulam portal frames every 6 m over 24 or 30 m, a 10° roof with its ridge east to west, insulated sandwich panels, solar on the south slope. Each is as long as its works needs.{/if}</p>
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
					{#if hex !== 'tower'}<tr><td>A resident’s share</td><td class="num">{eur(stats.total / stats.residents)}</td></tr>{/if}
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
		{@const pct = (100 * stats.food.grown) / Math.max(1, stats.food.need)}
		<section class="panel">
			<h2>Food <span class="sub">a healthy diet, grown here</span></h2>
			<table>
				<thead><tr><th>Food forests</th><th class="num">ha</th><th class="num">feed</th></tr></thead>
				<tbody>
					{#each stats.food.rows as r (r.label)}<tr><td>{r.label}</td><td class="num">{ha(r.ha)}</td><td class="num">{n0(r.fed)}</td></tr>{/each}
					<tr class="total"><td>People the hex can feed</td><td></td><td class="num">{n0(stats.food.grown)}</td></tr>
					<tr><td>People who eat here</td><td></td><td class="num">{n0(stats.food.eaters)}</td></tr>
				</tbody>
			</table>
			<p class="small">{pct >= 100 ? `The hex grows ${n0(pct)}% of what its people eat: food for ${n0(stats.food.grown - stats.food.need)} more, to share with the tower hex or to sell.` : `The hex grows ${n0(pct)}% of what its people eat; the living hexes round it grow the rest.`}</p>
			<table>
				<thead><tr><th>A person’s day</th><th class="num">g</th><th class="num">kcal</th></tr></thead>
				<tbody>
					{#each Object.entries(DIET) as [k, d] (k)}<tr><td>{d.label}</td><td class="num">{d.g}</td><td class="num">{n0((d.g / 1000) * d.kcal)}</td></tr>{/each}
					<tr class="total"><td>{n0(DAY.protein)} g of protein</td><td></td><td class="num">{n0(DAY.kcal)}</td></tr>
				</tbody>
			</table>
			<table>
				<thead><tr><th>The harvest, a year</th><th class="num">t</th></tr></thead>
				<tbody>
					{#each Object.entries(stats.food.crops) as [k, t] (k)}<tr><td>{DIET[k].label}</td><td class="num">{tonnes(/** @type {number} */ (t))}</td></tr>{/each}
				</tbody>
			</table>
			<p class="small">Only legumes, nuts and seeds, vegetables, fruit, chicken and eggs, modelled on the EAT-Lancet planetary health diet with chestnuts and roots for its grains. Every food forest has seven layers planted for this diet (nut and chestnut trees, fruit trees, hazel and berries, beans and vegetables, ground cover, roots, climbers); the hens roam under the trees and find three tenths of their feed, the rest is grown for them ({n0(GROWN.feed)} kg a person a year). A person takes {n0(LAND_PERSON.outdoor.total)} m² of food forest outdoors or {n0(LAND_PERSON.indoor.total)} m² under the glass, where it grows all year.</p>
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
					{#each stats.energy.heatRows as m (m.label)}<tr><td>{m.label}</td><td class="num">{gwh(m.kwh)}</td></tr>{/each}
					{#each stats.energy.heatFrom as m (m.label)}<tr><td>{m.label}</td><td class="num">{gwh(m.kwh)}</td></tr>{/each}
				</tbody>
			</table>
			{#if HALLS && hex !== 'living'}
				<h3>The works: halls against Dome120s <span class="sub">a year, the eight</span></h3>
				<table>
					<thead><tr><th></th><th class="num">8 halls</th><th class="num">8 Dome120s</th></tr></thead>
					<tbody>
						<tr><td>Floor, m²</td><td class="num">{n0(works.halls.floor)}</td><td class="num">{n0(works.domes.floor)}</td></tr>
						<tr><td>Solar made</td><td class="num">{gwh(works.halls.solar)}</td><td class="num">{gwh(works.domes.solar)}</td></tr>
						<tr><td>Heat needed</td><td class="num">{gwh(works.halls.heat)}</td><td class="num">{gwh(works.domes.heat)}</td></tr>
						<tr><td>Power for fans or dome climate</td><td class="num">{gwh(works.halls.climate)}</td><td class="num">{gwh(works.domes.climate)}</td></tr>
						<tr class="total"><td>The buildings at today’s prices</td><td class="num">{eur(works.halls.eur)}</td><td class="num">{eur(works.domes.eur)}</td></tr>
					</tbody>
				</table>
				<p class="small">The halls’ south roofs carry {n0(works.halls.kwp)} kWp. They make less solar than the domes’ cells, but they need about half the heat and almost no climate power.</p>
			{/if}
		</section>
	{/if}

	{#if (hex === 'village' || hex === 'tower') && panel.floors}
		{@const floors = stats.floors}
		{@const T = TOWER}
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

	{#if (hex === 'village' || hex === 'tower') && panel.raw}
		<section class="panel">
			<h2>Raw materials <span class="sub">from the hex, a year</span></h2>
			<table>
				<tbody>
					{#each stats.raw as r (r.id)}<tr><td>{r.label}<small>{r.note}</small></td><td class="num">{ha(r.ha)} ha</td><td class="num">{r.per ? `${n0(r.yearly)} ${r.unit}` : ''}</td></tr>{/each}
				</tbody>
			</table>
			<h3>{HALLS ? 'The eight works halls' : 'The eight factory domes'}</h3>
			<ul class="plain">
				{#each TOWER_HEX.sites.filter((s) => s.kind === 'factory120') as s (s.id)}
					{@const run = stats.factoryRun[s.factory ?? '']}
					{#if FACTORIES.find((f) => f.id === s.factory)?.dome}<li><b>{s.name}</b>: {DF.lines.filter((l) => l.cap).map((l) => `${n0(l.cap ?? 0)} ${l.unit} ${l.label.toLowerCase()}`).join(', ')} a year <small>every dome’s parts, from bought lamellas, plate, float glass and cells</small></li>
					{:else}<li><b>{s.name}</b>: {run.t.toLocaleString('en-US')} {run.unit} a year <small>{run.note}</small></li>{/if}
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

<div class="hexplan" class:tl>
	<div class="stage" bind:this={stage}></div>
	<div class="labels" bind:this={labelLayer}></div>
	<WorldBar title="avenCITY #S6" subtitle="One village at its real size" clock={{ day: 'A day in June', hour: '11:30', about: 'On Auto the sky stands at late morning; Manual sets the hour' }} />

	{#if loading}<div class="loading">{loading}…</div>{/if}

	{#if tl && plan && mo && !(narrow && (sheetOpen || picked))}
		<div class="timeline panel" aria-label="The build-out, month by month">
			<div class="row">
				<button class="play" onclick={play} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
				<input type="range" min="0" max={maxMonth} step="0.05" bind:value={month} aria-label="Month" oninput={() => { playing = false; }} />
				<button class="x2" aria-label="Back to the finished village" onclick={() => openTimeline(false)}>×</button>
			</div>
			<div class="row when">
				<b>Month {Math.floor(month)} · {calOf(month)}</b><span class="sub">year {Math.floor(month / 12) + 1}{month >= (plan.totals.doneMonth ?? Infinity) + 1 ? ' · every dome built' : ''}</span>
				{#if !narrow}
					<div class="seg kits">
						<button class:on={kitId === 'auto'} onclick={() => (kitId = 'auto')}>Six-year kit</button>
						<button class:on={kitId === 'starter'} onclick={() => (kitId = 'starter')}>Starter kit</button>
					</div>
				{/if}
			</div>
			<div class="counts">
				<span><b>{n0(mo.people)}</b> people</span>
				<span><b>{n0(mo.beds)}</b> beds{mo.campBeds ? ` (${mo.campBeds} in the camp)` : ''}</span>
				<span><b>{mo.domes}</b> of {plan.totals.domes} domes{plan.totals.halls ? ` · ${mo.halls} of ${plan.totals.halls} halls` : ''}{plan.totals.domeFactory ? ` · ${mo.domesFromDF} from our dome factory` : ''}{mo.framing ? `, ${mo.framing} going up` : ''}</span>
				<span><b>{eur(mo.cumTotal)}</b> spent</span>
				{#if dfNow}<button class="dfchip" class:on={mo.domeFactory?.runs} onclick={() => { if (dfSite) { world?.pick(dfSite.id, 'tower'); world?.focusSite(dfSite.id, 'tower'); } }}>{dfNow.text}</button>{/if}
			</div>
			<div class="kinds">
				{#each Object.entries(EUR_KINDS) as [k, label] (k)}<span>{label} <b>{eur(mo.cum[k])}</b></span>{/each}
			</div>
			<p class="now"><b>Now:</b> {now}</p>
		</div>
	{/if}
	{#if narrow && !tl && !sheetOpen && !picked}
		<button class="opener" onclick={() => openTimeline(true)}>▶ Build-out</button>
	{/if}

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
	<!-- the joystick steps aside while a sheet is open over it -->
	{#if !(narrow && (sheetOpen || picked || tl))}<TouchStick move={(x, y, hurry) => world?.move(x, y, hurry)} {stage} taps=".panel button, .fab, .lbl" />{/if}
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
		background: var(--overlay-paper, rgb(250 248 242 / .75));
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
	.labels :global(.lbl.hex) {
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
		background: rgb(36 69 47 / 0.88);
		color: #f4f1e8;
	}
	.labels :global(.lbl.land) {
		background: var(--overlay-paper, rgb(250 248 242 / .75));
		pointer-events: none;
	}
	.labels :global(.lbl.land i) {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-right: 0.3rem;
		border-radius: 50%;
		vertical-align: -0.05rem;
	}
	.labels :global(.lbl.on) {
		background: #24452f;
		color: #f4f1e8;
	}
	.panel {
		background: var(--overlay-paper, rgb(250 248 242 / .75));
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
		flex-wrap: wrap;
		gap: 0.2rem;
		padding: 0.2rem;
		border-radius: 16px;
		background: rgb(31 42 35 / 0.07);
	}
	.seg button {
		flex: 1 1 40%;
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
	button.row {
		padding: 0;
		border: 0;
		background: none;
		text-align: left;
		text-decoration: underline dotted rgb(31 42 35 / 0.35);
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
	.section .hemp {
		fill: none;
		stroke: #d8cba8;
		stroke-width: 2.4;
	}
	.section .balcony {
		fill: #5a9e4b;
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
		background: var(--overlay-paper, rgb(250 248 242 / .75));
	}
	/* the build-out timeline: a bar over the world's foot, clear of the nav pill */
	.timeline {
		position: absolute;
		z-index: 3;
		left: 50%;
		transform: translateX(-50%);
		bottom: var(--nav-room, 5rem);
		width: min(44rem, calc(100vw - 2rem));
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.5rem 0.7rem;
	}
	.timeline .row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.timeline input[type='range'] {
		flex: 1;
		min-width: 0;
		accent-color: #24452f;
	}
	.timeline .play {
		flex: none;
		width: 2.2rem;
		height: 2.2rem;
		border: 0;
		border-radius: 999px;
		background: #24452f;
		color: #f4f1e8;
		font-size: 0.8rem;
	}
	.timeline .x2 {
		flex: none;
		border: 0;
		background: none;
		font-size: 1.3rem;
		opacity: 0.6;
		padding: 0 0.2rem;
	}
	.timeline .when {
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
		font-size: 0.85rem;
	}
	.timeline .kits {
		margin-left: auto;
		flex-wrap: nowrap;
	}
	.timeline .kits button {
		flex: none;
		padding: 0.2rem 0.6rem;
		font-size: 0.72rem;
	}
	.counts,
	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	.dfchip {
		border: 1px solid rgb(31 42 35 / 0.18);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.6);
		padding: 0.05rem 0.55rem;
		font-size: 0.72rem;
		max-width: 100%;
		text-align: left;
	}
	.dfchip.on {
		background: #9fd0dc;
		border-color: #6d9aa6;
	}
	.kinds {
		font-size: 0.68rem;
		opacity: 0.75;
		gap: 0.1rem 0.7rem;
	}
	.now {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.hexplan.tl .left {
		max-height: calc(100vh - 17rem - var(--nav-room, 4rem));
	}
	.hexplan.tl .right {
		max-height: calc(100vh - 15rem - var(--nav-room, 4rem));
	}
	button.grow {
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		text-align: left;
		font-size: 0.75rem;
	}
	button.grow.on {
		background: #24452f;
		color: #f4f1e8;
	}
	tr.pickedrow td {
		font-weight: 650;
	}
	.opener {
		position: absolute;
		z-index: 3;
		left: calc(0.8rem + env(safe-area-inset-left, 0px));
		top: calc(4.4rem + env(safe-area-inset-top, 0px));
		padding: 0.45rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: var(--overlay-paper, rgb(250 248 242 / .75));
		box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
		font-size: 0.78rem;
	}
	@media (max-width: 720px) {
		.timeline {
			left: 0.5rem;
			right: 0.5rem;
			width: auto;
			transform: none;
			padding: 0.45rem 0.6rem;
		}
		.now {
			-webkit-line-clamp: 1;
			line-clamp: 1;
		}
		.counts {
			gap: 0.05rem 0.7rem;
			font-size: 0.75rem;
		}
	}
	/* the menu button: in the bottom right corner, level with the nav pill, over the sheet when it is open */
	.fab {
		position: absolute;
		z-index: 4;
		right: calc(1rem + env(safe-area-inset-right, 0px));
		bottom: var(--nav-foot, 14px);
		width: var(--nav-height, 52px);
		height: var(--nav-height, 52px);
		border: 0;
		border-radius: 999px;
		background: #24452f;
		color: #f4f1e8;
		font-size: 1.2rem;
		box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
	}
	/* upright: the panels in a sheet on the screen's bottom edge, at most half the screen; the nav pill and the menu
	   button float over its foot, so what it holds scrolls clear above them */
	.sheet {
		position: absolute;
		z-index: 3;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 50vh;
		max-height: 50dvh;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem 0.6rem calc(var(--nav-room, 5rem) + 0.4rem);
		border-radius: 18px 18px 0 0;
		background: rgb(236 240 230 / 0.82);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		box-shadow: 0 -4px 18px rgb(0 0 0 / 0.15);
	}
	/* on its side: a slide-in aside on the right, the button on the lower left */
	@media (max-height: 500px) {
		.sheet {
			left: auto;
			top: calc(3.6rem + env(safe-area-inset-top, 0px));
			bottom: 0;
			width: min(24rem, 55vw);
			max-height: none;
			padding: 0.6rem calc(0.6rem + env(safe-area-inset-right, 0px)) 0.6rem 0.6rem;
			border-radius: 18px 0 0 0;
		}
		.fab {
			right: auto;
			left: calc(1rem + env(safe-area-inset-left, 0px));
			bottom: calc(0.8rem + env(safe-area-inset-bottom, 0px));
			width: 3rem;
			height: 3rem;
		}
	}
</style>
