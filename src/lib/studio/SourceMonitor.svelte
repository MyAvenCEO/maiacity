<!--
	The source monitor: one file from the library, on its own, beside the program. It plays apart from the timeline
	(never both at once), through the same colour path as the program (its proxy in Edit); I and O mark the part to use,
	and "Add to timeline" — or a drag onto a track — lays just that part down (a video with sound: its picture on V1, its
	sound linked on A3). Under it the file's transcript: click a word to go there, drag across words to mark them; and
	its shot analysis — its cues along the bar, and listed: click one to go there, Mark to take it as In and Out.
-->
<script>
	import CueLegend from './CueLegend.svelte';
	import Analysis from './Analysis.svelte';
	import { cueEnd, cuesOf } from './analysis.js';
	import ColorBadge from './ColorBadge.svelte';
	import { WORKING, isSequence, profileFor } from './color.js';
	import { clockText, itemName, raw, tint } from './studio.svelte.js';
	import Transcript from './Transcript.svelte';
	import Viewer from './Viewer.svelte';
	import { wave } from './wave.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	let srcTime = $state(0);
	let srcDuration = $state(0);
	let srcAspect = $state(16 / 9);
	/** @type {number | null} */
	let markIn = $state(null);
	/** @type {number | null} */
	let markOut = $state(null);
	let paused = $state(true);
	/** @type {HTMLImageElement | null} */
	let img = $state(null);
	/** @type {HTMLVideoElement | null} */
	let video = $state(null);
	/** @type {import('./view.js').ViewPlan | null} */
	let plan = $state(null);
	let gl = $state(true);

	const m = $derived(s.preview ? s.byHash.get(s.preview) : undefined);
	const av = $derived(m?.kind === 'audio' || m?.kind === 'video');
	// a video plays from its proxy in Edit (the proxy's own profile then), the original elsewhere
	const px = $derived(s.proxy(m));
	const useProxy = $derived((s.tab === 'edit' || isSequence(m)) && !!px.hash);
	const playItem = $derived((useProxy && px.hash && s.byHash.get(px.hash)) || m);
	const url = $derived(m ? (m.kind === 'video' ? raw(useProxy && px.hash ? px.hash : m.hash) : m.kind === 'audio' ? (s.sources[m.hash]?.url ?? raw(m.hash)) : raw(m.hash)) : '');
	// a proxy is ACEScct, always
	const profile = $derived(playItem !== m ? WORKING : profileFor(m).profile);
	const len = $derived(
		Number.isFinite(srcDuration) && srcDuration > 0 ? srcDuration : m && av ? (s.sources[m.hash]?.duration ?? (Number(m.meta?.duration_s) || 0)) : 0
	);
	const marked = $derived(av && (markIn !== null || markOut !== null));
	const range = $derived.by(() => {
		if (!marked || !len) return undefined;
		const from = Math.min(markIn ?? 0, len), to = Math.min(markOut ?? len, len);
		return to - from >= 0.05 ? { in: from, dur: to - from } : undefined;
	});
	/** @param {number} t */
	const pct = (t) => `${len ? (Math.min(Math.max(t, 0), len) / len) * 100 : 0}%`;

	// a new file: from its start, unmarked
	$effect(() => {
		void s.preview;
		srcTime = 0;
		srcDuration = 0;
		srcAspect = 16 / 9;
		markIn = markOut = null;
	});
	// the player the timeline pauses when it plays (the audio element binds itself)
	$effect(() => {
		if (m?.kind !== 'audio') s.srcEl = m?.kind === 'video' ? video : null;
	});

	/** @param {'in' | 'out'} which */
	function mark(which) {
		if (!av) return;
		const t = s.srcEl?.currentTime ?? srcTime;
		if (which === 'in') {
			markIn = t;
			if (markOut !== null && markOut <= t) markOut = null;
		} else {
			markOut = t;
			if (markIn !== null && markIn >= t) markIn = null;
		}
	}
	const add = () => m && void s.place(m.hash, s.defaultTrack(m), s.time, range);
	/** @param {DragEvent} e */
	function drag(e) {
		if (!m || !e.dataTransfer) return;
		e.dataTransfer.setData('text/x-hash', m.hash);
		if (range) e.dataTransfer.setData('text/x-range', JSON.stringify(range));
	}
	/** A word of the transcript: the player there. @param {number} t */
	function seekTo(t) {
		if (s.srcEl) s.srcEl.currentTime = t;
		srcTime = t;
	}
	/** A run of words: marked in and out (a cut on the words). @param {{ from: number, to: number } | null} r */
	function markWords(r) {
		if (!r) return;
		markIn = r.from;
		markOut = r.to;
		seekTo(r.from);
	}
	/** Click or drag along the source's waveform (or scrub bar) to move through it. */
	/** @param {PointerEvent} e */
	function scrub(e) {
		const bar = /** @type {HTMLElement} */ (e.currentTarget);
		if (!s.srcEl || !len) return;
		e.preventDefault();
		/** @param {PointerEvent} ev */
		const put = (ev) => {
			const r = bar.getBoundingClientRect();
			const t = (Math.min(Math.max(ev.clientX - r.left, 0), r.width) / (r.width || 1)) * len;
			if (s.srcEl) s.srcEl.currentTime = t;
			srcTime = t;
		};
		put(e);
		const up = () => (window.removeEventListener('pointermove', put), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', put);
		window.addEventListener('pointerup', up);
	}
	function playPause() {
		if (!s.srcEl) return;
		if (s.srcEl.paused) void s.srcEl.play();
		else s.srcEl.pause();
	}

	// whatever was last touched decides where I and O go: the source monitor (or the library that fills it), or not
	$effect(() => {
		/** @param {Event} e */
		const inHand = (e) => (s.srcFocus = !!(/** @type {Element | null} */ (e.target))?.closest?.('.source, .items'));
		window.addEventListener('pointerdown', inHand, true);
		window.addEventListener('focusin', inHand, true);
		return () => {
			window.removeEventListener('pointerdown', inHand, true);
			window.removeEventListener('focusin', inHand, true);
		};
	});
	/** @param {KeyboardEvent} e */
	function onKey(e) {
		if ((/** @type {HTMLElement | null} */ (e.target))?.closest?.('input, textarea, select')) return;
		if (s.srcFocus && av && !e.metaKey && !e.ctrlKey && !e.altKey && (e.code === 'KeyI' || e.code === 'KeyO')) {
			e.preventDefault();
			e.stopImmediatePropagation();
			mark(e.code === 'KeyI' ? 'in' : 'out');
		}
	}
</script>

<svelte:window onkeydowncapture={onKey} />

{#if m}
	<section class="source" aria-label="Source">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="shead" draggable="true" ondragstart={drag} title="Drag onto a track">
			<h2 class="mlabel">Source</h2>
			<span class="sname">{String(m.meta?.title ?? itemName(m))}</span>
			{#if m.kind !== 'audio'}<ColorBadge {s} {m} />{/if}
			{#if m.kind === 'video'}<span class="pxb" class:warn={!px.hash}>{useProxy ? 'proxy' : px.hash ? 'original' : 'no proxy yet'}</span>{/if}
			<button class="x" onclick={() => s.closeSource()} aria-label="Close the source monitor">×</button>
		</div>
		<div class="sstage" style:--ar={srcAspect}>
			{#key s.preview}
				{#if m.kind === 'video'}
					<div class="sframe">
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							class:on={!gl}
							bind:this={video}
							bind:currentTime={srcTime}
							bind:duration={srcDuration}
							bind:paused
							src={url}
							crossorigin="anonymous"
							preload="auto"
							playsinline
							onloadedmetadata={(e) => {
								const v = e.currentTarget;
								if (v.videoWidth && v.videoHeight) srcAspect = v.videoWidth / v.videoHeight;
							}}
							onplay={() => s.playing && s.stop()}
						></video>
						<Viewer source={video} {profile} luts={s.luts} aspect={srcAspect} bind:plan bind:supported={gl} />
					</div>
				{:else if m.kind === 'audio'}
					{@const src = s.sources[m.hash]}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="swave" onpointerdown={scrub}>
						{#if src?.peaks.length}
							<canvas use:wave={{ peaks: src.peaks, from: 0, to: src.duration, total: src.duration, color: tint(s.defaultTrack(m)) }}></canvas>
						{:else}
							<span class="hint">Reading the sound…</span>
						{/if}
						{#if marked}<i class="band" style:left={pct(markIn ?? 0)} style:right="calc(100% - {pct(markOut ?? len)})"></i>{/if}
						<i class="sph" style:left={pct(srcTime)}></i>
					</div>
				{:else}
					<div class="sframe">
						<img
							class:on={!gl}
							bind:this={img}
							src={url}
							alt=""
							draggable="false"
							crossorigin="anonymous"
							onload={(e) => {
								const i = /** @type {HTMLImageElement} */ (e.currentTarget);
								if (i.naturalWidth && i.naturalHeight) srcAspect = i.naturalWidth / i.naturalHeight;
							}}
						/>
						<Viewer source={img} {profile} luts={s.luts} aspect={srcAspect} bind:plan bind:supported={gl} />
					</div>
				{/if}
			{/key}
			{#if plan?.note && m.kind !== 'audio'}<span class="note">{plan.note}</span>{/if}
		</div>
		{#if m.kind === 'audio'}
			{#key s.preview}
				<audio
					bind:this={s.srcEl}
					bind:currentTime={srcTime}
					bind:duration={srcDuration}
					src={url}
					crossorigin="anonymous"
					preload="metadata"
					controls
					onplay={() => s.playing && s.stop()}
				></audio>
			{/key}
		{:else if m.kind === 'video'}
			<div class="vbar">
				<button class="pp" onclick={playPause} aria-label={paused ? 'Play the source' : 'Pause the source'}>{paused ? '▶' : '❚❚'}</button>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="sbar" onpointerdown={scrub}>
					{#if marked}<i class="band" style:left={pct(markIn ?? 0)} style:right="calc(100% - {pct(markOut ?? len)})"></i>{/if}
					{#each cuesOf(m) as q, i (i)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<i class="scue cue-kind {q.kind}" class:best={q.best} class:pt={cueEnd(q) - q.s < 0.05} style:left={pct(q.s)} style:right="calc(100% - {pct(cueEnd(q))})" onpointerenter={(e) => (s.cueHover = { q, x: e.clientX, y: e.clientY })} onpointermove={(e) => (s.cueHover = { q, x: e.clientX, y: e.clientY })} onpointerleave={() => (s.cueHover = null)} onpointerdown={(e) => (e.stopPropagation(), seekTo(q.s))}></i>
					{/each}
					<i class="sph" style:left={pct(srcTime)}></i>
				</div>
				<span class="range">{clockText(srcTime)}</span>
			</div>
			<CueLegend cues={cuesOf(m)} />
		{/if}
		<div class="sacts">
			{#if av}
				<button class="ghost small" onclick={() => mark('in')} title="Mark in (I)">Mark in</button>
				<button class="ghost small" onclick={() => mark('out')} title="Mark out (O)">Mark out</button>
				<span class="range">
					{#if range}{clockText(range.in)} → {clockText(range.in + range.dur)} · {clockText(range.dur)}{:else}whole file{/if}
				</span>
				{#if marked}<button class="ghost small" onclick={() => (markIn = markOut = null)}>Clear</button>{/if}
			{/if}
			<span class="grow"></span>
			{#if s.canEdit}
				<button class="add" draggable="true" ondragstart={drag} onclick={add} title="Add at the playhead ({s.defaultTrack(m)}), or drag onto a track">+ Add to timeline</button>
			{/if}
		</div>
		{#if av}
			<div class="strans"><Transcript {m} time={srcTime} onseek={seekTo} onselect={markWords} /></div>
		{/if}
		<div class="sanalysis"><Analysis {m} onseek={seekTo} onmark={av ? (from, to) => ((markIn = from), (markOut = to), seekTo(from)) : undefined} /></div>
		<div class="sinfo">
			<p class="skind">{m.kind}{#if av && len} · {clockText(len)}{/if}{#if m.tags.length} · <span>{m.tags.join(', ')}</span>{/if}</p>
			{#if m.meta?.text}<p class="line">{String(m.meta.text)}</p>{/if}
		</div>
	</section>
{/if}

<style>
	.source {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
		min-height: 0;
		padding: 0.4rem 1rem 0.7rem;
		background: var(--abyss);
	}

	.mlabel {
		margin: 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.shead {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		cursor: grab;
	}

	.sname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.78rem;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.pxb {
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--ok-bg);
		font-size: 0.62rem;
		color: var(--ok);
	}

	.pxb.warn {
		background: var(--warn-bg);
		color: var(--warn);
	}

	.shead .x {
		padding: 0 0.3rem;
		border: 0;
		background: none;
		font-size: 1.1rem;
		line-height: 1;
		color: var(--dim);
		cursor: pointer;
	}

	.shead .x:hover {
		color: var(--ink);
	}

	/* the picture first: it takes most of the column; the transcript scrolls in what is left */
	.sstage {
		position: relative;
		display: grid;
		flex: 3 1 14rem;
		place-items: center;
		min-height: 14rem;
		container-type: size;
	}

	.sframe {
		position: relative;
		display: block;
		overflow: hidden;
		width: min(100cqw, calc(100cqh * var(--ar)));
		aspect-ratio: var(--ar);
		border-radius: 6px;
		background: #000;
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.55);
	}

	.sframe video,
	.sframe img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0;
	}

	.sframe .on {
		z-index: 2;
		opacity: 1;
	}

	.note {
		position: absolute;
		right: 0.3rem;
		bottom: 0.3rem;
		z-index: 3;
		max-width: 90%;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: #2e2410;
		font-size: 0.62rem;
		color: var(--warn);
	}

	.swave,
	.sbar {
		position: relative;
		overflow: hidden;
		cursor: text;
		touch-action: none;
		user-select: none;
	}

	.swave {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: var(--panel);
	}

	.swave canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.vbar {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.5rem;
	}

	.pp {
		width: 1.7rem;
		height: 1.7rem;
		border: 1px solid var(--edge);
		border-radius: 50%;
		background: var(--raised);
		font-size: 0.66rem;
		color: var(--ink);
		cursor: pointer;
	}

	.sbar {
		flex: 1;
		height: 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 4px;
		background: var(--raised);
	}

	.band {
		position: absolute;
		top: 0;
		bottom: 0;
		border-inline: 2px solid var(--accent);
		background: rgb(232 168 58 / 0.24);
		pointer-events: none;
	}

	.sph {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 2px solid var(--rec);
		pointer-events: none;
	}

	.source audio {
		flex: none;
		width: 100%;
		height: 2.2rem;
	}

	.sacts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.range {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.add {
		padding: 0.3rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		font: inherit;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--on-accent);
		cursor: pointer;
	}

	/* the shot analysis' cues along the bar: a stretch, or a point */
	.scue {
		position: absolute;
		bottom: 0;
		height: 35%;
		min-width: 2px;
		border-radius: 1px;
		opacity: 0.85;
		cursor: pointer;
	}

	.scue.pt {
		right: auto !important;
		width: 2px;
		height: 100%;
	}

	.scue:hover {
		opacity: 1;
		height: 60%;
	}

	.sanalysis:not(:empty) {
		padding: 0.4rem 0.6rem;
		border-top: 1px solid var(--edge);
	}

	.strans {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		min-height: 3rem;
		max-height: 30%;
		overflow: auto;
		padding-top: 0.35rem;
		border-top: 1px solid var(--edge);
	}

	.strans > :global(*) {
		flex: 1;
	}

	.sinfo {
		flex: none;
		max-height: 5.5rem;
		overflow: auto;
	}

	.skind {
		margin: 0 0 0.2rem;
		font-size: 0.72rem;
		color: var(--dim);
	}

	.skind span {
		overflow-wrap: anywhere;
	}

	.line {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.82rem;
		line-height: 1.4;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--dim);
	}

	.grow {
		flex: 1;
	}
</style>
