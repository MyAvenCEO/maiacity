<!--
	THE MATH PROBE (/app/math/probe/) — every way out of the math host, tried by formulas made to do harm
	($lib/sandbox/math-probe.js) in the real host ($lib/sandbox/math-host.js): the shell's frame with no origin, the
	frozen math engine checked against its hash, its worker, and the checker that draws what comes back. Every attempt
	must be refused or stopped:
	- a doc whose formulas reach out (\href, \url, \includegraphics, the HTML extension, HTML in \text), blow up (\def
	  bombs, deep nesting, one too long to send) or name commands KaTeX never heard of goes the docs' own way (the
	  Markdown engine, then `typesetIn` in the page's own math shell): each of those is shown as its source, every formula
	  of the paper's kind beside them is typeset, and nothing is drawn but MathML Core and the Markdown engine's own tags;
	  a formula of a million characters, asked of the host, is never sent (and never drawn: laying out a word that long
	  would hold the page in WebKit by itself);
	- in a shell of its own, the engine's worker tries every way out it has, and says what came of each;
	- a batch that never returns ends its worker (its frame removed), the formulas beside it are typeset all the same,
	  and the next batch starts in a fresh worker, while the page's clock never waits (its longest wait named by what
	  the page was at, so a stall says where it came from).
	What reaches out only the canary can tell: `?canary=<address>` aims every attempt there, and scripts/probes.mjs
	(headless Chromium, in CI before every deploy) listens there and fails on anything that arrived. Opened by hand, the
	attempts aim at this site's /__math-probe/, which counts nothing.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount, tick } from 'svelte';
	import { DOC_PICTURE, render } from '$lib/avendb/article.js';
	import { TAGS } from '$lib/markdown/index.js';
	import { latestOf } from '$lib/sandbox/engines.js';
	import { engineCode } from '$lib/sandbox/frame.js';
	import { GOOD, MEGABYTE, SPIN, WORKER_TRIES, hostileDoc, hostileTex, probeEngine } from '$lib/sandbox/math-probe.js';
	import { TIMEOUT, mathShell, typeset, typesetIn } from '$lib/sandbox/math-host.js';
	import { ELEMENTS, MATHML } from '$lib/sandbox/mathml.js';

	// where every attempt aims: the runner's canary (a plain web address), else this site's own
	const given = new URLSearchParams(location.search).get('canary') ?? '';
	const canary = /^https?:\/\/[\w.-]+(:\d{1,5})?(\/[\w-]+)*\/?$/.test(given) ? given.replace(/\/$/, '') : `${location.origin}/__math-probe`;
	const HOSTILE = hostileTex(canary);
	const html = render(hostileDoc(canary), () => '', DOC_PICTURE, { math: true });

	/** what the probe's worker said of each attempt */
	let said = $state({});
	let checks = $state([]);
	let formulas = $state([]);
	let results = $state(null);
	let line = $state('The formulas are trying every way out…');
	/** the doc, drawn the docs' way */
	let doc;

	const t0 = performance.now();
	const ms = () => Math.round(performance.now() - t0);
	/** what the page is at, and the longest the page's clock waited at each (ms) */
	let phase = 'drawing the doc';
	const waits = {};
	const passed = $derived(checks.filter((c) => c.ok).length);
	const add = (name, ok, note) => (checks = [...checks, { name, ok: !!ok, note }]);
	const why = (e) => String(e?.message ?? e);

	/** each element and attribute drawn in the doc that neither the Markdown engine nor the checker writes */
	function strays(root) {
		const bad = [];
		for (const el of root.querySelectorAll('*')) {
			const math = el.namespaceURI === MATHML;
			const allowed = math ? ELEMENTS[el.localName] : el.namespaceURI === 'http://www.w3.org/1999/xhtml' ? TAGS[el.localName] : null;
			if (!allowed) {
				bad.push(`<${el.localName}> (${el.namespaceURI})`);
				continue;
			}
			for (const a of el.attributes) if (!allowed.includes(a.name)) bad.push(`${el.localName}[${a.name}]`);
		}
		return bad;
	}

	/** whatever drawn in the doc leads anywhere or runs anything */
	function reaches(root) {
		const bad = [];
		for (const el of root.querySelectorAll('*'))
			for (const a of el.attributes) if (/^on|^(href|src|srcset|style|xlink:href|action|formaction|id|data|poster)$/i.test(a.name)) bad.push(`${el.localName}[${a.name}=${a.value.slice(0, 60)}]`);
		const els = root.querySelectorAll('script, iframe, object, embed, link, style, a, form, img:not([data-picture]), svg, image, use');
		for (const el of els) bad.push(`<${el.localName}>`);
		return bad;
	}

	async function theDoc() {
		const code = await engineCode('math').catch((e) => (add('The engine is the frozen one, its bytes checked against its hash', false, why(e)), null));
		if (code) add('The engine is the frozen one, its bytes checked against its hash', true, `math engine ${latestOf('math')?.v}, ${code.length} characters, as engines.json names them`);
		await tick();
		phase = 'typesetting the doc';
		await typesetIn(doc);
		phase = 'checking what was drawn';
		const spans = [...doc.querySelectorAll('span.math[data-math]')];
		const drawn = (s) => !!s?.querySelector(':scope > math');
		formulas = [...GOOD.map((tex, i) => ({ what: tex, want: 'typeset', typeset: drawn(spans[i]) })), ...HOSTILE.map(([what, , want], i) => ({ what, want, typeset: drawn(spans[GOOD.length + i]) }))];
		const lost = formulas.filter((f) => f.want === 'typeset' && !f.typeset);
		const tagged = spans[1]?.querySelector('mtable mtext')?.textContent ?? '';
		add("Formulas of the paper's kind are typeset: inline, numbered, gathered, in a table cell and in a caption", spans.length === GOOD.length + HOSTILE.length && !lost.length && tagged === '(1)', lost.length ? `not typeset: ${lost.map((f) => f.what).join('; ')}` : spans.length !== GOOD.length + HOSTILE.length ? `${spans.length} formulas found, not ${GOOD.length + HOSTILE.length}` : `${GOOD.length} of them, the numbered one's number “${tagged}” at its right`);
		const wrong = formulas.filter((f) => f.want === 'source' && f.typeset);
		const kept = formulas.filter((f) => f.want === 'source' && !f.typeset).length;
		add('Every formula that reaches out, blows up or is unknown shows its source', !wrong.length, wrong.length ? `typeset: ${wrong.map((f) => f.what).join('; ')}` : `${kept} of them, each its LaTeX as text`);
		const stray = strays(doc);
		add("Nothing is drawn but MathML Core and the Markdown engine's tags", !stray.length, stray.length ? stray.slice(0, 12).join(', ') : `${doc.querySelectorAll('*').length} elements, each with only its own attributes`);
		const out = reaches(doc);
		add('Nothing drawn leads anywhere or runs anything', !out.length, out.length ? out.slice(0, 12).join(', ') : 'no address, handler, style, link, script or frame');
		phase = 'a formula of a million characters';
		const t = performance.now();
		const [mega] = await typeset([{ tex: MEGABYTE, display: true }]);
		add('A formula of a million characters is never sent', mega === null, mega === null ? `its source kept, in ${Math.round(performance.now() - t)} ms` : 'it was typeset');
	}

	async function theWorker() {
		phase = "the worker's tries";
		const shell = await mathShell(probeEngine(() => engineCode('math'), canary));
		const stops = [];
		const stop = shell.stop.bind(shell);
		shell.stop = (w) => (stops.push({ at: ms(), why: String(w) }), stop(w));
		try {
			const got = await shell.ask('probe', { site: location.origin });
			said = got.out ?? {};
		} catch (e) {
			said = { '(the probe)': `no answer: ${why(e)}` };
		}
		const open = WORKER_TRIES.filter((t) => String(said[t] ?? '').startsWith('OPEN'));
		const silent = WORKER_TRIES.filter((t) => !said[t]);
		add('Its worker gets out no way', !open.length && !silent.length, open.length ? `open: ${open.map((t) => `${t} (${said[t]})`).join('; ')}` : silent.length ? `no word of: ${silent.join(', ')}` : `${WORKER_TRIES.length} ways out of its worker, every one refused`);
		// the frame: no origin, so the page reaches nothing of it and it nothing of the page's
		const frame = shell.frame;
		let reached = 'nothing';
		try {
			reached = frame?.contentWindow?.document ? 'its document' : 'nothing';
		} catch {}
		const walls = frame?.getAttribute('sandbox') === 'allow-scripts' && frame.contentDocument === null && reached === 'nothing' && /default-src 'none'/.test(frame.srcdoc) && /connect-src 'none'/.test(frame.srcdoc);
		add('Its frame has no origin and no connection', walls, walls ? `sandbox="allow-scripts", its document out of the page's reach, its policy “default-src 'none'; connect-src 'none'”; its worker: ${said['an origin'] ?? '?'}` : `sandbox=${frame?.getAttribute('sandbox')}, the page reached ${reached}`);

		// a batch that never returns: its worker ended, the formula beside it typeset, the spinning one its source
		phase = 'a batch that never returns';
		const t = ms();
		const [beside, spun] = await typeset([{ tex: 'y^{2}' }, { tex: SPIN }], { shell });
		const took = ms() - t;
		const ended = stops.filter((s) => /ran longer than/.test(s.why));
		add('A batch that runs past its time ends its worker', ended.length >= 1 && !frame?.isConnected && shell.frame === null, ended.length ? `${ended.length} times, after ${(TIMEOUT / 1000).toFixed(0)} s each: “${ended[0].why}”, its frame removed with its worker` : 'it was never ended');
		add('The formulas beside it are typeset; it shows its source', !!beside && !spun, `y² ${beside ? 'typeset' : 'not typeset'}, the spinning formula ${spun ? 'typeset' : 'its source'}, in ${(took / 1000).toFixed(1)} s`);
		phase = 'the next batch';
		const [next] = await typeset([{ tex: 'z_{n}' }], { shell });
		add('The next batch starts in a fresh worker', !!next && !!shell.frame && shell.frame !== frame, next ? 'typeset in a new frame and worker' : 'it was not typeset');
		stop('the probe is through');
	}

	onMount(() => {
		// the page's clock: how long it ever waited while the formulas ran
		let [last, gap] = [performance.now(), 0];
		const clock = setInterval(() => {
			const now = performance.now();
			gap = Math.max(gap, now - last);
			waits[phase] = Math.max(waits[phase] ?? 0, now - last);
			last = now;
		}, 50);
		(async () => {
			await theDoc().catch((e) => add('The doc is drawn', false, why(e)));
			await theWorker().catch((e) => add('The probe shell runs', false, why(e)));
			clearInterval(clock);
			const where = Object.entries(waits).map(([p, w]) => `${p} ${Math.round(w)} ms`).join(', ');
			add('The page goes on meanwhile', gap < 1000, `the page’s clock never waited more than ${Math.round(gap)} ms (the longest wait while ${where})`);
			results = { canary, ms: ms(), said: { ...said }, checks, formulas, waits };
			line = checks.every((c) => c.ok) ? 'Every check passed.' : 'Some checks failed.';
		})();
		return () => clearInterval(clock);
	});
