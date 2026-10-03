<!--
	A story's journey: the transformation it makes (from → to), the one question it holds open to the end, and the
	beats in order along a timeline — each a coloured card with its kind, what happens, and what the viewer should feel
	there. Over the cards runs the tension, beat by beat: the retention curve. Between two beats stands how the second
	follows the first: "but" (it turns) or "therefore" (it follows) — never "and then" (Jenny Hoyos; storyteller:
	arc.md, retention.md). Every change goes to `onchange`; the page saves it.
-->
<script>
	import { BEATS } from '$lib/auth/client';
	import { BEAT_COLOR, BEAT_LABEL, BEAT_NOTE, BEAT_TENSION } from './stories.js';

	/** @typedef {import('$lib/auth/client').Journey} Journey */
	/** @typedef {import('$lib/auth/client').Beat} Beat */
	/** @typedef {import('$lib/auth/client').BeatType} BeatType */

	/** @type {{ journey: Journey, onchange: (journey: Journey) => void }} */
	let { journey, onchange } = $props();

	const beats = $derived(journey?.beats ?? []);
	/** @type {BeatType} the kind the next new beat gets */
	let kind = $state('obstacle');

	/** @param {Partial<Journey>} patch */
	const change = (patch) => onchange({ ...journey, ...patch });
	/** @param {Beat[]} next */
	const setBeats = (next) => change({ beats: next });
	/** @param {number} k @param {Partial<Beat>} patch */
	const edit = (k, patch) => setBeats(beats.map((b, i) => (i === k ? { ...b, ...patch } : b)));

	const newId = () => `b${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
	/** @param {BeatType} type @param {Partial<Beat>} [more] @returns {Beat} */
	const beat = (type, more = {}) => ({ id: newId(), type, title: BEAT_LABEL[type], text: '', tension: BEAT_TENSION[type], ...more });

	function add() {
		setBeats([...beats, beat(kind, beats.length ? { link: kind === 'turn' || kind === 'obstacle' || kind === 'low' ? 'but' : 'therefore' } : {})]);
	}

	/** The arc every story starts from: one beat of each kind, in the order they usually come. */
	function scaffold() {
		setBeats(
			BEATS.map((type, i) =>
				beat(type, i === 0 ? {} : { link: type === 'obstacle' || type === 'low' || type === 'turn' ? 'but' : 'therefore' })
			)
		);
	}

	/** @param {number} k @param {-1 | 1} by */
	function shift(k, by) {
		const j = k + by;
		if (j < 0 || j >= beats.length) return;
		const next = [...beats];
		[next[k], next[j]] = [next[j], next[k]];
		setBeats(next);
	}

	/** @param {number} k */
	const drop = (k) => setBeats(beats.filter((_, i) => i !== k));

	/** but → therefore → (none) → but @param {number} k */
	const cycle = (k) => {
		const now = beats[k].link;
		edit(k, { link: now === 'but' ? 'therefore' : now === 'therefore' ? undefined : 'but' });
	};

	// the curve: one point per beat at its tension, smooth between them, over the cards' centres
	const W = 100;
	/** @param {Beat} b */
	const yOf = (b) => 8 + (1 - (b.tension ?? 0.5)) * 84;
	const path = $derived.by(() => {
		if (!beats.length) return '';
		const pts = beats.map((b, k) => [k * W + W / 2, yOf(b)]);
		let d = `M ${pts[0][0]} ${pts[0][1]}`;
		for (let k = 1; k < pts.length; k++) {
			const [x0, y0] = pts[k - 1];
			const [x1, y1] = pts[k];
			d += ` C ${x0 + W / 2} ${y0}, ${x1 - W / 2} ${y1}, ${x1} ${y1}`;
		}
		return d;
	});
	const area = $derived(beats.length ? `${path} L ${beats.length * W - W / 2} 100 L ${W / 2} 100 Z` : '');

	const buts = $derived(beats.filter((b, k) => k > 0 && b.link === 'but').length);
	const therefores = $derived(beats.filter((b, k) => k > 0 && b.link === 'therefore').length);
	const andThens = $derived(beats.filter((b, k) => k > 0 && !b.link).length);
</script>

<div class="journey">
	<!-- the transformation, and the question held open -->
	<section class="shift">
		<label class="from">
			<span>From</span>
			<textarea rows="2" value={journey?.from ?? ''} placeholder="What the viewer believes when they arrive" oninput={(e) => change({ from: e.currentTarget.value })}></textarea>
		</label>
		<span class="arrow" aria-hidden="true">→</span>
		<label class="to">
			<span>To</span>
			<textarea rows="2" value={journey?.to ?? ''} placeholder="What they leave with" oninput={(e) => change({ to: e.currentTarget.value })}></textarea>
		</label>
		<label class="question">
			<span>The question it holds open to the end</span>
			<input value={journey?.question ?? ''} placeholder="One concrete question, answered only in the last beat" oninput={(e) => change({ question: e.currentTarget.value })} />
		</label>
	</section>

	<div class="tools">
		<p class="tally">
			{beats.length} {beats.length === 1 ? 'beat' : 'beats'}
			{#if beats.length > 1}· <b class="but">{buts} but</b> · <b class="therefore">{therefores} therefore</b>{#if andThens}· <b class="and">{andThens} “and then”</b>{/if}{/if}
		</p>
		<span class="grow"></span>
		<select bind:value={kind} aria-label="The kind of the new beat">
			{#each BEATS as t (t)}<option value={t}>{BEAT_LABEL[t]}</option>{/each}
		</select>
		<button class="add" onclick={add}>+ Beat</button>
	</div>

	{#if !beats.length}
		<div class="blank">
			<p>No beats yet. A journey is a row of short beats, each one a turn (<b>but</b>) or a consequence (<b>therefore</b>) of the one before.</p>
			<button class="add" onclick={scaffold}>Start from the arc: hook → context → problem → … → vision</button>
		</div>
	{:else}
		<div class="scroll">
			<div class="track" style:--n={beats.length}>
				<!-- the tension, beat by beat -->
				<svg class="curve" viewBox="0 0 {beats.length * W} 100" preserveAspectRatio="none" aria-hidden="true">
					<defs>
						<linearGradient id="tension-fill" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0" stop-color="#e39a2d" stop-opacity="0.28" />
							<stop offset="1" stop-color="#e39a2d" stop-opacity="0" />
						</linearGradient>
					</defs>
					<path d={area} fill="url(#tension-fill)" />
					<path d={path} fill="none" stroke="#c9822a" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linecap="round" />
				</svg>

				{#each beats as b, k (b.id)}
					<div class="col" style:--c={BEAT_COLOR[b.type] ?? '#999'}>
						<div class="peak">
							<span class="dot" style:top="{yOf(b)}%" title="Tension {Math.round((b.tension ?? 0.5) * 100)}"></span>
							{#if b.feel}<span class="feel" style:top="{yOf(b)}%">{b.feel}</span>{/if}
						</div>
						{#if k > 0}
							<button class="link {b.link ?? 'none'}" onclick={() => cycle(k)} title="How this beat follows the one before (click to change)">
								{b.link === 'but' ? 'but' : b.link === 'therefore' ? 'therefore' : 'and then?'}
							</button>
						{/if}
						<article class="beat">
							<header>
								<span class="no">{k + 1}</span>
								<select value={b.type} aria-label="Kind" title={BEAT_NOTE[b.type]} onchange={(e) => edit(k, { type: /** @type {BeatType} */ (e.currentTarget.value) })}>
									{#each BEATS as t (t)}<option value={t}>{BEAT_LABEL[t]}</option>{/each}
								</select>
								<span class="grow"></span>
								<button class="mini" disabled={k === 0} onclick={() => shift(k, -1)} aria-label="Earlier">‹</button>
								<button class="mini" disabled={k === beats.length - 1} onclick={() => shift(k, 1)} aria-label="Later">›</button>
								<button class="mini x" onclick={() => drop(k)} aria-label="Remove">×</button>
							</header>
							<input class="title" value={b.title} maxlength="160" placeholder={BEAT_LABEL[b.type]} aria-label="What happens" oninput={(e) => edit(k, { title: e.currentTarget.value })} />
							<textarea class="text" value={b.text} rows="4" maxlength="4000" placeholder={BEAT_NOTE[b.type]} aria-label="The beat, in a few lines" oninput={(e) => edit(k, { text: e.currentTarget.value })}></textarea>
							<label class="feelin">
								<span>They feel</span>
								<input value={b.feel ?? ''} maxlength="80" placeholder="curiosity, unease, awe…" oninput={(e) => edit(k, { feel: e.currentTarget.value || undefined })} />
							</label>
							<label class="tension">
								<span>Tension</span>
								<input type="range" min="0" max="100" value={Math.round((b.tension ?? 0.5) * 100)} oninput={(e) => edit(k, { tension: Number(e.currentTarget.value) / 100 })} />
							</label>
						</article>
					</div>
				{/each}
			</div>
		</div>

		<ul class="legend" aria-label="The kinds of beat">
			{#each BEATS as t (t)}<li style:--c={BEAT_COLOR[t]}><i></i><b>{BEAT_LABEL[t]}</b> {BEAT_NOTE[t]}</li>{/each}
		</ul>
	{/if}
</div>

<style>
	.journey {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
	}

	label span {
		display: block;
		margin-bottom: 0.25rem;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	input,
	textarea,
	select {
		box-sizing: border-box;
		width: 100%;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink);
	}

	textarea {
		resize: vertical;
		line-height: 1.45;
	}

	input:focus-visible,
	textarea:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--mustard);
		outline-offset: 1px;
	}

	/* ── from → to, and the question ── */
	.shift {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: end;
		gap: 0.8rem 1rem;
	}

	.shift textarea {
		font-family: var(--font-display);
		font-size: 1.05rem;
	}

	.arrow {
		padding-bottom: 0.9rem;
		font-size: 1.6rem;
		color: var(--terracotta);
	}

	.question {
		grid-column: 1 / -1;
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.tools select {
		width: auto;
		padding-block: 0.35rem;
	}

	.tally {
		margin: 0;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}

	.tally .but {
		color: #c44d3a;
	}

	.tally .therefore {
		color: #2a958d;
	}

	.tally .and {
		color: var(--muted);
	}

	.grow {
		flex: 1;
	}

	.add {
		padding: 0.4rem 0.95rem;
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--paper);
		cursor: pointer;
	}

	.blank {
		padding: 2rem 1.5rem;
		border: 1px dashed var(--line);
		border-radius: 14px;
		text-align: center;
		color: var(--ink-soft);
	}

	.blank p {
		max-width: 34rem;
		margin: 0 auto 1rem;
	}

	/* ── the timeline: the curve over the cards, scrolled sideways ── */
	.scroll {
		overflow-x: auto;
		padding-bottom: 0.6rem;
		overscroll-behavior-x: contain;
	}

	.track {
		--w: 16.5rem;
		--peak: 6rem;
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--n), var(--w));
		width: max-content;
	}

	.curve {
		position: absolute;
		top: 0;
		left: 0;
		width: calc(var(--n) * var(--w));
		height: var(--peak);
		overflow: visible;
	}

	.col {
		position: relative;
		padding: 0 0.55rem;
	}

	.peak {
		position: relative;
		height: var(--peak);
	}

	.dot {
		position: absolute;
		left: 50%;
		width: 12px;
		height: 12px;
		border: 2px solid #fff;
		border-radius: 50%;
		background: var(--c);
		box-shadow: 0 0 0 1px var(--c);
		transform: translate(-50%, -50%);
	}

	.feel {
		position: absolute;
		left: calc(50% + 10px);
		max-width: calc(50% - 10px);
		overflow: hidden;
		font-size: 0.7rem;
		font-style: italic;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink-soft);
		transform: translateY(-50%);
	}

	/* how this beat follows the one before: on the seam between the two cards */
	.link {
		position: absolute;
		top: calc(var(--peak) + 0.05rem);
		left: 0;
		z-index: 1;
		padding: 0.12rem 0.5rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
		transform: translateX(-50%);
	}

	.link.but {
		color: #c44d3a;
	}

	.link.therefore {
		color: #2a958d;
	}

	.link.none {
		border-style: dashed;
		font-weight: 500;
		color: var(--muted);
	}

	.beat {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin-top: 1.5rem;
		padding: 0.6rem 0.65rem 0.7rem;
		border: 1px solid color-mix(in srgb, var(--c) 35%, var(--line));
		border-top: 5px solid var(--c);
		border-radius: 12px;
		background: color-mix(in srgb, var(--c) 9%, #fff);
	}

	.beat header {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.no {
		min-width: 1.4rem;
		font-family: var(--font-display);
		font-size: 1rem;
		color: var(--c);
	}

	.beat header select {
		width: auto;
		padding: 0.15rem 0.4rem;
		border-color: transparent;
		background: var(--c);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #fff;
	}

	.mini {
		padding: 0 0.35rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.95rem;
		color: var(--muted);
		cursor: pointer;
	}

	.mini:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.mini:hover:not(:disabled) {
		background: #fff;
		color: var(--ink);
	}

	.beat .title {
		font-weight: 600;
	}

	.beat .text {
		font-size: 0.84rem;
	}

	.beat input,
	.beat textarea {
		background: rgb(255 255 255 / 0.8);
	}

	.feelin span,
	.tension span {
		margin-bottom: 0.15rem;
		font-size: 0.62rem;
	}

	.tension input {
		padding: 0;
		border: 0;
		background: none;
		accent-color: var(--c);
	}

	/* ── the kinds of beat ── */
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1.1rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.74rem;
		color: var(--muted);
	}

	.legend i {
		display: inline-block;
		width: 0.65rem;
		height: 0.65rem;
		margin-right: 0.3rem;
		border-radius: 3px;
		background: var(--c);
		vertical-align: -1px;
	}

	.legend b {
		color: var(--ink-soft);
	}

	@media (max-width: 640px) {
		.shift {
			grid-template-columns: minmax(0, 1fr);
		}

		.arrow {
			padding: 0;
			text-align: center;
			transform: rotate(90deg);
		}

		.track {
			--w: 15rem;
		}
	}
</style>
