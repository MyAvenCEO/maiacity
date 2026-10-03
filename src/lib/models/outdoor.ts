/*
 * OUTDOORS — the models a world under the open sky is built from: trees (a broadleaf, a white willow, a black poplar
 * and a willow shrub, as the Isar's banks have them), a park bench, the Wittelsbacherbrücke's lamp, a limestone
 * block and the bridge's bronze rider. Each is seeded: the same tree every time, so a film renders the same pixels.
 *
 * A world plants many trees, so a tree is two geometries — its wood and its leaves — for instancing (`treeParts`);
 * `tree()` puts them together for the 3D models viewer. Leaves are cards cut from a drawn cluster of leaves, their
 * normals pointing out from the crown, so a crown is lit as one soft mass and not as a thousand flat cards.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bar, part, shared, std, v3 } from './parts';
import { pine } from './textures';

/** a seeded random generator: the same shapes every time */
export function seeded(seed: number) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const canvas = (w: number, h: number) => {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return { c, x: c.getContext('2d')! };
};

/* ── the surfaces ─────────────────────────────────────────────────────────── */

const atlases = new Map<string, THREE.CanvasTexture>();
/** Leaves on a twig, four clusters to a sheet (2 × 2): broad leaves (ash, maple, lime) or a willow's narrow ones. */
export function leafAtlas(kind: 'broad' | 'narrow'): THREE.CanvasTexture {
	const hit = atlases.get(kind);
	if (hit) return hit;
	{
		const { c, x } = canvas(512, 512);
		const r = seeded(kind === 'broad' ? 411 : 977);
		const greens = kind === 'broad' ? ['#2f4a1a', '#3a5720', '#456526', '#2a4217', '#4f6f2b', '#3d5a22'] : ['#5d6d44', '#67784b', '#55653d', '#71825a', '#7b8b62', '#606f45'];
		for (let cell = 0; cell < 4; cell++) {
			const ox = (cell % 2) * 256, oy = Math.floor(cell / 2) * 256;
			x.save();
			x.beginPath();
			x.rect(ox, oy, 256, 256);
			x.clip();
			// twigs from the cell's foot, fanning out; leaves along them
			const twigs = 7 + Math.floor(r() * 3);
			for (let t = 0; t < twigs; t++) {
				const a = -Math.PI / 2 + (r() - 0.5) * 1.9;
				const len = 110 + r() * 100;
				const x0 = ox + 128 + (r() - 0.5) * 60, y0 = oy + 252;
				x.strokeStyle = '#4a3c2a';
				x.lineWidth = 2;
				x.beginPath();
				x.moveTo(x0, y0);
				x.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
				x.stroke();
				const n = kind === 'broad' ? 12 : 18;
				for (let i = 0; i < n; i++) {
					const f = 0.25 + (i / n) * 0.8;
					const px = x0 + Math.cos(a) * len * f, py = y0 + Math.sin(a) * len * f;
					for (const side of [-1, 1]) {
						const la = a + side * (0.6 + r() * 0.5);
						const L = kind === 'broad' ? 26 + r() * 18 : 32 + r() * 20;
						const W = kind === 'broad' ? L * (0.45 + r() * 0.15) : L * 0.16;
						const cx = px + Math.cos(la) * L * 0.55, cy = py + Math.sin(la) * L * 0.55;
						x.save();
						x.translate(cx, cy);
						x.rotate(la);
						const g = x.createLinearGradient(0, -W, 0, W);
						const base = greens[Math.floor(r() * greens.length)]!;
						g.addColorStop(0, base);
						g.addColorStop(0.5, kind === 'broad' ? '#5b7a33' : '#8f9d72');
						g.addColorStop(1, base);
						x.fillStyle = g;
						x.beginPath();
						x.ellipse(0, 0, L / 2, W / 2, 0, 0, Math.PI * 2);
						x.fill();
						x.strokeStyle = 'rgba(40,50,20,0.35)';
						x.lineWidth = 1;
						x.beginPath();
						x.moveTo(-L / 2, 0);
						x.lineTo(L / 2, 0);
						x.stroke();
						x.restore();
					}
				}
			}
			x.restore();
		}
		const t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		t.anisotropy = 4;
		atlases.set(kind, t);
		return t;
	}
}

