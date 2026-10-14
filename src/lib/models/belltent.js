// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE BELL TENT — our bell tent (the Buildings' one, $lib/sandbox-2/interior/tent.ts, which stays as it is) as a model
 * in its parts, pitched the way a settler pitches it; the fire place in front of it; and the bag it comes in.
 *
 * The tent: cotton canvas 4.2 m across on one centre pole. A wall 75 cm high all round, the bell rising from it to the
 * pole's top at 3 m, a door at the front (+z) 1.1 m wide and 1.8 m high whose two flaps roll back to either side. Ten
 * wall poles stand under its eave, ten guy ropes run from their spikes out to pegs 1.5 m from the wall, a bathtub
 * groundsheet is zipped in. Inside: a jute rug, two mats and sleeping bags with their pillows at the back, a crate for
 * a table with two mugs and a book on it, two packs against the wall, and a hurricane lantern hung on the pole, lit.
 *
 * It is pitched step by step (bellTent's setPitch, k from 0 to 1; each step's range is in BELL_TENT.steps): the
 * groundsheet unfolded from the door and pegged; the canvas spread over it; the centre pole walked upright under it,
 * the canvas rising on it; the wall poles stood under the eave and the wall's foot pegged out; the guy ropes run out
 * one by one to their pegs and tensioned; the door flaps rolled back and tied; the things brought in, the lantern
 * hung and lit. Every piece is a part of its own (userData.parts by id, userData.catalog its cards and steps, as the
 * Power Cube machines have them): the Things viewer picks it, shows it alone, takes the tent apart (userData.explode)
 * and pitches it.
 *
 * The fire place (firePlace) goes in front of it (BELL_TENT.fire): a ring of stones round a bed of ash, four logs in a
 * tepee, the flames and their light, two camp chairs facing the fire, a woodpile; built step by step (setBuild) and
 * lit or put out (userData.fire.setLit).
 *
 * The bag (bellTentBag) is a roll of canvas 1.1 m long and 0.5 m thick, two straps buckled round it; unrolled
 * (setOpen) what is in it lies on it: the canvas folded, the groundsheet rolled, the centre pole in three sections, the
 * wall poles in a bundle, the pegs in a sack.
 *
 * Each at its real measure (./units.js), standing on the ground at its origin.
 */
import * as THREE from 'three';
import { soft, std } from './parts';
import { canvasTexture } from './textures';

const m = {
	pole: std('#9c6b3f', 0.6),
	ferrule: std('#8e9398', 0.4, { metalness: 0.7 }),
	steel: std('#3a3d40', 0.5, { metalness: 0.6 }),
	rope: std('#d8ccb0', 1),
	runner: std('#a77d4f', 0.7),
	sheet: std('#5c6650', 0.95),
	rim: std('#4f5845', 0.9, { side: THREE.DoubleSide }),
	rubber: std('#1c1d1e', 0.8),
	hook: std('#c8742c', 0.6),
	rug: std('#b9a589', 1),
	mat: std('#2f3438', 0.9),
	bagA: std('#2f6f73', 0.8),
	bagB: std('#b5553a', 0.8),
	linen: std('#f1ece2', 0.95),
	crate: std('#a98256', 0.8),
	groove: std('#6f5232', 0.85),
	enamel: std('#f4f1ea', 0.35),
	enamelRim: std('#2c4a6e', 0.4),
	book: std('#c47a4a', 0.9),
	pages: std('#efe6d2', 0.9),
	enamelIn: std('#f4f1ea', 0.35, { side: THREE.DoubleSide }),
	packA: std('#56643f', 0.9),
	packB: std('#7a4a32', 0.9),
	strap: std('#1e1f1f', 0.75),
	lantern: std('#2f4a3a', 0.45, { metalness: 0.5 }),
	stone: std('#8d8a83', 0.9),
	ash: std('#3b3835', 1),
	bark: std('#6b4c32', 0.9),
	wood: std('#c9a274', 0.8),
	seat: std('#3f5f4a', 0.9),
	leg: std('#23262a', 0.5, { metalness: 0.4 }),
	bag: std('#cfc3a4', 0.92),
	buckle: std('#111213', 0.45),
	sack: std('#4b4a33', 0.95),
	folded: std('#e6dcc4', 0.95)
};

/** the tent's measures (as the Buildings' bell tent): its radius at the wall, the wall's height, the pole's top, the
 *  door's half width and its top, how far out the guy ropes' pegs are from the wall; each pitching step's range of k
 *  (setPitch), in order; and where its fire place stands in front of it */
export const BELL_TENT = {
	R: 2.1,
	wall: 0.75,
	pole: 3,
	doorHalf: 0.55,
	doorTop: 1.8,
	guyOut: 1.5,
	steps: { groundsheet: [0, 0.12], canvas: [0.12, 0.2], pole: [0.2, 0.42], wall: [0.42, 0.56], guys: [0.56, 0.78], door: [0.78, 0.86], inside: [0.86, 1] },
	fire: { x: 1.2, z: 4.2 }
};

const clamp = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);
const span = (k, [a, b]) => clamp((k - a) / (b - a));
const lerp = THREE.MathUtils.lerp;
const adiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** the i-th of n turns, one after another, as far as f of them is done: how far this one is (0 … 1) */
const turn = (f, i, n) => clamp(f * n - i);
const UP = new THREE.Vector3(0, 1, 0);

/** a round rod stretched from a to b, set again as it moves */
function rod(r, mat, seg = 6) {
	const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, seg), mat);
	o.castShadow = true;
	o.userData.span = (a, b) => {
		const d = b.clone().sub(a);
		const len = d.length();
		o.visible = len > 1e-4;
		if (!o.visible) return;
		o.position.copy(a).addScaledVector(d, 0.5);
		o.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
		o.scale.set(1, len, 1);
	};
	return o;
}

/**
 * A peg at its spot, turned so +z is away from the tent: a shaft leaning out by `tilt`, `len` long in the hand and
 * `out` of it left showing once it is knocked in, a hook at its top (and a rubber ring, `ring`, for the groundsheet's).
 * userData.drive(t): 0 not there; brought down to the ground, then knocked in.
 */
function peg({ tilt = 0, len = 0.23, out = 0.04, r = 0.005, head = m.steel(), ring = false }) {
	const p = new THREE.Group();
	const lean = new THREE.Group();
	lean.rotation.x = tilt;
	p.add(lean);
	const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.6, 1, 6).translate(0, 0.5, 0), m.steel());
	shaft.castShadow = true;
	const hook = new THREE.Mesh(new THREE.TorusGeometry(0.012, r * 0.8, 4, 8, Math.PI).rotateY(Math.PI / 2), head);
	lean.add(shaft, hook);
	if (ring) {
		const band = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 5, 12).rotateX(Math.PI / 2), m.rubber());
		band.position.set(0, 0.006, -0.02);
		p.add(band);
	}
	p.userData.drive = (t) => {
		p.visible = t > 0;
		const lift = (1 - ease(clamp(t / 0.3))) * 0.35;
		const h = lerp(len, out, ease(clamp((t - 0.3) / 0.7)));
		shaft.scale.y = h;
		shaft.position.y = lift;
		hook.position.y = lift + h;
	};
	return p;
}

