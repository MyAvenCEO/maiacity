// @ts-nocheck — three's post-processing passes are typed loosely
/*
 * THE STAGE — how any asset built in its parts (./parts.js) is shown the way AirSup's lab shows a machine: a paper
 * studio (a softbox environment, a soft key shadow, a contact shadow, a seamless floor that fades into the backdrop),
 * ambient occlusion, a little bloom, neutral tone mapping and a light grade; and its modes, eased in and out:
 *
 *   explode   every part out along its own way, staggered
 *   cut       the section planes sweep in and the solids show clean red caps where they are cut
 *   xray      the shells turn to glass with their edges drawn, the insides solid
 *   labels    leader lines to the named parts, with live readings
 *   slow      the solver's time slowed to 8 %
 *   break     the machine's own failure, decided by its solver
 *
 * Ported from AirSup's Lab (`.claude/skills/machine-skill`, kit/lab-kit.js at e0bd066, MIT; ./kit.js has the licence)
 * with one difference that is our law: the asset is never scaled. AirSup shows every machine 2.4 units across; we keep
 * it at its real size and scale the studio to it instead (the floor, the contact shadow, the occlusion radius, the
 * section hatch). The page around it (the turntable's canvas, its camera and controls) is the caller's.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CUT, ContactShadow, LAB_PLANES, LAYER_FX, approach, clamp, ease, ghostMaterial, lerp, studioEnvironment, untonemap } from './kit.js';

export const MODES = /** @type {const} */ (['explode', 'cut', 'xray', 'labels', 'slow']);