/** Bark: grey-brown, furrowed along the trunk. */
export const bark = shared(() => {
	const { c, x } = canvas(256, 512);
	const r = seeded(73);
	x.fillStyle = '#7d7468';
	x.fillRect(0, 0, 256, 512);
	for (let i = 0; i < 160; i++) {
		const px = r() * 256, w = 2 + r() * 6;
		x.fillStyle = r() < 0.5 ? 'rgba(45,40,34,0.45)' : 'rgba(160,152,140,0.35)';
		x.beginPath();
		let y = 0;
		x.moveTo(px, 0);
		while (y < 512) {
			y += 20 + r() * 30;
			x.lineTo(px + (r() - 0.5) * 8, y);
		}
		x.lineTo(px + w, 512);
		x.lineTo(px + w, 0);
		x.fill();
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	return t;
});

/** Shell limestone (Muschelkalk): warm pale grey, shells and pores in it, weathered darker in places. */
export const limestone = shared(() => {
	const { c, x } = canvas(512, 512);
	const r = seeded(1905);
	x.fillStyle = '#c9c1b1';
	x.fillRect(0, 0, 512, 512);
	for (let i = 0; i < 2600; i++) {
		x.fillStyle = r() < 0.6 ? `rgba(120,110,95,${0.08 + r() * 0.2})` : `rgba(235,230,218,${0.1 + r() * 0.25})`;
		const s = 1 + r() * 3.5;
		x.beginPath();
		x.ellipse(r() * 512, r() * 512, s, s * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2);
		x.fill();
	}
	for (let i = 0; i < 26; i++) {
		const g = x.createRadialGradient(0, 0, 0, 0, 0, 40 + r() * 70);
		g.addColorStop(0, `rgba(90,85,70,${0.08 + r() * 0.1})`);
		g.addColorStop(1, 'rgba(90,85,70,0)');
		x.save();
		x.translate(r() * 512, r() * 512);
		x.fillStyle = g;
		x.fillRect(-110, -110, 220, 220);
		x.restore();
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 8;
	return t;
});

/* ── trees ────────────────────────────────────────────────────────────────── */

export type TreeKind = 'broadleaf' | 'willow' | 'poplar' | 'shrub' | 'lilac' | 'corkscrew' | 'maple' | 'privet' | 'sapling';

/**
 * Each kind's measure (m): its height, the trunk's radius at the foot, how many trunks, how far they lean, where the
 * crown sits and its radii (x, y, z), how many limbs, how many leaf cards and how big, which leaves.
 */
const KINDS: Record<TreeKind, { trunk: number; stems: number; lean: number; at: number; crown: [number, number, number]; limbs: number; cards: number; card: number; leaf: 'broad' | 'narrow'; twist?: number }> = {
	// ash, maple, lime: the banks' tall broadleaves, about 19 m
	broadleaf: { trunk: 0.38, stems: 1, lean: 0.05, at: 12.4, crown: [6.0, 6.2, 6.0], limbs: 6, cards: 300, card: 2.0, leaf: 'broad' },
	// the white willow: two leaning trunks, a broad silvery crown, about 15 m
	willow: { trunk: 0.36, stems: 2, lean: 0.22, at: 9.6, crown: [6.6, 5.0, 6.6], limbs: 5, cards: 280, card: 2.0, leaf: 'narrow' },
	// the black poplar: tall and oval, about 27 m
	poplar: { trunk: 0.46, stems: 1, lean: 0.03, at: 17.8, crown: [4.6, 9.2, 4.6], limbs: 7, cards: 300, card: 2.0, leaf: 'broad' },
	// the willow shrub at the water's edge: many thin stems, about 4.5 m
	shrub: { trunk: 0.07, stems: 4, lean: 0.3, at: 2.4, crown: [2.4, 2.1, 2.4], limbs: 2, cards: 190, card: 0.85, leaf: 'narrow' },
	// a backyard's garden trees: the old lilac, many stems from one root, about 5.5 m
	lilac: { trunk: 0.1, stems: 4, lean: 0.2, at: 3.7, crown: [2.5, 1.9, 2.5], limbs: 3, cards: 520, card: 0.52, leaf: 'broad' },
	// the corkscrew willow: two twisted trunks, a drooping crown of narrow leaves, about 5.5 m
	corkscrew: { trunk: 0.11, stems: 2, lean: 0.24, at: 3.8, crown: [2.4, 1.8, 2.4], limbs: 3, cards: 560, card: 0.48, leaf: 'narrow', twist: 0.16 },
	// a small field maple by a door, about 4.3 m
	maple: { trunk: 0.075, stems: 1, lean: 0.05, at: 2.95, crown: [1.4, 1.35, 1.4], limbs: 4, cards: 360, card: 0.42, leaf: 'broad' },
	// a privet grown to a small tree, several stems, about 4.5 m
	privet: { trunk: 0.065, stems: 3, lean: 0.22, at: 3.0, crown: [1.8, 1.5, 1.8], limbs: 3, cards: 420, card: 0.42, leaf: 'narrow' },
	// a young tree in a pot: one thin stem, a few leaves at its top, about 2.2 m
	sapling: { trunk: 0.02, stems: 1, lean: 0.02, at: 1.75, crown: [0.45, 0.5, 0.45], limbs: 5, cards: 16, card: 0.24, leaf: 'broad' }
};

export type TreeParts = { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; height: number; crown: number };
const treeCache = new Map<string, TreeParts>();

/**
 * A tree as two geometries, for instancing: its wood (trunks, limbs, branches) and its leaves (cards with their UVs
 * in the leaf atlas and normals pointing out from the crown). Standing on its origin, y up. Seeded: one seed, one tree.
 */
export function treeParts(kind: TreeKind, seed = 1, light = false): TreeParts {
	const key = `${kind}:${seed}:${light}`;
	const hit = treeCache.get(key);
	if (hit) return hit;
	// far off, a light tree: its trunks and a few limbs, a third of the cards, each bigger
	const k = light ? { ...KINDS[kind], limbs: Math.min(3, KINDS[kind].limbs), cards: Math.round(KINDS[kind].cards / 4.5), card: KINDS[kind].card * 2.05 } : KINDS[kind];
	const sides = light ? 4 : 0;
	const r = seeded(seed * 7919 + kind.length * 101);
	const wood: THREE.BufferGeometry[] = [];
	const up = v3(0, 1, 0);
	const branch = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, n: number) => {
		// a little longer at its foot, into the branch it grows from, so no joint shows a gap
		const len = a.distanceTo(b) + r0 * 1.2;
		const g = new THREE.CylinderGeometry(r1, r0, len, sides || n, 1, true);
		g.translate(0, len / 2 - r0 * 1.2, 0);
		g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()));
		g.translate(a.x, a.y, a.z);
		// the bark's texture round the branch and along it, at its real size
		const uv = g.attributes.uv!;
		for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(r0 * 6)), uv.getY(i) * len * 0.6);
		wood.push(g);
	};
	const centre = v3(0, k.at, 0);
	const [rx, ry, rz] = k.crown;
	/** a point on the crown's surface in a direction (from its centre) */
	const surface = (d: THREE.Vector3) => {
		const s = 1 / Math.sqrt((d.x / rx) ** 2 + (d.y / ry) ** 2 + (d.z / rz) ** 2);
		return centre.clone().addScaledVector(d, s);
	};
	const tips: THREE.Vector3[] = [];
	for (let st = 0; st < k.stems; st++) {
		const az = (st / k.stems) * Math.PI * 2 + r() * 0.8;
		const lean = k.lean * (0.6 + r() * 0.8);
		const foot = v3(Math.cos(az) * 0.15 * (k.stems > 1 ? 1 : 0), 0, Math.sin(az) * 0.15 * (k.stems > 1 ? 1 : 0));
		const topY = k.at - ry * (kind === 'shrub' ? 0.2 : 0.55);
		const top = v3(foot.x + Math.cos(az) * lean * topY, topY, foot.z + Math.sin(az) * lean * topY);
		const mid = foot.clone().lerp(top, 0.5).add(v3((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5));
		const rt = k.trunk * (k.stems > 1 ? 0.75 : 1);
		if (k.twist) {
			// a corkscrew's trunk: up in short pieces, each turned round the line from foot to top
			const ph = r() * Math.PI * 2;
			let prev = foot.clone().setY(-0.3);
			for (let i = 1; i <= 8; i++) {
				const t = i / 8, a = ph + t * Math.PI * 3.2;
				const p = foot.clone().lerp(top, t).add(v3(Math.cos(a) * k.twist * Math.sin(Math.PI * t), 0, Math.sin(a) * k.twist * Math.sin(Math.PI * t)));
				branch(prev, p, rt * (1.15 - 0.6 * (t - 1 / 8)), rt * (1.15 - 0.6 * t), 6);
				prev = p;
			}
		} else {
			branch(foot.clone().setY(-0.3), mid, rt * 1.15, rt * 0.82, 6);
			branch(mid, top, rt * 0.82, rt * 0.55, 6);
		}
		// the limbs: out and up from the upper trunk towards the crown's surface, each forking into branches
		for (let l = 0; l < k.limbs; l++) {
			const from = mid.clone().lerp(top, 0.35 + r() * 0.65);
			const a = r() * Math.PI * 2;
			const dir = v3(Math.cos(a), 0.55 + r() * 0.9, Math.sin(a)).normalize();
			const end = surface(dir).lerp(centre, 0.25 + r() * 0.15);
			const rl = rt * (0.38 + r() * 0.12);
			const knee = from.clone().lerp(end, 0.5).add(v3((r() - 0.5) * 0.8, (r() - 0.3) * 0.8, (r() - 0.5) * 0.8));
			branch(from, knee, rl, rl * 0.7, 5);
			branch(knee, end, rl * 0.7, rl * 0.35, 5);
			for (let f = 0; f < (light ? 0 : 3); f++) {
				const at = knee.clone().lerp(end, r());
				const d2 = dir.clone().add(v3((r() - 0.5) * 1.4, (r() - 0.2) * 0.8, (r() - 0.5) * 1.4)).normalize();
				const e2 = surface(d2).lerp(centre, 0.12 + r() * 0.1);
				branch(at, at.clone().lerp(e2, 0.85), rl * 0.4, rl * 0.12, 4);
				tips.push(e2);
			}
			tips.push(end);
		}
		// the trunk's own top, up into the crown
		const crownTop = surface(v3((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3)).lerp(centre, 0.3);
		branch(top, crownTop, rt * 0.55, rt * 0.15, 5);
		tips.push(crownTop);
	}

	// the leaves: cards through the crown, most of them in its outer shell and round the branches' tips
	const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
	const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), p = new THREE.Vector3();
	for (let c = 0; c < k.cards; c++) {
		if (c % 3 === 0 && tips.length) {
			const tip = tips[Math.floor(r() * tips.length)]!;
			p.copy(tip).add(v3((r() - 0.5) * rx * 0.5, (r() - 0.5) * ry * 0.4, (r() - 0.5) * rz * 0.5));
		} else {
			const d = v3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
			if (d.lengthSq() < 1e-4) d.set(0, 1, 0);
			d.normalize();
			const depth = 0.6 + 0.4 * Math.sqrt(r());
			p.copy(centre).add(v3(d.x * rx * depth, d.y * ry * depth, d.z * rz * depth));
		}
		// it drops a little under its own weight: the crown's underside is flatter
		if (p.y < centre.y - ry * 0.6) p.y = centre.y - ry * 0.6 + r() * 0.4;
		const size = k.card * (0.75 + r() * 0.5);
		n.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
		t1.crossVectors(n, Math.abs(n.y) < 0.9 ? up : v3(1, 0, 0)).normalize();
		t2.crossVectors(n, t1).normalize();
		// its light: as if the crown were one soft ball
		const out = v3((p.x - centre.x) / rx, (p.y - centre.y) / ry, (p.z - centre.z) / rz).normalize();
		const cell = Math.floor(r() * 4), u0 = (cell % 2) * 0.5, v0 = Math.floor(cell / 2) * 0.5;
		const base = pos.length / 3;
		for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
			pos.push(p.x + (t1.x * a + t2.x * b) * size * 0.5, p.y + (t1.y * a + t2.y * b) * size * 0.5, p.z + (t1.z * a + t2.z * b) * size * 0.5);
			nor.push(out.x, out.y, out.z);
			uvs.push(u0 + (a + 1) * 0.25, 1 - (v0 + (1 - (b + 1) / 2) * 0.5));
		}
		idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	const leaves = new THREE.BufferGeometry();
	leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	leaves.setIndex(idx);
	leaves.computeBoundingSphere();
	const merged = mergeGeometries(wood)!;
	merged.computeBoundingSphere();
	const parts = { wood: merged, leaves, height: k.at + ry, crown: Math.max(rx, rz) };
	treeCache.set(key, parts);
	return parts;
}

