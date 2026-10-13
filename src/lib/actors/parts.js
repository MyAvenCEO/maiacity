/*
 * A MACHINE'S PARTS — for an actor that is a machine taken apart: every piece of it its own part, picked on the
 * turntable one by one (/app/actors/), each with its card — what it is, what it does, how it moves and what drives
 * it, its numbers, and the build step it goes on at. The LifeTrac (./lifetrac.js) is built so.
 *
 * `machineKit` collects the parts as they are made: each part's pieces ride a bone of its own (`p.<id>`), hung from the
 * joint it moves with (a wheel, a loader arm, a cylinder's barrel), so a pose can draw it out of the machine and put
 * it back — the exploded view, and the machine assembled step by step, each part flying in at its step.
 */
import * as THREE from 'three';

/** @typedef {import('./rig').V3} V3 */
/** @typedef {import('./rig').Pose} Pose */
/** @typedef {import('./rig').Piece} Piece */
/** @typedef {import('./rig').BoneSpec} BoneSpec */

/**
 * @typedef {object} Assembly a group of parts that is built and works together (the frame, a wheel module, the power cube)
 * @property {string} id
 * @property {string} label
 * @property {string} note what it is and does, in a sentence or two
 * @property {V3} out which way it is drawn out of the machine in the exploded view (m)
 */
/**
 * @typedef {object} PartInfo one part's card
 * @property {string} id
 * @property {string} label
 * @property {string} assembly its assembly's id
 * @property {string} what what it is and what it is for
 * @property {string} [moves] how it moves (a part that does not move has none)
 * @property {string} [drive] what moves it, or what it drives
 * @property {[string, string][]} [specs] its numbers, as label and value
 * @property {number} [count] how many of it the machine has, where one card stands for several alike
 * @property {number} step the build step it goes on at (1 first)
 * @property {string} [source] where its numbers come from (a source's label in the catalog)
 */
/**
 * @typedef {object} Catalog a machine's parts: its assemblies, its parts' cards, its build steps and its sources
 * @property {Assembly[]} assemblies
 * @property {PartInfo[]} parts
 * @property {string[]} steps the build steps, in order: what each does
 * @property {{ label: string, url: string }[]} sources
 */

/**
 * A kit to build a machine of parts.
 * @param {Assembly[]} assemblies
 */
export function machineKit(assemblies) {
	/** @type {PartInfo[]} */
	const infos = [];
	/** @type {Map<string, { info: PartInfo, joint: string, pieces: { geo: THREE.BufferGeometry, color: string, mat?: number }[] }>} */
	const byId = new Map();
	const out = Object.fromEntries(assemblies.map((a) => [a.id, a.out]));

	return {
		/**
		 * A part: its card, the joint it moves with, and its pieces (made by `make`, through `put`).
		 * @param {Omit<PartInfo, 'step'> & { step: number }} info
		 * @param {string} joint
		 * @param {(put: (geo: THREE.BufferGeometry, color: string, mat?: number) => void) => void} make
		 */
		part(info, joint, make) {
			if (byId.has(info.id)) throw new Error(`part ${info.id} twice`);
			if (!(info.assembly in out)) throw new Error(`part ${info.id}: no assembly ${info.assembly}`);
			/** @type {{ geo: THREE.BufferGeometry, color: string, mat?: number }[]} */
			const pieces = [];
			make((geo, color, mat) => void pieces.push({ geo, color, ...(mat ? { mat } : {}) }));
			byId.set(info.id, { info, joint, pieces });
			infos.push(info);
		},
		/**
		 * The parts' bones (to go after the joints they hang from) and pieces, and how to pose them.
		 * @returns {{ bones: BoneSpec[], pieces: Piece[], catalogParts: PartInfo[], centre: Record<string, V3> }}
		 */
		build() {
			/** @type {BoneSpec[]} */
			const bones = [];
			/** @type {Piece[]} */
			const pieces = [];
			/** @type {Record<string, V3>} */
			const centre = {};
			const box = new THREE.Box3(), b = new THREE.Box3(), c = new THREE.Vector3();
			for (const [id, { joint, pieces: ps }] of byId) {
				box.makeEmpty();
				for (const p of ps) {
					p.geo.computeBoundingBox();
					box.union(b.copy(/** @type {THREE.Box3} */ (p.geo.boundingBox)));
				}
				const at = /** @type {V3} */ (box.getCenter(c).toArray());
				centre[id] = at;
				const bone = `p.${id}`;
				bones.push({ name: bone, parent: joint, at });
				for (const p of ps) pieces.push({ geo: p.geo, color: p.color, bone, part: id, ...(p.mat ? { mat: p.mat } : {}) });
			}
			return { bones, pieces, catalogParts: infos, centre };
		},
		/**
		 * Every part drawn out of the machine by `k` (0: in place, 1: the exploded view): its assembly's way out, and
		 * apart from the assembly's middle a little, so the parts of one assembly stand clear of each other too.
		 * @param {Record<string, V3>} centre @param {number} k @param {Pose} [into]
		 */
		explode(centre, k, into = {}) {
			/** @type {Record<string, THREE.Vector3>} */
			const mid = {};
			/** @type {Record<string, number>} */
			const n = {};
			for (const { info } of byId.values()) {
				const a = info.assembly;
				(mid[a] ??= new THREE.Vector3()).add(pc.set(...centre[info.id]));
				n[a] = (n[a] ?? 0) + 1;
			}
			for (const a in mid) mid[a].divideScalar(n[a]);
			for (const { info } of byId.values()) {
				const o = out[info.assembly], m = mid[info.assembly];
				const [x, y, z] = centre[info.id];
				into[`p.${info.id}`] = [0, 0, 0, 1, k * (o[0] + (x - m.x) * 0.45), k * (o[1] + (y - m.y) * 0.45), k * (o[2] + (z - m.z) * 0.45)];
			}
			return into;
		},
		/**
		 * The machine being built, `u` of the way (0…1) through its steps: the parts of each step fly in from above
		 * their place, one after another, and the parts of the steps to come are not there yet.
		 * @param {Record<string, V3>} centre @param {number} u @param {number} steps @param {Pose} [into]
		 */
		assemble(centre, u, steps, into = {}) {
			/** @type {Record<number, PartInfo[]>} */
			const per = {};
			for (const info of infos) (per[info.step] ??= []).push(info);
			for (const info of infos) {
				const list = per[info.step], i = list.indexOf(info);
				// a step's share of the time, its parts arriving across the first two thirds of it
				const s0 = (info.step - 1) / steps, s1 = info.step / steps;
				const t0 = s0 + ((s1 - s0) * 0.66 * i) / Math.max(1, list.length);
				const t1 = t0 + Math.min(0.03, (s1 - s0) * 0.5);
				const k = Math.min(1, Math.max(0, (u - t0) / (t1 - t0)));
				const e = k * k * (3 - 2 * k);
				const o = out[info.assembly];
				const far = 1 - e;
				into[`p.${info.id}`] = u < t0 ? [0, 0, 0, 0] : [0, 0, 0, 1, far * o[0] * 0.6, far * (1.6 + Math.abs(o[1])), far * o[2] * 0.6];
			}
			return into;
		}
	};
}

const pc = new THREE.Vector3();
/** a part's pieces' middle as posed now, found from the rig: where its bone is in the world @param {THREE.Bone} bone */
export const partAt = (bone) => bone.getWorldPosition(pc).clone();
