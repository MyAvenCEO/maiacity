/*
 * THE SONGBIRDS — five birds of a middle-European garden and forest edge, each to its measure: the robin (Erithacus
 * rubecula, 14 cm, its face and breast orange-red edged grey), the blackbird (Turdus merula, 25 cm, the male black,
 * his bill and eye-ring yellow-orange), the great tit (Parus major, 14 cm, a black head with white cheeks, a yellow
 * breast and its black stripe, a green back, blue-grey wings), the house sparrow (Passer domesticus, 15 cm, the male's
 * grey crown, chestnut nape and black bib) and the chaffinch (Fringilla coelebs, 15 cm, the male's blue-grey crown,
 * rusty-pink breast and two white wing bars).
 *
 * On the bird plan (../plans/bird.ts) — a body, a neck in two, the head, the tail, the wings, four bones a leg — and
 * two more of their own: a `jaw` (the lower mandible, which opens when it sings) and, riding each wing bone, a whole
 * wing: folded along the flank with its primaries over the tail, and swung out, spread flat and beaten in flight.
 *
 * Their moves: `fly` (a songbird's bounding flight: a burst of wingbeats, then the wings shut for a moment), `hop`
 * (both feet together, as a sparrow or a tit goes on the ground; a robin and a blackbird hop too), `peck` (at the
 * ground), `sing` (perched upright, the head up, the bill opening and closing in phrases), `sit` (settled down on a
 * branch or the ground, the legs folded under it) and `idle` (standing, looking round).
 */
import * as THREE from 'three';
import { egg, limb, rig, spike } from '../rig';
import { sculpt, mix, ramp } from '../sculpt';
import { animalMaterials, eyes } from '../features';
import { birdHead, birdLegs, birdMoves, birdSkeleton } from '../plans/bird';
import { frac, smooth } from '../motion';
import { noise3, wander } from '../noise';

/** @typedef {import('../rig').V3} V3 */
/** @typedef {import('../rig').Pose} Pose */
/** @typedef {import('../rig').PartSpec} PartSpec */
/** @typedef {import('../rig').Cast} Cast */
/** @typedef {import('../sculpt').Surface} Surface */
/** @typedef {'robin' | 'blackbird' | 'greattit' | 'sparrow' | 'chaffinch'} Songbird */

/** @type {Songbird[]} */
export const SONGBIRDS = ['robin', 'blackbird', 'greattit', 'sparrow', 'chaffinch'];

/**
 * Each bird: its size against a robin's, its bill (length, thickness at the root, colour), its legs' colour, its
 * eye-ring, and how it is coloured (`paint`).
 * @type {Record<Songbird, { k: number, bill: [number, number, string], legs: string, ring?: string, wing: string, bars?: string, tail: string }>}
 */
const LOOK = {
	robin: { k: 1, bill: [0.012, 0.0028, '#2a2420'], legs: '#8a7a6a', wing: '#6e5c42', tail: '#6a5840' },
	blackbird: { k: 1.55, bill: [0.016, 0.0034, '#f2a51c'], legs: '#2a2624', ring: '#f2b23a', wing: '#161515', tail: '#141313' },
	greattit: { k: 0.96, bill: [0.009, 0.0028, '#1c1c1e'], legs: '#5a6a7a', wing: '#6d8197', bars: '#f2f2ec', tail: '#5f6f82' },
	sparrow: { k: 1.04, bill: [0.0095, 0.0042, '#2c2a2a'], legs: '#a08a72', wing: '#7a5434', bars: '#f0ece2', tail: '#5e4630' },
	chaffinch: { k: 1.05, bill: [0.0105, 0.004, '#7c8a96'], legs: '#8a7a70', wing: '#232222', bars: '#f4f2ec', tail: '#2c2a2a' }
};

/** a robin's joints (m); the others are its measure times their size */
const ROBIN = {
	body: [0, 0.052, 0],
	neck: [[0, 0.064, 0.016], [0, 0.071, 0.021]],
	head: [0, 0.078, 0.024],
	beak: [0, 0.077, 0.044],
	tail: [0, 0.052, -0.026],
	wing: [0.016, 0.064, 0.012],
	leg: [[0.008, 0.045, 0.002], [0.009, 0.036, 0.011], [0.009, 0.0245, -0.002], [0.009, 0.002, 0.003], [0.009, 0, 0.015]]
};
/** how far the whole bird above its legs sits lower than the robin's joints say (its legs mostly hidden in its feathers) */
const SINK = 0.011;
/** a robin's point, sunk @param {number[]} p @returns {number[]} */
const sunk = (p) => [p[0], p[1] - SINK, p[2]];

