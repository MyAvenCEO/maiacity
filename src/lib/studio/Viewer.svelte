<!--
	The viewer: a picture (a video, a still or a canvas) through its input transform, its grade (a cube the Mac bakes
	from the grade's only maths, vault-render `grade`) and the output transform, drawn by the GPU (gl.js) every frame it
	changes. It covers its frame the way the render crops, and a
	clip's own framing for the shape moves and zooms it. Without WebGL2 it says so and draws nothing: the monitor then
	shows the pictures themselves, colour unmanaged.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { ViewerGL, cover } from './gl.js';
	import { viewPlan } from './view.js';
	import { gradeLut } from './luts.js';

	/**
	 * source: the picture; aspect: the frame's width / height; canvas, plan, supported: bound back to the monitor.
	 * @type {{
	 *   source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null | undefined,
	 *   profile: string,
	 *   stacks?: any[],
	 *   luts: Record<string, import('./luts.js').Lut | null>,
	 *   aspect: number,
	 *   frame?: import('$lib/auth/client').ClipFrame,
	 *   falseColor?: boolean,
	 *   canvas?: HTMLCanvasElement | null,
	 *   plan?: import('./view.js').ViewPlan | null,
	 *   supported?: boolean
	 * }}
	 */
	let {
		source,
		profile,
		stacks = [],
		luts,
		aspect,
		frame,
		falseColor = false,
		canvas = $bindable(null),
		plan = $bindable(null),
		supported = $bindable(true)
	} = $props();

	/** @type {ViewerGL | null} */
	let gl = null;
	let raf = 0;
	let last = '';
	/** the clip's grade as the Mac baked it; null: as it is @type {import('./luts.js').Lut | null} */
	let cube = $state(null);
	// a picture already display-referred (a drawn stand-in) takes no base correction
	const gradeKey = $derived(JSON.stringify(profile === 'srgb' ? stacks.slice(1) : stacks));
	$effect(() => {
		const st = JSON.parse(gradeKey);
		if (!st.length) return void (cube = null);
		let live = true;
		gradeLut(st)
			.then((l) => live && (cube = l))
			.catch((e) => console.warn('viewer: no grade cube:', e));
		return () => void (live = false);
	});

	/** @param {HTMLVideoElement | HTMLImageElement | HTMLCanvasElement} el */
	const size = (el) =>
		el instanceof HTMLVideoElement
			? { w: el.videoWidth, h: el.videoHeight, ok: el.readyState >= 2 }
			: el instanceof HTMLImageElement
				? { w: el.naturalWidth, h: el.naturalHeight, ok: el.complete }
				: { w: el.width, h: el.height, ok: true };

	function loop() {
		raf = requestAnimationFrame(loop);
		if (!gl || !canvas) return;
		// the canvas: the size it is shown at, in device pixels (never more than HD's long edge — it is a proxy view)
		const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
		const k = Math.min(1, 1920 / Math.max(1, r.width * dpr, r.height * dpr));
		const W = Math.max(2, Math.round(r.width * dpr * k)), H = Math.max(2, Math.round(r.height * dpr * k));
		if (canvas.width !== W || canvas.height !== H) (canvas.width = W), (canvas.height = H), (last = '');
		const el = source;
		if (!el) {
			if (last !== 'none') gl.clear(), (last = 'none');
			return;
		}
		const { w, h, ok } = size(el);
		if (!ok || !w || !h) return;
		const p = viewPlan(profile, [], luts);
		if (plan?.note !== p.note || plan?.idt !== p.idt || plan?.odt !== p.odt) plan = p;
		// only when something changed: a video that moves, a still or a grade that is new
		const moving = el instanceof HTMLVideoElement ? `${el.currentTime}:${el.paused}` : el instanceof HTMLCanvasElement ? String(performance.now()) : el.src;
		const key = `${moving}|${W}x${H}|${profile}|${cube?.hash ?? ''}|${aspect}|${JSON.stringify(frame ?? null)}|${falseColor}|${p.idt}${p.odt}|${p.idtLut?.name}|${p.odtLut?.name}`;
		if (key === last && !(el instanceof HTMLVideoElement && !el.paused)) return;
		last = key;
		gl.setLut('idt', p.idtLut);
		gl.setLut('odt', p.odtLut);
		gl.setLut('grade', cube);
		try {
			gl.draw(el, { idt: p.idt, odt: p.odt, grade: cube ? 1 : 0, falseColor, crop: cover(w / h, aspect, frame) });
		} catch {
			/* a frame not decodable yet (or a tainted one): the next will do */
		}
	}

	onMount(() => {
		if (!canvas || !ViewerGL.supported()) return void (supported = false);
		try {
			gl = new ViewerGL(canvas);
		} catch (e) {
			console.warn('viewer:', /** @type {Error} */ (e).message);
			supported = false;
			return;
		}
		raf = requestAnimationFrame(loop);
	});
	onDestroy(() => {
		cancelAnimationFrame(raf);
		gl?.dispose();
	});
</script>

<canvas class="viewer" bind:this={canvas}></canvas>

<style>
	.viewer {
		position: absolute;
		inset: 0;
		z-index: 1;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
</style>
