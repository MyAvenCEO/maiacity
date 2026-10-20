// WARMING — whatever a world holds, drawn once out of sight before any shot shows it. The first time the GPU draws a
// thing it is sent the thing's buffers and textures and compiles its shaders, and that first frame took what tens of
// frames do (measured on the Mac: 300 ms to 2 s at a cut whose camera first sees a dome's insides, a plant, the land
// ahead of the van). Drawn here first, seen from above into a target 64 pixels wide, with nothing culled and the hidden
// things shown for the moment, a cut finds it all on the GPU: its first frame costs what any frame does. Nothing in the
// world knows: every flag touched is put back, the shadows are not drawn again, and the canvas is not drawn on.
//
// The shaders are compiled as the film draws (into a half-float target: no tone mapping, linear), not as the canvas
// would — the world's own compiles too —, and set compiling a frame before their first draw, so a GPU that compiles
// beside the page has them ready. Each draw is made the ways a frame makes it: into the shadow maps (into small ones
// of the warming's own: the world's are not drawn again), and behind glass (a pane of the warming's own in every
// draw: a frame with glass in it draws everything behind it once more, into a target of four samples, and a GPU
// makes each thing again for that — 1.4 s on the Mac at the first shot that looked through a dome's glass).
// Only what is new is drawn (a renderable not warmed with its geometry and material yet): the whole world as the shots
// are prepared, and while a timeline plays, what the world builds for the shots ahead, a few at a time.
import * as THREE from 'three';

/** the layer the warming draws on (src/lib/assets/stage.js uses 1 and 30) */
const LAYER = 31;

