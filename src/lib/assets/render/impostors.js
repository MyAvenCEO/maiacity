// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * PICTURES OF THINGS FAR AWAY — any asset, when it looks small (./lod.js), drawn as a picture of itself: photographed
 * once on this device's graphics card from eight sides, the pictures laid in a page of pictures shared by many kinds,
 * and each copy a single card standing upright at its foot, turned to the eye, showing it from the side the eye sees
 * it from. Two triangles a copy, every copy on a page in one draw call. Sandbox 4's trees far away
 * (src/lib/sandbox-2/interior/impostors.js), made for every asset: a chair, a pickup, a goat or a walnut tree.
 *
 * The picture is taken by our own renderer from the asset's coarsest shape, so it is no more than the asset is: nothing
 * of it comes from the asset itself. The card is lit as the scene is (as if it were a thing facing the eye a little
 * upward); its picture is taken in a soft light from the front, so it keeps its depth at any hour. It casts its
 * shadow too: in the shadow pass the card turns to the sun and throws the thing's outline.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DITHER } from './presets.js';

/** how many sides each kind is photographed from */
export const FRAMES = 8;

/**
 * @typedef {{ page: number, cell: number, size: number, foot: number }} Slot where a kind's pictures are: its page,
 *   its first cell there, and its frame (a square `size` metres a side, its lower edge `foot` metres above the
 *   asset's own ground)
 */

/**
 * The pictures of a renderer's kinds, page by page.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ px?: number, page?: number }} [o] each picture `px` pixels a side, on pages of `page` pixels a side
 */
