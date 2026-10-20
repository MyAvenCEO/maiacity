// @ts-nocheck — three's post-processing passes are typed loosely
/*
 * THE STAGE — how any asset built in its parts (./parts.js) is shown the way AirSup's lab shows a machine: a paper
 * studio (a softbox environment, a soft key shadow, a contact shadow, a seamless floor that fades into the backdrop),
 * ambient occlusion, a little bloom, neutral tone mapping and a light grade; and its modes, eased in and out:
 *
 * its views, how it is looked at (any of them on at once):
 *
 *   explode   every part out along its own way, staggered
 *   cut       the section planes sweep in and the solids show clean red caps where they are cut
 *   xray      the shells turn to glass with their edges drawn, the insides solid
 *   labels    leader lines to the named parts, with live readings
 *   slow      the solver's time slowed to 8 %
 *
 * and its moves, how it moves (one at a time, by the clock on the wall, slowed by Slow and held by Pause):
 *
 *   run       its solver at the sliders, nothing scripted
 *   <its own> a machine's own moves (`lab.moves`: the service drawer out and in, a door opened), loops over its
 *             controls; a slider a move sets follows it
 *   assemble  its parts flying in by their build steps, again and again
 *   break     the machine's own failure, decided by its solver
 *
 * Ported from AirSup's Lab (`.claude/skills/machine-skill`, kit/lab-kit.js at e0bd066, MIT; ./kit.js has the licence)
 * with one difference that is our law: the asset is never scaled. AirSup shows every machine 2.4 units across; we keep
 * it at its real size and scale the studio to it instead (the floor, the contact shadow, the occlusion radius, the
 * section hatch). The page around it (the turntable's canvas, its camera and controls) is the caller's.
 *
 * It shows any build of the box's as well, through ./hero.js, which is a sealed asset made of the build's checked data
 * (its solver running in the box): with what a rigged one adds, a part found by the group of its skinned mesh
 * (`partAt`), lit up by it (`highlight`), and found by its bone (`centreOf`); and where its floor is (`show`'s
 * `ground`, a plant's soil at 0 rather than under its roots).
 */
import * as THREE from 'three';
import { ShaderPass, createPost } from '$lib/render/post.js';
import { CUT, ContactShadow, LAB_PLANES, LAYER_FX, approach, clamp, ease, ghostMaterial, lerp, studioEnvironment, untonemap } from './kit.js';

export const MODES = /** @type {const} */ (['explode', 'cut', 'xray', 'labels', 'slow']);

/** the layer a part shown on its own puts the rest of its asset on: one no camera of the stage draws */
const SOLO_OFF = 30;

