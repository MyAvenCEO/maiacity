/*
 * THE SONGBIRDS OF THE FOOD FOREST (Sandbox 5) — robins, blackbirds, great tits, house sparrows and chaffinches, each
 * living round a few trees of its own: it sits up in a crown and sings, or settles there a while; drops down to the
 * floor beside the tree and forages there — hops, pecks, looks round; and flies up again to that tree or the next,
 * in a songbird's bounding flight. Every one is a rigged actor ($lib/actors/species/songbird.js), drawn as the other
 * animals are ($lib/actors/crowd): near you every bone moving, further off the bird at rest, a hundred a draw call.
 *
 * Where a bird is and what it does is worked out from the world's time alone — each bird's round is laid out once
 * from the seed and repeats — so a film shot draws the same birds every time.
 */
import * as THREE from 'three';
import { CASTS } from '$lib/actors/casts';
import { prepare, ready } from '$lib/actors/build';
import { crowd, FAR } from '$lib/actors/crowd';
import { SONGBIRDS } from '$lib/actors/species/songbird.js';
import { seeded } from './plants';

/** @typedef {{ x: number, z: number, height: number, reach: number }} Tree a tree a bird can sit in */
/** @typedef {{ kind: 'perch' | 'ground' | 'fly', t0: number, t1: number, from: THREE.Vector3, to: THREE.Vector3, act: string, yaw: number }} Leg one stretch of a bird's round */
/** @typedef {{ coat: number, legs: Leg[], period: number, phase: number }} Bird */

/** how often each kind is met */
const OFTEN = { robin: 3, blackbird: 3, greattit: 3, sparrow: 4, chaffinch: 3 };

/**
 * The birds round `trees`, `count` of them, never coming down where `open(x, z)` says the ground is not (a path, the
 * water, a dome).
 * @param {Tree[]} trees @param {number} count @param {number} seed
 * @param {(x: number, z: number) => boolean} open
 * @param {() => { x: number, z: number }} [eye]
 */
