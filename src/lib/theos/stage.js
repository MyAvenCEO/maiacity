// @ts-nocheck — plain JS, kept loose on purpose
// One small three.js stage for the paper's figures: a renderer sized to its box, a camera, a loop that only runs
// while the figure is on screen, at most 30 frames a second (and holds still for anyone who asked for reduced
// motion), and a clean teardown. Only one frame is ever pending: a redraw asked for during a frame (OrbitControls
// fires 'change' from its own update) folds into that frame's follow-up instead of starting a second loop.
import * as THREE from 'three';

export function createStage(box, { fov = 40, position = [0, 6, 18], target = [0, 0, 0] } = {}) {
	// a sharp screen hides jagged edges anyway, so it skips antialiasing and draws at 1.5x at most
	const dpr = window.devicePixelRatio || 1;
	const renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, alpha: true, powerPreference: 'low-power' });
	renderer.setPixelRatio(Math.min(dpr, 1.5));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	box.appendChild(renderer.domElement);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);
	camera.position.set(...position);
	camera.lookAt(...target);

	scene.add(new THREE.HemisphereLight(0xfaf8f2, 0x6b7a5e, 2.2));
	const sun = new THREE.DirectionalLight(0xffffff, 1.6);
	sun.position.set(6, 12, 8);
	scene.add(sun);

	const resize = () => {
		const w = box.clientWidth, h = box.clientHeight;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(box);

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
		still,
		/** the per-frame update: (dt in seconds, time in seconds) */
		loop(fn) {
			tick = fn;
			request();
		},
		/** draw once more, e.g. after a control moved while reduced motion holds the loop */
		redraw() {
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
			ro.disconnect();
			scene.traverse((o) => {
				o.geometry?.dispose?.();
				if (o.material) [].concat(o.material).forEach((m) => m.dispose());
			});
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