export class Stage {
	/**
	 * @param {THREE.WebGLRenderer} renderer the page's renderer (its tone mapping is set while the stage draws)
	 * @param {THREE.PerspectiveCamera} camera
	 * @param {{ theme?: 'paper' | 'night', low?: boolean }} [o] `low`: a phone's budget (no occlusion pass, 2× multisampling,
	 *   a smaller, softer-sampled shadow), so it draws smoothly and fits in a phone's memory ($lib/render/core.js)
	 */
	constructor(renderer, camera, { theme = 'paper', low = false } = {}) {
		this.renderer = renderer;
		this.camera = camera;
		this.theme = theme;
		this.low = low;
		this.scene = new THREE.Scene();
		this.state = { explode: 0, cut: 0, xray: 0, labels: 0, slow: 0 };
		this.target = { explode: 0, cut: 0, xray: 0, labels: 0, slow: 0 };
		this.paused = false;
		this.broken = false;
		this.time = 0;
		this.built = 1;
		/** the move playing ('run', 'assemble' or one of the asset's own), its time, and the controls it took over */
		this.move = 'run';
		this.moveT = 0;
		/** @type {Record<string, number>} */
		this.held = {};
		/** @type {THREE.Box3 | null} the asset's world box as shown, for the labels' columns */
		this.box = null;
		/** the part picked, whether it is shown alone (the rest a ghost) or on its own (`solo`, the rest not drawn) */
		this.picked = null;
		this.alone = false;
		this.solo = false;
		/** @type {THREE.Mesh[] | null} the meshes a part on its own leaves undrawn, and what of the asset it is */
		this.hidden = null;
		/** @type {Set<THREE.Object3D> | null} */
		this.own = null;
		const paper = theme === 'paper';
		this.bg = untonemap(new THREE.Color(paper ? 0xf3f2ee : 0x0d0e10).convertSRGBToLinear(), 1);
		this.scene.background = this.bg.clone();
		this.scene.environment = studioEnvironment(renderer, theme);
		this.scene.environmentIntensity = paper ? 0.82 : 0.9;
		// lights: a soft key with its shadow, a cool rim, a gentle fill (the environment does most of the work)
		const key = new THREE.DirectionalLight(0xfff3e6, paper ? 2.4 : 2.6);
		key.castShadow = true;
		key.shadow.mapSize.setScalar(low ? 1024 : 2048);
		key.shadow.radius = low ? 4 : 7;
		key.shadow.blurSamples = low ? 8 : 16;
		const rim = new THREE.DirectionalLight(0xdbe8ff, paper ? 0.9 : 1.8);
		const fill = new THREE.HemisphereLight(0xffffff, paper ? 0xd9d5cc : 0x202020, paper ? 0.2 : 0.15);
		this.scene.add(key, key.target, rim, fill);
		this.key = key;
		this.rim = rim;
		this.ghosted = new Set();
		this.edges = null;
	}