export function createImpostors(renderer, o = {}) {
	const most = Math.min(o.page ?? 2048, renderer.capabilities.maxTextureSize);
	const px = Math.min(o.px ?? 128, most);
	const cols = Math.floor(most / px), rows = cols;
	const kindsPerPage = Math.floor((cols * rows) / FRAMES);
	const group = new THREE.Group();
	group.name = 'asset pictures';
	/** @type {ReturnType<typeof pageOf>[]} */
	const pages = [];
	/** @type {THREE.Plane[] | null} */
	let planes = null;

	// where the pictures are taken: a soft light from the front and all round, and a room's reflections for the metals
	const studio = new THREE.Scene();
	studio.add(new THREE.AmbientLight('#ffffff', Math.PI * 0.45));
	const key = new THREE.DirectionalLight('#ffffff', Math.PI * 0.55);
	studio.add(key, key.target);
	// the room's reflections made when the first picture is to be taken, not with the renderer: a world that takes none
	// (drawing every kind at its finest, as MaiaCity V1 does) never waits for them (seconds on a software GPU)
	let env = null;
	const lit = () => {
		if (env) return;
		const pmrem = new THREE.PMREMGenerator(renderer);
		env = pmrem.fromScene(new RoomEnvironment(), 0.04);
		pmrem.dispose();
		studio.environment = env.texture;
	};
	studio.environmentIntensity = 0.35;
	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
	const shot = new THREE.WebGLRenderTarget(px, px, { samples: 4, generateMipmaps: false });
	shot.texture.colorSpace = THREE.SRGBColorSpace;

	function pageOf() {
		const target = new THREE.WebGLRenderTarget(cols * px, rows * px, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
		target.texture.colorSpace = THREE.SRGBColorSpace;
		target.texture.anisotropy = 4;
		renderer.initRenderTarget(target);
		const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
		const geo = new THREE.InstancedBufferGeometry();
		geo.index = quad.index;
		geo.setAttribute('position', quad.attributes.position);
		geo.setAttribute('normal', quad.attributes.normal);
		geo.setAttribute('uv', quad.attributes.uv);
		const uniforms = { uGrid: { value: new THREE.Vector2(cols, rows) } };
		const material = new THREE.MeshStandardMaterial({ map: target.texture, alphaTest: 0.5, roughness: 0.85, side: THREE.DoubleSide });
		const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: target.texture, alphaTest: 0.5, side: THREE.DoubleSide });
		patch(material, uniforms);
		patch(depth, uniforms);
		const mesh = new THREE.Mesh(geo, material);
		mesh.name = `asset pictures ${pages.length + 1}`;
		mesh.frustumCulled = false;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.customDepthMaterial = depth;
		group.add(mesh);
		const page = { target, quad, geo, material, depth, mesh, kinds: 0, n: 0, cap: 0, attrs: null };
		grow(page, 64);
		clip(page);
		return page;
	}

	/** room on a page for `need` cards */
	function grow(page, need) {
		if (page.cap >= need) return;
		const cap = Math.max(need, page.cap * 2, 64);
		const make = (name, size) => {
			const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
			a.setUsage(THREE.DynamicDrawUsage);
			const old = page.attrs?.[name];
			if (old) a.array.set(old.array.subarray(0, page.n * size));
			page.geo.setAttribute(name, a);
			return a;
		};
		page.attrs = { aAt: make('aAt', 3), aSize: make('aSize', 1), aTurn: make('aTurn', 1), aCell: make('aCell', 1), aFade: make('aFade', 1) };
		page.cap = cap;
	}

	const clip = (page) => {
		for (const m of [page.material, page.depth]) {
			m.clippingPlanes = planes;
			m.needsUpdate = true;
		}
	};

	/** the asset as it stands in the studio: its drawings, each at its places */
	function thingOf(level) {
		const thing = new THREE.Group();
		for (const d of level.draws) {
			const m = new THREE.InstancedMesh(d.geometry, d.material, d.n);
			m.instanceMatrix.array.set(d.locals);
			if (d.colors) m.instanceColor = new THREE.InstancedBufferAttribute(d.colors, 3);
			m.frustumCulled = false;
			thing.add(m);
		}
		return thing;
	}

	/** a kind's shaders as the studio lights them, made before its picture is taken (./index.js, `compiled`) */
	async function prepare(level) {
		lit();
		const thing = thingOf(level);
		const clip = renderer.localClippingEnabled;
		renderer.localClippingEnabled = false;
		const made = renderer.compileAsync(thing, camera, studio);
		renderer.localClippingEnabled = clip;
		await made;
		for (const m of thing.children) m.dispose();
	}

	/**
	 * A kind photographed from its eight sides onto a page.
	 * @param {import('./prepare.js').Level} level the shape it is photographed from (its coarsest)
	 * @returns {Slot}
	 */
	function add(level) {
		lit();
		let p = pages.findIndex((x) => x.kinds < kindsPerPage);
		if (p < 0) {
			pages.push(pageOf());
			p = pages.length - 1;
		}
		const page = pages[p];
		const cell = page.kinds++ * FRAMES;
		// its frame: square, as wide as it reaches out both ways or as tall as it stands, whichever is more
		const size = Math.max(0.05, Math.max(level.reach * 2, level.height - Math.min(0, level.bottom)) * 1.06);
		const mid = (Math.min(0, level.bottom) + level.height) / 2;
		const foot = mid - size / 2;
		const thing = thingOf(level);
		studio.add(thing);
		const D = level.reach + size + 10;
		camera.left = -size / 2;
		camera.right = size / 2;
		camera.top = size / 2;
		camera.bottom = -size / 2;
		camera.near = 0.05;
		camera.far = D * 2 + size * 2;
		camera.updateProjectionMatrix();
		const was = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, clip: renderer.localClippingEnabled };
		renderer.autoClear = false;
		renderer.localClippingEnabled = false;
		const to = new THREE.Vector2();
		for (let f = 0; f < FRAMES; f++) {
			const a = (f / FRAMES) * Math.PI * 2, c = cell + f;
			camera.position.set(Math.sin(a) * D, mid, Math.cos(a) * D);
			camera.lookAt(0, mid, 0);
			key.position.set(Math.sin(a) * D, mid + D * 0.6, Math.cos(a) * D);
			renderer.setRenderTarget(shot);
			// cleared to its own colour, see-through: from afar, where the picture is averaged down, its edges soften
			// into its own colour, never into black
			renderer.setClearColor(level.colour, 0);
			renderer.clear();
			renderer.render(studio, camera);
			renderer.copyTextureToTexture(shot.texture, page.target.texture, null, to.set((c % cols) * px, Math.floor(c / cols) * px));
		}
		studio.remove(thing);
		for (const m of thing.children) m.dispose();
		// and the page's smaller copies for afar, made again now it has more (drawing nothing into it makes them)
		renderer.setRenderTarget(page.target);
		renderer.render(new THREE.Scene(), camera);
		renderer.setRenderTarget(was.target);
		renderer.setClearColor(was.color, was.alpha);
		renderer.autoClear = was.autoClear;
		renderer.localClippingEnabled = was.clip;
		return { page: p, cell, size, foot };
	}

	return {
		group,
		prepare,
		add,
		/** starts a frame's cards: none on any page */
		begin() {
			for (const page of pages) page.n = 0;
		},
		/**
		 * One card: a copy of the kind in `slot` standing at x, y, z, turned by `turn` about the upright, at `scale`,
		 * `fade` how much of it shows (0 or 1 whole).
		 */
		push(slot, x, y, z, turn, scale, fade) {
			const page = pages[slot.page];
			if (page.n >= page.cap) grow(page, page.n + 1);
			const i = page.n++, A = page.attrs;
			A.aAt.array[i * 3] = x;
			A.aAt.array[i * 3 + 1] = y + slot.foot * scale;
			A.aAt.array[i * 3 + 2] = z;
			A.aSize.array[i] = slot.size * scale;
			A.aTurn.array[i] = turn;
			A.aCell.array[i] = slot.cell;
			A.aFade.array[i] = fade >= 1 ? 0 : fade;
		},
		/** ends a frame's cards: what was pushed is drawn */
		end() {
			for (const page of pages) {
				page.geo.instanceCount = page.n;
				page.mesh.visible = page.n > 0;
				for (const a of Object.values(page.attrs)) {
					a.clearUpdateRanges();
					a.addUpdateRange(0, page.n * a.itemSize);
					a.needsUpdate = true;
				}
			}
		},
		/** the cards cut away on the negative side of a plane too (no faces: a picture has no inside), or not (null) */
		cut(/** @type {THREE.Plane | null} */ plane) {
			planes = plane ? [plane] : null;
			for (const page of pages) clip(page);
		},
		/** how many cards are drawn, and on how many pages */
		get drawn() {
			return pages.reduce((a, p) => a + p.n, 0);
		},
		get pages() {
			return pages.length;
		},
		dispose() {
			group.removeFromParent();
			for (const page of pages) {
				page.target.dispose();
				page.quad.dispose();
				page.geo.dispose();
				page.material.dispose();
				page.depth.dispose();
			}
			pages.length = 0;
			shot.dispose();
			env?.dispose();
		}
	};
}

