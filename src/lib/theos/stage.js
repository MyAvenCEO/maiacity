// @ts-nocheck — plain JS, kept loose on purpose
// One small three.js stage for the paper's figures: a renderer sized to its box, a camera, a loop that only runs
// while the figure is on screen (and holds still for anyone who asked for reduced motion), and a clean teardown.
import * as THREE from 'three';

export function createStage(box, { fov = 40, position = [0, 6, 18], target = [0, 0, 0] } = {}) {
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
	let visible = false, raf = 0, last = performance.now(), tick = () => {};
	const frame = (now) => {
		raf = 0;
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		tick(still ? 0 : dt, now / 1000);
		renderer.render(scene, camera);
		if (visible && !still) raf = requestAnimationFrame(frame);
	};
	const io = new IntersectionObserver(([e]) => {
		visible = e.isIntersecting;
		if (visible && !raf) {
			last = performance.now();
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
			if (!raf) raf = requestAnimationFrame(frame);
		},
		/** draw once more, e.g. after a control moved while reduced motion holds the loop */
		redraw() {
			if (!raf) raf = requestAnimationFrame(frame);
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
