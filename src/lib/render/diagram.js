// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE DIAGRAM RENDERER — one small three.js stage for an explainer's figures (theOS's paper, /theos/): the purpose
 * renderer for diagrams on the core (./core.js). Flat light, no shadows, a see-through canvas on a low-power GPU,
 * sized to its box, a camera, a loop that only runs while the figure is on screen, at most 30 frames a second (and
 * holds still for anyone who asked for reduced motion), and a clean teardown. Only one frame is ever pending: a redraw
 * asked for during a frame folds into that frame's follow-up instead of starting a second loop.
 *
 * It was theOS's own `createStage` (src/lib/theos/stage.js), the name the sandbox kit's world stage has too.
 */
import * as THREE from 'three';
import { createRenderer, disposeObject, disposeRenderer, fitTo } from './core.js';

export function createDiagram(box, { fov = 40, position = [0, 6, 18], target = [0, 0, 0] } = {}) {
	// a sharp screen hides jagged edges anyway, so it skips antialiasing and draws at 1.5x at most
	const dpr = window.devicePixelRatio || 1;
	const renderer = createRenderer({ antialias: dpr < 2, alpha: true, power: 'low-power', pixelRatio: Math.min(dpr, 1.5), colorSpace: THREE.SRGBColorSpace, container: box });

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);
	camera.position.set(...position);
	camera.lookAt(...target);

	scene.add(new THREE.HemisphereLight(0xfaf8f2, 0x6b7a5e, 2.2));
	const sun = new THREE.DirectionalLight(0xffffff, 1.6);
	sun.position.set(6, 12, 8);
	scene.add(sun);

	const size = fitTo(renderer, box, { camera, style: false });

	const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	let visible = false, raf = 0, busy = false, more = false, force = false, last = performance.now(), tick = () => {};
	const frame = (now) => {
		raf = 0;
		// 30 frames a second is plenty for these figures, and leaves the phone time to draw the text around them
		if (!still && !force && now - last < 30) {
			if (visible) raf = requestAnimationFrame(frame);
			return;
		}
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		busy = true;
		more = false;
		force = false;
		try {
			tick(still ? 0 : dt, now / 1000);
			renderer.render(scene, camera);
		} finally {
			busy = false;
		}
		if (visible && (!still || more)) raf = requestAnimationFrame(frame);
	};
	// a redraw asked for during a frame only asks that frame to go on; any other one draws at the next frame
	const request = () => {
		if (busy) more = true;
		else {
			force = true;
			if (!raf) raf = requestAnimationFrame(frame);
		}
	};
	const io = new IntersectionObserver(([e]) => {
		visible = e.isIntersecting;
		if (visible && !raf) {
			last = performance.now() - 30;
			raf = requestAnimationFrame(frame);
		}
	});
	io.observe(box);

	return {
		THREE,
		renderer,
		scene,
		camera,
		/** the per-frame update: (dt in seconds, time in seconds) */
		loop(fn) {
			tick = fn;
			request();
		},
		/** where a world point lands on the box, in px */
		project(v) {
			const p = v.clone().project(camera);
			return { x: (p.x * 0.5 + 0.5) * box.clientWidth, y: (-p.y * 0.5 + 0.5) * box.clientHeight, behind: p.z > 1 };
		},
		dispose() {
			cancelAnimationFrame(raf);
			io.disconnect();
			size.dispose();
			disposeObject(scene, { textures: false });
			disposeRenderer(renderer);
		}
	};
}
