/*
 * THE ANT — the red wood ant (Formica rufa), 8 mm: a red-brown head with elbowed antennae and its mandibles, a
 * red-brown thorax carrying six legs, the narrow waist (the petiole, its one scale), and the black, shining gaster.
 * It walks in a tripod: front and hind leg of one side with the middle leg of the other, three feet always down.
 *
 * And its hill: a mound of conifer needles, twigs and bits of bark thatched over an earth core, half a metre high and
 * a metre and more across, sunny side long, holes for doors all over it, and the colony on it — busy in the sun, the
 * foragers going out round it and coming back. One actor: the mound rides its root, and each ant rides its own bone,
 * pivoting round the mound's middle along its own ring of the surface, stopping, turning back, going on.
 */
import * as THREE from 'three';
import { egg, limb, rig } from '../rig';
import { animalMaterials } from '../features';
import { hash, noise3, wander } from '../noise';

/** @typedef {import('../rig').BoneSpec} BoneSpec */
/** @typedef {import('../rig').PartSpec} PartSpec */
/** @typedef {import('../rig').Cast} Cast */
/** @typedef {import('../rig').Clip} Clip */
/** @typedef {import('../rig').Pose} Pose */
/** @typedef {import('../rig').V3} V3 */

const RED = '#8a3a1e', DARK = '#1a1210', LEG = '#5a2a18';

/**
 * One ant's parts, standing at `at`, facing along `face` (+1: +z, −1: −z), its body leaning by `pitch` (radians,
 * nose up) — all riding `bone`, or its legs riding their own bones (`legs`).
 * @param {V3} at @param {number} face @param {number} pitch @param {string} bone
 * @param {{ legs?: (side: number, i: number) => string, s?: number, low?: boolean }} [o]
 * @returns {PartSpec[]}
 */
function antParts(at, face, pitch, bone, o = {}) {
	const s = o.s ?? 1, low = o.low ?? false;
	const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch * face, face < 0 ? Math.PI : 0, 0)), new THREE.Vector3(s, s, s));
	/** a point of the ant's own frame (it faces +z there) in the actor's */
	const P = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => /** @type {V3} */ (new THREE.Vector3(x, y, z).applyMatrix4(m).toArray());
	const eg = (/** @type {V3} */ c, /** @type {V3} */ r) => {
		const g = egg([0, 0, 0], r, [0, 0, 0], low ? [7, 5] : [12, 8]);
		g.applyMatrix4(new THREE.Matrix4().makeTranslation(...c)).applyMatrix4(m);
		return g;
	};
	/** @type {PartSpec[]} */
	const parts = [
		{ geo: eg([0, 0.0026, 0.0028], [0.0009, 0.0008, 0.001]), color: RED, bone },
		{ geo: eg([0, 0.0028, 0.0008], [0.0007, 0.0007, 0.0014]), color: RED, bone },
		{ geo: eg([0, 0.0028, -0.0008], [0.0003, 0.0005, 0.0003]), color: DARK, bone },
		{ geo: eg([0, 0.0029, -0.0026], [0.0012, 0.0011, 0.0015]), color: DARK, bone, mat: 1 }
	];
	const r = low ? 0.00012 : 0.0001;
	const seg = low ? 3 : 5;
	// the antennae, elbowed forward, and the mandibles
	for (const x of [-1, 1]) {
		const elbow = P(x * 0.0006, 0.0042, 0.0034);
		parts.push({ geo: limb(P(x * 0.0003, 0.0031, 0.0034), elbow, r, r, { seg }), color: DARK, bone });
		parts.push({ geo: limb(elbow, P(x * 0.0011, 0.0036, 0.0053), r, r * 0.8, { seg }), color: DARK, bone });
		if (!low) parts.push({ geo: limb(P(x * 0.0003, 0.0021, 0.0036), P(x * 0.0001, 0.002, 0.0042), r * 1.4, r * 0.8, { seg }), color: LEG, bone });
	}
	// six legs: out from the thorax, the knee up, the foot down to the ground
	[0.0013, 0.0007, 0.0001].forEach((z, i) => {
		for (const x of [-1, 1]) {
			const hip = P(x * 0.0005, 0.0024, z);
			const knee = P(x * 0.0022, 0.0034, z + (1 - i) * 0.0012);
			const foot = P(x * 0.0034, 0, z + (1 - i) * 0.0026);
			const b = o.legs ? o.legs(x, i) : bone;
			parts.push({ geo: limb(hip, knee, r * 1.4, r * 1.1, { seg }), color: LEG, bone: b });
			parts.push({ geo: limb(knee, foot, r * 1.1, r * 0.8, { seg }), color: LEG, bone: b });
		}
	});
	return parts;
}

