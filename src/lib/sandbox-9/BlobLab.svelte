<!--
	Sandbox 8 · the blob lab — the theOS economy as Primer would show it (world model §7): soft blobs on a small field,
	rules you can see, no LLM anywhere. Pick an experiment; say what you expect; then two fields run side by side on the
	same seed, the base world on the left and the world with one rule changed on the right, with a few clean live
	charts under them; at the end, the takeaway the run computed, in one sentence, and whether your guess came true.
	The Rules are cards of one sentence each; the Proof checks Proposition 3 per person and per day.

	The worlds run in a Web Worker ($lib/sandbox-9/lab.worker.js), so the page never freezes; the fields are drawn from
	one animation loop at most 30 times a second, each on one canvas.

	Layout (phone first): on an upright phone the two fields are stacked, one action button sits at the lower right and
	everything else is in a bottom sheet that covers at most half the screen; on a phone on its side the fields sit
	side by side, the sheet becomes an aside that slides in from the right and the action button is at the lower left;
	on a wide screen the page scrolls, the fields above, the charts below.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount, onDestroy } from 'svelte';
	import { wayBack } from '$lib/app/back.svelte.js';
	import { EXPERIMENTS } from './experiments.js';
	import { guessText } from './guesses.js';
	import Field from './Field.svelte';
	import LabCharts from './LabCharts.svelte';
	import RuleCards from './RuleCards.svelte';
	import ProofView from './ProofView.svelte';

	const LIST = Object.values(EXPERIMENTS);
	const SPEEDS = [
		{ label: 'Slow', dps: 7, hint: 'a week a second' },
		{ label: 'Normal', dps: 30, hint: 'a month a second' },
		{ label: 'Fast', dps: 91, hint: 'a year in 4 seconds' },
		{ label: 'Fastest', dps: Infinity, hint: 'as fast as it runs' }
	];
	const BASIC = [
		{ label: 'Food', unit: 'kg' },
		{ label: 'Water', unit: 'litre' },
		{ label: 'Energy', unit: 'kWh' },
		{ label: 'A bed', unit: 'night' }
	];
	const GOOD_LABEL = ['Food', 'Water', 'Energy', 'Beds', 'Glulam', 'Steel', 'Glass', 'Solar panels', 'Goods', 'Hot spring', 'Aven services'];
	const GOOD_UNIT = ['kg', 'litre', 'kWh', 'night', 't', 't', 't', 'kWp', 'kg', 'hour', 'hour'];
	/** plain names for the settings an experiment changes */
	const SETTING = {
		law5: (v) => `Law 5 at ${Math.round(v * 100)} %`,
		heartsPerDay: (v) => `${v} HEARTS a day`,
		geothermal: (v) => `geothermal ${v ? 'on' : 'off'}`,
		geoStages: (v) => `${v} geothermal stages`,
		rd: (v) => `R&D ${v ? 'on' : 'off'}`,
		springSites: (v) => `${v} spring sites`,
		ownerSpend: (v) => (v === 'dividends' ? 'owners spend dividends only' : 'owners spend normally'),
		shocks: (v) => (v?.length ? `${v.length} scheduled shock${v.length > 1 ? 's' : ''}` : 'no shocks'),
		coopsPerGood: (v) => `${v} COOP${v > 1 ? 's' : ''} a good`,
		priceRule: (v) => `${v} prices`,
		payout: (v) => (v ? 'treasuries pay out' : 'treasuries keep'),
		landRule: (v) => (v === 'private' ? 'private land' : 'City land'),
		bootstrap: (v) => (v ? 'bootstrap' : 'no bootstrap'),
		popGrowth: (v) => `population +${Math.round(v * 100)} % a year`,
		people: (v) => `${v} people`,
		melt: (v) => `melt ${Math.round(v * 100)} %`,
		reserveDays: (v) => `reserve ${v} days`,
		coopsOf: (v) => (v ? Object.entries(v).map(([g, n]) => `${n} ${g} COOP${n > 1 ? 's' : ''}`).join(', ') : 'two COOPs of each good'),
		allocBy: (v) => (v === 'price' ? 'HEARTS follow pool prices' : 'HEARTS follow delivered output')
	};
	/** settings that only size or label a run, never a rule */
	const QUIET = new Set(['maxYears', 'fieldPeople', 'label', 'testMode']);
	/** the one rule an experiment changes, in a few words, for each side */
	function sides(exp) {
		const keys = [...new Set([...Object.keys(exp.base ?? {}), ...Object.keys(exp.changed ?? {})])].filter((k) => !QUIET.has(k) && JSON.stringify(exp.base?.[k]) !== JSON.stringify(exp.changed?.[k]));
		const say = (cfg) => keys.map((k) => (SETTING[k] ? SETTING[k](cfg?.[k]) : `${k} ${JSON.stringify(cfg?.[k])}`)).join(', ');
		return { base: say(exp.base) || 'as it is', changed: say(exp.changed) || 'changed' };
	}

	// ── where we are ──
	let tab = $state(/** @type {'experiments' | 'rules' | 'proof'} */ ('experiments'));
	let expId = $state(/** @type {string | null} */ (null));
	const exp = $derived(expId ? EXPERIMENTS[expId] : null);
	const side = $derived(exp ? sides(exp) : { base: '', changed: '' });
	let stage = $state(/** @type {'guess' | 'run' | 'end'} */ ('guess'));
	let guess = $state(-1);
	let playing = $state(false);
	let speed = $state(91);
	let bars = $state(-1);
	let selected = $state(/** @type {any} */ (null));
	let sheetOpen = $state(true);
	let error = $state('');

	// ── what the worker sends ──
	let meta = $state.raw(/** @type {any} */ (null));
	let day = $state(0);
	let days = $state(1);
	let latest = $state.raw(/** @type {{ base: any, changed: any } | null} */ (null));
	let panel = $state.raw(/** @type {any} */ (null));
	let result = $state.raw(/** @type {any} */ (null));
	let version = $state(0);
	let pts = $state.raw({ base: /** @type {any[]} */ ([]), changed: /** @type {any[]} */ ([]) });
	let perf = $state({ msPerYear: 0, fps: 0 });
	/** @type {Worker | null} */
	let worker = null;
	/** @type {any} */
	let fieldA = $state(null);
	/** @type {any} */
	let fieldB = $state(null);
	let lastUi = 0;

	// ── layout ──
	let mode = $state(/** @type {'phone' | 'side' | 'wide'} */ ('wide'));
	function measure() {
		const w = window.innerWidth, h = window.innerHeight;
		mode = h <= 500 && w > h ? 'side' : w >= 900 ? 'wide' : 'phone';
	}
	onMount(() => {
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});

	// the way back closes an open experiment first
	$effect(() => {
		if (!expId) return;
		return wayBack('Back to the experiments', close);
	});

	function open(id) {
		close();
		expId = id;
		stage = 'guess';
		guess = -1;
		playing = false;
		selected = null;
		result = null;
		panel = null;
		latest = null;
		meta = null;
		error = '';
		day = 0;
		pts = { base: [], changed: [] };
		version++;
		sheetOpen = true;
		worker = new Worker(new URL('./lab.worker.js', import.meta.url), { type: 'module' });
		worker.onmessage = onMessage;
		worker.onerror = (e) => (error = e.message || 'The simulation stopped.');
		worker.postMessage({ type: 'start', id, speed });
		startLoop();
		window.scrollTo?.(0, 0);
	}
	function close() {
		worker?.terminate();
		worker = null;
		expId = null;
		playing = false;
		stopLoop();
	}
	onDestroy(close);

	function onMessage(/** @type {MessageEvent} */ e) {
		const m = e.data;
		if (m.type === 'meta') {
			meta = m;
			days = m.days;
		} else if (m.type === 'frame') {
			fieldA?.setFrame(m.base);
			fieldB?.setFrame(m.changed);
			if (m.points.base.length) {
				pts.base.push(...m.points.base);
				pts.changed.push(...m.points.changed);
			}
			day = m.day;
			if (m.msPerYear) perf.msPerYear = m.msPerYear;
			const now = performance.now();
			if (m.panel) panel = m.panel;
			if (now - lastUi > 250 || m.panel) {
				latest = { base: m.base, changed: m.changed };
				version++;
				lastUi = now;
			}
		} else if (m.type === 'done') {
			result = m.result;
			perf.msPerYear = m.result.msPerYear;
			stage = 'end';
			playing = false;
			sheetOpen = true;
			version++;
		} else if (m.type === 'error') error = m.message.split('\n')[0];
	}

	// ── the one action ──
	function action() {
		if (!worker) return;
		if (stage === 'end') return open(/** @type {string} */ (expId));
		if (stage === 'guess') stage = 'run';
		playing = !playing;
		worker.postMessage({ type: playing ? 'play' : 'pause' });
		if (playing && mode !== 'wide') sheetOpen = false;
	}
	const actionLabel = $derived(stage === 'end' ? 'Again' : stage === 'guess' ? 'Run' : playing ? 'Pause' : 'Play');
	function setSpeed(dps) {
		speed = dps;
		worker?.postMessage({ type: 'speed', speed: dps });
	}

	// ── one animation loop for both fields, at most 30 frames a second ──
	let raf = 0;
	let lastDraw = 0;
	let frames = 0;
	let fpsAt = 0;
	function startLoop() {
		if (raf) return;
		const loop = (/** @type {number} */ now) => {
			raf = requestAnimationFrame(loop);
			if (now - lastDraw < 32) return;
			lastDraw = now;
			fieldA?.draw(now);
			fieldB?.draw(now);
			frames++;
			if (now - fpsAt > 1000) {
				perf.fps = Math.round((frames * 1000) / (now - fpsAt));
				frames = 0;
				fpsAt = now;
			}
		};
		raf = requestAnimationFrame(loop);
	}
	function stopLoop() {
		cancelAnimationFrame(raf);
		raf = 0;
	}

	// ── reading the latest frame ──
	const counter = $derived.by(() => {
		const f = latest?.base;
		const y = Math.min(Math.max(1, Math.round(days / 365)), Math.floor(Math.max(0, day - 1) / 365) + 1);
		return { year: y, month: f?.month ?? 'Jan', of: Math.round(days / 365), shocks: [...new Set([...(latest?.base?.shocks ?? []), ...(latest?.changed?.shocks ?? [])])] };
	});
	const bands = $derived.by(() =>
		(meta?.shocks?.changed ?? []).concat(meta?.shocks?.base ?? []).map((s) => ({ from: s.day, to: s.day + (s.days ?? (s.kind === 'coopFail' ? 365 : 90)), label: shockLabel(s) }))
	);
	function shockLabel(s) {
		return { drought: 'Drought', darkWinter: 'Dark winter', coopFail: `${s.coop ?? 'A COOP'} fails`, wellFail: 'Geothermal well down', germany: 'Holdings as unequal as Germany’s', ring: 'A founder ring' }[s.kind] ?? s.kind;
	}
	const fmt = (/** @type {number} */ x, d = 2) => (Number.isFinite(x) ? (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-GB') : Math.abs(x) >= 10 ? x.toFixed(1) : x.toPrecision(d + 1).replace(/\.?0+$/, '')) : '–');
	const ratio = (/** @type {number} */ x) => (Number.isFinite(x) ? (x >= 100 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`) : '–');

	function pick(p) {
		selected = p && (p.kind === 'person' || p.kind === 'coop') ? p : null;
		if (selected && mode !== 'wide') sheetOpen = true;
	}
	/** the selected person in both worlds (same seed, same people) */
	const person = $derived.by(() => {
		void version;
		if (selected?.kind !== 'person' || !latest) return null;
		const i = selected.i;
		const one = (f) =>
			f && i < f.N
				? {
						decile: f.dec[i] + 1,
						owner: !!f.owner[i],
						hold: f.hold[i],
						div: f.div[i],
						aven: f.aven[i],
						living: f.living[i],
						met: f.met[i],
						basic: f.basicCostR,
						lim: [0, 1, 2, 3].map((b) => ({ lim: f.lim[i * 4 + b], price: f.price[b], pos: barScale(f, b) }))
					}
				: null;
		return { i, base: one(latest.base), changed: one(latest.changed) };
	});
	const coop = $derived.by(() => {
		void version;
		if (selected?.kind !== 'coop' || !latest) return null;
		const one = (f) => {
			const c = f?.coops.find((x) => x.id === selected.id);
			return c ? { ...c, basic: f.basicCostR } : null;
		};
		return { id: selected.id, base: one(latest.base), changed: one(latest.changed) };
	});
	/** the cost floor in words for a Law 5 share λ: variable cost ÷ (1 − λ), as the seller keeps 1 − λ of a sale */
	const floorText = (/** @type {number} */ l) => (Number.isFinite(l) ? (l > 0 ? `variable cost ÷ ${fmt(1 - l)}: it keeps ${Math.round(100 * (1 - l))} % of a sale` : 'its variable cost: with Law 5 at 0 % it keeps all of a sale') : 'variable cost ÷ (1 − the Law 5 share)');
	/**
	 * where a limit bar ends: a log scale over today's spread of everyone's limit ÷ price for that basic (from half the
	 * lowest, or half the price if anyone is below it, to twice the highest), so the bars show how people differ
	 */
	const barScale = (/** @type {any} */ f, /** @type {number} */ b) => {
		const lo = Math.log10(Math.min(0.5, (f?.limLo?.[b] ?? 0.1) / 2) || 0.05), hi = Math.log10(Math.max(2, (f?.limHi?.[b] ?? 1000) * 2));
		return (/** @type {number} */ x) => (x > 0 ? Math.max(0, Math.min(100, ((Math.log10(x) - lo) / (hi - lo)) * 100)) : 0);
	};
</script>

{#snippet guessBlock()}
	<section class="guess">
		<p class="eyebrow">What do you expect?</p>
		<h2>{exp?.question}</h2>
		<p class="rule"><b>The one rule changed:</b> {exp?.ruleChanged}</p>
		<div class="choices" role="radiogroup" aria-label="Your guess">
			{#each exp?.guesses ?? [] as g, j}
				<button role="radio" aria-checked={guess === j} class:on={guess === j} onclick={() => (guess = j)}>{guessText(g)}</button>
			{/each}
		</div>
		<p class="fine">Pick a guess, then press Run. Both worlds start from the same seed ({meta?.seed ?? '…'}), {meta?.people ?? 250} people, {Math.round(days / 365)} years.</p>
	</section>
{/snippet}

{#snippet endBlock()}
	{#if result}
		{@const mine = guess >= 0 ? result.guesses[guess] : null}
		<section class="end">
			<p class="eyebrow">What happened</p>
			<p class="takeaway">{result.takeaway}</p>
			{#if mine}
				<p class="you {mine.right === true ? 'yes' : mine.right === false ? 'no' : ''}">
					{#if mine.right === true}✓ Your guess came true: “{mine.text}”{:else if mine.right === false}✕ Your guess did not come true: “{mine.text}”{:else}Your guess: “{mine.text}”. This run cannot judge it; read the takeaway.{/if}
				</p>
			{:else}
				<p class="you">You ran it without a guess.</p>
			{/if}
			<ul class="others">
				{#each result.guesses as g, j}
					{#if j !== guess}<li><span class={g.right === true ? 'yes' : g.right === false ? 'no' : ''}>{g.right === true ? '✓ came true' : g.right === false ? '✕ did not' : '· not judged'}</span> {g.text}</li>{/if}
				{/each}
			</ul>
			<p class="verdict {result.verdict.pass ? 'yes' : 'no'}">{#if result.verdict.pass}<b>✓ This claim held in this run:</b> “{result.verdict.claim}”{:else}<b>✕ This claim failed in this run:</b> “{result.verdict.claim}”{/if}</p>
			<details>
				<summary>Evidence and every number</summary>
				<p class="fine">{result.verdict.evidence}</p>
				<div class="scroll">
					<table>
						<thead><tr><th>Measure</th><th>{side.base}</th><th>{side.changed}</th></tr></thead>
						<tbody>
							{#each result.metrics as m}
								<tr><td>{m.label}</td><td>{typeof m.base === 'number' ? fmt(m.base, 3) : JSON.stringify(m.base)}</td><td>{typeof m.changed === 'number' ? fmt(m.changed, 3) : JSON.stringify(m.changed)}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		</section>
	{/if}
{/snippet}

{#snippet controls()}
	<div class="controls">
		<div class="speeds" role="group" aria-label="Speed">
			{#each SPEEDS as s}<button class:on={speed === s.dps} title={s.hint} onclick={() => setSpeed(s.dps)}>{s.label}</button>{/each}
		</div>
		<label class="barsel">Limit bars
			<select bind:value={bars}>
				<option value={-1}>off</option>
				{#each BASIC as b, j}<option value={j}>{b.label.toLowerCase()}</option>{/each}
			</select>
		</label>
	</div>
{/snippet}

{#snippet scores()}
	{#if latest}
		<div class="scores">
			{#each [['base', side.base], ['changed', side.changed]] as [w, label]}
				{@const s = latest[w].score}
				<div class="score {w}">
					<b>{w === 'base' ? 'Base' : 'Changed'}</b> <span class="lbl">{label}</span>
					<span>short today <b>{s.shortToday}</b></span>
					<span>person-days short <b>{s.shortPD}</b></span>
					<span>owner-only dividends ÷ basics <b>{ratio(s.strict)}</b></span>
					<span>poorest tenth <b>{fmt(s.poorL)}</b> R a day</span>
					<span>receiverships <b>{s.exits}</b>, foundings <b>{s.founded}</b></span>
				</div>
			{/each}
		</div>
		<p class="fine units">Prices are in R: about what the MIND made by one HEART is worth. A day of basics (food, water, energy, a bed) costs {fmt(latest.base.basicCostR)} R here today. HEARTS are never a price.</p>
	{/if}
{/snippet}

{#snippet pickedBlock()}
	{#if person}
		<section class="picked">
			<header><b>Person {person.i + 1}</b><button class="x" onclick={() => (selected = null)} aria-label="Close">×</button></header>
			{#each [['base', 'Base'], ['changed', 'Changed']] as [w, label]}
				{@const p = person[w]}
				{#if p}
					<div class="who {w}">
						<p><b>{label}:</b> {p.owner ? 'owner-only (no Aven work, started with nothing)' : `holdings tenth ${p.decile}`} · holds {fmt(p.hold)} R · dividends today {fmt(p.div)} R · living standard {fmt(p.living)} R a day{p.met < 0.98 ? ' · short of a basic' : ''}</p>
						{#each p.lim as l, b}
							<div class="lim" title="Can pay up to {fmt(l.lim)} R a {BASIC[b].unit}; the price is {fmt(l.price)} R">
								<span>{BASIC[b].label}</span>
								<div class="track"><i class:low={l.lim < l.price} style:width="{l.pos(l.price > 0 ? l.lim / l.price : 0)}%"></i><em style:left="{l.pos(1)}%"></em></div>
								<span class="r">{l.price > 0 ? ratio(l.lim / l.price) : '–'}</span>
							</div>
						{/each}
					</div>
				{/if}
			{/each}
			<p class="fine">Bar: the most this person can pay for a unit today while spending at most a 30th of what they hold plus today’s dividends (after the other basics); the mark is today’s price. Green above the mark: they can pay. Log scale over today’s spread between people.</p>
		</section>
	{:else if coop}
		<section class="picked">
			<header><b>{coop.id}</b><button class="x" onclick={() => (selected = null)} aria-label="Close">×</button></header>
			{#each [['base', 'Base'], ['changed', 'Changed']] as [w, label]}
				{@const c = coop[w]}
				{#if c}
					<p class="who {w}">
						<b>{label}:</b>
						{c.alive ? '' : `closed (${c.why || 'receivership'}) · `}{GOOD_LABEL[c.good]} · price {fmt(c.priceR, 3)} R a {GOOD_UNIT[c.good]}{c.basic > 0 && c.priceR / c.basic >= 0.01 ? ` (${fmt(c.priceR / c.basic)} days of basics)` : ''} · cost floor {fmt(c.floorR, 3)} R · full cost {fmt(c.fullR, 3)} R · treasury {fmt(c.treasuryR)} R of a {fmt(c.reserveR)} R reserve · made {fmt(c.made)} {GOOD_UNIT[c.good]}, sold {fmt(c.sold)} today · limit: {c.limit}
					</p>
				{:else}
					<p class="who {w}"><b>{label}:</b> not in this world.</p>
				{/if}
			{/each}
			<p class="fine">The bar under a COOP is its price; the tick is its cost floor ({floorText(latest?.base?.law5)}{latest?.changed && latest.changed.law5 !== latest.base?.law5 ? `; in the changed world, ${floorText(latest.changed.law5)}` : ''}). The ring is its treasury against its reserve of 9 months of costs.</p>
		</section>
	{/if}
{/snippet}

{#snippet panelBody()}
	{#if error}<p class="bad">{error}</p>{/if}
	{#if stage === 'guess' && mode !== 'wide'}{@render guessBlock()}{/if}
	{#if stage === 'end'}{@render endBlock()}{/if}
	{@render pickedBlock()}
	{#if mode !== 'wide'}{@render controls()}{/if}
	{@render scores()}
	<LabCharts {pts} {panel} xMax={days} {bands} names={{ base: 'Base', changed: 'Changed' }} {version} />
	<p class="fine perf">This browser: {perf.msPerYear ? `${(perf.msPerYear / 1000).toFixed(2)} s a simulated year for both worlds` : '…'} · {perf.fps} frames a second.</p>
{/snippet}

<div class="lab-root mode-{mode}" class:open={!!expId} class:aside={sheetOpen}>
	{#if !exp}
		<div class="home">
			<header class="top">
				<p class="eyebrow">Sandbox 8 · blob economy</p>
				<h1>Does the post-labour economy work out?</h1>
				<p class="lede">Simulated people, soft blobs, on one hex of land. Nobody is paid to work: they own, through HEARTS that become MIND, and every sale pays its owners. Each experiment changes one rule and runs the same seed side by side. Only physics should limit what they get.</p>
				<div class="tabs" role="tablist">
					{#each [['experiments', 'Experiments'], ['rules', 'Rules'], ['proof', 'Proof']] as [id, label]}
						<button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = /** @type {any} */ (id))}>{label}</button>
					{/each}
				</div>
			</header>
			{#if tab === 'experiments'}
				<div class="cards">
					{#each LIST as e}
						{@const s = sides(e)}
						<button class="card" onclick={() => open(e.id)}>
							<span class="id">{e.id}</span>
							<b>{e.question}</b>
							<span class="vs"><span class="pair"><i class="b"></i>{s.base}</span><span class="pair"><i class="c"></i>{s.changed}</span></span>
							<span class="yrs">{e.people ?? 250} people · {e.years} years · same seed, side by side</span>
						</button>
					{/each}
				</div>
			{:else if tab === 'rules'}
				<RuleCards />
			{:else}
				<ProofView />
			{/if}
		</div>
	{:else}
		<div class="lab">
			<header class="bar">
				<span class="q">{exp.question}</span>
				<span class="count">Year {counter.year} of {counter.of} · {counter.month}{#each counter.shocks as s}<em>{shockLabel({ kind: s })}</em>{/each}</span>
				<i class="prog" style:width="{(100 * day) / Math.max(1, days)}%"></i>
			</header>
			{#if mode === 'wide' && stage === 'guess'}
				<!-- on a wide screen the guess comes first, above the fields and the Run button -->
				<div class="wide-guess">{@render guessBlock()}</div>
			{/if}
			{#if mode === 'wide'}
				<div class="wide-controls">
					<button class="act inline" onclick={action}>{actionLabel}</button>
					{@render controls()}
				</div>
			{/if}
			<div class="fields">
				<Field bind:this={fieldA} label="Base" sub={side.base} tone="base" {selected} {bars} onpick={pick} />
				<Field bind:this={fieldB} label="Changed" sub={side.changed} tone="changed" {selected} {bars} onpick={pick} />
			</div>
			{#if mode === 'wide'}
				<div class="panel">{@render panelBody()}</div>
			{:else}
				<button class="act float" onclick={action} aria-label={actionLabel}>{actionLabel}</button>
				<div class="sheet" class:up={sheetOpen}>
					<button class="handle" onclick={() => (sheetOpen = !sheetOpen)} aria-expanded={sheetOpen}>
						<i></i>
						<span>{stage === 'guess' ? 'What do you expect?' : stage === 'end' ? 'What happened' : 'Charts and controls'}</span>
						<small>{sheetOpen ? 'Hide' : 'Show'}</small>
					</button>
					<div class="body">{@render panelBody()}</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.lab-root {
		position: fixed;
		inset: 0;
		background: var(--cream);
		color: var(--ink);
		overflow-y: auto;
		overflow-x: hidden;
		padding-top: env(safe-area-inset-top, 0px);
	}
	.lab-root.open:not(.mode-wide) {
		overflow: hidden;
	}

	/* ── the picker ── */
	.home {
		max-width: 1180px;
		margin: 0 auto;
		padding: 1.2rem 1rem calc(var(--nav-room) + 1.5rem);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		font-size: clamp(1.8rem, 5vw, 2.8rem);
		margin: 0.3rem 0 0.4rem;
	}
	.lede {
		margin: 0;
		max-width: 44rem;
		color: var(--ink-soft);
		font-size: 0.95rem;
	}
	.tabs {
		display: flex;
		gap: 0.3rem;
		margin-top: 0.9rem;
		flex-wrap: wrap;
	}
	.tabs button,
	.speeds button {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.9rem;
		cursor: pointer;
		color: var(--ink);
	}
	.tabs button.on,
	.speeds button.on {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
		gap: 0.7rem;
	}
	.card {
		text-align: left;
		font: inherit;
		color: inherit;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 0.8rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		cursor: pointer;
		transition: transform 0.12s, box-shadow 0.12s;
	}
	.card:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 18px rgb(38 56 44 / 0.1);
	}
	.card .id {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--muted);
	}
	.card b {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: 1.15rem;
		line-height: 1.2;
	}
	.vs {
		font-size: 0.76rem;
		color: var(--ink-soft);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.15rem 0.35rem;
	}
	.vs i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		display: inline-block;
		background: #2a78d6;
	}
	.vs i.c {
		background: #eb6834;
	}
	/* a dot stays with its label */
	.vs .pair {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
		margin-right: 0.4rem;
	}
	.yrs {
		font-size: 0.72rem;
		color: var(--muted);
	}

	/* ── the lab ── */
	.lab {
		display: flex;
		flex-direction: column;
		min-height: 100%;
	}
	.bar {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.8rem;
		background: var(--paper);
		border-bottom: 1px solid var(--line);
		font-size: 0.82rem;
		min-height: 2.4rem;
	}
	.bar .q {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		color: var(--ink-soft);
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}
	.count em {
		font-style: normal;
		font-size: 0.7rem;
		color: #fff;
		background: #c8744f;
		border-radius: 999px;
		padding: 0 0.45rem;
	}
	.prog {
		position: absolute;
		left: 0;
		bottom: -1px;
		height: 2px;
		background: var(--ink);
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		padding: 0.5rem;
	}
	.controls,
	.wide-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.8rem;
		align-items: center;
	}
	.wide-controls {
		padding: 0.5rem 0.8rem 0;
	}
	.speeds {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}
	.speeds button {
		font-size: 0.78rem;
		padding: 0.25rem 0.7rem;
	}
	.barsel {
		font-size: 0.78rem;
		color: var(--ink-soft);
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}
	select {
		font: inherit;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--paper);
		padding: 0.15rem 0.4rem;
	}
	.act {
		border: 0;
		font: inherit;
		font-weight: 700;
		color: var(--paper);
		background: var(--ink);
		cursor: pointer;
		box-shadow: 0 8px 22px rgb(38 56 44 / 0.25);
	}
	.act.inline {
		border-radius: 999px;
		padding: 0.45rem 1.4rem;
		min-width: 6rem;
	}
	.act.float {
		position: fixed;
		z-index: 30;
		right: max(12px, env(safe-area-inset-right, 0px));
		bottom: var(--nav-foot);
		height: var(--nav-height);
		min-width: var(--nav-height);
		padding: 0 1.1rem;
		border-radius: 999px;
		font-size: 0.95rem;
	}
	.wide-guess {
		padding: 0.6rem 0.8rem 0;
		max-width: 1500px;
	}
	.panel {
		padding: 0.5rem 0.8rem calc(var(--nav-room) + 1rem);
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		max-width: 1500px;
	}

	/* wide: fields side by side, as tall as fits */
	.mode-wide .fields {
		height: min(64vh, 620px);
		min-height: 320px;
	}

	/* an upright phone: the two fields stacked, a sheet at the foot over at most half the screen */
	.mode-phone .lab {
		height: 100%;
	}
	.mode-phone .fields {
		flex: 1;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 0.3rem;
		padding: 0.3rem 0.3rem calc(var(--nav-room) + 2.9rem);
		min-height: 0;
	}
	.sheet {
		position: fixed;
		z-index: 20;
		left: 0;
		right: 0;
		bottom: calc(var(--nav-room) - 0.2rem);
		max-height: 50dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
		border-top: 1px solid var(--line);
		border-radius: 18px 18px 0 0;
		box-shadow: 0 -8px 24px rgb(38 56 44 / 0.12);
	}
	/* in the sheet its handle already says what the part is */
	.sheet .eyebrow {
		display: none;
	}
	.sheet .takeaway {
		font-size: 1rem;
	}
	.sheet .guess h2 {
		font-size: 1.15rem;
	}
	.sheet .body {
		display: none;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.2rem 0.8rem 0.9rem;
		flex-direction: column;
		gap: 0.7rem;
	}
	.sheet.up .body {
		display: flex;
	}
	.handle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink);
		padding: 0.55rem 0.9rem 0.45rem;
		cursor: pointer;
		position: relative;
		flex: none;
	}
	.handle i {
		position: absolute;
		top: 4px;
		left: 50%;
		width: 36px;
		height: 4px;
		margin-left: -18px;
		border-radius: 2px;
		background: var(--line);
	}
	.handle small {
		margin-left: auto;
		font-weight: 400;
		color: var(--muted);
	}

	/* a phone on its side: fields side by side, the sheet becomes an aside from the right, the action at the lower left */
	.mode-side .lab {
		height: 100%;
	}
	.mode-side .fields {
		flex: 1;
		min-height: 0;
		padding: 0.3rem 0.3rem calc(var(--nav-room) - 0.3rem) 0.3rem;
	}
	.mode-side .bar {
		padding-right: 7.5rem;
	}
	/* with the aside open, the bar (and its year counter) ends left of it and of its Hide tab */
	.mode-side.aside .bar {
		padding-right: calc(min(400px, 46vw) + 5.5rem);
	}
	.mode-side .act.float {
		right: auto;
		left: max(12px, env(safe-area-inset-left, 0px));
	}
	.mode-side .sheet {
		top: 0;
		/* the aside ends above the navigation pill, so the pill covers none of it */
		bottom: calc(var(--nav-room) - 0.2rem);
		left: auto;
		right: 0;
		width: min(400px, 46vw);
		max-height: none;
		border-radius: 18px 0 0 18px;
		border-top: 0;
		border-bottom: 1px solid var(--line);
		border-left: 1px solid var(--line);
		transform: translateX(100%);
		transition: transform 0.25s ease;
		padding-top: env(safe-area-inset-top, 0px);
		overflow: visible;
	}
	.mode-side .sheet.up {
		transform: none;
	}
	.mode-side .sheet .body {
		display: flex;
		padding-bottom: 0.9rem;
		padding-right: max(0.8rem, env(safe-area-inset-right, 0px));
	}
	.mode-side .handle {
		position: absolute;
		top: 0.3rem;
		right: calc(100% + 0.4rem);
		white-space: nowrap;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		font-size: 0.78rem;
	}
	.mode-side .handle i,
	.mode-side .handle span {
		display: none;
	}
	.mode-side .handle small {
		margin: 0;
		color: var(--ink);
	}
	.mode-side .sheet.up .handle {
		right: calc(100% + 0.4rem);
	}

	/* ── the panel's parts ── */
	.guess h2 {
		font-size: 1.35rem;
		margin: 0.25rem 0;
	}
	.rule {
		margin: 0 0 0.5rem;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}
	.choices {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.choices button {
		text-align: left;
		font: inherit;
		font-size: 0.86rem;
		line-height: 1.4;
		border: 1px solid var(--line);
		background: var(--paper);
		color: var(--ink);
		border-radius: 12px;
		padding: 0.5rem 0.7rem;
		cursor: pointer;
	}
	.choices button.on {
		border-color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--ink);
		background: #fff;
	}
	.fine {
		margin: 0.35rem 0 0;
		font-size: 0.74rem;
		color: var(--muted);
		line-height: 1.4;
	}
	.bad {
		color: #d03b3b;
		font-size: 0.82rem;
	}
	.end {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 0.7rem 0.8rem;
	}
	.takeaway {
		font-family: var(--font-display);
		font-size: 1.12rem;
		line-height: 1.35;
		margin: 0.3rem 0 0.5rem;
	}
	.you,
	.verdict {
		margin: 0.35rem 0;
		font-size: 0.86rem;
	}
	.yes {
		color: #2f7d4f;
	}
	.no {
		color: #c2410c;
	}
	.you.yes,
	.you.no {
		font-weight: 600;
	}
	.others {
		list-style: none;
		margin: 0.2rem 0;
		padding: 0;
		font-size: 0.78rem;
		color: var(--ink-soft);
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.others span {
		font-weight: 600;
		white-space: nowrap;
	}
	details summary {
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--ink-soft);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: 0.74rem;
		margin-top: 0.4rem;
		width: 100%;
	}
	th,
	td {
		text-align: right;
		padding: 0.2rem 0.3rem;
		border-top: 1px solid var(--line);
		font-variant-numeric: tabular-nums;
	}
	th:first-child,
	td:first-child {
		text-align: left;
	}
	.scores {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
		gap: 0.5rem;
	}
	.score {
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.7rem;
		font-size: 0.76rem;
		color: var(--ink-soft);
		background: var(--paper);
		border: 1px solid var(--line);
		border-left: 4px solid #2a78d6;
		border-radius: 10px;
		padding: 0.4rem 0.6rem;
	}
	.score.changed {
		border-left-color: #eb6834;
	}
	.score > b,
	.score span b {
		color: var(--ink);
	}
	.score .lbl {
		flex-basis: 100%;
		order: 0;
	}
	.units {
		margin-top: -0.2rem;
	}
	.picked {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 0.55rem 0.75rem;
	}
	.picked header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.x {
		border: 0;
		background: none;
		font-size: 1.3rem;
		line-height: 1;
		cursor: pointer;
		color: var(--ink-soft);
	}
	.picked .who {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		border-left: 3px solid #2a78d6;
		padding-left: 0.5rem;
	}
	.picked .who.changed {
		border-left-color: #eb6834;
	}
	.who p {
		margin: 0 0 0.25rem;
	}
	.lim {
		display: grid;
		grid-template-columns: 3.4rem 1fr 3.2rem;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.72rem;
	}
	.track {
		position: relative;
		height: 8px;
		background: var(--cream);
		border-radius: 4px;
	}
	.track i {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		background: #2f9e5a;
		border-radius: 4px;
	}
	.track i.low {
		background: #d03b3b;
	}
	.track em {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		background: var(--ink);
	}
	.lim .r {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.perf {
		margin-bottom: 0.5rem;
	}
</style>