/** the canvas's weave and the seams between its twelve panels, along the texture's u (one panel a repeat) */
const canvasTex = () =>
	canvasTexture('bell-tent-canvas', 256, 256, (x, r) => {
		x.fillStyle = '#ece3cf';
		x.fillRect(0, 0, 256, 256);
		for (let i = 0; i < 3200; i++) {
			x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '90,70,40'},${0.03 + r() * 0.04})`;
			x.fillRect(r() * 256, r() * 256, 1.5, 1.5);
		}
		x.fillStyle = 'rgba(110,90,60,0.32)';
		x.fillRect(0, 0, 3, 256);
		x.fillStyle = 'rgba(255,255,255,0.25)';
		x.fillRect(3, 0, 2, 256);
	});

/** the cards of the tent's parts, its assemblies (and which way each is drawn out of it, taken apart), its steps */
const TENT_ASSEMBLIES = [
	{ id: 'ground', label: 'Groundsheet', note: 'What it stands on: the bathtub groundsheet and the pegs that hold it down.', out: [0, 0, 0] },
	{ id: 'canvas', label: 'Canvas', note: 'One piece of cotton canvas sewn from twelve panels: the bell, the wall below it, the door in both.', out: [0, 2.6, 0] },
	{ id: 'poles', label: 'Poles', note: 'The centre pole the whole tent hangs from, and the short wall poles under its eave.', out: [0, 0, 0] },
	{ id: 'guys', label: 'Ropes and pegs', note: 'What holds it to the ground and keeps the canvas tight: the guy ropes, their runners and pegs, the wall pegs.', out: [0, 0, 0] },
	{ id: 'inside', label: 'Inside', note: 'What is brought in once it stands: two beds at the back, a table, the packs, the lantern.', out: [0, 0, 0] }
];
const TENT_STEPS = [
	'Lay the groundsheet out where the tent will stand, its door to the front, unfold it and peg it down through the rings round its edge.',
	'Spread the canvas over it, its door over the groundsheet’s door.',
	'Crawl in under the canvas with the centre pole, put its spike through the cap at the top and walk it upright: the canvas rises on it.',
	'Stand a wall pole under the eave at each guy rope’s loop, its spike through the eyelet, then peg the wall’s foot out round the groundsheet.',
	'Run each guy rope out from its wall pole, knock its peg in at 45° 1.5 m out from the wall, loop the rope over it and pull it tight with its runner.',
	'Roll the door flaps back to either side of the door and tie them.',
	'Bring the things in: the rug, two mats and sleeping bags with their pillows, the crate with two mugs and a book, the packs; hang the lantern on the pole and light it.'
];
const TENT_PARTS = [
	{ id: 'groundsheet', label: 'Groundsheet', assembly: 'ground', step: 1, what: 'Heavy PVC, round, 4.2 m across, its edge turned up 15 cm into a tub so no water runs in; zipped to the foot of the wall all round.', specs: [['Across', '4.2 m'], ['Rim', '15 cm high'], ['Weight', 'about 540 g/m²']] },
	{ id: 'sheet-pegs', label: 'Groundsheet pegs', assembly: 'ground', step: 1, count: 12, what: 'A plastic hook peg through a rubber ring at each D-ring round the groundsheet’s edge: the rubber gives, so the sheet is held without tearing.', specs: [['Peg', '18 cm'], ['Ring', '45 mm rubber']] },
	{ id: 'bell', label: 'Bell', assembly: 'canvas', step: 2, what: 'The roof: twelve panels of 285 g/m² cotton canvas sewn into a bell, rising from the eave to a leather-backed cap round the pole’s spike. It glows from inside at night.', moves: 'Rises on the centre pole as it is walked upright', specs: [['Across at the eave', '4.5 m'], ['Up to', '3 m'], ['Canvas', '285 g/m² cotton, proofed']] },
	{ id: 'wall', label: 'Wall', assembly: 'canvas', step: 2, what: 'The same canvas hanging 75 cm from the eave to the ground, all round but for the door, pegged out at its foot; zipped to the groundsheet.', moves: 'Hangs loose until the wall poles push the eave up and its foot is pegged', specs: [['High', '75 cm'], ['Round', '13.2 m']] },
	{ id: 'door-flaps', label: 'Door flaps', assembly: 'canvas', step: 6, count: 2, what: 'The door, 1.1 m wide and 1.8 m high, closes with two flaps zipped down its middle; by day they are rolled back to either side and tied with their ties.', moves: 'Roll back to the sides of the door and are tied', specs: [['Door', '1.1 × 1.8 m'], ['Ties', 'two each']] },
	{ id: 'centre-pole', label: 'Centre pole', assembly: 'poles', step: 3, what: 'Ash, 70 mm round and 3.15 m long in three sections joined by steel ferrules; a spike at its top through the canvas’s cap, a rubber foot.', moves: 'Walked upright from lying, its top under the cap, its foot sliding in to the middle', specs: [['Long', '3.15 m'], ['Sections', 'three, 1.05 m'], ['Round', '70 mm']] },
	{ id: 'wall-poles', label: 'Wall poles', assembly: 'poles', step: 4, count: 10, what: 'Short poles standing just inside the wall under the eave, each with a spike through the eyelet at a guy rope’s loop: they hold the eave up so the wall hangs straight.', moves: 'Stood up one by one', specs: [['High', '82 cm with its spike'], ['Round', '25 mm']] },
	{ id: 'guy-ropes', label: 'Guy ropes', assembly: 'guys', step: 5, count: 10, what: 'Ten 8 mm polyester ropes from the wall poles’ spikes out to their pegs; tight, they pull the eave out and keep the canvas taut in the wind.', moves: 'Run out to their pegs and tensioned', specs: [['Rope', '8 mm'], ['Out', '1.5 m from the wall']] },
	{ id: 'runners', label: 'Runners', assembly: 'guys', step: 5, count: 10, what: 'A wooden runner on each guy rope: slid along it, it pulls the rope tight or lets it off as the canvas shrinks in the rain and dries.', moves: 'Slid along its rope to tension it' },
	{ id: 'guy-pegs', label: 'Guy pegs', assembly: 'guys', step: 5, count: 10, what: 'Steel pegs 30 cm long, knocked in at 45° leaning away from the tent, so the rope pulls them down into the ground and not out of it.', specs: [['Long', '30 cm'], ['Angle', '45°']] },
	{ id: 'wall-pegs', label: 'Wall pegs', assembly: 'guys', step: 4, count: 18, what: 'Steel pin pegs through the loops at the wall’s foot, all round but for the door.', specs: [['Long', '23 cm']] },
	{ id: 'rug', label: 'Rug', assembly: 'inside', step: 7, what: 'A round jute rug 1.8 m across in front of the beds.' },
	{ id: 'mats', label: 'Mats', assembly: 'inside', step: 7, count: 2, what: 'Two foam sleeping mats, 62 cm wide and 1.9 m long, at the back.' },
	{ id: 'sleeping-bags', label: 'Sleeping bags', assembly: 'inside', step: 7, count: 2, what: 'Two sleeping bags on the mats, one teal and one rust.' },
	{ id: 'pillows', label: 'Pillows', assembly: 'inside', step: 7, count: 2, what: 'Two linen pillows at the head of the beds, by the wall.' },
	{ id: 'crate', label: 'Crate', assembly: 'inside', step: 7, what: 'A wooden crate 50 × 36 cm on its side for a table, by the door.' },
	{ id: 'mugs', label: 'Mugs', assembly: 'inside', step: 7, count: 2, what: 'Two white enamel mugs with blue rims on the crate.' },
	{ id: 'book', label: 'Book', assembly: 'inside', step: 7, what: 'A book left on the crate.' },
	{ id: 'packs', label: 'Packs', assembly: 'inside', step: 7, count: 2, what: 'Two packs against the wall, olive and brown.' },
	{ id: 'lantern', label: 'Lantern', assembly: 'inside', step: 7, what: 'A green hurricane lantern hung from a hook on the pole at 2 m, its flame behind glass: the light inside the tent, and the glow of the canvas at night.', moves: 'Hung on its hook and lit', specs: [['Hung at', '2 m'], ['Light', 'warm, about 5 m']] }
];
const SOURCES = [
	{ label: 'Bell tent (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Bell_tent' },
	{ label: 'The Buildings’ bell tent', url: '/app/buildings/' }
];

/**
 * The bell tent, pitched as far as `pitch` (0 nothing … 1 standing, furnished, the lantern lit). userData:
 * - setPitch(k), pitch; work(k): where the work is at k (the tent's frame), for a worker to stand by
 * - lamp: the lantern's PointLight; canvas: the canvas's material (its emissive is the glow at night)
 * - walk: { r, door, headroom, colliders: [{ x, z, r }] } (the wall's radius at the ground, the door's half width at
 *   +z, how far from the pole a grown-up stands upright under the bell, what is in the way), with the Things viewer's
 *   walk (x, z, yaw, canStand, floorAt, lamps) in it too
 * - parts (each part's group by id), catalog, explode(k)
 */
export function bellTent({ pitch = 1 } = {}) {
	const { R, wall, pole, doorHalf, doorTop, guyOut, steps } = BELL_TENT;
	const g = new THREE.Group();
	const parts = {};
	for (const { id } of TENT_PARTS) {
		const p = new THREE.Group();
		p.name = id;
		p.userData.part = id;
		g.add(p);
		parts[id] = p;
	}
	/** a piece of a part that is drawn straight out from the middle when the tent is taken apart */
	const piece = (part, a) => {
		const q = new THREE.Group();
		if (a !== undefined) q.userData.radial = [Math.sin(a), Math.cos(a)];
		part.add(q);
		return q;
	};
	const gap = doorHalf / R;

	/* ── the groundsheet ── */
	const sheetPart = parts.groundsheet;
	const fold = new THREE.Group();
	sheetPart.add(fold);
	const floor = new THREE.Mesh(new THREE.CircleGeometry(R - 0.01, 64).rotateX(-Math.PI / 2), m.sheet());
	floor.position.y = 0.012;
	floor.receiveShadow = true;
	const tub = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.015, R - 0.015, 0.15, 64, 1, true, gap, Math.PI * 2 - 2 * gap), m.rim());
	tub.position.y = 0.075;
	fold.add(floor, tub);
	const sheetPegs = [];
	for (let i = 0; i < 14; i++) {
		const a = ((i + 0.5) / 14) * Math.PI * 2;
		if (Math.abs(adiff(a, 0)) < gap + 0.05) continue;
		const p = peg({ len: 0.18, out: 0.035, r: 0.006, head: m.hook(), ring: true });
		p.position.set(Math.sin(a) * (R + 0.03), 0, Math.cos(a) * (R + 0.03));
		p.rotation.y = a;
		piece(parts['sheet-pegs'], a).add(p);
		sheetPegs.push(p);
	}

	/* ── the canvas: the bell and the wall hung from one meridian (apex → eave → the wall's foot), the door's flaps ── */
	const canvas = new THREE.MeshStandardMaterial({ map: canvasTex(), color: '#ffffff', emissive: '#5a4c34', emissiveIntensity: 0.35, roughness: 1, side: THREE.DoubleSide });
	const BR = 24, BC = 72, WR = 6, WC = 64, PANELS = 12;
	const bellAt = (v) => ({ r: (R + 0.12) * (1 - v) ** 1.25 + 0.04, y: wall + (pole - wall) * (1 - (1 - v) ** 1.6) });
	const MER = [];
	{
		let s = 0, prev = null;
		for (let q = 0; q <= BR; q++) {
			const p = bellAt(1 - q / BR);
			if (prev) s += Math.hypot(p.r - prev.r, p.y - prev.y);
			MER.push({ s, r: p.r, y: p.y, bell: true });
			prev = p;
		}
		const hem = s + 0.02;
		for (let w = 0; w <= WR; w++) MER.push({ s: hem + (wall * w) / WR, r: R, y: wall * (1 - w / WR), bell: false });
	}
	const S_HEM = MER[BR].s;
	const N = MER.length;
	const rr = new Float32Array(N), ry = new Float32Array(N), lying = new Float32Array(N);
	const LIE = 0.025;
	/**
	 * The canvas's meridian as it hangs now: its eave let down by `sag` (no wall poles under it yet), its top let down by
	 * `drop` (the pole not up yet); where it meets the ground the rest lies on it, bunched (`bunch`), and spread out as
	 * far as `spread` (the canvas still in a heap by the door, at 0).
	 */
	function hang(drop, sag, spread = 1) {
		for (let i = 0; i < N; i++) {
			const p = MER[i];
			const near = p.bell ? ease(clamp(1 - (S_HEM - p.s) / 0.9)) : 1;
			rr[i] = p.r - sag * 0.1 * near;
			ry[i] = p.y - sag * 0.24 * near - drop;
			lying[i] = 0;
		}
		let k = 0;
		while (k < N && ry[k] > LIE) k++;
		if (k === N) return;
		let r0 = 0, s0 = 0;
		if (k > 0) {
			const t = (ry[k - 1] - LIE) / (ry[k - 1] - ry[k]);
			r0 = lerp(rr[k - 1], rr[k], t);
			s0 = lerp(MER[k - 1].s, MER[k].s, t);
		}
		for (let i = k; i < N; i++) {
			rr[i] = (r0 + (MER[i].s - s0) * 0.62) * spread;
			ry[i] = LIE + (MER[i].s - s0) * 0.004;
			lying[i] = 1;
		}
	}
	let heap = 0; // the canvas still in a heap by the door (1) or spread out (0)
	const crumple = (a, s, i) => lying[i] * (0.012 + 0.018 * (0.5 + 0.5 * Math.sin(a * 9 + s * 4.5))) + heap * 0.16 * (0.5 + 0.5 * Math.sin(a * 6) * Math.cos(s * 6));
	/** the pole being walked up under the canvas (its top over the middle, its foot at z = foot), or null: the canvas
	 *  lies over it in a ridge, its sides falling away from it */
	let ridge = null;
	const over = (x, y, z) => {
		if (!ridge || z <= 0 || z >= ridge.foot) return y;
		return Math.max(y, ridge.top * (1 - z / ridge.foot) + 0.06 - Math.max(0, Math.abs(x) - 0.08) * 0.9);
	};
	const place = (pa, idx, a, i) => {
		const x = Math.sin(a) * rr[i], z = Math.cos(a) * rr[i] + heap * 1.3;
		pa.setXYZ(idx, x, over(x, ry[i] + crumple(a, MER[i].s, i), z), z);
	};

	const bellGeo = new THREE.BufferGeometry();
	{
		const pos = new Float32Array((BR + 1) * (BC + 1) * 3), uv = [], idx = [];
		for (let q = 0; q <= BR; q++) for (let i = 0; i <= BC; i++) uv.push((i / BC) * PANELS, MER[q].s);
		for (let q = 0; q < BR; q++)
			for (let i = 0; i < BC; i++) {
				const a = ((i + 0.5) / BC) * Math.PI * 2;
				if (Math.abs(adiff(a, 0)) * MER[q].r < doorHalf && MER[q].y < doorTop) continue;
				const p = q * (BC + 1) + i, l = p + BC + 1;
				idx.push(l, p, l + 1, l + 1, p, p + 1);
			}
		bellGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		bellGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		bellGeo.setIndex(idx);
	}
	const wallGeo = new THREE.BufferGeometry();
	const wallA = (i) => gap + ((Math.PI * 2 - 2 * gap) * i) / WC;
	{
		const pos = new Float32Array((WR + 1) * (WC + 1) * 3), uv = [], idx = [];
		for (let w = 0; w <= WR; w++) for (let i = 0; i <= WC; i++) uv.push((wallA(i) / (Math.PI * 2)) * PANELS, MER[BR + 1 + w].s);
		for (let w = 0; w < WR; w++)
			for (let i = 0; i < WC; i++) {
				const p = w * (WC + 1) + i, l = p + WC + 1;
				idx.push(l, p, l + 1, l + 1, p, p + 1);
			}
		wallGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		wallGeo.setIndex(idx);
	}
	const bell = new THREE.Mesh(bellGeo, canvas);
	const wallMesh = new THREE.Mesh(wallGeo, canvas);
	for (const o of [bell, wallMesh]) {
		o.castShadow = true;
		o.frustumCulled = false;
	}
	parts.bell.add(bell);
	parts.wall.add(wallMesh);

	// the door's two flaps: rows down the meridian from the door's top, each across its half of the door from the
	// middle (u 0) to its side (u 1); rolled back (roll 1), all of it is wound up at the side
	const UC = 6;
	const flapRows = [];
	{
		let q = 0;
		while (MER[q + 1].y >= doorTop) q++;
		const t = (MER[q].y - doorTop) / (MER[q].y - MER[q + 1].y);
		flapRows.push({ i: q, t, r: lerp(MER[q].r, MER[q + 1].r, t), s: lerp(MER[q].s, MER[q + 1].s, t) });
		for (let i = q + 1; i < N; i++) flapRows.push({ i, t: 0, r: MER[i].r, s: MER[i].s });
	}
	const at = (arr, row) => (row.t ? lerp(arr[row.i], arr[row.i + 1], row.t) : arr[row.i]);
	const flapReach = (row) => doorHalf / row.r + 0.05;
	const flaps = [-1, 1].map((side) => {
		const geo = new THREE.BufferGeometry();
		const pos = new Float32Array(flapRows.length * (UC + 1) * 3), uv = [], idx = [];
		flapRows.forEach((row) => {
			for (let c = 0; c <= UC; c++) uv.push(((side * flapReach(row) * c) / UC / (Math.PI * 2)) * PANELS, row.s);
		});
		for (let w = 0; w < flapRows.length - 1; w++)
			for (let c = 0; c < UC; c++) {
				const p = w * (UC + 1) + c, l = p + UC + 1;
				idx.push(l, p, l + 1, l + 1, p, p + 1);
			}
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		geo.setIndex(idx);
		const mesh = new THREE.Mesh(geo, canvas);
		mesh.castShadow = true;
		mesh.frustumCulled = false;
		// rolled, it is wound up along the door's side: a roll down its edge, the bell's and then the wall's
		const roll = new THREE.Group();
		const segs = flapRows.slice(1).map(() => new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), canvas));
		const knees = flapRows.map(() => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), canvas));
		for (const o of [...segs, ...knees]) o.castShadow = true;
		roll.add(...segs, ...knees);
		const ties = [0.22, 0.62].map((f) => {
			const t = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 14).rotateX(Math.PI / 2), m.strap());
			t.userData.f = f;
			return t;
		});
		piece(parts['door-flaps']).add(mesh, roll, ...ties);
		return { side, geo, mesh, roll, segs, knees, ties };
	});

	/** the canvas hung as it is now (hang), and the door's flaps as far as rolled back */
	function drape(roll) {
		const bp = bellGeo.attributes.position;
		for (let q = 0; q <= BR; q++) for (let i = 0; i <= BC; i++) place(bp, q * (BC + 1) + i, (i / BC) * Math.PI * 2, q);
		const wp = wallGeo.attributes.position;
		for (let w = 0; w <= WR; w++) for (let i = 0; i <= WC; i++) place(wp, w * (WC + 1) + i, wallA(i), BR + 1 + w);
		for (const geo of [bellGeo, wallGeo]) {
			geo.attributes.position.needsUpdate = true;
			geo.computeVertexNormals();
			geo.boundingBox = geo.boundingSphere = null;
		}
		for (const f of flaps) {
			const fp = f.geo.attributes.position;
			flapRows.forEach((row, w) => {
				const r = at(rr, row) + 0.012, y = at(ry, row) + lying[row.i] * 0.004;
				for (let c = 0; c <= UC; c++) {
					const a = f.side * flapReach(row) * (roll + (1 - roll) * (c / UC));
					const x = Math.sin(a) * r, z = Math.cos(a) * r + heap * 1.3;
					fp.setXYZ(w * (UC + 1) + c, x, over(x, y + crumple(a, row.s, row.i), z), z);
				}
			});
			fp.needsUpdate = true;
			f.geo.computeVertexNormals();
			f.geo.boundingBox = f.geo.boundingSphere = null;
			f.mesh.visible = roll < 0.98;
			// the roll down the door's side, from its top to the ground, as thick as the canvas wound on it
			f.roll.visible = roll > 0.02;
			if (!f.roll.visible) {
				for (const t of f.ties) t.visible = false;
				continue;
			}
			const rad = 0.01 + 0.032 * roll;
			const pts = flapRows.map((row) => {
				const a = f.side * flapReach(row);
				const r = at(rr, row) + 0.02 + rad;
				return new THREE.Vector3(Math.sin(a) * r, Math.max(rad, at(ry, row)), Math.cos(a) * r);
			});
			const lens = [0];
			f.segs.forEach((sg, i) => {
				const d = pts[i + 1].clone().sub(pts[i]);
				const len = Math.max(1e-4, d.length());
				lens.push(lens[i] + len);
				sg.position.copy(pts[i]).addScaledVector(d, 0.5);
				sg.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
				sg.scale.set(rad, len, rad);
			});
			f.knees.forEach((kn, i) => {
				kn.position.copy(pts[i]);
				kn.scale.setScalar(rad);
			});
			for (const t of f.ties) {
				const want = t.userData.f * lens.at(-1);
				const i = Math.max(0, lens.findIndex((l) => l >= want) - 1);
				const sg = f.segs[Math.min(i, f.segs.length - 1)];
				t.position.lerpVectors(pts[i], pts[i + 1], (want - lens[i]) / Math.max(1e-4, lens[i + 1] - lens[i]));
				t.quaternion.copy(sg.quaternion);
				t.scale.set(rad + 0.004, 0.1, rad + 0.004);
			}
		}
	}

	/* ── the poles ── */
	const L = pole + 0.15;
	const centre = new THREE.Group();
	{
		const sec = 1.05;
		for (let i = 0; i < 3; i++) {
			const top = i === 2 ? L - 0.15 - 2 * sec : sec;
			const s = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, top, 14), m.pole());
			s.position.y = i * sec + top / 2;
			s.castShadow = true;
			centre.add(s);
		}
		for (const y of [sec, 2 * sec]) {
			const f = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.09, 14), m.ferrule());
			f.position.y = y;
			centre.add(f);
		}
		const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.15, 8), m.ferrule());
		spike.position.y = L - 0.075;
		const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 14), m.rubber());
		foot.position.y = 0.0125;
		centre.add(spike, foot);
	}
	parts['centre-pole'].add(centre);
	/** the pole as far as walked upright (0 lying under the canvas, its foot out of the door; 1 standing) */
	function raisePole(p) {
		const th = lerp(0.03, Math.PI / 2, ease(p));
		const top = new THREE.Vector3(0, L * Math.sin(th), 0);
		const foot = new THREE.Vector3(0, 0, L * Math.cos(th));
		centre.position.copy(foot);
		centre.quaternion.setFromUnitVectors(UP, top.sub(foot).normalize());
		ridge = p < 1 ? { top: L * Math.sin(th), foot: L * Math.cos(th) } : null;
		return L * (1 - Math.sin(th)); // how far the canvas's top is still let down
	}

	// the guy ropes' places round the tent (none in front of the door); a wall pole under the eave at each
	const GUYS = [];
	for (let k = 0; k < 12; k++) {
		const a = ((k + 0.5) / 12) * Math.PI * 2;
		if (Math.abs(adiff(a, 0)) >= 0.3) GUYS.push(a);
	}
	const WP = { r: R + 0.06, h: 0.78, spike: 0.06 };
	const wallPoles = GUYS.map((a) => {
		const p = new THREE.Group();
		p.position.set(Math.sin(a) * WP.r, 0, Math.cos(a) * WP.r);
		p.rotation.y = a;
		const hinge = new THREE.Group();
		p.add(hinge);
		const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, WP.h, 8).translate(0, WP.h / 2, 0), m.pole());
		const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.005, WP.spike, 6).translate(0, WP.h + WP.spike / 2, 0), m.ferrule());
		shaft.castShadow = true;
		hinge.add(shaft, spike);
		piece(parts['wall-poles'], a).add(p);
		p.userData.stand = (t) => {
			p.visible = t > 0;
			hinge.rotation.x = (Math.PI / 2) * (1 - ease(t));
		};
		return p;
	});
	const wallPegs = [];
	for (let i = 0; i < 22; i++) {
		const a = ((i + 0.5) / 22) * Math.PI * 2;
		if (Math.abs(adiff(a, 0)) < gap + 0.04) continue;
		const p = peg({ tilt: 0.25, len: 0.23, out: 0.04 });
		p.position.set(Math.sin(a) * (R + 0.04), 0, Math.cos(a) * (R + 0.04));
		p.rotation.y = a;
		piece(parts['wall-pegs'], a).add(p);
		wallPegs.push(p);
	}

	/* ── the guy ropes: from the wall pole's spike out to the peg, a runner on each ── */
	const A = { r: WP.r, y: WP.h + 0.04 };
	const guys = GUYS.map((a) => {
		const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
		const toward = (r, y) => dir.clone().multiplyScalar(r).setY(y);
		const ropeP = piece(parts['guy-ropes'], a);
		const runP = piece(parts.runners, a);
		const pegP = piece(parts['guy-pegs'], a);
		const r0 = rod(0.004, m.rope(), 5), r1 = rod(0.004, m.rope(), 5);
		ropeP.add(r0, r1);
		const runner = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.07, 0.016), m.runner());
		runner.castShadow = true;
		runP.add(runner);
		const p = peg({ tilt: Math.PI / 4, len: 0.3, out: 0.08, r: 0.006 });
		p.position.copy(toward(R + guyOut, 0));
		p.rotation.y = a;
		pegP.add(p);
		const top = toward(A.r, A.y), hung = toward(R + 0.2, 0.03);
		// the rope's end at the peg: on its hook, where it shows above the ground
		const tied = toward(R + guyOut + 0.08 * Math.sin(Math.PI / 4), 0.08 * Math.cos(Math.PI / 4) + 0.01);
		/** as far as this rope is run out (0 hanging down the wall … 1 on its peg, pulled tight) */
		function set(u) {
			p.userData.drive(clamp((u - 0.15) / 0.4));
			const out = ease(clamp(u / 0.55));
			const tight = ease(clamp((u - 0.55) / 0.45));
			const end = hung.clone().lerp(tied, out);
			end.y += Math.sin(Math.PI * out) * 0.35 * (1 - tight);
			const mid = top.clone().lerp(end, 0.5);
			mid.y -= 0.16 * out * (1 - tight);
			r0.userData.span(top, mid);
			r1.userData.span(mid, end);
			const d = end.clone().sub(mid);
			runner.position.copy(mid).addScaledVector(d, lerp(0.75, 0.35, tight));
			runner.quaternion.setFromUnitVectors(UP, d.normalize());
		}
		return { set };
	});

	/* ── inside ── */
	/** a thing brought in: its part, and a group it is carried in by (lowered into its place as it comes) */
	const thing = (id) => {
		const c = new THREE.Group();
		parts[id].add(c);
		return c;
	};
	const inside = [];
	{
		const c = thing('rug');
		const rug = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48).rotateX(-Math.PI / 2), m.rug());
		rug.position.set(0, 0.022, 0.55);
		rug.receiveShadow = true;
		c.add(rug);
		inside.push(c);
	}
	{
		const c = thing('mats');
		for (const x of [-0.36, 0.36]) soft(c, 0.62, 0.05, 1.9, 0.02, m.mat(), x, 0.02 + 0.025, -0.72);
		inside.push(c);
	}
	{
		const c = thing('sleeping-bags');
		[m.bagA(), m.bagB()].forEach((mat, i) => soft(c, 0.56, 0.12, 1.55, 0.05, mat, i ? 0.36 : -0.36, 0.07 + 0.06, -0.55));
		inside.push(c);
	}
	{
		const c = thing('pillows');
		for (const x of [-0.36, 0.36]) soft(c, 0.45, 0.1, 0.3, 0.04, m.linen(), x, 0.07 + 0.05, -1.45);
		inside.push(c);
	}
	{
		const c = thing('crate');
		const crate = new THREE.Group();
		crate.position.set(0.95, 0, 0.45);
		crate.rotation.y = 0.4;
		const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.36), m.crate());
		body.position.y = 0.18;
		body.castShadow = body.receiveShadow = true;
		crate.add(body);
		for (const y of [0.12, 0.24]) {
			const gr = new THREE.Mesh(new THREE.BoxGeometry(0.504, 0.008, 0.364), m.groove());
			gr.position.y = y;
			crate.add(gr);
		}
		c.add(crate);
		inside.push(c);
	}
	{
		const c = thing('mugs');
		for (const [x, z] of [[0.86, 0.4], [1.02, 0.52]]) {
			const mug = new THREE.Group();
			mug.position.set(x, 0.36, z);
			const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.08, 16, 1, true), m.enamelIn());
			cup.position.y = 0.04;
			const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16).rotateX(-Math.PI / 2), m.enamel());
			bottom.position.y = 0.004;
			const lip = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.003, 5, 18).rotateX(Math.PI / 2), m.enamelRim());
			lip.position.y = 0.08;
			const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 5, 12, Math.PI), m.enamel());
			handle.rotation.z = -Math.PI / 2;
			handle.position.set(0.04, 0.042, 0);
			cup.castShadow = true;
			mug.add(cup, bottom, lip, handle);
			c.add(mug);
		}
		inside.push(c);
	}
	{
		const c = thing('book');
		const book = new THREE.Group();
		book.position.set(1.05, 0.36, 0.33);
		book.rotation.y = 0.3;
		const cover = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.22), m.book());
		cover.position.y = 0.015;
		const pages = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.024, 0.212), m.pages());
		pages.position.set(0.006, 0.015, 0);
		book.add(cover, pages);
		c.add(book);
		inside.push(c);
	}
	{
		const c = thing('packs');
		for (const [x, z, ry, w, h, d, mat] of [[-1.3, 0.1, -1.2, 0.36, 0.5, 0.24, m.packA()], [-1.25, 0.55, -1.4, 0.34, 0.46, 0.22, m.packB()]]) {
			const pk = new THREE.Group();
			pk.position.set(x, 0, z);
			pk.rotation.y = ry;
			soft(pk, w, h, d, 0.05, mat, 0, h / 2, 0);
			soft(pk, w * 0.9, 0.07, d * 0.9, 0.03, mat, 0, h + 0.02, 0.01);
			soft(pk, w * 0.7, h * 0.4, 0.06, 0.025, mat, 0, h * 0.35, d / 2 + 0.02);
			for (const sx of [-1, 1]) {
				const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, h * 0.8, 0.012), m.strap());
				s.position.set(sx * w * 0.25, h * 0.5, -d / 2 - 0.006);
				pk.add(s);
			}
			c.add(pk);
		}
		inside.push(c);
	}
	// the lantern on its hook on the pole
	const lamp = new THREE.PointLight('#ffcf8a', 0, 5, 1.6);
	const LAMP = 1.4;
	const glass = new THREE.MeshStandardMaterial({ color: '#fff1d6', roughness: 0.15, emissive: '#ffcf8a', emissiveIntensity: 0, transparent: true, opacity: 0.85 });
	{
		const c = thing('lantern');
		const hook = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 4, 10, Math.PI * 1.3), m.steel());
		hook.position.set(0.05, 2.03, 0);
		hook.rotation.z = Math.PI * 0.85;
		const lt = new THREE.Group();
		lt.position.set(0.06, 1.72, 0);
		const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.04, 18), m.lantern());
		base.position.y = 0.02;
		const globe = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), glass);
		globe.scale.y = 1.4;
		globe.position.y = 0.11;
		const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.068, 0.05, 18), m.lantern());
		cap.position.y = 0.205;
		const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.03, 12), m.lantern());
		chimney.position.y = 0.245;
		const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.003, 4, 16, Math.PI), m.steel());
		handle.position.y = 0.215;
		lt.add(base, globe, cap, chimney, handle);
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
			const w = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.15, 4), m.lantern());
			w.position.set(Math.cos(a) * 0.058, 0.11, Math.sin(a) * 0.058);
			lt.add(w);
		}
		base.castShadow = cap.castShadow = true;
		lamp.position.set(0.06, 1.83, 0);
		c.add(hook, lt, lamp);
		inside.push(c);
	}

	/* ── pitching ── */
	let now = -1;
	function setPitch(k) {
		k = clamp(k);
		if (k === now) return;
		now = k;
		g.userData.pitch = k;
		// the groundsheet unfolded from the door, across then back, and pegged
		const gs = span(k, steps.groundsheet);
		sheetPart.visible = k > 0;
		const across = ease(clamp(gs / 0.35)), back = ease(clamp((gs - 0.35) / 0.35));
		fold.scale.set(lerp(0.14, 1, across), 1, lerp(0.12, 1, back));
		fold.position.z = R * (1 - fold.scale.z);
		sheetPegs.forEach((p, i) => p.userData.drive(turn(clamp((gs - 0.7) / 0.3), i, sheetPegs.length)));
		// the canvas: spread out from its heap, raised on the pole, its eave held up and its wall pegged
		const cs = span(k, steps.canvas);
		const ps = span(k, steps.pole);
		const ws = span(k, steps.wall);
		const ds = span(k, steps.door);
		const up = cs > 0;
		for (const id of ['bell', 'wall', 'door-flaps']) parts[id].visible = up;
		parts['centre-pole'].visible = ps > 0;
		ridge = null;
		const drop = ps > 0 ? raisePole(ps) : L;
		const stood = clamp(ws / 0.6);
		heap = 1 - ease(cs);
		if (up) {
			hang(drop, 1 - ease(stood), lerp(0.18, 1, ease(cs)));
			drape(ease(clamp(ds / 0.75)));
		}
		wallPoles.forEach((p, i) => p.userData.stand(turn(stood, i, wallPoles.length)));
		wallPegs.forEach((p, i) => p.userData.drive(turn(clamp((ws - 0.6) / 0.4), i, wallPegs.length)));
		for (const f of flaps) for (const t of f.ties) t.visible = ds > 0.85 && f.roll.visible;
		// the guy ropes, one after another
		const gu = span(k, steps.guys);
		for (const id of ['guy-ropes', 'runners', 'guy-pegs']) parts[id].visible = gu > 0;
		guys.forEach((gy, i) => gy.set(turn(gu, i, guys.length)));
		// the things brought in, one by one, the lantern last
		const ins = span(k, steps.inside);
		inside.forEach((c, i) => {
			const u = turn(ins, i, inside.length);
			c.visible = u > 0;
			const last = i === inside.length - 1;
			c.position.y = last ? -(1 - ease(clamp(u / 0.6))) * 0.5 : (1 - ease(u)) * 0.35;
		});
		const glow = ease(clamp((turn(ins, inside.length - 1, inside.length) - 0.6) / 0.4));
		lamp.intensity = LAMP * glow;
		glass.emissiveIntensity = 0.9 * glow;
		lamp.visible = glow > 0;
	}
	/** where the work is at k (in the tent's frame): the groundsheet's edge, the canvas, the pole's foot, the wall pole
	 *  or peg going in, the guy's peg, the door, the thing being put down */
	function work(k) {
		k = clamp(k);
		const v = (a, y = 0) => new THREE.Vector3(Math.sin(a) * (R + 0.3), y, Math.cos(a) * (R + 0.3));
		if (k <= steps.groundsheet[1]) {
			const gs = span(k, steps.groundsheet);
			if (gs < 0.7) return new THREE.Vector3(0, 0, R - 2 * R * ease(clamp((gs - 0.35) / 0.35)));
			const i = Math.min(sheetPegs.length - 1, Math.floor(clamp((gs - 0.7) / 0.3) * sheetPegs.length));
			return sheetPegs[i].position.clone();
		}
		if (k <= steps.canvas[1]) return new THREE.Vector3(0, 0, R * 0.6 * (1 - span(k, steps.canvas)));
		if (k <= steps.pole[1]) return centre.position.clone();
		if (k <= steps.wall[1]) {
			const ws = span(k, steps.wall);
			if (ws < 0.6) return v(GUYS[Math.min(GUYS.length - 1, Math.floor((ws / 0.6) * GUYS.length))], 0);
			return wallPegs[Math.min(wallPegs.length - 1, Math.floor(((ws - 0.6) / 0.4) * wallPegs.length))].position.clone();
		}
		if (k <= steps.guys[1]) {
			const a = GUYS[Math.min(GUYS.length - 1, Math.floor(span(k, steps.guys) * GUYS.length))];
			return new THREE.Vector3(Math.sin(a) * (R + guyOut - 0.3), 0, Math.cos(a) * (R + guyOut - 0.3));
		}
		if (k <= steps.door[1]) return new THREE.Vector3(0, 0, R + 0.4);
		const spots = [[0, 0.55], [0, -0.6], [0, -0.6], [0, -1.2], [0.75, 0.6], [0.75, 0.6], [0.75, 0.6], [-0.9, 0.3], [0.3, 0.3]];
		const [x, z] = spots[Math.min(spots.length - 1, Math.floor(span(k, steps.inside) * spots.length))];
		return new THREE.Vector3(x, 0, z);
	}
	/** taken apart as far as k: each assembly drawn out its way, the ring of ropes and pegs spread out round it */
	const SPREAD = { 'sheet-pegs': 0.35, 'wall-poles': 0.55, 'wall-pegs': 0.7, 'guy-ropes': 1, runners: 1, 'guy-pegs': 1 };
	function explode(k) {
		for (const info of TENT_PARTS) {
			const p = parts[info.id];
			const out = TENT_ASSEMBLIES.find((a) => a.id === info.assembly).out;
			p.position.set(out[0] * k, out[1] * k, out[2] * k);
			const d = (SPREAD[info.id] ?? 0) * k;
			for (const c of p.children) if (c.userData.radial) c.position.set(c.userData.radial[0] * d, 0, c.userData.radial[1] * d);
		}
	}

	/* ── walking: in through the door (once its flaps are back), round the things on the floor, upright only as far out
	   as the bell is over a grown-up's head (1.8 m: the door's top), the wall's foot out of reach ── */
	const headroom = bellAt(1 - (1 - (doorTop - wall) / (pole - wall)) ** (1 / 1.6)).r - 0.1;
	const colliders = [
		{ x: 0, z: 0, r: 0.2 },
		{ x: 0.95, z: 0.45, r: 0.35 },
		{ x: -1.3, z: 0.1, r: 0.28 },
		{ x: -1.25, z: 0.55, r: 0.28 }
	];
	const walk = {
		r: R,
		door: doorHalf,
		headroom,
		colliders,
		x: 0,
		z: R + 2.4,
		yaw: 0,
		canStand(x, z, _here, _ground, from) {
			const d = Math.hypot(x, z);
			const open = (g.userData.pitch ?? 0) >= steps.door[1];
			const ok = d < headroom || d > R + 0.3 || (open && z > 0 && Math.abs(x) < doorHalf - 0.12);
			if (!ok) return false;
			for (const c of colliders) {
				const e = Math.hypot(x - c.x, z - c.z);
				if (e < c.r && e < Math.hypot(from.x - c.x, from.z - c.z)) return false;
			}
			return true;
		},
		floorAt: () => 0,
		lamps: []
	};

	g.userData = {
		pitch,
		setPitch,
		work,
		lamp,
		canvas,
		walk,
		parts,
		explode,
		catalog: { assemblies: TENT_ASSEMBLIES, parts: TENT_PARTS, steps: TENT_STEPS, ranges: Object.values(steps), sources: SOURCES, play: 'Pitch it', seconds: 28 }
	};
	setPitch(pitch);
	return g;
}

/* ── the fire place ─────────────────────────────────────────────────────────────────────────────────────────── */

/** a folding camp chair facing +z: steel tubes crossed under the seat on either side, a canvas seat at 42 cm and
 *  back, armrests */
function campChair() {
	const c = new THREE.Group();
	const v = (x, y, z) => new THREE.Vector3(x, y, z);
	const tube = (a, b) => {
		const t = rod(0.011, m.leg(), 8);
		t.userData.span(a, b);
		c.add(t);
	};
	for (const sx of [-1, 1]) {
		const x = sx * 0.25;
		tube(v(x, 0, 0.22), v(x, 0.42, -0.2));
		tube(v(x, 0, -0.22), v(x, 0.42, 0.2));
		tube(v(x, 0.42, -0.22), v(x, 0.9, -0.34));
		tube(v(x, 0.42, 0.2), v(x, 0.62, 0.2));
		tube(v(x, 0.62, 0.2), v(x, 0.62, -0.27));
		const pad = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.42), m.seat());
		pad.position.set(x, 0.635, -0.03);
		c.add(pad);
	}
	tube(v(-0.25, 0.42, 0.2), v(0.25, 0.42, 0.2));
	tube(v(-0.25, 0.42, -0.21), v(0.25, 0.42, -0.21));
	const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.015, 0.42), m.seat());
	seat.position.y = 0.41;
	const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.46, 0.012), m.seat());
	back.position.set(0, 0.67, -0.285);
	back.rotation.x = -0.245;
	c.add(seat, back);
	c.traverse((o) => o.isMesh && (o.castShadow = true));
	return c;
}

/** the fire place's measures: the stone ring's radius, the steps of building it (setBuild), the last one lighting it */
export const FIRE_PLACE = {
	ring: 0.6,
	steps: { stones: [0, 0.28], woodpile: [0.28, 0.5], logs: [0.5, 0.68], chairs: [0.68, 0.86], light: [0.86, 1] }
};
const FIRE_ASSEMBLIES = [
	{ id: 'ring', label: 'Fire ring', note: 'Where the fire is kept: a ring of field stones round a bed of ash.', out: [0, 0, 0] },
	{ id: 'fire', label: 'The fire', note: 'Four logs over kindling in a tepee, and what burns.', out: [0, 0.9, 0] },
	{ id: 'seats', label: 'Chairs', note: 'Two folding camp chairs facing the fire.', out: [0, 0, 0] },
	{ id: 'wood', label: 'Woodpile', note: 'Split logs stacked to dry, within reach of the fire.', out: [-0.6, 0, 0] }
];
const FIRE_STEPS = [
	'Clear a round of earth and set a ring of stones round it, 1.2 m across.',
	'Stack the woodpile beside it, split logs three rows high.',
	'Lay four logs over the kindling in a tepee.',
	'Unfold the two chairs facing the fire.',
	'Light the kindling.'
];
const FIRE_PARTS = [
	{ id: 'stones', label: 'Stones', assembly: 'ring', step: 1, count: 11, what: 'Field stones the size of a loaf set round the fire, 1.2 m across: they keep the embers in and the grass out.', specs: [['Across', '1.2 m'], ['Stones', 'about 30 cm']] },
	{ id: 'ash', label: 'Bed of ash', assembly: 'ring', step: 1, what: 'The bare earth inside the ring, grey with old ash; it glows where the embers lie.', moves: 'Glows as the fire burns down' },
	{ id: 'logs', label: 'Logs', assembly: 'fire', step: 3, count: 4, what: 'Four split logs, 80 cm long, leant together over the kindling so the air draws up through them.', specs: [['Long', '80 cm'], ['Round', '13 cm']] },
	{ id: 'flames', label: 'Flames', assembly: 'fire', step: 5, what: 'The fire itself and its light: warm, flickering, lighting the ground about 7 m round.', moves: 'Flicker; grow when it is lit, die down when it is put out', specs: [['Light', 'about 7 m round']] },
	{ id: 'chairs', label: 'Chairs', assembly: 'seats', step: 4, count: 2, what: 'Two green folding camp chairs, the seats at 40 cm, facing the fire.', moves: 'Unfold', specs: [['Seat', '50 × 45 cm at 40 cm']] },
	{ id: 'woodpile', label: 'Woodpile', assembly: 'wood', step: 2, count: 9, what: 'Nine split logs 60 cm long, three rows of three on two bearers off the ground.', specs: [['Long', '60 cm'], ['Rows', 'three']] }
];

/**
 * The fire place, built as far as `built` (0 … 1, its last step lighting it) and lit as much as `lit`. Its ring is at
 * its origin; the chairs on its +z side, the woodpile on its −x side. userData:
 * - setBuild(k), built; fire: { light, setLit(k), update(t) } (the flames and their flicker); tick(t) = fire.update
 * - walk: { colliders: [{ x, z, r }] } (the ring, the chairs, the woodpile) with the Things viewer's walk in it
 * - parts, catalog, explode(k)
 */
export function firePlace({ built = 1, lit = 1 } = {}) {
	const { ring, steps } = FIRE_PLACE;
	const g = new THREE.Group();
	const parts = {};
	for (const { id } of FIRE_PARTS) {
		const p = new THREE.Group();
		p.name = id;
		p.userData.part = id;
		g.add(p);
		parts[id] = p;
	}
	/** a piece of a part, set down in its place as it is built */
	const set = (id) => {
		const c = new THREE.Group();
		parts[id].add(c);
		return c;
	};
	// the ring of stones, each set in turn
	const stones = [];
	for (let k = 0; k < 11; k++) {
		const a = (k / 11) * Math.PI * 2;
		const c = set('stones');
		const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), m.stone());
		st.position.set(Math.sin(a) * ring, 0.08, Math.cos(a) * ring);
		st.scale.set(1, 0.7, 0.9);
		st.rotation.set(k * 0.7, k * 1.3, k * 0.4);
		st.castShadow = st.receiveShadow = true;
		c.add(st);
		stones.push(c);
	}
	const ash = new THREE.Mesh(new THREE.CircleGeometry(ring - 0.08, 32).rotateX(-Math.PI / 2), m.ash());
	ash.position.y = 0.006;
	ash.receiveShadow = true;
	// the embers under the logs, glowing as it burns
	const embers = new THREE.MeshStandardMaterial({ color: '#2a2522', roughness: 1, emissive: '#ff4a12', emissiveIntensity: 0 });
	const glowBed = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24).rotateX(-Math.PI / 2), embers);
	glowBed.position.y = 0.009;
	parts.ash.add(ash, glowBed);
	// the woodpile on two bearers, row by row
	const pile = [];
	{
		const at = new THREE.Vector3(-1.55, 0, -0.2);
		for (const z of [-0.2, 0.2]) {
			const c = set('woodpile');
			const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.06), m.bark());
			b.position.set(at.x, 0.025, at.z + z);
			c.add(b);
			pile.push(c);
		}
		for (let k = 0; k < 9; k++) {
			const c = set('woodpile');
			const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 7), [m.bark(), m.wood(), m.wood()]);
			log.rotation.x = Math.PI / 2;
			log.position.set(at.x - 0.15 + (k % 3) * 0.15, 0.05 + 0.07 + Math.floor(k / 3) * 0.13, at.z);
			log.rotation.y = (k % 2) * 0.3;
			log.castShadow = true;
			c.add(log);
			pile.push(c);
		}
	}
	// the logs over the kindling, one by one
	const logs = [];
	for (let k = 0; k < 4; k++) {
		const c = set('logs');
		const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 8), [m.bark(), m.wood(), m.wood()]);
		log.rotation.set(Math.PI / 2 - 0.5, (k / 4) * Math.PI, 0, 'YXZ');
		log.position.y = 0.2;
		log.castShadow = true;
		c.add(log);
		logs.push(c);
	}
	// the flames and their light
	const flameMat = new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 2.2, transparent: true, opacity: 0.85 });
	const flamesG = set('flames');
	const flames = [0, 1, 2].map((k) => {
		const f = new THREE.Mesh(new THREE.ConeGeometry(0.16 - k * 0.03, 0.55 - k * 0.1, 8).translate(0, (0.55 - k * 0.1) / 2, 0), flameMat);
		f.position.set((k - 1) * 0.08, 0.08, (k % 2) * 0.06);
		flamesG.add(f);
		return f;
	});
	const light = new THREE.PointLight('#ff9a4a', 0, 7, 1.8);
	light.position.set(0, 0.6, 0);
	flamesG.add(light);
	// two folding chairs facing the fire, unfolded one after the other
	const chairs = [];
	for (const [cx, cz, face] of [[-1.2, 0.6, 2.1], [0.9, 1.1, -2.6]]) {
		const c = set('chairs');
		const chair = campChair();
		chair.position.set(cx, 0, cz);
		chair.rotation.y = face;
		c.add(chair);
		chairs.push(chair);
	}

	// how lit it is asked to be (setLit), and how much burns: as much as that once the kindling has caught
	let want = clamp(lit);
	let flame = 0;
	function burn() {
		flame = want * ease(span(g.userData.built ?? 1, steps.light));
		flamesG.visible = flame > 0.01;
		light.intensity = 2 * flame;
		flameMat.opacity = 0.85 * Math.min(1, flame * 1.5);
		embers.emissiveIntensity = 0.9 * flame;
		for (const f of flames) f.scale.setScalar(0.3 + 0.7 * flame);
	}
	/** lit as much as k (0 out … 1 burning) */
	function setLit(k) {
		want = clamp(k);
		g.userData.fire.lit = want;
		burn();
	}
	function update(t) {
		if (!flamesG.visible) return;
		flames.forEach((f, k) => {
			const s = (0.85 + Math.sin(t * (9 + k * 3) + k) * 0.15) * (0.3 + 0.7 * flame);
			f.scale.set(s, (0.8 + Math.abs(Math.sin(t * (7 + k * 2))) * 0.4) * (0.3 + 0.7 * flame), s);
		});
		light.intensity = (1.7 + Math.sin(t * 13) * 0.3 + Math.sin(t * 7.3) * 0.2) * flame;
	}
	let now = -1;
	function setBuild(k) {
		k = clamp(k);
		if (k === now) return;
		now = k;
		g.userData.built = k;
		const drop = (c, u) => {
			c.visible = u > 0;
			c.position.y = (1 - ease(u)) * 0.4;
		};
		const st = span(k, steps.stones);
		stones.forEach((c, i) => drop(c, turn(st, i, stones.length)));
		parts.ash.visible = st >= 1;
		const wp = span(k, steps.woodpile);
		pile.forEach((c, i) => drop(c, turn(wp, i, pile.length)));
		const lg = span(k, steps.logs);
		logs.forEach((c, i) => drop(c, turn(lg, i, logs.length)));
		const ch = span(k, steps.chairs);
		chairs.forEach((chair, i) => {
			const u = turn(ch, i, chairs.length);
			chair.parent.visible = u > 0;
			// set down folded, a bundle of tubes, then opened out sideways
			chair.position.y = (1 - ease(clamp(u / 0.4))) * 0.3;
			chair.scale.x = lerp(0.12, 1, ease(clamp((u - 0.4) / 0.6)));
		});
		burn();
	}
	function explode(k) {
		for (const info of FIRE_PARTS) {
			const out = FIRE_ASSEMBLIES.find((a) => a.id === info.assembly).out;
			parts[info.id].position.set(out[0] * k, out[1] * k, out[2] * k);
		}
		// the chairs drawn back from the fire, the stones out from its middle
		parts.chairs.children.forEach((c, i) => {
			const [cx, cz] = i ? [0.9, 1.1] : [-1.2, 0.6];
			const d = Math.hypot(cx, cz);
			c.position.set((cx / d) * 0.6 * k, 0, (cz / d) * 0.6 * k);
		});
		parts.stones.children.forEach((c, i) => {
			const a = (i / 11) * Math.PI * 2;
			c.position.x = Math.sin(a) * 0.35 * k;
			c.position.z = Math.cos(a) * 0.35 * k;
		});
	}
	const colliders = [
		{ x: 0, z: 0, r: 0.75 },
		{ x: -1.2, z: 0.6, r: 0.4 },
		{ x: 0.9, z: 1.1, r: 0.4 },
		{ x: -1.55, z: -0.2, r: 0.45 }
	];
	const walk = {
		colliders,
		x: 0.2,
		z: 3.2,
		yaw: 0,
		canStand(x, z, _here, _ground, from) {
			for (const c of colliders) {
				const e = Math.hypot(x - c.x, z - c.z);
				if (e < c.r && e < Math.hypot(from.x - c.x, from.z - c.z)) return false;
			}
			return true;
		},
		floorAt: () => 0,
		lamps: []
	};
	g.userData = {
		built,
		setBuild,
		fire: { light, setLit, update, lit: want },
		tick: update,
		walk,
		parts,
		explode,
		catalog: { assemblies: FIRE_ASSEMBLIES, parts: FIRE_PARTS, steps: FIRE_STEPS, ranges: Object.values(steps), sources: [{ label: 'Campfire (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Campfire' }], play: 'Build it', seconds: 16 }
	};
	setBuild(built);
	return g;
}

/* ── the bag ────────────────────────────────────────────────────────────────────────────────────────────────── */

/** the bag's measures: its length and its radius rolled up */
export const BELL_TENT_BAG = { len: 1.1, r: 0.25 };

/**
 * The bell tent's bag: canvas rolled round what is in it, two straps buckled over its top; open (0 rolled … 1 lying
 * flat), its straps undone and the canvas unrolled, what was in it settled on it. userData: setOpen, open, parts
 * ({ canvas, groundsheet, pole, wallPoles, pegs }: the canvas folded, the groundsheet rolled, the centre pole's three
 * sections, the wall poles' bundle, the pegs' sack; each to be taken off it as the tent is pitched).
 */
export function bellTentBag({ open = 0 } = {}) {
	const { len, r } = BELL_TENT_BAG;
	const g = new THREE.Group();
	const W = 2 * Math.PI * r;
	/** a sheet of the canvas (x0 … x1 along the bag) at radius rr round its middle, as open as k */
	const sheet = (x0, x1, rr, mat, cols, rows) => {
		const geo = new THREE.PlaneGeometry(1, 1, cols, rows);
		const mesh = new THREE.Mesh(geo, mat);
		mesh.castShadow = true;
		mesh.frustumCulled = false;
		mesh.userData.lay = (k) => {
			const pa = geo.attributes.position;
			const bend = (1 - k) / r;
			for (let j = 0; j <= rows; j++) {
				const a = (j / rows - 0.5) * W * (rr / r);
				for (let i = 0; i <= cols; i++) {
					const x = x1 - ((x1 - x0) * i) / cols;
					const idx = j * (cols + 1) + i;
					if (bend < 1e-4) pa.setXYZ(idx, x, 0.002 - (rr - r) * 0.25, a);
					else {
						const rho = 1 / bend + (rr - r);
						const b = a / rho;
						pa.setXYZ(idx, x, 0.002 + 1 / bend - rho * Math.cos(b), rho * Math.sin(b));
					}
				}
			}
			pa.needsUpdate = true;
			geo.computeVertexNormals();
			geo.boundingBox = geo.boundingSphere = null;
		};
		return mesh;
	};
	const bagMat = m.bag().clone();
	bagMat.side = THREE.DoubleSide;
	const cover = sheet(-len / 2, len / 2, r, bagMat, 10, 44);
	g.add(cover);
	const straps = [-0.32, 0.32].map((x) => sheet(x - 0.02, x + 0.02, r + 0.004, m.strap(), 1, 44));
	g.add(...straps);
	const buckles = [-0.32, 0.32].map((x) => {
		const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.04), m.buckle());
		b.position.set(x, 2 * r + 0.006, 0);
		g.add(b);
		return b;
	});
	const handle = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.006, 0.035), m.strap());
	handle.position.set(0, 2 * r + 0.003, 0.015);
	g.add(handle);

	// what is in it, rolled up in the bag (its section: z across, y up) and where it settles on the open canvas
	const roll = (rad, l, mat) => {
		const o = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, l, 20).rotateZ(Math.PI / 2), mat);
		o.castShadow = true;
		return o;
	};
	const canvasG = new THREE.Group();
	canvasG.add(roll(0.11, 1.0, m.folded()));
	for (const x of [-0.3, 0.3]) {
		const tie = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.006, 6, 20).rotateY(Math.PI / 2), m.strap());
		tie.position.x = x;
		canvasG.add(tie);
	}
	const sheetRoll = roll(0.075, 0.7, m.sheet());
	const poleG = new THREE.Group();
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2;
		const s = roll(0.035, 1.05, m.pole());
		s.position.set(0, Math.sin(a) * 0.04, Math.cos(a) * 0.04);
		poleG.add(s);
	}
	const wallG = new THREE.Group();
	for (let i = 0; i < 10; i++) {
		const ringN = i < 3 ? 0 : 1;
		const a = ringN ? ((i - 3) / 7) * Math.PI * 2 : (i / 3) * Math.PI * 2;
		const s = roll(0.0125, 0.84, m.pole());
		const d = ringN ? 0.027 : 0.012;
		s.position.set(0, Math.sin(a) * d, Math.cos(a) * d);
		wallG.add(s);
	}
	for (const x of [-0.25, 0.25]) {
		const tie = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.005, 6, 16).rotateY(Math.PI / 2), m.strap());
		tie.position.x = x;
		wallG.add(tie);
	}
	const sack = new THREE.Group();
	const sackBody = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.28, 14).rotateZ(Math.PI / 2), m.sack());
	sackBody.castShadow = true;
	const sackTie = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 12).rotateY(Math.PI / 2), m.rope());
	sackTie.position.x = 0.15;
	sack.add(sackBody, sackTie);
	const parts = { canvas: canvasG, groundsheet: sheetRoll, pole: poleG, wallPoles: wallG, pegs: sack };
	const places = {
		canvas: [new THREE.Vector3(0, 0.15, 0.07), new THREE.Vector3(0, 0.112, -0.42)],
		groundsheet: [new THREE.Vector3(-0.17, 0.17, -0.12), new THREE.Vector3(-0.17, 0.077, -0.14)],
		pegs: [new THREE.Vector3(0.36, 0.17, -0.12), new THREE.Vector3(0.36, 0.067, -0.14)],
		pole: [new THREE.Vector3(0, 0.36, -0.06), new THREE.Vector3(0, 0.074, 0.14)],
		wallPoles: [new THREE.Vector3(0, 0.38, 0.09), new THREE.Vector3(0, 0.041, 0.4)]
	};
	for (const o of Object.values(parts)) g.add(o);

	let now = -1;
	function setOpen(k) {
		k = clamp(k);
		if (k === now) return;
		now = k;
		g.userData.open = k;
		const lay = ease(clamp((k - 0.12) / 0.88));
		for (const s of [cover, ...straps]) s.userData.lay(lay);
		for (const b of buckles) b.visible = k < 0.08;
		handle.visible = lay < 0.02;
		for (const [name, [from, to]] of Object.entries(places)) parts[name].position.lerpVectors(from, to, ease(clamp((k - 0.3) / 0.7)));
	}
	g.userData = { open, setOpen, parts };
	setOpen(open);
	return g;
}