/** The ant on its own, its legs rigged: walks in a tripod, stops to wave its antennae. */
/** @returns {Cast} */
export function ant() {
	/** @type {BoneSpec[]} */
	const bones = [
		{ name: 'body', at: [0, 0.0026, 0] },
		{ name: 'head', parent: 'body', at: [0, 0.0028, 0.002] },
		{ name: 'gaster', parent: 'body', at: [0, 0.0028, -0.0008] }
	];
	const legName = (/** @type {number} */ x, /** @type {number} */ i) => `leg${x < 0 ? 'L' : 'R'}${i}`;
	[0.0013, 0.0007, 0.0001].forEach((z, i) => {
		for (const x of [-1, 1]) bones.push({ name: legName(x, i), parent: 'body', at: [x * 0.0005, 0.0024, z] });
	});
	const parts = antParts([0, 0, 0], 1, 0, 'body', { legs: legName });
	// the head's parts ride the head, the gaster's the gaster
	parts[0] = { ...parts[0], bone: 'head' };
	parts[2] = { ...parts[2], bone: 'gaster' };
	parts[3] = { ...parts[3], bone: 'gaster' };
	for (let k = 4; k < 8; k++) parts[k] = { ...parts[k], bone: 'head' };
	const r = rig(bones, parts, animalMaterials(0.55, {}));
	r.object.name = 'ant';
	/** a tripod gait: front and hind of one side with the middle of the other @type {Clip} */
	const walk = (t, m) => {
		const phase = ((m?.dist ?? t * 0.04) / 0.006) * Math.PI * 2;
		/** @type {Pose} */
		const p = { body: [0, 0, 0.04 * Math.sin(phase * 2)], head: [0.05 * Math.sin(phase), 0.08 * Math.sin(phase * 0.5), 0], gaster: [0.06 * Math.sin(phase * 2), 0, 0] };
		[0, 1, 2].forEach((i) => {
			for (const x of [-1, 1]) {
				const group = (i === 1 ? -x : x) > 0 ? 0 : Math.PI;
				const swing = Math.sin(phase + group);
				p[legName(x, i)] = [0, 0.45 * swing * x, Math.max(0, Math.cos(phase + group)) * 0.35 * x];
			}
		});
		return p;
	};
	/** standing, the antennae sweeping, the head turning @type {Clip} */
	const idle = (t) => ({ head: [0.15 * Math.sin(t * 3), 0.35 * wander(t, 1.4, 3), 0.1 * Math.sin(t * 5)], gaster: [0.05 * Math.sin(t * 1.3), 0, 0] });
	return { rig: r, clips: { walk, idle }, first: 'walk' };
}

/** the hill's measure: its radius, its height, how many ants on it and round it */
const R = 0.6, H = 0.45, ON = 64, OUT = 20;
/** the mound's height at a distance d from its middle */
const surface = (/** @type {number} */ d) => (d >= R ? 0 : H * Math.pow(1 - Math.pow(d / R, 1.8), 0.75));