/** @param {THREE.WebGLRenderer} renderer */
export function createWarmer(renderer) {
	/** each renderable as it was warmed: its geometry and its material(s) @type {WeakMap<THREE.Object3D, [unknown, unknown]>} */
	const done = new WeakMap();
	/** the materials whose shaders were set compiling @type {WeakSet<THREE.Material>} */
	const compiling = new WeakSet();
	/** what the warming sent the GPU so far: things drawn, and the bytes of their buffers (each geometry once) */
	const stats = { things: 0, bytes: 0 };
	/** @type {WeakSet<object>} */
	const counted = new WeakSet();
	const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: false });
	rt.texture.colorSpace = THREE.NoColorSpace;
	// its own camera, kept (three keeps a glass's refraction target by the camera it was drawn for: one a draw would be
	// a new target each time, and the film's own camera's would be made 64 pixels wide and back)
	const eye = new THREE.OrthographicCamera();
	eye.layers.set(LAYER);
	// the pane: a triangle of glass only the warming sees, in front of the eye
	const pane = new THREE.Mesh(
		new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 0, 0, 1], 3)),
		new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0, side: THREE.DoubleSide })
	);
	pane.layers.set(LAYER);
	pane.frustumCulled = false;
	pane.castShadow = false;
	/** each light's own small shadow map, drawn into by the warming @type {WeakMap<THREE.Light, unknown>} */
	const smallMaps = new WeakMap();
	const SMALL = new THREE.Vector2(16, 16);
	const box = new THREE.Box3(), ball = new THREE.Sphere(), centre = new THREE.Vector3(), size = new THREE.Vector3();

	/** @param {() => void} job runs with the warm target bound, as the film's frames are drawn */
	const onTarget = (job) => {
		const before = renderer.getRenderTarget();
		renderer.setRenderTarget(rt);
		try {
			job();
		} finally {
			renderer.setRenderTarget(before);
		}
	};
	// and whatever the world compiles itself (a dome as it is built, a level of a library asset), compiled as the film
	// draws: in film mode the canvas only ever shows the view (./pipeline.js), so a variant for the canvas is never used,
	// and the first frame that drew the thing compiled it again, at the cut
	const compile = renderer.compile;
	renderer.compile = function (/** @type {any[]} */ ...a) {
		if (renderer.getRenderTarget() !== null) return compile.apply(this, /** @type {any} */ (a));
		/** @type {any} */
		let out;
		onTarget(() => void (out = compile.apply(this, /** @type {any} */ (a))));
		return out;
	};
	const materials = (/** @type {any} */ o) => /** @type {THREE.Material[]} */ (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean);

	/**
	 * What the camera could draw and has not been warmed as it is now.
	 * @param {THREE.Scene} scene @param {THREE.Camera} camera @returns {THREE.Object3D[]}
	 */
	function fresh(scene, camera) {
		/** @type {THREE.Object3D[]} */
		const out = [];
		scene.traverse((o) => {
			const r = /** @type {any} */ (o);
			// (an instanced drawing of no copies yet too: drawn, it is sent and compiled, and draws nothing)
			if (!(r.isMesh || r.isLine || r.isPoints || r.isSprite) || !o.layers.test(camera.layers)) return;
			const was = done.get(o);
			if (!was || was[0] !== r.geometry || was[1] !== r.material) out.push(o);
		});
		return out;
	}

	/**
	 * Draws these, and only these, once: shown, unculled, under the lights the world has on now.
	 * @param {THREE.Scene} scene @param {THREE.Camera} camera @param {THREE.Object3D[]} objs
	 */
	function draw(scene, camera, objs) {
		/** @type {[any, string, unknown][]} */
		const put = [];
		const set = (/** @type {any} */ o, /** @type {string} */ k, /** @type {unknown} */ v) => {
			put.push([o, k, o[k]]);
			o[k] = v;
		};
		/** @type {THREE.Object3D[]} */
		const marked = [];
		const mark = (/** @type {THREE.Object3D} */ o) => {
			o.layers.enable(LAYER);
			marked.push(o);
		};
		// the lights as they are now (the shaders are compiled for as many lights as a frame has): only those a frame draws
		/** @type {any[]} */
		const casting = [];
		scene.traverseVisible((o) => {
			const l = /** @type {any} */ (o);
			if (!l.isLight || !o.layers.test(camera.layers)) return;
			mark(o);
			if (l.castShadow && l.shadow) casting.push(l);
		});
		// their shadows drawn into maps of the warming's own: the world's keep what they hold, and the light's matrix
		for (const l of casting) {
			set(l.shadow, 'map', smallMaps.get(l) ?? null);
			set(l.shadow, 'mapSize', SMALL);
			set(l.shadow, 'needsUpdate', true);
			set(l.shadow, 'matrix', new THREE.Matrix4());
		}
		for (const o of objs) {
			mark(o);
			if (o.frustumCulled) set(o, 'frustumCulled', false);
			// a hidden thing, or one inside a hidden group, shown for this draw; a level of detail keeps its levels shown
			for (let p = /** @type {THREE.Object3D | null} */ (o); p; p = p.parent) {
				if (!p.visible) set(p, 'visible', true);
				if (/** @type {any} */ (p).isLOD && /** @type {any} */ (p).autoUpdate) set(p, 'autoUpdate', false);
			}
		}
		const shadows = renderer.shadowMap;
		set(shadows, 'autoUpdate', false);
		set(shadows, 'needsUpdate', casting.length > 0);
		// seen from above, all of them in the frame: each covers a few pixels, so a GPU that makes a shader only for the
		// first pixel it shades has made it
		box.makeEmpty();
		for (const o of objs) {
			const g = /** @type {any} */ (o).geometry;
			if (!g) continue;
			if (!g.boundingSphere) g.computeBoundingSphere();
			if (g.boundingSphere) box.expandByPoint(ball.copy(g.boundingSphere).applyMatrix4(o.matrixWorld).center);
		}
		const c = box.isEmpty() ? centre.set(0, 0, 0) : box.getCenter(centre), r = box.isEmpty() ? 1 : Math.max(1, box.getSize(size).length() / 2 + 50);
		Object.assign(eye, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: 4 * r });
		eye.updateProjectionMatrix();
		eye.position.set(c.x, c.y + 2 * r, c.z);
		eye.lookAt(c);
		eye.updateMatrixWorld();
		pane.position.copy(c);
		pane.scale.setScalar(r / 4);
		scene.add(pane);
		try {
			onTarget(() => renderer.render(scene, eye));
		} finally {
			scene.remove(pane);
			for (const l of casting) smallMaps.set(l, l.shadow.map);
			for (const o of marked) o.layers.disable(LAYER);
			for (let i = put.length - 1; i >= 0; i--) put[i][0][put[i][1]] = put[i][2];
		}
		for (const o of objs) {
			const g = /** @type {any} */ (o).geometry;
			done.set(o, [g, /** @type {any} */ (o).material]);
			for (const m of materials(o)) compiling.add(m);
			stats.things++;
			if (g && !counted.has(g)) {
				counted.add(g);
				for (const a of [...Object.values(g.attributes ?? {}), g.index]) stats.bytes += /** @type {any} */ (a)?.array?.byteLength ?? 0;
			}
			const im = /** @type {any} */ (o).instanceMatrix;
			if (im && !counted.has(im)) (counted.add(im), (stats.bytes += im.array.byteLength));
		}
	}

	/** found new, their shaders not set compiling yet */
	/** @type {THREE.Object3D[]} */
	let found = [];
	/** set compiling on a frame before: drawn on a later one */
	/** @type {THREE.Object3D[]} */
	let ripe = [];
	let lookedAt = -Infinity;
	/** how many a draw takes while the timeline plays: more while they are cheap, fewer when one was dear */
	let batch = 8;

	return {
		/**
		 * Everything the world holds that is not warmed yet: every shader compiled (beside the page where the GPU can),
		 * then all of it drawn once. Before a timeline plays.
		 * @param {THREE.Scene} scene @param {THREE.Camera} camera @returns {Promise<number>} how many were drawn
		 */
		async all(scene, camera) {
			await renderer.compileAsync(scene, camera);
			found = [];
			ripe = [];
			const objs = fresh(scene, camera);
			if (objs.length) draw(scene, camera, objs);
			return objs.length;
		},
		/**
		 * While a timeline plays: what the world has built since, a batch a frame within about `budget` ms: its shaders
		 * set compiling on one frame, the things drawn on a later one (the world is looked through every `every` ms; a
		 * thing gone from it meanwhile is let go).
		 * @param {THREE.Scene} scene @param {THREE.Camera} camera @param {number} budget @param {number} [every]
		 * @returns {number} how many were drawn
		 */
		some(scene, camera, budget, every = 500) {
			const t0 = performance.now();
			let n = 0;
			const here = ripe.splice(0, batch).filter((o) => isIn(o, scene));
			if (here.length) {
				draw(scene, camera, here);
				n = here.length;
				const took = performance.now() - t0;
				batch = took > budget ? Math.max(1, batch >> 1) : took < budget / 2 ? Math.min(256, batch * 2) : batch;
			}
			if (!found.length && !ripe.length && t0 - lookedAt >= every) {
				lookedAt = t0;
				found = fresh(scene, camera);
			}
			// the next batch's shaders set compiling now (only materials never compiled: most new things share theirs)
			const next = found.splice(0, batch);
			for (const o of next) {
				const mats = materials(o).filter((m) => !compiling.has(m));
				if (mats.length && isIn(o, scene)) renderer.compile(o, camera, scene);
				for (const m of mats) compiling.add(m);
			}
			ripe.push(...next);
			return n;
		},
		stats,
		dispose() {
			rt.dispose();
			pane.geometry.dispose();
			pane.material.dispose();
		}
	};
}

/** @param {THREE.Object3D} o @param {THREE.Object3D} scene */
function isIn(o, scene) {
	for (let p = /** @type {THREE.Object3D | null} */ (o); p; p = p.parent) if (p === scene) return true;
	return false;
}