</script>

<svelte:head><title>Math probe · maiaCITY</title></svelte:head>

<main class="app-page">
	<header>
		<p class="eyebrow">The math host</p>
		<h1>Every way out of a formula</h1>
		<p class="dim">
			Formulas made to do harm, in the real math host as a doc's would be: KaTeX in our frozen math engine, in a worker of a
			frame with no origin, and every formula's MathML held to the checker before it is drawn. Some reach out, some blow
			up, one names a command KaTeX never heard of, one never returns; the engine's worker tries every way out it has.
			Every attempt aims at <code>{canary}/…</code>.
		</p>
		<p class="dim" data-line>{line}</p>
	</header>

	{#if checks.length}
		<section>
			<h2>Checks · {passed} of {checks.length} passed</h2>
			<ul class="checks">
				{#each checks as c}
					<li class:bad={!c.ok}><b>{c.ok ? '✓' : '✗'} {c.name}</b><small>{c.note}</small></li>
				{/each}
			</ul>
		</section>
	{/if}

	<section>
		<h2>What its worker tried</h2>
		<ul class="tries">
			{#each WORKER_TRIES as t}
				<li class:bad={said[t]?.startsWith('OPEN')}><b>{t}</b> {said[t] ?? '…'}</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>The formulas</h2>
		<ul class="tries">
			{#each formulas as f}
				<li class:bad={f.want !== 'either' && f.typeset !== (f.want === 'typeset')}><b>{f.what}</b> {f.typeset ? 'typeset' : 'its source'}</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>The doc, as the docs draw it</h2>
		<div class="doc" bind:this={doc}>{@html html}</div>
	</section>

	{#if results}<pre id="results" hidden>{JSON.stringify(results)}</pre>{/if}
</main>

<style>
	.app-page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.6rem clamp(1rem, 4vw, 2rem) 6rem;
	}
	.dim {
		color: var(--muted);
	}
	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		margin: 0.2rem 0 0.4rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 2.8rem);
	}
	h2 {
		margin: 1.6rem 0 0.6rem;
		font-family: var(--font-display);
		font-size: 1.3rem;
	}
	code {
		overflow-wrap: anywhere;
	}
	.checks,
	.tries {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.checks li {
		display: grid;
		gap: 0.1rem;
		padding: 0.45rem 0.55rem;
		border-radius: 8px;
		background: #edf2e6;
	}
	.checks li b {
		font-weight: 600;
		color: #2f5a22;
	}
	.checks li.bad {
		background: #f6e1dc;
	}
	.checks li.bad b,
	.tries li.bad b {
		color: #a3312a;
	}
	.checks small,
	.tries {
		color: rgb(31 42 35 / 0.7);
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}
	.tries b {
		color: var(--ink);
		font-weight: 600;
	}
	/* a formula's source can be long: the doc keeps to its box */
	.doc {
		max-height: 30rem;
		overflow: auto;
		overflow-wrap: anywhere;
	}
	.doc :global(.math[data-math='display']) {
		display: block;
		overflow-x: auto;
		text-align: center;
	}
</style>