	/**
	 * the post stack, made at the canvas's size (AirSup's: MSAA HDR, GTAO, bloom, tone map, grade; on a phone no GTAO):
	 * the renderer's one ($lib/render/post.js)
	 */
	_post() {
		const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
		// at the canvas's own pixels (a composer given its target counts them 1:1 until told the ratio)
		const css = r.getSize(new THREE.Vector2());
		const paper = this.theme === 'paper';
		const grade = new ShaderPass({
			uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: paper ? 0.1 : 0.32 }, uGrain: { value: paper ? 0.012 : 0.02 }, uSat: { value: 1.06 }, uRes: { value: new THREE.Vector2(size.x, size.y) } },
			vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
			fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uSat; uniform vec2 uRes; varying vec2 vUv;
				float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
				void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
					float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, uSat);
					vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y; c *= 1.0 - uVig * smoothstep(0.35, 1.25, length(q));
					c += (h(vUv * uRes + fract(uTime) * 91.7) - 0.5) * uGrain;
					gl_FragColor = vec4(c, 1.0); }`
		});
		const post = createPost(r, this.scene, this.camera, {
			target: [size.x, size.y],
			samples: this.low ? 2 : 4,
			size: { pixelRatio: r.getPixelRatio(), width: css.x, height: css.y },
			ao: !this.low && ((ao) => this._ao(ao)),
			bloom: { strength: paper ? 0.22 : 0.42, radius: 0.55, threshold: paper ? 1.6 : 1.0 },
			after: [grade]
		});
		this.post = post;
		this.composer = post.composer;
		this.ao = post.ao;
		this.grade = grade;
		this._fitAO();
	}
	/**
	 * the ambient occlusion (GTAO) after the render pass: on a desktop only, the heaviest pass for a phone's GPU
	 * @param {any} ao the GTAO pass, before it is added
	 */
	_ao(ao) {
		ao.blendIntensity = this.theme === 'paper' ? 0.85 : 1;
		ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
		// effects and see-through parts are not solid: keep them out of the normal and depth pass
		const aoRender = ao.render.bind(ao);
		ao.render = (...a) => {
			this.camera.layers.disable(LAYER_FX);
			const hidden = [];
			this.scene.traverse((m) => {
				if (m.isMesh && m.visible && m.userData.noAO) {
					m.visible = false;
					hidden.push(m);
				}
			});
			aoRender(...a);
			for (const m of hidden) m.visible = true;
			this.camera.layers.enable(LAYER_FX);
		};
		if (ao.normalMaterial) {
			ao.normalMaterial.clippingPlanes = LAB_PLANES;
			ao.normalMaterial.clipIntersection = true;
			ao.normalMaterial.side = THREE.DoubleSide;
		}
	}
	_fitAO() {
		if (this.ao) this.ao.updateGtaoMaterial({ radius: 0.35 * this.s, distanceExponent: 1.6, thickness: 1.2 * this.s, scale: 1, samples: 16 });
	}

	/** the size the stage was set for: AirSup's display units over the asset's (its floor, shadows, hatch scale by it) */
	get s() {
		return (this.asset?.size ?? 2.4) / 2.4;
	}

	/**
	 * Show an asset (a sealed root, ./parts.js, or a build of the box's as ./hero.js makes it): on its floor, lit, its
	 * parts flying in.
	 * @param {THREE.Object3D} root
	 * @param {{ asset?: any, ground?: number, keep?: boolean }} [o] the asset, if it is not the root's own; the floor's
	 *   height, if it is not under the asset's lowest point; `keep`: the same asset built anew with other values (a plant
	 *   a little further grown), so its views stay as they were and its parts stand built, not flying in again
	 * @returns {{ centre: THREE.Vector3, size: THREE.Vector3 }}
	 */
	show(root, { asset, ground, keep = false } = {}) {
		const views = keep && this.root ? { state: { ...this.state }, target: { ...this.target } } : null;
		this.clear();
		this.root = root;
		this.asset = asset ?? root.userData.asset;
		this.scene.add(root);
		root.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(root);
		this.box = box;
		const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
		const s = this.s, paper = this.theme === 'paper';
		this.groundY = ground ?? box.min.y;
		// the seamless floor: the backdrop's colour far away; shadows and the contact shadow near the asset
		const fm = new THREE.MeshStandardMaterial({ color: paper ? 0xf0efea : 0x121315, roughness: paper ? 0.92 : 0.55, metalness: 0, envMapIntensity: paper ? 0.25 : 0.6 });
		const bg = this.bg, fade = new THREE.Vector2(4.5 * s, 16 * s);
		fm.onBeforeCompile = (sh) => {
			sh.uniforms.uBg = { value: bg };
			sh.uniforms.uFade = { value: fade };
			sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFW;').replace('#include <project_vertex>', '#include <project_vertex>\nvFW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
			sh.fragmentShader = sh.fragmentShader
				.replace('#include <common>', '#include <common>\nuniform vec3 uBg; uniform vec2 uFade; varying vec3 vFW;')
				.replace('#include <dithering_fragment>', '#include <dithering_fragment>\nfloat fr = smoothstep(uFade.x, uFade.y, length(vFW.xz)); gl_FragColor.rgb = mix(gl_FragColor.rgb, uBg, fr);');
		};
		const floor = new THREE.Mesh(new THREE.CircleGeometry(40 * s, 96), fm);
		floor.rotation.x = -Math.PI / 2;
		// a hair under the asset's lowest point when the floor is its own: an asset whose bottom is a ground facing up (a
		// biome's patch, a meadow with nothing lying below it) would otherwise share the floor's plane and flicker with it
		floor.position.set(centre.x, this.groundY - (ground === undefined ? 0.004 * s : 0), centre.z);
		floor.receiveShadow = true;
		floor.userData.studio = true;
		this.scene.add(floor);
		this.floor = floor;
		this.contact = new ContactShadow(this, paper ? 0.7 : 0.85, s);
		this.contact.plane.position.x = this.contact.quad.position.x = this.contact.cam.position.x = centre.x;
		this.contact.plane.position.z = this.contact.quad.position.z = this.contact.cam.position.z = centre.z;
		// the key from front left and above, its shadow framed to the asset
		const key = this.key, reach = size.length() * 0.65;
		key.target.position.copy(centre);
		key.position.copy(centre).add(new THREE.Vector3(-3.2, 6.5, 4.2).multiplyScalar(s));
		const sc = key.shadow.camera;
		sc.left = sc.bottom = -reach;
		sc.right = sc.top = reach;
		sc.near = 0.5 * s;
		sc.far = 20 * s;
		sc.updateProjectionMatrix();
		key.shadow.bias = -0.0004;
		key.shadow.normalBias = 0.02 * s;
		this.rim.position.copy(centre).add(new THREE.Vector3(4, 3, -5).multiplyScalar(s));
		CUT.hatch.value = 0.0015 * this.asset.size;
		this._fitAO();
		this.built = views ? 1 : 0;
		this.shownAt = performance.now();
		this.state = views?.state ?? { explode: 0, cut: 0, xray: 0, labels: 0, slow: 0 };
		this.target = views?.target ?? { explode: 0, cut: 0, xray: 0, labels: 0, slow: 0 };
		this.broken = false;
		this.picked = null;
		this.alone = false;
		this.move = 'run';
		this.moveT = 0;
		this.held = {};
		this.scrub = null;
		return { centre, size };
	}

	/** take the asset off the stage (it is the caller's to dispose of) */
	clear() {
		if (this.root) {
			this.play('run');
			this.resetBreak();
			this.asset?.pose(0, 1);
			this._cutTo(0);
			this.scene.remove(this.root);
		}
		if (this.floor) {
			this.scene.remove(this.floor);
			this.floor.geometry.dispose();
			this.floor.material.dispose();
		}
		this.contact?.dispose();
		this._unpick();
		this.root = this.asset = this.floor = this.contact = this.box = null;
	}

	/** turn a mode on or off (`on` left out: toggle) @param {'run' | 'break' | typeof MODES[number]} k @param {boolean} [on] */
	toggle(k, on) {
		if (k === 'run') return void (this.paused = on ?? !this.paused);
		if (k === 'break') return void ((on ?? !this.broken) ? this.breakNow() : this.resetBreak());
		this.target[k] = (on ?? this.target[k] < 0.5) ? 1 : 0;
	}
	/** is a mode on (where it is going, not where it is) @param {string} k */
	on(k) {
		return k === 'run' ? !this.paused : k === 'break' ? this.broken : this.target[k] > 0.5;
	}
	/** the moves it can play, in the bar's order: Run, its own, Assemble @returns {[string, string][]} */
	moves() {
		const own = Object.entries(this.asset?.lab?.moves ?? {}).map(([k, m]) => /** @type {[string, string]} */ ([k, m.label]));
		return [['run', 'Run'], ...own, ['assemble', 'Assemble']];
	}
	/**
	 * Play a move from its start: the controls the last one set go back to where the sliders had them, and the ones
	 * this one sets are taken over (the sliders follow them).
	 * @param {string} k
	 */
	play(k) {
		const c = this.asset?.lab?.controls ?? {};
		for (const [id, v] of Object.entries(this.held)) if (c[id]) c[id].value = v;
		this.held = {};
		const m = this.asset?.lab?.moves?.[k];
		this.move = m || k === 'assemble' ? k : 'run';
		this.moveT = 0;
		if (m) for (const id of Object.keys(m.at(0))) if (c[id]) this.held[id] = c[id].value;
	}
	/** where Assemble stands now (0 … 1): its move's time, a hand's, or built */
	builtNow() {
		if (this.move === 'assemble') {
			const T = this.asset?.catalog?.seconds ?? 12;
			return Math.min(1, (this.moveT % (T + 2.5)) / T);
		}
		return this.scrub ?? this.built;
	}
	/** a hand on the Built slider: the build held there (null lets it go, built); Assemble stops @param {number | null} u */
	scrubTo(u) {
		if (this.move === 'assemble') this.play('run');
		this.scrub = u;
	}
	/** does the move playing set this control @param {string} id */
	drives(id) {
		return id in this.held;
	}
	breakNow() {
		if (this.broken || !this.asset?.lab?.breakIt) return;
		this.broken = true;
		this.asset.lab.breakIt.run(this._env());
	}
	resetBreak() {
		if (!this.broken) return;
		this.broken = false;
		this.asset?.lab?.breakIt?.reset(this._env());
	}
	_env() {
		return { broken: this.broken, time: this.time, slow: this.state.slow, cut: this.state.cut, xray: this.state.xray };
	}

	/**
	 * One frame: the modes eased, the solver run, the parts placed, the cut and the x-ray set. The solver steps by `dt`
	 * (the caller keeps it small); the modes ease by the clock on the wall, so they answer at once however slowly the
	 * frames come.
	 * @param {number} dt
	 */
	update(dt) {
		const s = this.state, tg = this.target, now = performance.now();
		const wall = Math.min(0.5, (now - (this.lastWall ?? now)) / 1000);
		this.lastWall = now;
		const rate = (k, tau) => {
			s[k] = approach(s[k], tg[k], tau, wall);
			if (Math.abs(s[k] - tg[k]) < 1e-4) s[k] = tg[k];
		};
		rate('explode', 0.45);
		rate('cut', 0.42);
		rate('xray', 0.3);
		rate('slow', 0.35);
		rate('labels', 0.25);
		if (!this.asset) return;
		const sdt = this.paused ? 0 : dt * lerp(1, 0.08, s.slow);
		this.time += sdt;
		// a move runs by the clock on the wall (slowed and held like the solver), so it plays through however slowly
		// the frames come
		this.moveT += this.paused ? 0 : wall * lerp(1, 0.08, s.slow);
		// its own move sets the controls it drives before the solver reads them
		const m = this.asset.lab?.moves?.[this.move], c = this.asset.lab?.controls;
		if (m && c) for (const [id, v] of Object.entries(m.at((this.moveT / m.seconds) % 1))) if (c[id]) c[id].value = v;
		this.asset.tick(sdt, this._env());
		// the parts fly in over 2.6 s of the clock on the wall, however slowly the frames come; Assemble plays the build
		// by its steps over the catalog's seconds, holds it built a moment, and again
		if (this.built < 1) this.built = Math.min(1, (now - this.shownAt) / 2600);
		let built = this.built;
		// held by a hand on the Built slider, while no move plays it
		if (this.scrub != null && this.move !== 'assemble') built = this.scrub;
		if (this.move === 'assemble') {
			const T = this.asset.catalog?.seconds ?? 12;
			built = Math.min(1, (this.moveT % (T + 2.5)) / T);
		}
		this.asset.pose(s.explode, built);
		this._cutTo(s.cut);
		this._xray(s.xray);
	}

	/** the section planes, swept in from beyond the asset by `k` @param {number} k */
	_cutTo(k) {
		const c = this.asset?.cut ?? {};
		const a = new THREE.Vector3(...(c.a ?? [0, 0, 1])).normalize(), b = new THREE.Vector3(...(c.b ?? c.a ?? [0, 0, 1])).normalize();
		const ctr = new THREE.Vector3(...(c.center ?? [0, 0, 0]));
		const size = this.asset?.size ?? 1;
		const sweep = size * (c.reach ?? 0.8) * (1 - ease.io(k)) + (c.offset ?? 0);
		const M = this.root?.matrixWorld ?? new THREE.Matrix4(), N = new THREE.Matrix3().getNormalMatrix(M);
		const mk = (dir, plane, U) => {
			if (k <= 0.0005 || !this.root) {
				plane.set(new THREE.Vector3(0, 0, -1), 1e5);
				U.value.set(0, 0, -1, 1e5);
				return;
			}
			const n = dir.clone().negate(), p0 = ctr.clone().addScaledVector(dir, sweep);
			const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0).applyMatrix4(M, N);
			plane.copy(pl);
			U.value.set(pl.normal.x, pl.normal.y, pl.normal.z, pl.constant);
		};
		mk(a, LAB_PLANES[0], CUT.a);
		mk(b, LAB_PLANES[1], CUT.b);
	}

	/** a mesh turned to glass by `x` (0 solid, 1 a ghost with its edges) @param {THREE.Mesh} m @param {number} x */
	_ghost(m, x) {
		if (!m.userData.ghost) {
			if (x <= 0.002) return;
			const g = new THREE.Mesh(m.geometry, ghostMaterial());
			g.layers.set(LAYER_FX);
			g.renderOrder = 5;
			g.userData.edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), new THREE.LineBasicMaterial({ color: this.theme === 'paper' ? 0x2a3442 : 0xbcd4ff, transparent: true, opacity: 0, depthWrite: false }));
			g.userData.edges.layers.set(LAYER_FX);
			m.add(g, g.userData.edges);
			m.userData.ghost = g;
			m.userData.solidMats = Array.isArray(m.material) ? m.material : [m.material];
			m.userData.solidMats.forEach((sm) => (sm.userData.wasTransparent ??= sm.transparent));
		}
		const g = m.userData.ghost, paper = this.theme === 'paper';
		g.visible = g.userData.edges.visible = x > 0.002;
		g.material.uniforms.uA.value = x;
		g.material.uniforms.uPaper.value = paper ? 1 : 0;
		g.userData.edges.material.opacity = x * (paper ? 0.35 : 0.3);
		// a ghost's material is its own while it fades (materials are shared between parts)
		const want = x > 0.002;
		if (want && !m.userData.ownMats) {
			m.userData.ownMats = m.userData.solidMats.map((sm) => {
				const c = sm.clone();
				c.clippingPlanes = sm.clippingPlanes; // the live section planes, not copies of them
				c.onBeforeCompile = sm.onBeforeCompile;
				c.customProgramCacheKey = sm.customProgramCacheKey;
				c.userData = { ...sm.userData };
				return c;
			});
			m.material = Array.isArray(m.material) ? m.userData.ownMats : m.userData.ownMats[0];
		}
		if (m.userData.ownMats)
			for (const sm of m.userData.ownMats) {
				if (sm.transparent !== want && !sm.userData.wasTransparent) {
					sm.transparent = want;
					sm.depthWrite = !want;
					sm.needsUpdate = true;
				}
				if (!sm.transmission) sm.opacity = 1 - x;
			}
		if (!want && m.userData.ownMats) {
			m.material = Array.isArray(m.material) ? m.userData.solidMats : m.userData.solidMats[0];
			m.userData.ownMats.forEach((c) => c.dispose());
			m.userData.ownMats = null;
		}
		m.userData.noAO = x > 0.5;
		m.castShadow = x < 0.5;
	}
	/** the x-ray: the shells by `x`; and, a part shown alone, everything else */
	_xray(x) {
		const alone = this.alone && this.picked && !this.painted;
		const now = new Set();
		if (this._shellsOf !== this.asset) {
			this._shells = new Set(this.asset.shells);
			this._shellsOf = this.asset;
		}
		this.root.traverse((m) => {
			if (!m.isMesh || m.layers.mask !== 1) return;
			const part = this.asset.partOf(m);
			let k = 0;
			if (alone) k = part === this.picked ? 0 : 0.85;
			else if (this._shells.has(m)) k = x;
			if (k > 0.002 || m.userData.ghost?.visible) this._ghost(m, k);
			if (k > 0.002) now.add(m);
		});
		this.ghosted = now;
	}

	/** the part under a point of the canvas (-1…1 each way), or null @param {number} x @param {number} y */
	pick(x, y) {
		if (!this.root) return null;
		const ray = new THREE.Raycaster();
		ray.layers.set(0);
		ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
		for (const hit of ray.intersectObject(this.root, true)) {
			if (!hit.object.visible || hit.object.layers.mask !== 1) continue;
			// seen through the cut, a part cut away is not there
			if (LAB_PLANES.every((pl) => pl.distanceToPoint(hit.point) < 0)) continue;
			const part = this.asset.partAt?.(hit) ?? this.asset.partOf(hit.object);
			if (part && (!this.alone || !this.picked || part === this.picked)) return part;
		}
		return null;
	}
	/**
	 * Pick a part (null: none): its edges drawn bright; `alone`, the rest a ghost round it; `solo`, the part on its own,
	 * the rest not drawn, lit or picked at all (off the camera's layers, so the shadows and the passes leave it out too)
	 * @param {string | null} id @param {boolean} alone @param {boolean} [solo]
	 */
	setPick(id, alone, solo = false) {
		this._unpick();
		this.picked = id;
		this.alone = !!(id && (alone || solo));
		// an asset that lights its own parts (by the groups of a skinned mesh) does, the rest a ghost if alone, or not
		// drawn if on its own
		this.painted = !!this.asset?.highlight?.(id, this.alone, !!(id && solo));
		this.solo = this.painted && !!(id && solo);
		if (this.painted) return;
		const obj = id ? this.asset?.objOf(id) : null;
		if (!obj) return;
		if (solo) {
			this.solo = true;
			// the part with all it holds (a part that moves with it, as a wheel on its axle), and nothing else
			const own = new Set();
			obj.traverse((m) => own.add(m));
			const hidden = [];
			this.root.traverse((m) => {
				if (!m.isMesh || m.layers.mask !== 1 || own.has(m)) return;
				if (m.userData.ghost?.visible) this._ghost(m, 0);
				m.layers.set(SOLO_OFF);
				hidden.push(m);
			});
			[this.hidden, this.own] = [hidden, own];
			return;
		}
		const lines = [];
		obj.traverse((m) => {
			if (!m.isMesh || m.layers.mask !== 1) return;
			const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), new THREE.LineBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95, depthTest: false }));
			e.renderOrder = 9;
			e.layers.set(LAYER_FX);
			m.add(e);
			lines.push(e);
		});
		this.edges = lines;
	}
	_unpick() {
		for (const e of this.edges ?? []) {
			e.parent?.remove(e);
			e.geometry.dispose();
			e.material.dispose();
		}
		this.edges = null;
		for (const m of this.hidden ?? []) m.layers.set(0);
		this.hidden = this.own = null;
		this.solo = false;
	}
	/** where a part is now (its middle, in the world) @param {string} id */
	partCentre(id) {
		const at = this.asset?.centreOf?.(id);
		if (at) return at;
		const obj = this.asset?.objOf(id);
		return obj ? new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()) : null;
	}

	/**
	 * The labels as they fall on a canvas `w` × `h` px: each pinned point, where its text goes (spread per side so
	 * none overlap), its text and live reading, and how far faded in (AirSup's `_updateLabels`). `safe` is the part of
	 * the canvas no panel covers (px), where the columns of text must stay.
	 * @param {number} w @param {number} h @param {{ left?: number, right?: number, top?: number, bottom?: number }} [safe]
	 */
	labels(w, h, safe = {}) {
		const on = this.state.labels;
		if (!this.asset || on < 0.01) return [];
		// the asset's outline on the canvas, so the labels' columns stand clear of it (a long vehicle as much as a cube)
		let x0 = Infinity, x1 = -Infinity;
		if (this.box) {
			const b = this.box, c = new THREE.Vector3();
			for (let i = 0; i < 8; i++) {
				c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camera);
				const x = (c.x * 0.5 + 0.5) * w;
				x0 = Math.min(x0, x);
				x1 = Math.max(x1, x);
			}
		}
		const mid = Number.isFinite(x0) ? (x0 + x1) / 2 : (new THREE.Vector3().setFromMatrixPosition(this.root.matrixWorld).project(this.camera).x * 0.5 + 0.5) * w;
		const items = [];
		for (const L of this.asset.labels) {
			L.obj.updateWorldMatrix(true, false);
			const p = L.at.clone().applyMatrix4(L.obj.matrixWorld).project(this.camera);
			if (p.z >= 1 || !L.obj.visible || (this.solo && this.own && !this.own.has(L.obj))) continue;
			const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
			items.push({ x, y, side: L.side ?? (x < mid ? 'left' : 'right'), text: L.text, value: L.value?.() ?? '', lx: 0, ly: 0, on });
		}
		// room for a label's text beside its column (px), so a column pushed outward never runs off the canvas or under
		// a panel; and the rows kept between the panels above and below
		const L0 = safe.left ?? 0, R0 = safe.right ?? w, T0 = safe.top ?? 0, B0 = safe.bottom ?? h;
		const room = Math.min(170, (R0 - L0) * 0.2);
		const gap = Math.max(30, h * 0.05);
		// a side with no room beside the outline (a big asset by a panel) hands its labels to the other, if that has room
		if (Number.isFinite(x0)) {
			const fits = { left: x0 - w * 0.03 >= L0 + room, right: x1 + w * 0.03 <= R0 - room };
			for (const [from, to] of /** @type {const} */ ([['left', 'right'], ['right', 'left']]))
				if (!fits[from] && fits[to]) for (const it of items) if (it.side === from) it.side = to;
		}
		for (const side of ['left', 'right']) {
			const list = items.filter((i) => i.side === side).sort((a, b) => a.y - b.y);
			if (!list.length) continue;
			let last = -1e9;
			for (const it of list) last = it.ly = Math.max(it.y, T0 + gap * 0.6, last + gap);
			// a column running below the lowest safe row moves up as a whole (never above the highest)
			const over = list[list.length - 1].ly - (B0 - gap * 0.5);
			if (over > 0) for (const it of list) it.ly = Math.max(T0 + gap * 0.6, it.ly - over);
			const xs = side === 'left' ? Math.min(x0, ...list.map((i) => i.x)) - w * 0.03 : Math.max(x1, ...list.map((i) => i.x)) + w * 0.03;
			for (const it of list) it.lx = clamp(xs, L0 + room, R0 - room);
		}
		return items;
	}

	/** one real length (a round number) as about 120 px at the target's distance: [px, '20 cm'] @param {number} h @param {THREE.Vector3} target */
	scaleBar(h, target) {
		const d = this.camera.position.distanceTo(target);
		const pxPerM = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * d);
		const nice = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
		let L = nice[0];
		for (const n of nice) if (n * pxPerM <= 120) L = n;
		return /** @type {[number, string]} */ ([L * pxPerM, L >= 1 ? `${L} m` : L >= 0.01 ? `${Math.round(L * 100)} cm` : `${Math.round(L * 1000)} mm`]);
	}

	/**
	 * Compile the asset's shaders as the stage draws them (into its post stack, tone mapped there, clipped), before its
	 * first frame and off the page's thread where the browser can (KHR_parallel_shader_compile): a phone's first frame
	 * of a big machine otherwise holds the page for seconds. Resolves when they are ready; never rejects.
	 * @returns {Promise<void>}
	 */
	compile() {
		if (!this.composer) this._post();
		const r = this.renderer;
		const was = { tm: r.toneMapping, clip: r.localClippingEnabled, rt: r.getRenderTarget() };
		r.toneMapping = THREE.NeutralToneMapping;
		r.localClippingEnabled = true;
		r.setRenderTarget(this.composer.readBuffer);
		let done = Promise.resolve();
		try {
			done = r.compileAsync(this.scene, this.camera);
		} catch {
			/* drawn as usual */
		}
		r.setRenderTarget(was.rt);
		r.toneMapping = was.tm;
		r.localClippingEnabled = was.clip;
		return done.then(() => {}, () => {});
	}

	/** draw a frame (the page's renderer, our post stack) */
	render() {
		if (!this.composer) this._post();
		const r = this.renderer;
		const was = { tm: r.toneMapping, clip: r.localClippingEnabled };
		r.toneMapping = THREE.NeutralToneMapping;
		r.localClippingEnabled = true;
		this.camera.layers.enable(LAYER_FX);
		this.camera.updateMatrixWorld();
		CUT.proj.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
		if (this.contact) this.contact.update();
		this.grade.uniforms.uTime.value = this.time;
		this.composer.render();
		r.toneMapping = was.tm;
		r.localClippingEnabled = was.clip;
		this.camera.layers.disable(LAYER_FX);
	}

	/** the canvas changed size @param {number} w @param {number} h */
	resize(w, h) {
		if (!this.composer) return;
		this.post.setSize(w, h, this.renderer.getPixelRatio()); // the page may lower its pixel ratio while frames are slow
		const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
		this.grade.uniforms.uRes.value.set(s.x, s.y);
	}

	dispose() {
		this.clear();
		this.post?.dispose();
		this.scene.environment?.dispose();
	}
}