/** a point scaled by k @param {number[]} p @param {number} k @returns {V3} */
const at = (p, k) => [p[0] * k, p[1] * k, p[2] * k];

/* The wing: folded, it lies along the flank from the shoulder back and a little down, its leading edge up; spread, it
   points straight out to the side, flat, its leading edge forward. Its turn from the one to the other, and a flap
   (about the body's forward axis) on top. */
const SPAN_F = new THREE.Vector3(0, -0.3, -1).normalize(), LEAD_F = new THREE.Vector3(0, 1, -0.3).normalize();
const NORM_F = SPAN_F.clone().cross(LEAD_F);
const FOLDED = new THREE.Matrix4().makeBasis(SPAN_F, LEAD_F, NORM_F);
const SPREAD = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0).cross(new THREE.Vector3(0, 0, 1)));
/** folded → spread, as a turn of the wing bone (the left wing) */
const OPEN = new THREE.Quaternion().setFromRotationMatrix(SPREAD.clone().multiply(FOLDED.clone().transpose()));
const FLAP = new THREE.Quaternion(), QW = new THREE.Quaternion(), EW = new THREE.Euler();
/**
 * The wing bone's turn: `open` 0 (folded) … 1 (spread), `beat` how far the spread wing is raised (rad; negative: down),
 * `sweep` how far it is swept back; the right wing the left's mirror.
 * @param {'L' | 'R'} side @param {number} open @param {number} beat @param {number} [sweep]
 * @returns {[number, number, number]}
 */
function wingTurn(side, open, beat, sweep = 0) {
	FLAP.setFromEuler(EW.set(0, -sweep, beat, 'YZX'));
	FLAP.multiply(OPEN);
	QW.set(0, 0, 0, 1).slerp(FLAP, open);
	if (side === 'R') QW.set(QW.x, -QW.y, -QW.z, QW.w);
	EW.setFromQuaternion(QW, 'XYZ');
	return [EW.x, EW.y, EW.z];
}

/**
 * A wing, folded at rest along the flank from `shoulder`: `span` long, `chord` deep at its root, the primaries'
 * tips notched along its trailing edge; coloured by `color` (its bars).
 * @param {V3} shoulder @param {number} span @param {number} chord @param {number} x which side (1 left, −1 right)
 * @param {(u: number, v: number) => string} color by how far along the span (0…1) and back from the leading edge (0…1)
 * @param {string} bone
 * @returns {PartSpec}
 */
function wing(shoulder, span, chord, x, color, bone) {
	const s = new THREE.Shape();
	s.moveTo(0, 0);
	s.quadraticCurveTo(span * 0.55, chord * 0.12, span * 0.9, chord * 0.02);
	s.quadraticCurveTo(span * 1.02, -chord * 0.1, span, -chord * 0.32);
	// the trailing edge: the primaries' tips, then the secondaries, back to the body
	const tips = 6;
	for (let i = 0; i < tips; i++) {
		const u = span * (1 - (i + 0.5) / tips * 0.55), v = -chord * (0.35 + 0.5 * (i / tips));
		s.lineTo(u + span * 0.04, v + chord * 0.07);
		s.lineTo(u, v);
	}
	s.lineTo(span * 0.35, -chord * 0.95);
	s.quadraticCurveTo(span * 0.12, -chord * 1.02, 0, -chord * 0.85);
	s.lineTo(0, 0);
	const g = new THREE.ExtrudeGeometry(s, { depth: chord * 0.05, bevelEnabled: false, curveSegments: 4 });
	g.translate(0, 0, -chord * 0.025);
	const span3 = SPAN_F.clone(), lead3 = LEAD_F.clone(), norm3 = NORM_F.clone().multiplyScalar(x);
	const place = new THREE.Matrix4().makeBasis(span3, lead3, norm3);
	place.setPosition(shoulder[0] - x * chord * 0.08, shoulder[1] - chord * 0.05, shoulder[2]);
	g.applyMatrix4(place);
	const o = new THREE.Vector3(...shoulder);
	return {
		geo: g,
		color: (p) => {
			const d = p.clone().sub(o);
			return color(Math.max(0, Math.min(1, d.dot(span3) / span)), Math.max(0, Math.min(1, -d.dot(lead3) / chord)));
		},
		bone
	};
}