export function songbirds(trees, count, seed, open, eye) {
	const r = seeded(seed);
	const ids = SONGBIRDS.map((k) => `bird-${k}`);
	for (const id of ids) {
		void prepare(id, FAR);
		void prepare(id, 1);
	}
	/** @type {Record<string, import('$lib/actors/rig').Clip>[]} */
	const clips = [];
	const total = Object.values(OFTEN).reduce((a, b) => a + b, 0);
	const coatOf = () => {
		let x = r() * total;
		return Math.max(0, SONGBIRDS.findIndex((k) => (x -= OFTEN[k]) < 0));
	};
	/** a place to sit in a tree's crown @param {Tree} t */
	const perch = (t) => {
		const a = r() * Math.PI * 2, d = t.reach * (0.35 + r() * 0.4);
		return new THREE.Vector3(t.x + Math.cos(a) * d, t.height * (0.55 + r() * 0.25), t.z + Math.sin(a) * d);
	};
	/** a place on the floor near a tree, in the open @param {Tree} t */
	const ground = (t) => {
		for (let k = 0; k < 12; k++) {
			const a = r() * Math.PI * 2, d = t.reach * 0.6 + 0.6 + r() * 3;
			const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
			if (open(x, z)) return new THREE.Vector3(x, 0, z);
		}
		return null;
	};
	/** @type {Bird[]} */
	const birds = [];
	for (let i = 0; i < count && trees.length; i++) {
		const coat = coatOf();
		// its trees: one, and two more near it
		const home = /** @type {Tree} */ (trees[Math.floor(r() * trees.length)]);
		const near = trees.filter((t) => Math.hypot(t.x - home.x, t.z - home.z) < 25 && t !== home);
		const own = [home, ...near.sort(() => r() - 0.5).slice(0, 2)];
		/** @type {Leg[]} */
		const legs = [];
		let t = 0, at = perch(home), tree = home;
		const flyTo = (/** @type {THREE.Vector3} */ to) => {
			const d = at.distanceTo(to), dur = Math.max(0.8, d / (4.5 + r() * 2));
			legs.push({ kind: 'fly', t0: t, t1: t + dur, from: at.clone(), to: to.clone(), act: 'fly', yaw: Math.atan2(to.x - at.x, to.z - at.z) });
			t += dur;
			at = to.clone();
		};
		for (let round = 0; round < 4; round++) {
			// up in the crown: singing, or sitting a while
			const sit = 6 + r() * 14;
			legs.push({ kind: 'perch', t0: t, t1: t + sit, from: at.clone(), to: at.clone(), act: r() < (coat === 3 ? 0.35 : 0.65) ? 'sing' : r() < 0.5 ? 'sit' : 'idle', yaw: r() * Math.PI * 2 });
			t += sit;
			// down to the floor to forage, if there is open ground
			const spot = ground(tree);
			if (spot) {
				flyTo(spot);
				const forage = 6 + r() * 12;
				legs.push({ kind: 'ground', t0: t, t1: t + forage, from: at.clone(), to: at.clone(), act: 'forage', yaw: r() * Math.PI * 2 });
				t += forage;
			}
			// and up again, to this tree or the next
			tree = /** @type {Tree} */ (own[Math.floor(r() * own.length)]);
			flyTo(perch(tree));
		}
		// home for the start of the next round: the round repeats, so it ends where it began
		flyTo(/** @type {THREE.Vector3} */ (/** @type {Leg} */ (legs[0]).from));
		birds.push({ coat, legs, period: t, phase: r() * t });
	}

	const flock = crowd(
		(c) => {
			const made = CASTS[/** @type {string} */ (ids[c])]();
			clips[c] = made.clips;
			return made;
		},
		SONGBIRDS.map((_, c) => birds.filter((b) => b.coat === c).length),
		{ near: 28, max: 18, ready: (c, d) => ready(/** @type {string} */ (ids[c]), d), shadows: false }
	);
	const p = new THREE.Vector3();
	/** where a bird is at time t, which way it faces, and what it is doing @param {Bird} b @param {number} time */
	const state = (b, time) => {
		const u = (((time + b.phase) % b.period) + b.period) % b.period;
		const leg = /** @type {Leg} */ (b.legs.find((l) => u < l.t1) ?? b.legs[b.legs.length - 1]);
		const k = (u - leg.t0) / Math.max(1e-6, leg.t1 - leg.t0);
		if (leg.kind === 'fly') {
			// an arc: up and over, higher the further it goes, coming down onto its feet
			const d = leg.from.distanceTo(leg.to);
			p.lerpVectors(leg.from, leg.to, k);
			p.y += Math.sin(Math.PI * k) * Math.min(3, 0.6 + d * 0.15);
			return { x: p.x, y: p.y, z: p.z, yaw: leg.yaw, clip: 'fly', at: u - leg.t0, motion: undefined };
		}
		if (leg.kind === 'perch') return { x: leg.from.x, y: leg.from.y, z: leg.from.z, yaw: leg.yaw + 0.6 * Math.sin(u * 0.13), clip: leg.act, at: u, motion: undefined };
		// foraging: a few hops one way, a peck or two, a look round, a few hops on — in turns of 1.6 s
		const step = Math.floor((u - leg.t0) / 1.6), inStep = (u - leg.t0) / 1.6 - step;
		const sr = seeded(Math.floor(leg.t0 * 100) + step * 7);
		let x = leg.from.x, z = leg.from.z, yaw = leg.yaw;
		for (let s = 0; s < step; s++) {
			const turn = seeded(Math.floor(leg.t0 * 100) + s * 7);
			yaw += (turn() - 0.5) * 2.2;
			if (s % 2 === 0) {
				x += Math.sin(yaw) * 0.25;
				z += Math.cos(yaw) * 0.25;
			}
		}
		yaw += (sr() - 0.5) * 2.2;
		const hopping = step % 2 === 0;
		if (hopping) {
			x += Math.sin(yaw) * 0.25 * inStep;
			z += Math.cos(yaw) * 0.25 * inStep;
		}
		return { x, y: 0, z, yaw, clip: hopping ? 'hop' : sr() < 0.7 ? 'peck' : 'idle', at: u, motion: hopping ? { dist: 0.25 * inStep, speed: 0.16 } : undefined };
	};
	const update = (/** @type {number} */ t) => {
		const at = eye?.();
		flock.begin();
		for (const b of birds) {
			const s = state(b, t);
			const d2 = at ? (s.x - at.x) ** 2 + (s.z - at.z) ** 2 : Infinity;
			flock.put(b.coat, s.x, s.y, s.z, s.yaw, d2, () => clips[b.coat]?.[s.clip]?.(s.at, s.motion) ?? {});
		}
		flock.end();
	};
	update(0);
	return { object: flock.object, update, where: () => birds.map((b) => { const s = state(b, 0); return { x: s.x, z: s.z }; }) };
}
