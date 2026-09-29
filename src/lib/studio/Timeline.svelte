<!--
	The timeline: picture (V1), voice (A1), music (A2), sound (A3) and the captions (T1) that follow the voice. Every clip
	moves by hand in Edit — drag it to move it, drag its edges to trim it, click it to see and set it in the inspector —
	and nothing moves once the edit is locked. A world clip (a shot as data) sits on V1 like any other; selected, its
	keyframe lanes open under the tracks: the camera's keys, the hour, the exposure, the lights and the cues (a sound cue
	lands on A3, where it plays).
-->
<script>
	import ColorBadge from './ColorBadge.svelte';
	import { evaluate, shotAt, toKeys } from './shots.js';
	import { TRACKS, isWorld, thumb, tint } from './studio.svelte.js';
	import { wave } from './wave.js';

	/** @typedef {import('$lib/auth/client').ShotSpec} ShotSpec */
	/** @typedef {import('./studio.svelte.js').Clip} Clip */
	/** @typedef {import('./studio.svelte.js').Track} Track */
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	/** @param {number} t */
	const x = (t) => `${t * s.pxPerSec}px`;
	const ticks = $derived.by(() => {
		const every = s.pxPerSec >= 40 ? 1 : s.pxPerSec >= 15 ? 5 : 10;
		return Array.from({ length: Math.floor(s.span / every) + 1 }, (_, i) => i * every);
	});
	/** the world clip whose lanes are open */
	const wc = $derived(s.tab === 'edit' && isWorld(s.sel) ? s.sel : null);
	const spec = $derived(wc ? s.specOf(wc) : null);
	const LANES = ['Camera', 'Hour', 'Exposure', 'Lights', 'Cues'];
	const rows = $derived(`1.5rem minmax(2.6rem, 1fr) repeat(4, minmax(1.7rem, 1fr))${spec ? ` repeat(${LANES.length}, 1.45rem)` : ''}`);
	/** timeline time of a shot-local time in the open world clip */
	/** @param {number} t */
	const tl = (t) => (wc ? wc.start + (t - wc.in) : 0);
	/** @param {number} t */
	const inClip = (t) => !!wc && t >= wc.in - 1e-6 && t <= wc.in + wc.dur + 1e-6;

	// ── by hand: move, trim, seek, drop ──────────────────────────────────────
	/** @param {PointerEvent} e @param {Clip} c @param {'move' | 'left' | 'right'} mode */
	function grab(e, c, mode) {
		e.stopPropagation();
		e.preventDefault();
		s.selected = c.id;
		s.selectedKey = null;
		if (!s.canEdit) return;
		const x0 = e.clientX, s0 = c.start, i0 = c.in, d0 = c.dur;
		const isImage = !isWorld(c) && s.byCid.get(c.cid ?? '')?.kind === 'image';
		const max = isImage ? Infinity : isWorld(c) ? (s.specOf(c)?.seconds ?? d0 + i0) : (s.sources[c.cid ?? '']?.duration ?? d0 + i0);
		let moved = false;
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			const dt = (ev.clientX - x0) / s.pxPerSec;
			if (Math.abs(ev.clientX - x0) > 1) moved = true;
			const i = s.clips.findIndex((k) => k.id === c.id);
			if (i < 0) return;
			const k = { ...s.clips[i] };
			if (mode === 'move') k.start = Math.max(0, s.snap(s0 + dt));
			if (mode === 'left') {
				// trimming the head: the clip starts later and plays from further in (a world clip: later in its move — never faster)
				const d = Math.min(Math.max(s.snap(dt), -Math.min(s0, isImage ? s0 : i0)), d0 - 0.2);
				k.start = s0 + d;
				k.in = isImage ? 0 : i0 + d;
				k.dur = d0 - d;
			}
			if (mode === 'right') k.dur = Math.min(Math.max(0.2, s.snap(d0 + dt)), max - i0);
			s.clips[i] = k;
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			if (moved) {
				s.changed();
				if (s.playing) s.schedule();
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	/** @param {PointerEvent} e */
	function scrub(e) {
		const lanes = s.lanes;
		if (!lanes) return;
		// a click in the world clip's lanes moves the playhead and keeps the clip (and its lanes) in hand
		if (!(/** @type {Element} */ (e.target)).closest?.('.lane')) s.selected = null;
		s.selectedKey = null;
		/** @param {PointerEvent} ev */
		const put = (ev) => s.seek((ev.clientX - lanes.getBoundingClientRect().left) / s.pxPerSec);
		put(e);
		const up = () => (window.removeEventListener('pointermove', put), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', put);
		window.addEventListener('pointerup', up);
	}

	/** @param {DragEvent} e @param {Track} track */
	async function drop(e, track) {
		e.preventDefault();
		if (!s.lanes) return;
		const at = (e.clientX - s.lanes.getBoundingClientRect().left) / s.pxPerSec;
		const shot = e.dataTransfer?.getData('text/x-shot');
		if (shot) {
			if (track !== 'V1') return void (s.error = 'A world shot goes on V1.');
			const got = await shotAt(shot, Number(e.dataTransfer?.getData('text/x-shot-version')) || undefined);
			if (got) s.placeShot(got, at);
			return;
		}
		const cid = e.dataTransfer?.getData('text/x-cid');
		if (!cid) return;
		// from the source monitor a drag carries the marked range too
		/** @type {{ in: number, dur: number } | undefined} */
		let range;
		try {
			const r = JSON.parse(e.dataTransfer?.getData('text/x-range') || 'null');
			if (r && typeof r.in === 'number' && typeof r.dur === 'number') range = r;
		} catch {
			/* no range: the whole file */
		}
		void s.place(cid, track, at, range);
	}

	// ── the world clip's lanes ────────────────────────────────────────────────
	const keys = $derived(spec?.camera.kind === 'keys' ? (spec.camera.keys ?? []) : null);
	/** @param {PointerEvent} e @param {number} i */
	function dragKey(e, i) {
		e.stopPropagation();
		e.preventDefault();
		s.selectedKey = i;
		if (!wc || !keys || !s.canEdit) return;
		const clip = wc, x0 = e.clientX, t0 = keys[i].t;
		s.seek(tl(t0));
		let moved = false;
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			const dt = (ev.clientX - x0) / s.pxPerSec;
			if (Math.abs(ev.clientX - x0) < 2 && !moved) return;
			moved = true;
			const t = Math.min(clip.in + clip.dur, Math.max(clip.in, Math.round((t0 + dt) * 30) / 30));
			s.editSpec(clip, (sp) => {
				const k = sp.camera.keys?.[i];
				if (k) k.t = t;
			});
			s.seek(tl(t));
		};
		const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	/** A key where the camera is at that moment (so adding one changes nothing until it is moved). */
	/** @param {MouseEvent} e */
	function addKey(e) {
		e.stopPropagation();
		if (!wc || !spec || !s.canEdit || !s.lanes) return;
		const at = (e.clientX - s.lanes.getBoundingClientRect().left) / s.pxPerSec;
		const t = Math.min(wc.in + wc.dur, Math.max(wc.in, wc.in + (at - wc.start)));
		const ev = evaluate(spec, t);
		/** @type {import('$lib/auth/client').CameraKey} */
		const k = { t: Math.round(t * 30) / 30, position: [ev.pose[0], ev.pose[1], ev.pose[2]], yaw: ev.pose[3], pitch: ev.pose[4], fov: ev.fov };
		s.editSpec(wc, (sp) => {
			const list = sp.camera.kind === 'keys' ? (sp.camera.keys ?? []) : (toKeys(sp) ?? []);
			sp.camera = { kind: 'keys', curve: sp.camera.curve ?? 'glide', keys: [...list, k].sort((a, b) => a.t - b.t) };
		});
		s.seek(tl(k.t));
	}
	/** @param {PointerEvent} e @param {number} i */
	function dragCue(e, i) {
		e.stopPropagation();
		e.preventDefault();
		if (!wc || !spec || !s.canEdit) return;
		const clip = wc, x0 = e.clientX, t0 = spec.cues[i].at;
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			const t = Math.min(clip.in + clip.dur, Math.max(clip.in, Math.round((t0 + (ev.clientX - x0) / s.pxPerSec) * 30) / 30));
			s.editSpec(clip, (sp) => void (sp.cues[i].at = t));
		};
		const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	/** @param {number} v */
	const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();
	/** @param {ShotSpec} sp */
	const hourText = (sp) => `${fmt(sp.time.hour)} h${sp.time.hourTo !== undefined && sp.time.hourTo !== sp.time.hour ? ` → ${fmt(sp.time.hourTo)} h` : ''}`;
	/** @param {ShotSpec} sp */
	const expText = (sp) => `${sp.exposure.meter} · ${sp.exposure.stops >= 0 ? '+' : ''}${fmt(sp.exposure.stops)} stops${sp.exposure.ev !== undefined ? ` · EV ${fmt(sp.exposure.ev)}` : ''}`;
	/** @param {ShotSpec} sp */
	const lightText = (sp) =>
		sp.lights.length ? sp.lights.map((l) => `${l.id} ${Array.isArray(l.intensity) ? '∿' : fmt(l.intensity ?? 1, 2)}`).join(' · ') : 'no light changes';
</script>

<div class="timeline" style:--rows={rows}>
	<div class="heads">
		<div class="head"></div>
		{#each TRACKS as t (t.id)}<div class="head"><b>{t.id}</b> {t.label}</div>{/each}
		{#if spec}
			{#each LANES as l (l)}<div class="head lane-head">{l}</div>{/each}
		{/if}
	</div>
	<div class="scroll">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="lanes" class:locked={!s.canEdit} bind:this={s.lanes} style:width={x(s.span)} onpointerdown={scrub}>
			<div class="ruler">
				{#each ticks as t (t)}<span class="tick" style:left={x(t)}>{t}s</span>{/each}
			</div>
			{#each TRACKS as t (t.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="track" ondragover={(e) => t.id !== 'T1' && s.canEdit && e.preventDefault()} ondrop={(e) => t.id !== 'T1' && drop(e, /** @type {Track} */ (t.id))}>
					{#if t.id === 'T1'}
						{#each s.clips.filter((c) => c.track === 'A1') as c (c.id)}
							{@const words = s.captionWords.filter((w) => w.clip === c.id)}
							{#if words.length}
								<div class="clip caps" style:left={x(words[0].t)} style:width={x(Math.max(0.3, c.start + c.dur - words[0].t))}>
									<span>{words.map((w) => w.word).join(' ')}</span>
								</div>
							{/if}
						{/each}
					{:else}
						{#each s.clips.filter((c) => c.track === t.id) as c (c.id)}
							{@const m = c.cid ? s.byCid.get(c.cid) : undefined}
							{@const src = c.cid ? s.sources[c.cid] : undefined}
							{@const world = isWorld(c)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="clip {world ? 'world' : m?.kind} {t.id}"
								class:sel={s.selected === c.id}
								class:graded={!!c.grade}
								style:left={x(c.start)}
								style:width={x(c.dur)}
								onpointerdown={(e) => grab(e, c, 'move')}
								title={world ? `${s.clipName(c)} · world shot v${c.shotVersion}` : s.clipName(c)}
							>
								{#if m?.kind === 'image'}
									<img src={thumb(m)} alt="" draggable="false" />
								{:else if m?.kind === 'audio' && src}
									<canvas use:wave={{ peaks: src.peaks, from: c.in, to: c.in + c.dur, total: src.duration, color: tint(/** @type {Track} */ (t.id)) }}></canvas>
								{/if}
								<span class="label">{s.clipName(c)}{#if world}<i>&nbsp;v{c.shotVersion}</i>{/if}</span>
								{#if t.id === 'V1'}
									<span class="chips">
										{#if world}<b class="wtag">world</b>{:else if m}<ColorBadge {s} {m} />{#if m.kind === 'video' && !s.proxy(m).cid}{@const st = s.proxy(m).state}<b class="nopx" title="No proxy yet: the original plays">{st === 'none' ? 'no proxy' : `proxy ${st}`}</b>{/if}{/if}
										{#if c.grade}<b class="gr" title="Graded">◐</b>{/if}
									</span>
								{/if}
								{#if s.canEdit}
									<i class="edge l" onpointerdown={(e) => grab(e, c, 'left')}></i>
									<i class="edge r" onpointerdown={(e) => grab(e, c, 'right')}></i>
								{/if}
							</div>
						{/each}
						{#if t.id === 'A3'}
							{#each s.cueClips as q (q.id)}
								{@const src = s.sources[q.cid ?? '']}
								<div class="clip audio A3 cue" style:left={x(q.start)} style:width={x(q.dur)} title="A sound cue of a world shot (edit it in its Cues lane)">
									{#if src}<canvas use:wave={{ peaks: src.peaks, from: 0, to: q.dur, total: src.duration, color: tint('A3') }}></canvas>{/if}
									<span class="label">cue · {s.byCid.get(q.cid ?? '')?.title || 'sound'}</span>
								</div>
							{/each}
						{/if}
					{/if}
				</div>
			{/each}
			{#if spec && wc}
				<!-- the world clip's keyframe lanes -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="lane" ondblclick={addKey} title={s.canEdit ? 'Double-click to add a camera key here' : ''}>
					<i class="span" style:left={x(wc.start)} style:width={x(wc.dur)}></i>
					{#if keys}
						{#each keys as k, i (i)}
							<button
								class="key"
								class:on={s.selectedKey === i}
								class:out={!inClip(k.t)}
								style:left={x(tl(k.t))}
								onpointerdown={(e) => dragKey(e, i)}
								ondblclick={(e) => e.stopPropagation()}
								aria-label="Camera key at {fmt(k.t, 2)} s"
							></button>
						{/each}
					{:else}
						<span class="val" style:left={x(wc.start)}>{spec.camera.kind} ({spec.camera.curve ?? 'glide'}) — preset move</span>
					{/if}
				</div>
				<div class="lane"><i class="span hour" style:left={x(wc.start)} style:width={x(wc.dur)}></i><span class="val" style:left={x(wc.start)}>{hourText(spec)}</span></div>
				<div class="lane"><i class="span" style:left={x(wc.start)} style:width={x(wc.dur)}></i><span class="val" style:left={x(wc.start)}>{expText(spec)}</span></div>
				<div class="lane"><i class="span" style:left={x(wc.start)} style:width={x(wc.dur)}></i><span class="val" style:left={x(wc.start)}>{lightText(spec)}</span></div>
				<div class="lane">
					<i class="span" style:left={x(wc.start)} style:width={x(wc.dur)}></i>
					{#each spec.cues as q, i (i)}
						<button
							class="key cue {q.kind}"
							class:out={!inClip(q.at)}
							style:left={x(tl(q.at))}
							onpointerdown={(e) => dragCue(e, i)}
							title={q.kind === 'sound' ? `sound cue (lands on A3) at ${fmt(q.at, 2)} s` : `${q.name} at ${fmt(q.at, 2)} s`}
							aria-label="Cue at {fmt(q.at, 2)} s"
						></button>
					{/each}
				</div>
			{/if}
			<div class="playhead" style:left={x(s.time)}><i></i></div>
		</div>
	</div>
</div>

<style>
	.timeline {
		grid-area: timeline;
		display: grid;
		grid-template-columns: 7rem 1fr;
		min-height: 0;
		overflow-y: auto;
		background: var(--bg);
	}

	.heads {
		display: grid;
		grid-template-rows: var(--rows);
		border-right: 1px solid var(--edge);
		background: var(--panel);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.7rem;
		border-bottom: 1px solid var(--edge);
		font-size: 0.75rem;
		color: var(--dim);
	}

	.head b {
		color: var(--ink);
	}

	.lane-head {
		padding-left: 1.2rem;
		font-size: 0.66rem;
		background: #f1f4f8;
		color: #4a5f93;
	}

	.scroll {
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.lanes {
		position: relative;
		display: grid;
		grid-template-rows: var(--rows);
		min-width: 100%;
		height: 100%;
		cursor: text;
		touch-action: none;
		user-select: none;
	}

	.ruler,
	.track,
	.lane {
		position: relative;
		border-bottom: 1px solid var(--edge);
	}

	.ruler {
		background: var(--panel);
	}

	.lane {
		background: #f6f8fb;
	}

	.tick {
		position: absolute;
		top: 0;
		height: 100%;
		padding-left: 3px;
		border-left: 1px solid var(--edge);
		font-size: 0.62rem;
		line-height: 1.5rem;
		color: var(--dim);
	}

	.clip {
		position: absolute;
		top: 0.3rem;
		bottom: 0.3rem;
		overflow: hidden;
		border: 1px solid;
		border-radius: 6px;
		cursor: grab;
	}

	.locked .clip {
		cursor: pointer;
	}

	.clip:active {
		cursor: grabbing;
	}

	.clip.sel {
		box-shadow: 0 0 0 2px var(--accent);
	}

	.clip.image,
	.clip.video {
		display: flex;
		border-color: #7fa98f;
		background: #dcebe1;
	}

	.clip.world {
		border-color: #8fa0c9;
		background: linear-gradient(180deg, #dfe8f6, #e8eedd);
	}

	.clip.image img {
		height: 100%;
		pointer-events: none;
	}

	.clip.audio.A1 {
		border-color: #d4a64a;
		background: #f7e8c5;
	}

	.clip.audio.A2 {
		border-color: #6fb3a1;
		background: #d6eee8;
	}

	.clip.audio.A3 {
		border-color: #8fa0c9;
		background: #e1e7f5;
	}

	.clip.cue {
		border-style: dashed;
		opacity: 0.8;
		cursor: default;
	}

	.clip canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.clip .label {
		position: absolute;
		top: 0.15rem;
		left: 0.5rem;
		overflow: hidden;
		max-width: calc(100% - 1rem);
		font-size: 0.66rem;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink);
		pointer-events: none;
	}

	.clip .label i {
		font-style: normal;
		color: #4a5f93;
	}

	.clip.image .label,
	.clip.video .label,
	.clip.world .label {
		left: auto;
		right: 0.5rem;
		max-width: calc(100% - 4.5rem);
	}

	/* on the left of the clip's top line (its name is on the right), so a short row still shows both */
	.chips {
		position: absolute;
		top: 0.15rem;
		left: 0.3rem;
		display: flex;
		gap: 0.2rem;
		align-items: center;
	}

	.chips b {
		padding: 0 0.25rem;
		border-radius: 4px;
		font-size: 0.56rem;
		font-weight: 600;
		line-height: 1.4;
	}

	.wtag {
		background: #cbd6ec;
		color: #3c4f80;
	}

	.nopx {
		background: #fbf1dc;
		color: #7a5a17;
	}

	.gr {
		background: #f3e3c1;
		color: #a8741a;
	}

	.clip.caps {
		display: flex;
		align-items: center;
		border-color: #a594c6;
		background: #ebe5f5;
		cursor: default;
	}

	.clip.caps span {
		overflow: hidden;
		padding: 0 0.5rem;
		font-size: 0.7rem;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.edge {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 7px;
		cursor: ew-resize;
	}

	.edge.l {
		left: 0;
	}

	.edge.r {
		right: 0;
	}

	.clip:hover .edge,
	.clip.sel .edge {
		background: rgb(38 56 44 / 0.18);
	}

	.span {
		position: absolute;
		top: 0.2rem;
		bottom: 0.2rem;
		border-radius: 4px;
		background: #e3e9f4;
		pointer-events: none;
	}

	.span.hour {
		background: linear-gradient(90deg, #d8e2f2, #f5e6c4);
	}

	.val {
		position: absolute;
		top: 0;
		padding-left: 0.45rem;
		font-size: 0.64rem;
		line-height: 1.45rem;
		white-space: nowrap;
		color: #3c4f80;
		pointer-events: none;
	}

	.key {
		position: absolute;
		top: 50%;
		width: 0.62rem;
		height: 0.62rem;
		margin: -0.31rem 0 0 -0.31rem;
		padding: 0;
		border: 1px solid #3c4f80;
		background: #fff;
		transform: rotate(45deg);
		cursor: ew-resize;
	}

	.key.on {
		background: var(--accent);
		border-color: #a8741a;
	}

	.key.out {
		opacity: 0.35;
	}

	.key.cue.sound {
		border-color: #4a5f93;
		background: #8fa0c9;
		border-radius: 50%;
		transform: none;
	}

	.key.cue.event {
		border-color: #6a4f93;
		background: #d8cdef;
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 2px solid #e5483d;
		pointer-events: none;
	}

	.playhead i {
		position: absolute;
		top: 0;
		left: -7px;
		width: 12px;
		height: 12px;
		border-radius: 0 0 50% 50%;
		background: #e5483d;
	}
</style>