export class Stage {
	/**
	 * @param {THREE.WebGLRenderer} renderer the page's renderer (its tone mapping is set while the stage draws)
	 * @param {THREE.PerspectiveCamera} camera
	 * @param {{ theme?: 'paper' | 'night' }} [o]
	 */
	constructor(renderer, camera, { theme = 'paper' } = {}) {
		this.renderer = renderer;
		this.camera = camera;
		this.theme = theme;
		this.scene = new THREE.Scene();
		this.state = { explode: 0, cut: 0, xray: 0, labels: 0, slow: 0 };
		this.target = { explode: 0, cut: 0, xray: 0, labels: 0, slow: 0 };
		this.paused = false;
		this.broken = false;
		this.time = 0;
		this.built = 1;
		/** the part picked, and whether it is shown alone */
		this.picked = null;
		this.alone = false;
		const paper = theme === 'paper';
		this.bg = untonemap(new THREE.Color(paper ? 0xf3f2ee : 0x0d0e10).convertSRGBToLinear(), 1);
		this.scene.background = this.bg.clone();
		this.scene.environment = studioEnvironment(renderer, theme);
		this.scene.environmentIntensity = paper ? 0.82 : 0.9;
		// lights: a soft key with its shadow, a cool rim, a gentle fill (the environment does most of the work)
		const key = new THREE.DirectionalLight(0xfff3e6, paper ? 2.4 : 2.6);
		key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048);
		key.shadow.radius = 7;
		key.shadow.blurSamples = 16;
		const rim = new THREE.DirectionalLight(0xdbe8ff, paper ? 0.9 : 1.8);
		const fill = new THREE.HemisphereLight(0xffffff, paper ? 0xd9d5cc : 0x202020, paper ? 0.2 : 0.15);
		this.scene.add(key, key.target, rim, fill);
		this.key = key;
		this.rim = rim;
		this.ghosted = new Set();
		this.edges = null;
	}

	/** the post stack, made at the canvas's size (AirSup's: MSAA HDR, GTAO, bloom, tone map, grade) */
	_post() {
		const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
		const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
		const comp = new EffectComposer(r, rt);
		// at the canvas's own pixels (a composer given its target counts them 1:1 until told the ratio)
		const css = r.getSize(new THREE.Vector2());
		comp.setPixelRatio(r.getPixelRatio());
		comp.setSize(css.x, css.y);
		comp.addPass(new RenderPass(this.scene, this.camera));
		const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
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
		comp.addPass(ao);
		const paper = this.theme === 'paper';
		const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), paper ? 0.22 : 0.42, 0.55, paper ? 1.6 : 1.0);
		comp.addPass(bloom);
		comp.addPass(new OutputPass());
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
		comp.addPass(grade);
		this.composer = comp;
		this.ao = ao;
		this.grade = grade;
		this._fitAO();
	}
	_fitAO() {
		if (this.ao) this.ao.updateGtaoMaterial({ radius: 0.35 * this.s, distanceExponent: 1.6, thickness: 1.2 * this.s, scale: 1, samples: 16 });
	}

	/** the size the stage was set for: AirSup's display units over the asset's (its floor, shadows, hatch scale by it) */
	get s() {
		return (this.asset?.size ?? 2.4) / 2.4;
	}

	/**
	 * Show an asset (a sealed root, ./parts.js): on its floor, lit, its parts flying in.
	 * @param {THREE.Object3D} root
	 * @returns {{ centre: THREE.Vector3, size: THREE.Vector3 }}
	 */
	show(root) {
		this.clear();
		this.root = root;
		this.asset = root.userData.asset;
		this.scene.add(root);
		root.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(root);
		const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
		const s = this.s, paper = this.theme === 'paper';
		this.groundY = box.min.y;
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
		floor.position.set(centre.x, this.groundY, centre.z);
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
		this.built = 0;
		this.shownAt = performance.now();
		this.state = { explode: 0, cut: 0, xray: 0, labels: 0, slow: 0 };
		this.target = { explode: 0, cut: 0, xray: 0, labels: 0, slow: 0 };
		this.broken = false;
		this.picked = null;
		this.alone = false;
		return { centre, size };
	}

	/** take the asset off the stage (it is the caller's to dispose of) */
	clear() {
		if (this.root) {
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
		if (this.contact) {
			this.scene.remove(this.contact.plane, this.contact.cam);
			this.contact.rt.dispose();
			this.contact.rtB.dispose();
		}
		this._unpick();
		this.root = this.asset = this.floor = this.contact = null;
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
		this.asset.tick(sdt, this._env());
		// the parts fly in over 2.6 s of the clock on the wall, however slowly the frames come
		if (this.built < 1) this.built = Math.min(1, (now - this.shownAt) / 2600);
		this.asset.pose(s.explode, this.built);
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
		const alone = this.alone && this.picked;
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
			const part = this.asset.partOf(hit.object);
			if (part && (!this.alone || !this.picked || part === this.picked)) return part;
		}
		return null;
	}
	/** pick a part (null: none): its edges drawn bright @param {string | null} id @param {boolean} alone */
	setPick(id, alone) {
		this._unpick();
		this.picked = id;
		this.alone = !!(id && alone);
		const obj = id ? this.asset?.objOf(id) : null;
		if (!obj) return;
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
	}
	/** where a part is now (its middle, in the world) @param {string} id */
	partCentre(id) {
		const obj = this.asset?.objOf(id);
		return obj ? new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()) : null;
	}

	/**
	 * The labels as they fall on a canvas `w` × `h` px: each pinned point, where its text goes (spread per side so
	 * none overlap), its text and live reading, and how far faded in (AirSup's `_updateLabels`).
	 * @param {number} w @param {number} h
	 */
	labels(w, h) {
		const on = this.state.labels;
		if (!this.asset || on < 0.01) return [];
		const ctr = new THREE.Vector3().setFromMatrixPosition(this.root.matrixWorld).project(this.camera);
		const items = [];
		for (const L of this.asset.labels) {
			L.obj.updateWorldMatrix(true, false);
			const p = L.at.clone().applyMatrix4(L.obj.matrixWorld).project(this.camera);
			if (p.z >= 1 || !L.obj.visible) continue;
			const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
			items.push({ x, y, side: L.side ?? (p.x < ctr.x ? 'left' : 'right'), text: L.text, value: L.value?.() ?? '', lx: 0, ly: 0, on });
		}
		for (const side of ['left', 'right']) {
			const list = items.filter((i) => i.side === side).sort((a, b) => a.y - b.y);
			const gap = Math.max(30, h * 0.05);
			let last = -1e9;
			for (const it of list) last = it.ly = Math.max(it.y, last + gap);
			const xs = side === 'left' ? Math.min(...list.map((i) => i.x)) - w * 0.06 : Math.max(...list.map((i) => i.x)) + w * 0.06;
			for (const it of list) it.lx = clamp(xs, w * 0.04, w * 0.96);
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
		this.composer.setSize(w, h);
		const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
		this.grade.uniforms.uRes.value.set(s.x, s.y);
	}

	dispose() {
		this.clear();
		this.composer?.dispose();
		this.scene.environment?.dispose();
	}
}