/** The ant hill and its colony: a thatched mound of needles and twigs, the ants busy all over it. */
/** @returns {Cast} */
export function antHill() {
	/** @type {BoneSpec[]} */
	const bones = [{ name: 'mound', at: [0, 0, 0] }];
	/** @type {PartSpec[]} */
	const parts = [];
	// the mound: a lathe of the profile, coloured needle by needle (brown, rust, dark, the odd pale bit of bark)
	const prof = [];
	for (let k = 0; k <= 60; k++) {
		const d = R * 1.04 * (1 - k / 60);
		prof.push(new THREE.Vector2(Math.max(1e-4, d), surface(Math.min(d, R * 0.999)) + (k === 0 ? -0.01 : 0)));
	}
	const mound = new THREE.LatheGeometry(prof, 160);
	// gently lumpy — only ever a little lower than its profile, so the ants on the profile walk on top of it
	const pos = mound.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		pos.setY(i, y * (1 - 0.04 * (0.5 + 0.5 * noise3(x * 14, y * 14, z * 14, 5))));
	}
	mound.computeVertexNormals();
	const needle = (/** @type {THREE.Vector3} */ p) => {
		const h = hash(Math.round(p.x * 900) * 73856093 ^ Math.round(p.y * 900) * 19349663 ^ Math.round(p.z * 900) * 83492791, 11);
		return h < 0.42 ? '#6a4228' : h < 0.72 ? '#8a5230' : h < 0.95 ? '#3a2618' : '#a88a5a';
	};
	parts.push({ geo: mound, color: needle, bone: 'mound' });
	// twigs lying on it, and the doors: dark holes all over its surface
	for (let k = 0; k < 26; k++) {
		const a = hash(k, 21) * Math.PI * 2, d = Math.sqrt(hash(k, 22)) * R * 0.9;
		const c = new THREE.Vector3(Math.cos(a) * d, surface(d) + 0.004, Math.sin(a) * d);
		const dir = new THREE.Vector3(Math.cos(a + 1.3 + hash(k, 23)), 0, Math.sin(a + 1.3 + hash(k, 23))).multiplyScalar(0.04 + 0.05 * hash(k, 24));
		const a2 = /** @type {V3} */ (c.clone().sub(dir).toArray()), b2 = /** @type {V3} */ (c.clone().add(dir).toArray());
		parts.push({ geo: limb(a2, b2, 0.003, 0.0025, { seg: 4 }), color: '#5a4030', bone: 'mound' });
	}
	for (let k = 0; k < 14; k++) {
		const a = hash(k, 31) * Math.PI * 2, d = (0.15 + 0.7 * hash(k, 32)) * R;
		parts.push({ geo: egg([Math.cos(a) * d, surface(d) + 0.001, Math.sin(a) * d], [0.012, 0.004, 0.012], [0, 0, 0], [8, 5]), color: '#120c08', bone: 'mound' });
	}
	// the ants: each on its own bone at the mound's middle, set out at its distance on the surface, facing along its ring
	/** @type {{ name: string, d: number, way: number, speed: number, phase: number }[]} */
	const ants = [];
	for (let i = 0; i < ON + OUT; i++) {
		const out = i >= ON;
		const d = out ? R * (1.1 + 0.5 * hash(i, 41)) : R * (0.08 + 0.85 * Math.sqrt(hash(i, 41)));
		const way = hash(i, 42) < 0.5 ? 1 : -1;
		const name = `ant${i}`;
		bones.push({ name, parent: 'mound', at: [0, 0, 0] });
		parts.push(...antParts([d, surface(d) + 0.001, 0], -way, 0, name, { low: true }));
		ants.push({ name, d, way, speed: (0.03 + 0.03 * hash(i, 43)) / d, phase: hash(i, 44) * 100 });
	}
	const r = rig(bones, parts, animalMaterials(0.8, {}));
	r.object.name = 'ant-hill';
	/** how far an ant has gone round by t: on, a stop, on again; now and then the other way */
	const travel = (/** @type {{ way: number, speed: number, phase: number }} */ a, /** @type {number} */ t, /** @type {number} */ busy) => {
		const u = t + a.phase;
		const go = Math.max(0, wander(u, 2.5, a.phase * 7) + busy - 0.2);
		return a.way * a.speed * (u * 0.6 * busy + go * 1.8 + 0.4 * Math.sin(u * 0.7));
	};
	/** the colony in the sun @type {Clip} */
	const busy = (t) => Object.fromEntries(ants.map((a) => [a.name, /** @type {V3} */ ([0, travel(a, t, 1) + a.phase, 0])]));
	/** a cool morning: most still, a few moving @type {Clip} */
	const calm = (t) => Object.fromEntries(ants.map((a) => [a.name, /** @type {V3} */ ([0, travel(a, t, 0.15) + a.phase, 0])]));
	return { rig: r, clips: { busy, calm }, first: 'busy' };
}