/** The wood's material: bark, at its real size. */
export const barkMaterial = shared(() => new THREE.MeshStandardMaterial({ map: bark(), color: '#f0e8dc', roughness: 0.95 }));

/**
 * The leaves' material for a kind of leaf: cut out of the atlas, lit from both faces with the crown's soft normals (not
 * flipped on the far face, so a crown is not dark inside), a little brighter where the sun shines through them.
 */
export function leafMaterial(kind: 'broad' | 'narrow', wind?: { value: number }) {
	const m = new THREE.MeshStandardMaterial({ map: leafAtlas(kind), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, envMapIntensity: 0.7 });
	m.onBeforeCompile = (s) => {
		s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );');
		if (wind) {
			s.uniforms.wind = wind;
			s.vertexShader = s.vertexShader
				.replace('#include <common>', '#include <common>\nuniform float wind;')
				.replace(
					'#include <begin_vertex>',
					`#include <begin_vertex>
					// the crown stirs in the breeze, the outer leaves most, each tree on its own beat
					#ifdef USE_INSTANCING
						float beat = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
					#else
						float beat = 0.0;
					#endif
					float reach = clamp( position.y / 20.0, 0.0, 1.0 );
					transformed.x += sin( wind * 1.7 + beat + position.y * 0.4 ) * 0.06 * reach;
					transformed.z += cos( wind * 1.3 + beat * 1.3 + position.x * 0.5 ) * 0.05 * reach;`
				);
		}
	};
	m.customProgramCacheKey = () => `leaf-${kind}-${wind ? 'wind' : 'still'}`;
	return m;
}

