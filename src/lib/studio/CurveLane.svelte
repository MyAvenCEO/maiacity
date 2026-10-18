<!--
	One curve lane of a world shot (./lanes.js): its value over the shot as a line between its range's bottom and top,
	its keys on it. A double click adds a key where the line is; a key drags in time and in value; a double click on a
	key removes it. Left to the world (or the hour), the lane shows a dashed line and says so.
-->
<script>
	import { valueAt } from '../../../game/film/shot.js';
	import { keysOf, movedKey, withKey, withoutKey } from './lanes.js';

	/**
	 * @type {{ s: import('./studio.svelte.js').Studio, clip: import('./studio.svelte.js').Clip,
	 *   spec: import('$lib/auth/client').ShotSpec, lane: import('./lanes.js').Lane }}
	 */
	let { s, clip, spec, lane } = $props();

	const range = $derived(/** @type {[number, number]} */ (lane.range ?? [0, 1]));
	const c = $derived(lane.get?.(spec));
	const keys = $derived(keysOf(c));
	/** px across the timeline of shot time t @param {number} t */
	const px = (t) => (clip.start + (t - clip.in)) * s.pxPerSec;
	/** % down the lane of value v @param {number} v */
	const y = (v) => (1 - (v - range[0]) / (range[1] - range[0] || 1)) * 100;
	/** the value where the spec leaves it: the lane's rest, else the middle of its range */
	const here = (/** @type {number} */ t) => (c !== undefined ? valueAt(c, t) : (lane.rest ?? range[0]));
	/** the line: flat before the first key and after the last, straight between */
	const points = $derived.by(() => {
		const a = clip.in, b = clip.in + clip.dur;
		const ts = [a, ...keys.map(([t]) => t).filter((t) => t > a && t < b), b];
		return ts.map((t) => `${px(t)},${y(here(t))}`).join(' ');
	});
	/** the whole timeline's width, the line drawn across it in its own px */
	const width = $derived(Math.max(1, s.span * s.pxPerSec));
	const fmt = (/** @type {number} */ v) => String(Math.round(v * 100) / 100);
	const said = $derived(
		c === undefined ? (lane.rest === null ? 'moves as the world moves it' : `as the hour has it (${fmt(lane.rest ?? 0)})`) : Array.isArray(c) ? `${c.length} keys` : fmt(c)
	);

	/** @param {(c: any) => any} change */
	const write = (change) => s.editSpec(clip, (sp) => lane.set?.(sp, change(lane.get?.(sp))));
	/** where a pointer is on the lane, as shot time and value @param {PointerEvent | MouseEvent} e @param {HTMLElement} el */
	function at(e, el) {
		const r = el.getBoundingClientRect(), lanes = /** @type {HTMLElement} */ (s.lanes).getBoundingClientRect();
		const t = Math.min(clip.in + clip.dur, Math.max(clip.in, clip.in + (e.clientX - lanes.left) / s.pxPerSec - clip.start));
		const v = range[0] + (1 - (e.clientY - r.top) / r.height) * (range[1] - range[0]);
		return { t, v };
	}
	/** @param {MouseEvent} e */
	function add(e) {
		e.stopPropagation();
		if (!s.canEdit) return;
		const { t } = at(e, /** @type {HTMLElement} */ (e.currentTarget));
		write((now) => withKey(now, t, now !== undefined ? valueAt(now, t) : here(t), range));
		s.seek(clip.start + (t - clip.in));
	}
	/** @param {PointerEvent} e @param {number} i */
	function drag(e, i) {
		e.stopPropagation();
		e.preventDefault();
		s.seek(clip.start + (keys[i][0] - clip.in));
		if (!s.canEdit) return;
		const el = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.currentTarget).parentElement);
		const x0 = e.clientX, y0 = e.clientY;
		/** @param {PointerEvent} ev */
		const move = (ev) => {
			if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
			const p = at(ev, el);
			// shift: in value only, the time kept
			write((now) => movedKey(now, i, ev.shiftKey ? keysOf(now)[i][0] : p.t, p.v, range));
			s.seek(clip.start + ((ev.shiftKey ? keys[i][0] : p.t) - clip.in));
		};
		const up = () => (removeEventListener('pointermove', move), removeEventListener('pointerup', up));
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
	}
	/** @param {MouseEvent} e @param {number} i */
	function remove(e, i) {
		e.stopPropagation();
		if (s.canEdit) write((now) => withoutKey(now, i));
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lane curve" ondblclick={add} title="{lane.title ?? lane.label}{s.canEdit ? '. Double click: a key here; drag a key; double click a key: remove it' : ''}">
	<i class="span" style:left="{px(clip.in)}px" style:width="{clip.dur * s.pxPerSec}px"></i>
	<svg class="line" class:loose={c === undefined} aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 {width} 100" style:width="{width}px">
		<polyline {points} />
	</svg>
	{#each keys as k, i (i)}
		<button
			class="dot"
			style:left="{px(k[0])}px"
			style:top="{y(k[1])}%"
			onpointerdown={(e) => drag(e, i)}
			ondblclick={(e) => remove(e, i)}
			aria-label="{lane.label}: {fmt(k[1])} at {fmt(k[0])} s"
			title="{fmt(k[1])} at {fmt(k[0])} s"
		></button>
	{/each}
	<span class="val" style:left="{px(clip.in)}px">{said}</span>
</div>

<style>
	.lane {
		position: relative;
		border-bottom: 1px solid var(--edge);
		background: var(--lane);
	}

	.span {
		position: absolute;
		top: 0;
		bottom: 0;
		background: color-mix(in srgb, var(--cyan) 7%, transparent);
	}

	.line {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	polyline {
		fill: none;
		stroke: var(--cyan);
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}

	.loose polyline {
		stroke-dasharray: 3 3;
		opacity: 0.6;
	}

	.dot {
		position: absolute;
		width: 0.6rem;
		height: 0.6rem;
		margin: -0.3rem 0 0 -0.3rem;
		padding: 0;
		border: 1px solid var(--cyan);
		border-radius: 50%;
		background: var(--bg);
		cursor: move;
	}

	.dot:hover {
		background: var(--accent);
	}

	.val {
		position: absolute;
		top: 1px;
		padding-left: 4px;
		font-size: 0.6rem;
		color: var(--dim);
		white-space: nowrap;
		pointer-events: none;
	}
</style>
