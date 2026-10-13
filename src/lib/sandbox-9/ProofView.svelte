<!--
	Sandbox 8 · the Proof: Proposition 3 part by part (no one starves, no one has to work, living standards rise for
	everyone, abundance limited only by physics), each pass or fail with its evidence, then every experiment's verdict
	and takeaway. It reads static/sandbox-9/proof.json (written by scripts/sandbox-9-proof-json.mjs from full 30-year
	runs), and can run the suite again here, in quick mode, in a few Web Workers ($lib/sandbox-9/proof.worker.js).
	Every pass and fail is the engine's own, computed from the runs ($lib/sandbox-9/proofRun.js).

	Above the verdicts, the base world itself, read from the saved full run (proof.json `suite`): how people live per
	tenth year by year (the Living table, first), what the village imports to be built and to eat until its food
	forest bears (Imports), and every parameter it ran with (World).
-->
<script>
	// @ts-nocheck — plain JS
	import { base } from '$app/paths';
	import { onMount, onDestroy } from 'svelte';
	import { proofJobs, assemble, engineHash, ENGINE_FILES } from './proofRun.js';
	import { livingOf, importsOf } from './params.js';
	import { DAY } from '../sandbox-7/specs.js';
	import LivingView from './LivingView.svelte';
	import ImportsView from './ImportsView.svelte';
	import WorldParams from './WorldParams.svelte';
	import * as ENG from './engine.js';

	// the engine's own source files, loaded only for their hash (to tell a saved proof older than this engine)
	const sources = import.meta.glob('./*.js', { query: '?raw', import: 'default' });
	let hashNow = $state(/** @type {string | null} */ (null));

	let saved = $state(/** @type {any} */ (null));
	let live = $state(/** @type {any} */ (null));
	let missing = $state(false);
	let running = $state(false);
	let jobs = $state(/** @type {{ label: string, state: string, ms?: number }[]} */ ([]));
	let error = $state('');
	/** @type {Worker[]} */
	let workers = [];
	let t0 = 0;

	onMount(async () => {
		try {
			const r = await fetch(`${base}/sandbox-9/proof.json`, { cache: 'no-cache' });
			if (!r.ok) throw new Error(String(r.status));
			saved = await r.json();
		} catch {
			missing = true;
		}
		try {
			const texts = {};
			for (const f of ENGINE_FILES) texts[f] = await sources['./' + f]();
			hashNow = engineHash(texts);
		} catch {
			hashNow = null;
		}
	});
	onDestroy(stop);

	const shown = $derived(live ?? saved);
	/** the saved proof (or its suite summary) was computed by another version of the engine than this page runs */
	const stale = $derived(!live && !!saved && !!hashNow && saved.engineHash !== hashNow);
	const suiteNow = $derived(saved?.suite && hashNow && saved.suite.engineHash === hashNow ? saved.suite : null);

	function stop() {
		for (const w of workers) w.terminate();
		workers = [];
		running = false;
	}

	function rerun() {
		stop();
		error = '';
		live = null;
		const list = proofJobs(true).sort((a, b) => b.years * (b.kind === 'exp' ? 2 : 1) - a.years * (a.kind === 'exp' ? 2 : 1));
		jobs = list.map((j) => ({ label: j.kind === 'base' ? `Base world, seed ${j.seed}, ${j.years} years` : `${j.id}, ${j.years} years`, state: 'waiting' }));
		const par = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
		const results = [];
		let next = 0;
		running = true;
		t0 = performance.now();
		const feed = (/** @type {Worker} */ w) => {
			if (next >= list.length) return void w.terminate();
			const j = next++;
			jobs[j].state = 'running';
			w.onmessage = (e) => {
				if (e.data.error) {
					error = e.data.error.split('\n')[0];
					jobs[j].state = 'error';
				} else {
					results.push(e.data.result);
					jobs[j].state = e.data.result.kind === 'base' ? (e.data.result.pass ? 'pass' : 'fail') : e.data.result.verdict.pass ? 'pass' : 'fail';
					jobs[j].ms = e.data.result.ms;
				}
				if (results.length + jobs.filter((x) => x.state === 'error').length === list.length) {
					live = assemble(results, { quick: true, where: 'browser', wallMs: performance.now() - t0, engineHash: hashNow, suite: suiteNow });
					stop();
				} else feed(w);
			};
			w.postMessage({ job: list[j] });
		};
		for (let i = 0; i < par; i++) {
			const w = new Worker(new URL('./proof.worker.js', import.meta.url), { type: 'module' });
			workers.push(w);
			feed(w);
		}
	}

	/**
	 * The base world of the saved full run (proof.json `suite`): its parameters (paramsBase merged with the seed's own),
	 * its living standards and village totals by year, and its border ledger with the founding bill.
	 */
	const baseWorld = $derived.by(() => {
		const su = saved?.suite;
		if (!su) return null;
		const seed = su.living?.seed ?? su.border?.seed ?? su.village?.seed ?? su.seeds?.[0]?.seed;
		const pb = su.paramsBase ?? null;
		const own = (su.seeds ?? []).find((x) => x.seed === seed)?.params ?? null;
		const settings = pb ? { ...(pb.defaults ?? {}), ...(own?.overrides ?? {}) } : null;
		const catalog = pb ? { ...(pb.catalog ?? {}), ...(own?.catalog ?? {}) } : {};
		const L = su.living?.years ?? null, V = su.village?.years ?? null;
		const living = livingOf(L, V, catalog, DAY);
		const imports = importsOf(su.border?.years ?? null, su.border?.founding ?? null, V, { firstFedYear: su.border?.firstFedYear, exportsCoverYear: su.border?.exportsCoverYear }, L);
		const years = Math.max(L?.length ?? 0, su.border?.years?.length ?? 0);
		return {
			seed,
			years,
			people: settings?.people ?? null,
			params: settings ? { settings, catalog, village: pb.village ?? null } : null,
			defaults: pb?.defaults ?? null,
			living,
			imports,
			indoor: su.village?.indoorMonths ?? null
		};
	});
	/** every catalog record the engine reads, for the World part (the same for every world) */
	const catalogRecs = () => {
		try {
			return ENG.catalogAll?.() ?? null;
		} catch {
			return null;
		}
	};
	const nParams = $derived(baseWorld?.params ? Object.keys(baseWorld.params.settings).length + Object.keys(baseWorld.params.catalog).length : 0);

	const done = $derived(jobs.filter((j) => j.state !== 'waiting' && j.state !== 'running').length);
	const when = (/** @type {string} */ iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	let openParts = $state(/** @type {Record<string, boolean>} */ ({}));
</script>

<div class="proof">
	<header>
		<h2>Proposition 3, checked</h2>
		<p class="lede">For every person on every day, never on averages: no one starves, no one has to work to survive, and living standards rise for everyone, limited only by physics.</p>
	</header>

	{#if baseWorld && (baseWorld.living || baseWorld.imports || baseWorld.params)}
		<section class="world">
			<h3 class="sub">The base world: how people live</h3>
			<p class="fine">{baseWorld.people ? `${baseWorld.people.toLocaleString('en-GB')} people, ` : ''}seed {baseWorld.seed}, {baseWorld.years} years from the founding (day 0 is move-in day), from the saved full run{saved?.suite?.generated ? ` of ${when(saved.suite.generated)}` : ''}.{stale ? ' This page’s engine is newer than that run, so its numbers can differ.' : ''}</p>
			<LivingView worlds={[baseWorld.living]} names={['Base']} indoor={baseWorld.indoor} />
			<h3 class="sub">What the village imports</h3>
			<ImportsView worlds={[baseWorld.imports]} names={['Base']} />
			{#if baseWorld.params}
				<details class="params">
					<summary><b>Every parameter of the base world</b> <span>{nParams} settings and constants and the village plan, grouped, in plain units</span></summary>
					<WorldParams sets={[baseWorld.params]} names={['Base']} defaults={baseWorld.defaults} records={catalogRecs()} />
				</details>
			{/if}
		</section>
	{:else if saved && !saved.suite?.living}
		<p class="fine">The saved proof has no yearly living standards or import ledger yet (they come with the next full run: node scripts/sandbox-9-proof.mjs, then node scripts/sandbox-9-proof-json.mjs).</p>
	{/if}

	{#if shown}
		<h3 class="sub">The verdicts</h3>
		<div class="verdict" class:ok={shown.pass}>
			<span class="badge">{shown.pass ? '✓ Holds' : '✕ Not everything holds'}</span>
			<span>
				{shown.mode === 'full' ? 'Full run' : 'Quick run'}{shown.where === 'browser' ? ' in this browser' : ''}: {shown.seeds.length} seeds × {shown.baseYears} years, {shown.people} people{shown.wallMs ? `, ${(shown.wallMs / 1000).toFixed(0)} s` : ''} · {when(shown.generated)}
			</span>
		</div>

		{#if stale}
			<p class="bad">This saved proof was computed by an older version of the engine than this page runs (engine {saved.engineHash ?? 'unknown'}, page {hashNow}). Its numbers can differ from what the page shows; run it again below.</p>
		{/if}
		{#if !shown.suiteUsed}
			<p class="fine">The parts below read the base worlds and the experiments only{saved?.suite ? '; the full proof suite’s scenarios were run with another engine, so their verdicts are left out' : ''}. The full suite (node scripts/sandbox-9-proof.mjs) adds the longer scenarios.</p>
		{/if}

		<div class="parts">
			{#each shown.parts as p}
				<article class="part" class:ok={p.pass}>
					<h3><span class="mark" aria-hidden="true">{p.pass ? '✓' : '✕'}</span>{p.title} <small>{p.pass ? 'pass' : 'fail'}</small></h3>
					<p class="claim">{p.claim}</p>
					<ul>
						{#each openParts[p.id] ? p.evidence : p.evidence.slice(0, 2) as line}<li>{line}</li>{/each}
					</ul>
					{#if p.evidence.length > 2}<button class="more" onclick={() => (openParts[p.id] = !openParts[p.id])}>{openParts[p.id] ? 'Less' : `All ${p.evidence.length} lines`}</button>{/if}
				</article>
			{/each}
		</div>

		<h3 class="sub">The experiments</h3>
		<div class="exps">
			{#each shown.experiments as e}
				<details class="exp" class:ok={e.pass}>
					<summary>
						<span class="mark" aria-hidden="true">{e.pass ? '✓' : '✕'}</span>
						<span class="id">{e.id}</span>
						<span class="q">{e.question}</span>
						<span class="st">{e.pass ? 'pass' : 'fail'}</span>
					</summary>
					<p><b>Takeaway.</b> {e.takeaway}</p>
					<p><b>Claim.</b> {e.claim}</p>
					<p><b>Evidence.</b> {e.evidence}</p>
					<p class="fine">Rule changed: {e.ruleChanged} · {e.years} years{e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''}</p>
				</details>
			{/each}
		</div>

		{#if shown.ledgers?.length}
			<p class="fine">Both ledgers checked every day: {shown.ledgers.map((l) => `seed ${l.seed}: ${l.checks} checks, ${l.leaks} leaks`).join(' · ')}.</p>
		{/if}
	{:else if missing}
		<p class="lede">No saved proof yet (static/sandbox-9/proof.json). Run it here in quick mode, or in node with <code>node scripts/sandbox-9-proof-json.mjs</code>.</p>
	{:else}
		<p class="lede">Loading the saved proof…</p>
	{/if}

	<section class="rerun">
		<button class="pill" onclick={running ? stop : rerun}>{running ? 'Stop' : 'Run the proof again here (quick)'}</button>
		<p class="fine">Quick mode: 10-year base worlds on 5 seeds and shorter experiments, in {Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2) - 1))} workers. It takes about a minute.</p>
		{#if jobs.length}
			<p class="fine">{done} of {jobs.length} done{running ? '…' : '.'}</p>
			<ul class="jobs">
				{#each jobs as j}<li class={j.state}><i></i>{j.label}<span>{j.state}{j.ms ? ` · ${(j.ms / 1000).toFixed(1)} s` : ''}</span></li>{/each}
			</ul>
		{/if}
		{#if error}<p class="bad">{error}</p>{/if}
	</section>
</div>

<style>
	.proof {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	h2 {
		font-size: 1.6rem;
	}
	.lede {
		margin: 0.3rem 0 0;
		color: var(--ink-soft);
		font-size: 0.92rem;
	}
	.verdict {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.7rem;
		align-items: center;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}
	.badge {
		font-weight: 700;
		color: #fff;
		background: #d03b3b;
		border-radius: 999px;
		padding: 0.15rem 0.7rem;
	}
	.verdict.ok .badge {
		background: #2f7d4f;
	}
	.parts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
		gap: 0.6rem;
	}
	.part,
	.exp {
		background: var(--paper);
		border: 1px solid var(--line);
		border-left: 4px solid #d03b3b;
		border-radius: 12px;
		padding: 0.6rem 0.75rem;
		min-width: 0;
	}
	.part.ok,
	.exp.ok {
		border-left-color: #2f7d4f;
	}
	h3 {
		font-size: 1.05rem;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	h3 small,
	.st {
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #d03b3b;
		margin-left: auto;
	}
	.ok h3 small,
	.ok .st {
		color: #2f7d4f;
	}
	.mark {
		font-family: var(--font-body);
		font-weight: 700;
		color: #d03b3b;
	}
	.ok .mark {
		color: #2f7d4f;
	}
	.claim {
		margin: 0.3rem 0;
		font-size: 0.84rem;
	}
	ul {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.78rem;
		color: var(--ink-soft);
		line-height: 1.45;
	}
	.more {
		margin-top: 0.3rem;
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.75rem;
		text-decoration: underline;
		color: var(--ink-soft);
		cursor: pointer;
	}
	.sub {
		margin-top: 0.4rem;
	}
	.exps {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	summary {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		cursor: pointer;
		font-size: 0.86rem;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.id {
		font-weight: 700;
	}
	.q {
		flex: 1;
		min-width: 0;
	}
	.exp p {
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
		line-height: 1.45;
	}
	.fine {
		font-size: 0.74rem;
		color: var(--muted);
		margin: 0;
	}
	.bad {
		color: #d03b3b;
		font-size: 0.8rem;
	}
	.rerun {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: flex-start;
	}
	.pill {
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		color: var(--paper);
		font: inherit;
		font-weight: 600;
		font-size: 0.9rem;
		padding: 0.55rem 1.1rem;
		cursor: pointer;
	}
	.jobs {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
		gap: 0.2rem 0.8rem;
		width: 100%;
	}
	.jobs li {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.jobs li span {
		margin-left: auto;
		color: var(--muted);
	}
	.jobs i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--line);
		flex: none;
	}
	.jobs .running i {
		background: #eda100;
	}
	.jobs .pass i {
		background: #2f7d4f;
	}
	.jobs .fail i,
	.jobs .error i {
		background: #d03b3b;
	}
	code {
		font-size: 0.8em;
	}
	.world {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-width: 0;
	}
	.params {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 0.5rem 0.7rem;
	}
	.params[open] summary {
		margin-bottom: 0.5rem;
	}
	.params summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
		align-items: baseline;
	}
	.params summary::before {
		content: '▸';
		color: var(--muted);
	}
	.params[open] summary::before {
		content: '▾';
	}
	.params summary span {
		font-size: 0.74rem;
		color: var(--muted);
	}
</style>