/** The leaves' shadow: the cards cut out as the leaves are. */
export function leafDepthMaterial(kind: 'broad' | 'narrow') {
	return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafAtlas(kind), alphaTest: 0.42 });
}

/** A whole tree, for the 3D models viewer. */
export function tree(kind: TreeKind = 'broadleaf', seed = 1): THREE.Group {
	const g = new THREE.Group();
	g.name = `tree, ${kind}`;
	const p = treeParts(kind, seed);
	const wood = new THREE.Mesh(p.wood, barkMaterial());
	const leaves = new THREE.Mesh(p.leaves, leafMaterial(KINDS[kind].leaf));
	leaves.customDepthMaterial = leafDepthMaterial(KINDS[kind].leaf);
	for (const m of [wood, leaves]) {
		m.castShadow = true;
		m.receiveShadow = true;
		g.add(m);
	}
	return g;
}
export const leafOf = (kind: TreeKind) => KINDS[kind].leaf;

/* ── a park bench ─────────────────────────────────────────────────────────── */

const ironGreen = std('#26332b', 0.55, { metalness: 0.5 });

/**
 * A park bench as the Isar's meadows have them: wooden slats on two cast-iron frames, 1.80 m long, the seat at
 * 45 cm, the back up to 85 cm. Its back towards −z, its front towards +z.
 */