/**
 * A songbird, rigged, with its moves.
 * @param {Songbird} [kind]
 * @returns {Cast}
 */
export function songbird(kind = 'robin') {
	const L = LOOK[kind], k = L.k;
	/** @type {import('../plans/bird').BirdJoints} */
	const J = {
		body: at(sunk(ROBIN.body), k),
		neck: ROBIN.neck.map((p) => at(sunk(p), k)),
		head: at(sunk(ROBIN.head), k),
		beak: at(sunk(ROBIN.beak), k),
		tail: at(sunk(ROBIN.tail), k),
		wing: at(sunk(ROBIN.wing), k),
		leg: /** @type {[V3, V3, V3, V3, V3]} */ (ROBIN.leg.map((p, i) => at(i < 2 ? sunk(p) : i === 2 ? [p[0], p[1] - SINK * 0.6, p[2]] : p, k)))
	};
	const b = birdSkeleton(J);
	// the lower mandible, hinged under the eye
	const jawAt = /** @type {V3} */ ([0, J.head[1] - 0.003 * k, J.head[2] + 0.009 * k]);
	const bones = [...b.bones, { name: 'jaw', parent: 'head', at: jawAt }];
	const s = sculpt(bones);
	const feather = { bump: 0.0007 * k, lumps: 0.003 * k };
	const fat = kind === 'robin' || kind === 'greattit' ? 1.06 : 1;
	// the body tilted head-up; the breast full and forward; the belly between the legs; the back flat to the tail
	s.egg(at(sunk([0, 0.054, -0.002]), k), [0.0195 * k * fat, 0.02 * k * fat, 0.031 * k], { bone: 'body', tag: 'back', ...feather }, [0.5, 0, 0]);
	s.egg(at(sunk([0, 0.057, 0.013]), k), [0.018 * k * fat, 0.019 * k * fat, 0.018 * k], { bone: 'body', k: 0.008 * k, tag: 'breast', ...feather });
	s.egg(at(sunk([0, 0.045, -0.004]), k), [0.015 * k, 0.011 * k, 0.02 * k], { bone: 'body', k: 0.007 * k, tag: 'belly', ...feather });
	s.cone(J.neck[0], J.head, 0.0135 * k, 0.012 * k, { chain: b.neck, k: 0.006 * k, tag: 'neck', ...feather });
	s.egg(at(sunk([0, 0.0785, 0.0255]), k), [0.0135 * k, 0.0135 * k, 0.0155 * k], { bone: 'head', k: 0.005 * k, tag: 'head', bump: 0.0003 * k, lumps: 0.002 * k });
	// the tail, long and flat, angled down behind
	s.egg(at(sunk([0, 0.045, -0.048]), k), [0.0105 * k, 0.0028 * k, 0.027 * k], { bone: 'tail', k: 0.004 * k, tag: 'tail' }, [0.42, 0, 0]);
	// the folded wings' coverts on the flanks, part of the body (the wing itself is a part of its own, under them when
	// folded, and swung out from under them to fly)
	for (const [side, x] of /** @type {const} */ ([['L', 1], ['R', -1]]))
		s.egg(at(sunk([x * 0.0165, 0.06, -0.006]), k), [0.0055 * k, 0.0135 * k, 0.025 * k], { bone: 'body', k: 0.004 * k, tag: 'wing', ...feather }, [0.42, x * -0.06, 0]);
	// the thighs, feathered, down to the knee
	for (const [side, x] of /** @type {const} */ ([['L', 1], ['R', -1]])) s.egg([x * J.leg[1][0], J.leg[1][1] + 0.002 * k, J.leg[1][2] - 0.002 * k], [0.0055 * k, 0.008 * k, 0.007 * k], { bone: `shank${side}`, k: 0.004 * k, tag: 'belly', ...feather });

	const c = (/** @type {string} */ h) => new THREE.Color(h);
	const C = {
		robinBack: c('#7a6a4e'), orange: c('#d9622b'), border: c('#9aa3a6'), white: c('#efeae0'), cream: c('#e6dccb'),
		black: c('#181717'), sheen: c('#2b2a2c'), olive: c('#7c8a3c'), yellow: c('#e3c93a'), blueGrey: c('#6d8197'),
		grey: c('#8b8b88'), chestnut: c('#8a4a22'), paleGrey: c('#c9c5bc'), brown: c('#8a6038'), dark: c('#2b2420'),
		blueCrown: c('#6f8494'), pink: c('#c47a62'), paleP: c('#d9b2a2'), chestBrown: c('#8a5a3a'), green: c('#88915a')
	};
	/** @param {THREE.Color} col @param {Surface} sf */
	const paint = (col, sf) => {
		const { p, n } = sf;
		const fine = noise3(p.x * 900 / k, p.y * 900 / k, p.z * 900 / k, 7);
		const head = sf.tag('head') + sf.tag('neck') * 0.6;
		const front = ramp(n.z, 0.05, 0.45);
		const under = Math.max(sf.tag('belly'), ramp(-n.y, 0.15, 0.6));
		const y = p.y / k + SINK, z = p.z / k;
		if (kind === 'robin') {
			col.copy(C.robinBack);
			// the orange face and breast, bordered grey, the belly white below it
			const face = front * (y > 0.046 ? 1 : 0) * (1 - ramp(n.y, 0.55, 0.85)) * (z > -0.004 ? 1 : 0);
			mix(col, C.border, ramp(face, 0.05, 0.35) * 0.9);
			mix(col, C.orange, ramp(face, 0.3, 0.6));
			mix(col, C.white, under * (y < 0.05 ? 1 : 0.3));
		} else if (kind === 'blackbird') {
			col.copy(C.black);
			mix(col, C.sheen, 0.4 + 0.3 * fine);
		} else if (kind === 'greattit') {
			col.copy(C.olive);
			mix(col, C.yellow, Math.max(front * sf.tag('breast'), under) * (1 - head));
			// the black stripe down the middle of the breast and belly
			mix(col, C.black, (1 - ramp(Math.abs(p.x) / k, 0.0025, 0.004)) * Math.max(front, under) * (y < 0.066 ? 1 : 0));
			// the black head with its white cheek
			mix(col, C.black, head);
			const cheek = head * ramp(Math.abs(n.x), 0.45, 0.75) * (y < 0.08 ? 1 : 0) * (z > 0.018 ? 1 : 0);
			mix(col, C.white, cheek);
			mix(col, C.blueGrey, sf.tag('wing') + sf.tag('tail'));
		} else if (kind === 'sparrow') {
			col.copy(C.brown);
			// the back streaked black
			mix(col, C.dark, ramp(Math.sin(p.x * 1400 / k + fine * 3), 0.6, 0.95) * sf.tag('back') * ramp(n.y, 0.2, 0.7));
			mix(col, C.paleGrey, under);
			// a grey crown over a chestnut nape, pale grey cheeks, the black bib
			mix(col, C.chestnut, head * (1 - front));
			mix(col, C.grey, head * ramp(n.y, 0.55, 0.85));
			mix(col, C.paleGrey, head * front * ramp(Math.abs(n.x), 0.3, 0.6));
			const bib = (1 - ramp(Math.abs(p.x) / k, 0.005, 0.009)) * front * (y > 0.055 && y < 0.074 ? 1 : 0);
			mix(col, C.black, bib);
			mix(col, C.chestBrown, sf.tag('wing'));
		} else {
			col.copy(C.chestBrown);
			mix(col, C.green, ramp(-n.z, 0.5, 0.9) * sf.tag('back'));
			// the rusty-pink face and breast, paler below; the blue-grey crown and nape
			mix(col, C.pink, front * (1 - ramp(n.y, 0.5, 0.8)));
			mix(col, C.paleP, under);
			mix(col, C.blueCrown, head * Math.max(ramp(n.y, 0.4, 0.75), ramp(-n.z, 0.1, 0.5)));
			mix(col, C.dark, sf.tag('wing') * 0.8 + sf.tag('tail'));
		}
		col.multiplyScalar(0.94 + 0.1 * fine);
	};
	const skin = s.skin(0.0022 * k, paint, `bird-${kind}`);

	/** @type {PartSpec[]} */
	const parts = [{ skin }];
	// the bill: the upper mandible on the head, the lower on the jaw
	const [bl, bt, bc] = L.bill;
	const root = /** @type {V3} */ ([0, jawAt[1] + 0.0035 * k, J.head[2] + 0.011 * k]);
	parts.push({ geo: spike(root, [0, -0.08, 1], bt, bl * 0.95, { flat: 0.95 }), color: bc, bone: 'head' });
	parts.push({ geo: spike([0, root[1] - bt * 0.7, root[2] - 0.001 * k], [0, -0.16, 1], bt * 0.8, bl * 0.8, { flat: 0.9 }), color: bc, bone: 'jaw' });
	parts.push(...eyes(at(sunk([0.0098, 0.0805, 0.0315]), k), 0.0034 * k, [0.92, 0.1, 0.38], '#140d09', 'round', 'head', { irisR: 0.85, rim: L.ring ?? '#1d1713' }));
	if (L.ring) for (const x of [1, -1]) parts.push({ geo: new THREE.TorusGeometry(0.0034 * k, 0.0007 * k, 6, 14).rotateY(x * 1.2).translate(x * 0.0102 * k, (0.0805 - SINK) * k, 0.0312 * k), color: L.ring, bone: 'head' });
	// the wings: brown, black or blue-grey, a bar or two of white across them
	for (const [side, x] of /** @type {const} */ ([['L', 1], ['R', -1]])) {
		const shoulder = /** @type {V3} */ ([x * J.wing[0], J.wing[1], J.wing[2]]);
		parts.push(
			wing(shoulder, 0.07 * k, 0.03 * k, x, (u, v) => {
				if (L.bars && v < 0.42 && ((u > 0.18 && u < 0.26) || (kind === 'chaffinch' && u > 0.36 && u < 0.43))) return L.bars;
				if (kind === 'chaffinch' && u < 0.15) return '#c8cacc';
				return v > 0.7 && u > 0.5 ? new THREE.Color(L.wing).multiplyScalar(0.75).getStyle() : L.wing;
			}, `wing${side}`)
		);
	}
	// the legs, slim and scaled; three toes forward and one back, each with its claw
	for (const [side, x] of /** @type {const} */ ([['L', 1], ['R', -1]])) {
		const ankle = /** @type {V3} */ ([x * J.leg[2][0], J.leg[2][1], J.leg[2][2]]), toes = /** @type {V3} */ ([x * J.leg[3][0], J.leg[3][1], J.leg[3][2]]);
		parts.push({ geo: limb(ankle, toes, 0.0011 * k, 0.001 * k, { seg: 6 }), color: L.legs, bone: `tarsus${side}` });
		for (const a of [-0.45, 0, 0.45, Math.PI]) {
			const len = (a === Math.PI ? 0.008 : a === 0 ? 0.012 : 0.009) * k;
			const tip = /** @type {V3} */ ([toes[0] + Math.sin(a) * len, 0.0008 * k, toes[2] + Math.cos(a) * len]);
			parts.push({ geo: limb(toes, tip, 0.0008 * k, 0.0005 * k, { seg: 5 }), color: L.legs, bone: `toes${side}` });
		}
	}
	// the tail feathers spread a little at the tip
	parts.push({ geo: egg(at(sunk([0, 0.039, -0.072]), k), [0.0125 * k, 0.0012 * k, 0.012 * k], [0.42, 0, 0]), color: L.tail, bone: 'tail' });

	const mats = animalMaterials(0.85);
	mats[0].side = THREE.DoubleSide; // a wing's two faces, either side
	const r = rig(bones, parts, mats);
	r.object.name = `bird-${kind}`;
	const seed = SONGBIRDS.indexOf(kind) + 61;
	const base = birdMoves(b, {
		seed,
		gaits: { hop: { speed: 0.3 * k, stride: 0.07 * k, duty: 0.45, feet: { L: 0, R: 0 }, lift: 0.012 * k, bob: 0.009 * k, roll: 0, pitch: 0.06, tilt: 0.35, fold: 1.2, curl: 0.5, hold: 0 } },
		wag: 0.15
	});
	const beakDir = new THREE.Vector3(J.beak[0] - J.head[0], J.beak[1] - J.head[1], J.beak[2] - J.head[2]).normalize();
	/** the wings folded, the tail at rest with a flick now and then @param {number} t @returns {Pose} */
	const still = (t) => ({
		wingL: [0, 0, 0],
		wingR: [0, 0, 0],
		tail: [-0.25 * Math.pow(Math.max(0, Math.sin(t * 0.9 + seed)), 12), 0.04 * wander(t, 2, seed), 0]
	});
	/** @type {Record<string, import('../rig').Clip>} */
	const clips = {
		fly: (t) => {
			// bounding flight: a burst of beats, then the wings shut and it falls a little, then beats again
			const u = frac(t / 0.85 + seed * 0.13), beating = u < 0.62;
			const beat = Math.sin(t * Math.PI * 2 * 9);
			const open = beating ? 1 : 1 - smooth((u - 0.62) / 0.08) + smooth((u - 0.94) / 0.06);
			/** @type {Pose} */
			const pose = {
				root: [0, beating ? 0.004 * k * Math.max(0, beat) : -0.01 * k * smooth((u - 0.62) / 0.38), 0],
				body: [0.55, 0, 0],
				tail: [-0.35, 0, 0],
				wingL: wingTurn('L', open, beating ? 0.15 + 0.85 * beat : 0.1, beating ? 0.25 - 0.2 * beat : 0.6),
				wingR: wingTurn('R', open, beating ? 0.15 + 0.85 * beat : 0.1, beating ? 0.25 - 0.2 * beat : 0.6)
			};
			// the legs drawn up under the belly, the toes curled
			birdLegs(b, pose, null, null, 0, { L: { y: 0.02 * k, z: -0.016 * k, curl: 1.1 }, R: { y: 0.02 * k, z: -0.016 * k, curl: 1.1 } });
			birdHead(b, pose, new THREE.Vector3(0, J.head[1] - 0.006 * k, J.head[2] + 0.01 * k), new THREE.Vector3(0, -0.15, 1).normalize());
			return pose;
		},
		hop: (t, m) => ({ ...base.hop(t, m), ...still(t), tail: [0.15 * Math.max(0, Math.sin((t * Math.PI * 2 * 0.3 * k) / (0.07 * k))), 0, 0] }),
		peck: (t) => ({ ...base.peck(t), ...still(t) }),
		idle: (t) => ({ ...base.idle(t), ...still(t) }),
		sing: (t) => {
			// upright on its perch, the head up, the bill opening and closing through each phrase, a rest between
			/** @type {Pose} */
			const pose = { ...still(t), body: [-0.15, 0, 0], root: [0, -0.004 * k, 0] };
			const u = frac(t / 4.2 + seed * 0.1), phrase = u < 0.55;
			const syll = phrase ? Math.max(0, Math.sin(t * Math.PI * 2 * (kind === 'blackbird' ? 4 : 7))) : 0;
			pose.jaw = [0.12 + 0.5 * syll * smooth(u / 0.05) * (1 - smooth((u - 0.5) / 0.05)), 0, 0];
			birdLegs(b, pose, null, null, 0, { L: { curl: 0.6 }, R: { curl: 0.6 } });
			const look = wander(t, 3, seed + 2);
			birdHead(b, pose, new THREE.Vector3(0.002 * k * look, J.head[1] + 0.006 * k, J.head[2] - 0.002 * k), beakDir.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), phrase ? -0.55 : -0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5 * look));
			return pose;
		},
		sit: (t) => {
			// settled down on its feet, the legs folded under it, the feathers fluffed, now and then a look round
			/** @type {Pose} */
			const pose = { ...still(t), root: [0, -0.014 * k, 0], body: [0.12, 0, 0], tail: [-0.1, 0, 0] };
			birdLegs(b, pose, null, null, 0, { L: { y: 0.008 * k, curl: 0.7 }, R: { y: 0.008 * k, curl: 0.7 } });
			const look = wander(t, 2.2, seed + 5);
			birdHead(b, pose, new THREE.Vector3(0.002 * k * look, J.head[1] - 0.008 * k, J.head[2] - 0.006 * k), beakDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.9 * look));
			return pose;
		}
	};
	return { rig: r, clips, first: 'sing', gears: { hop: 0.3 * k }, feet: ['toesL', 'toesR'] };
}
