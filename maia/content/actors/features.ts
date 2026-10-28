/*
 * FEATURES — the small, crisp things a face and a foot are known by, too fine for the sculpted skin: eyes with their
 * pupils (round, a goat's and a sheep's bar, a cat's slit), hooves, claws. Each a plain part riding its bone (./rig.ts).
 * Wrong eyes kill a face faster than anything: their size and where they sit are measured, and their pupils shaped as
 * the animal's are.
 */
import * as THREE from 'three';
import { egg, type PartSpec, type V3 } from './rig';

export type Pupil = 'round' | 'bar' | 'slit';

/** the materials an animal is drawn in: 0 its skin (the colours in its vertices), 1 its eyes, wet and glossy */
export const animalMaterials = (roughness = 0.85, more: THREE.MeshStandardMaterialParameters = {}): THREE.Material[] => [
	new THREE.MeshStandardMaterial({ vertexColors: true, roughness, ...more }),
	new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 })
];

/**
 * An eye: a ball `r` across at `at`, looking along `dir`, its iris (`iris`, `irisR` of the ball's radius across) round a
 * pupil of its shape. `rim`: the dark skin round the edge of what shows.
 */
export function eye(at: V3, r: number, dir: V3, iris: string, pupil: Pupil, bone: string, { irisR = 0.62, pupilR = 0.45, rim = '#1d1713' }: { irisR?: number; pupilR?: number; rim?: string } = {}): PartSpec {
	const z = new THREE.Vector3(...dir).normalize();
	const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
	if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
	const y = z.clone().cross(x).normalize();
	const c = new THREE.Vector3(...at);
	const ir = new THREE.Color(iris), dark = new THREE.Color('#0b0907'), edge = new THREE.Color(rim);
	const v = new THREE.Vector3();
	return {
		geo: egg(at, [r, r, r], [0, 0, 0], [22, 16]),
		color: (p) => {
			v.copy(p).sub(c).divideScalar(r);
			const fx = v.dot(x), fy = v.dot(y), fz = v.dot(z);
			if (fz < Math.cos(Math.asin(irisR))) return `#${edge.getHexString()}`;
			const u = fx / irisR, w = fy / irisR;
			const inPupil = pupil === 'round' ? u * u + w * w < pupilR * pupilR : pupil === 'bar' ? (u / (pupilR * 1.35)) ** 2 + (w / (pupilR * 0.42)) ** 2 < 1 : (u / (pupilR * 0.35)) ** 2 + (w / (pupilR * 1.4)) ** 2 < 1;
			if (inPupil) return `#${dark.getHexString()}`;
			// the iris darker toward its rim
			const k = Math.min(1, Math.hypot(u, w));
			return `#${ir.clone().multiplyScalar(1.1 - 0.45 * k * k).getHexString()}`;
		},
		bone,
		mat: 1
	};
}

/** both eyes, the left at `at` looking along `dir` (the right its mirror) */
export function eyes(at: V3, r: number, dir: V3, iris: string, pupil: Pupil, bone = 'head', o?: Parameters<typeof eye>[6]): PartSpec[] {
	return [eye(at, r, dir, iris, pupil, bone, o), eye([-at[0], at[1], at[2]], r, [-dir[0], dir[1], dir[2]], iris, pupil, bone, o)];
}