export function parkBench(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'park bench';
	const slat = new THREE.MeshStandardMaterial({ map: pine(true), color: '#a58463', roughness: 0.8 });
	const iron = ironGreen();
	for (const x of [-0.78, 0.78]) {
		// each frame: the front leg, the back leg rising into the back's support, the seat's bearer
		bar(g, v3(x, 0, 0.22), v3(x, 0.43, 0.2), 0.025, iron);
		bar(g, v3(x, 0, -0.2), v3(x, 0.43, -0.16), 0.025, iron);
		bar(g, v3(x, 0.43, -0.16), v3(x, 0.86, -0.3), 0.022, iron);
		part(g, 0.04, 0.04, 0.48, iron, x, 0.42, 0.02);
		part(g, 0.05, 0.02, 0.5, iron, x, 0.01, 0.01);
	}
	for (let i = 0; i < 5; i++) part(g, 1.8, 0.035, 0.075, slat, 0, 0.455, 0.2 - i * 0.088);
	for (let i = 0; i < 3; i++) {
		const y = 0.56 + i * 0.11;
		const p = part(g, 1.8, 0.075, 0.03, slat, 0, y, -0.19 - (y - 0.45) * 0.3);
		p.rotation.x = -0.27;
	}
	return g;
}

/* ── the Wittelsbacherbrücke's lamp ───────────────────────────────────────── */

/**
 * A lamp of the Wittelsbacherbrücke: a dark cast-iron post on a stone-coloured foot, 5.4 m high, a crossbar at its top
 * and a lantern hanging from each end. Standing on its origin, its crossbar along x. userData: `glass` (the lanterns'
 * glowing material) and `lights` (where their light sits, in the model's space).
 */