/** a card's material given the card's shader: turned to the eye, its picture from that side, faded by the dither */
function patch(mat, uniforms) {
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute vec3 aAt;
attribute float aSize;
attribute float aTurn;
attribute float aCell;
attribute float aFade;
uniform vec2 uGrid;
varying float vFade;
varying vec2 vCard;`
			)
			// the card turned to the eye (to the light, in the shadow pass) about its upright axis
			.replace(
				'#include <beginnormal_vertex>',
				`vec2 te = cameraPosition.xz - aAt.xz;
	te = length(te) > 1e-4 ? normalize(te) : vec2(0.0, 1.0);
	vec3 objectNormal = normalize(vec3(te.x, 0.55, te.y));
	#ifdef USE_TANGENT
		vec3 objectTangent = vec3(te.y, 0.0, -te.x);
	#endif`
			)
			.replace(
				'#include <begin_vertex>',
				`vec2 tc = cameraPosition.xz - aAt.xz;
	tc = length(tc) > 1e-4 ? normalize(tc) : vec2(0.0, 1.0);
	vFade = aFade;
	vec3 right = vec3(tc.y, 0.0, -tc.x);
	vec3 transformed = aAt + right * position.x * aSize + vec3(0.0, position.y * aSize, 0.0);
	// which of its pictures: the side the eye sees it from, in the thing's own turn
	float side = mod(floor((atan(tc.x, tc.y) - aTurn) / ${((Math.PI * 2) / FRAMES).toFixed(6)} + 0.5), ${FRAMES.toFixed(1)});
	float cell = aCell + side;
	vec2 cr = vec2(mod(cell, uGrid.x), floor(cell / uGrid.x));
	vCard = (cr + clamp(uv, 0.004, 0.996)) / uGrid;`
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying float vFade;\nvarying vec2 vCard;')
			.replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D( map, vCard );\n\tdiffuseColor *= sampledDiffuseColor;')
			.replace(
				'#include <alphatest_fragment>',
				`#include <alphatest_fragment>
	if (vFade > 0.0 && vFade < 1.0 && ${DITHER} > vFade) discard;`
			);
	};
	mat.customProgramCacheKey = () => 'asset-picture';
}