export function bridgeLamp(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'Wittelsbacherbrücke lamp';
	const iron = std('#1f2421', 0.5, { metalness: 0.6 })();
	const glass = new THREE.MeshStandardMaterial({ color: '#f3e7cf', roughness: 0.25, emissive: '#ffcf8a', emissiveIntensity: 0.15 });
	part(g, 0.36, 0.3, 0.36, iron, 0, 0.15, 0);
	bar(g, v3(0, 0.3, 0), v3(0, 1.1, 0), 0.11, iron, 0.075);
	bar(g, v3(0, 1.1, 0), v3(0, 5.2, 0), 0.075, iron, 0.055);
	for (const y of [1.1, 2.6]) {
		const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 6, 16), iron);
		ring.rotation.x = Math.PI / 2;
		ring.position.y = y;
		g.add(ring);
	}
	bar(g, v3(-0.62, 5.15, 0), v3(0.62, 5.15, 0), 0.03, iron);
	bar(g, v3(0, 4.7, 0), v3(-0.5, 5.12, 0), 0.02, iron);
	bar(g, v3(0, 4.7, 0), v3(0.5, 5.12, 0), 0.02, iron);
	const finial = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 8), iron);
	finial.position.y = 5.42;
	g.add(finial);
	const lights: THREE.Vector3[] = [];
	for (const x of [-0.6, 0.6]) {
		bar(g, v3(x, 5.15, 0), v3(x, 4.95, 0), 0.012, iron);
		const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.16, 8), iron);
		cap.position.set(x, 4.9, 0);
		g.add(cap);
		const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.42, 8), glass);
		lantern.position.set(x, 4.62, 0);
		g.add(lantern);
		const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.05, 0.08, 8), iron);
		foot.position.set(x, 4.37, 0);
		g.add(foot);
		lights.push(v3(x, 4.6, 0));
	}
	g.traverse((o) => (o.castShadow = true));
	g.userData = { glass, lights };
	return g;
}

/* ── a limestone block ────────────────────────────────────────────────────── */

/**
 * A rough block of shell limestone, its edges worn round, as they lie by the Isar's paths to sit on and in its steps.
 * Standing on the ground at its origin. Seeded: one seed, one block.
 */
export function limestoneBlock({ w = 1.6, h = 0.8, d = 0.9, seed = 1 }: { w?: number; h?: number; d?: number; seed?: number } = {}): THREE.Mesh {
	const r = seeded(seed * 131 + 7);
	const geo = new THREE.BoxGeometry(w, h, d, 8, 4, 5);
	const p = geo.attributes.position!;
	const ph = [r() * 6, r() * 6, r() * 6];
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
		// worn round at its edges and corners, a little uneven on its faces
		const ex = Math.abs(x) / (w / 2), ey = Math.abs(y) / (h / 2), ez = Math.abs(z) / (d / 2);
		const corner = Math.max(0, ex + ey + ez - 2.1) * 0.12;
		const bump = 0.025 * Math.sin(x * 5 + ph[0]!) * Math.sin(z * 4 + ph[1]!) + 0.015 * Math.sin(y * 9 + ph[2]!);
		const k = 1 - corner / Math.max(0.3, Math.hypot(x, y, z));
		p.setXYZ(i, x * k + Math.sign(x) * bump * ex, y * k + (y > 0 ? bump * 0.5 : 0), z * k + Math.sign(z) * bump * ez);
	}
	geo.computeVertexNormals();
	geo.translate(0, h / 2 - 0.02, 0);
	const m = new THREE.Mesh(geo, limestoneMaterial());
	m.castShadow = m.receiveShadow = true;
	m.name = 'limestone block';
	return m;
}
export const limestoneMaterial = shared(() => new THREE.MeshStandardMaterial({ map: limestone(), color: '#d6cfc2', roughness: 0.92 }));

/* ── the bronze rider ─────────────────────────────────────────────────────── */

/**
 * Otto von Wittelsbach on his horse, in bronze gone dark green (Georg Wrba, 1905), as it stands high on its pier of the
 * Wittelsbacherbrücke: about 4.4 m from the hooves to the rider's raised hand, the horse 3.4 m long. A figure seen
 * from the meadow far below, its shape and not its features. Standing on its origin, facing +z.
 */
export function equestrianStatue(): THREE.Group {
	const g = new THREE.Group();
	g.name = 'Otto von Wittelsbach, bronze';
	const bronze = std('#3c4636', 0.48, { metalness: 0.65 })();
	const ball = (at: THREE.Vector3, r: [number, number, number], rot = 0) => {
		const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), bronze);
		m.scale.set(...r);
		m.position.copy(at);
		m.rotation.x = rot;
		m.castShadow = true;
		g.add(m);
		return m;
	};
	const limb = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0) => bar(g, a, b, r0, bronze, r1);
	// the horse: its barrel, chest and haunches, the neck raised, the head bowed a little, one forefoot lifted
	ball(v3(0, 1.85, 0), [0.52, 0.6, 1.25]);
	ball(v3(0, 1.95, 0.85), [0.5, 0.62, 0.55]);
	ball(v3(0, 1.9, -0.9), [0.55, 0.62, 0.6]);
	limb(v3(0, 2.2, 1.1), v3(0, 3.0, 1.65), 0.33, 0.22);
	ball(v3(0, 3.0, 1.95), [0.2, 0.25, 0.48], 0.6);
	limb(v3(0.08, 3.25, 1.7), v3(0.1, 3.42, 1.68), 0.04, 0.01);
	limb(v3(-0.08, 3.25, 1.7), v3(-0.1, 3.42, 1.68), 0.04, 0.01);
	limb(v3(0.25, 1.5, 0.95), v3(0.25, 0.75, 1.0), 0.13, 0.09);
	limb(v3(0.25, 0.75, 1.0), v3(0.25, 0.04, 1.02), 0.09, 0.08);
	limb(v3(-0.25, 1.5, 0.95), v3(-0.25, 0.95, 1.25), 0.13, 0.09);
	limb(v3(-0.25, 0.95, 1.25), v3(-0.25, 0.75, 1.6), 0.09, 0.08);
	for (const x of [0.25, -0.25]) {
		limb(v3(x, 1.55, -1.0), v3(x, 0.85, -1.15), 0.16, 0.1);
		limb(v3(x, 0.85, -1.15), v3(x, 0.04, -1.0), 0.09, 0.08);
	}
	limb(v3(0, 2.05, -1.4), v3(0, 1.0, -1.75), 0.12, 0.05);
	// the rider: upright in the saddle, his cloak behind him, his right hand raised
	ball(v3(0, 2.75, 0.05), [0.3, 0.42, 0.24]);
	ball(v3(0, 3.3, 0.02), [0.32, 0.38, 0.22]);
	ball(v3(0, 3.82, 0.04), [0.14, 0.17, 0.15]);
	limb(v3(0.3, 2.5, 0.1), v3(0.42, 1.95, 0.35), 0.11, 0.09);
	limb(v3(-0.3, 2.5, 0.1), v3(-0.42, 1.95, 0.35), 0.11, 0.09);
	limb(v3(0.3, 3.5, 0.0), v3(0.48, 3.95, 0.2), 0.08, 0.07);
	limb(v3(0.48, 3.95, 0.2), v3(0.5, 4.4, 0.32), 0.07, 0.06);
	limb(v3(-0.3, 3.5, 0.0), v3(-0.36, 3.05, 0.35), 0.08, 0.07);
	const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 12, 1, true), bronze);
	cloak.position.set(0, 2.85, -0.28);
	cloak.rotation.x = -0.35;
	cloak.castShadow = true;
	g.add(cloak);
	return g;
}

/* ── small plants: bushes, herbs, hanging and climbing stems ──────────────────────────────────────────────────── */

const tinted = new Map<string, { leaves: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial }>();
/** The leaves of a small plant, a kind of leaf in a tint (the atlas is drawn green; the tint shades it, `gain` over 1
 *  lightens it — an olive's silver): shared by every plant of that look. */
export function plantLeaves(kind: 'broad' | 'narrow', tint = '#ffffff', gain = 1) {
	const key = `${kind}:${tint}:${gain}`;
	let hit = tinted.get(key);
	if (!hit) {
		const leaves = leafMaterial(kind);
		leaves.color.set(tint).multiplyScalar(gain);
		hit = { leaves, depth: leafDepthMaterial(kind) };
		tinted.set(key, hit);
	}
	return hit;
}

/** cards of leaves round points, each facing anywhere, lit as the soft mass they make (normals out from `centre`) */
function cards(points: { p: THREE.Vector3; size: number }[], centre: (p: THREE.Vector3) => THREE.Vector3, r: () => number): THREE.BufferGeometry {
	const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
	const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), up = v3(0, 1, 0);
	for (const { p, size } of points) {
		n.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
		t1.crossVectors(n, Math.abs(n.y) < 0.9 ? up : v3(1, 0, 0)).normalize();
		t2.crossVectors(n, t1).normalize();
		const out = p.clone().sub(centre(p)).normalize();
		const cell = Math.floor(r() * 4), u0 = (cell % 2) * 0.5, v0 = Math.floor(cell / 2) * 0.5;
		const base = pos.length / 3;
		for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
			pos.push(p.x + (t1.x * a + t2.x * b) * size * 0.5, p.y + (t1.y * a + t2.y * b) * size * 0.5, p.z + (t1.z * a + t2.z * b) * size * 0.5);
			nor.push(out.x, out.y, out.z);
			uvs.push(u0 + (a + 1) * 0.25, 1 - (v0 + (1 - (b + 1) / 2) * 0.5));
		}
		idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	g.setIndex(idx);
	g.computeBoundingSphere();
	return g;
}

export type BushOptions = { w?: number; h?: number; d?: number; cards?: number; card?: number; leaf?: 'broad' | 'narrow'; tint?: string; gain?: number; seed?: number; base?: number };

/**
 * A bush, a herb or a clump of leaves: cards of leaves through a dome `w` × `h` × `d` (its foot `base` above the
 * origin), most of them in its outer shell, lit as one soft mass. Seeded: one seed, one bush.
 */
export function bush({ w = 0.5, h = 0.4, d = w, cards: n = 60, card = 0.2, leaf = 'broad', tint = '#ffffff', gain = 1, seed = 1, base = 0 }: BushOptions = {}): THREE.Mesh {
	const r = seeded(seed * 911 + n);
	const c = v3(0, base + h * 0.35, 0);
	const pts: { p: THREE.Vector3; size: number }[] = [];
	for (let i = 0; i < n; i++) {
		const dir = v3(r() * 2 - 1, r() * 1.3 - 0.3, r() * 2 - 1);
		if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
		dir.normalize();
		const depth = 0.55 + 0.45 * Math.sqrt(r());
		const p = v3(dir.x * (w / 2) * depth, Math.max(base + card * 0.25, c.y + dir.y * h * 0.65 * depth), dir.z * (d / 2) * depth);
		pts.push({ p, size: card * (0.7 + r() * 0.6) });
	}
	const look = plantLeaves(leaf, tint, gain);
	const m = new THREE.Mesh(cards(pts, () => c, r), look.leaves);
	m.customDepthMaterial = look.depth;
	m.castShadow = m.receiveShadow = true;
	m.name = 'bush';
	return m;
}

/**
 * Stems hanging down (ivy over a wall's coping, a trailing plant over a pot's rim) or climbing (a creeper up a wire):
 * each a line of leaf cards from its start along a curve. `from` the points they start at, `to` where each would end
 * (they sway a little on the way), `per` cards a metre, `face` the way the leaves turn (away from the wall they
 * hang on).
 */
export function stems(
	lines: [THREE.Vector3, THREE.Vector3][],
	{ card = 0.12, per = 22, leaf = 'broad', tint = '#ffffff', seed = 1, spread = 0.06, face = v3(0, 0, 1) }: { card?: number; per?: number; leaf?: 'broad' | 'narrow'; tint?: string; seed?: number; spread?: number; face?: THREE.Vector3 } = {}
): THREE.Mesh {
	const r = seeded(seed * 577 + lines.length);
	const pts: { p: THREE.Vector3; size: number }[] = [];
	const backs: THREE.Vector3[] = [];
	for (const [a, b] of lines) {
		const len = a.distanceTo(b), n = Math.max(2, Math.round(len * per));
		const ph = r() * 6;
		for (let i = 0; i < n; i++) {
			const t = i / (n - 1);
			const p = a.clone().lerp(b, t).add(v3(Math.sin(t * 7 + ph) * spread + (r() - 0.5) * spread, (r() - 0.5) * spread * 0.5, Math.cos(t * 5 + ph) * spread * 0.5 + (r() - 0.5) * spread));
			pts.push({ p, size: card * (0.75 + r() * 0.5) * (1 - 0.35 * t) });
			backs.push(a.clone().lerp(b, t));
		}
	}
	let k = 0;
	const look = plantLeaves(leaf, tint);
	// lit as if each leaf faced out from the line it hangs on, away from its wall
	const back = face.clone().normalize().multiplyScalar(-0.2);
	const m = new THREE.Mesh(cards(pts, () => backs[k++]!.clone().add(back), r), look.leaves);
	m.customDepthMaterial = look.depth;
	m.castShadow = true;
	m.receiveShadow = true;
	m.name = 'stems';
	return m;
}

/**
 * Leaves at given points, each card `size` across, lit as if they faced out from `centreOf(point)`: for a clipped
 * hedge's face, an ivy-covered shape, anything whose leaves follow a surface of its own.
 */
export function scatterLeaves(points: { p: THREE.Vector3; size: number }[], centreOf: (p: THREE.Vector3) => THREE.Vector3, { leaf = 'broad', tint = '#ffffff', seed = 1 }: { leaf?: 'broad' | 'narrow'; tint?: string; seed?: number } = {}): THREE.Mesh {
	const look = plantLeaves(leaf, tint);
	const m = new THREE.Mesh(cards(points, centreOf, seeded(seed * 313 + points.length)), look.leaves);
	m.customDepthMaterial = look.depth;
	m.castShadow = m.receiveShadow = true;
	m.name = 'leaves';
	return m;
}
