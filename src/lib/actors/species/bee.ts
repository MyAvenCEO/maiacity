/*
 * THE BEE — a honeybee worker (Apis mellifera), 1.5 cm: the head with its big compound eyes and elbowed antennae, the
 * furry thorax, the waist, the striped abdomen; six legs, the hind pair carrying pollen in their baskets; two pairs of
 * glass wings, beaten in a figure of eight — forward and back, each wing turned over at the end of every stroke.
 *
 * (A bee's wings beat some 230 times a second, far faster than a frame; they are drawn beating slowly enough to see,
 * as an eye sees the blur of them.)
 */
import * as THREE from 'three';
import { egg, limb, rig, spike, type BoneSpec, type Cast, type Clip, type PartSpec, type V3 } from '../rig';
import { sculpt, mix, ramp, type Surface } from '../sculpt';
import { animalMaterials } from '../features';
import { fbm3, wander } from '../noise';

export function bee(): Cast {
	const bones: BoneSpec[] = [
		{ name: 'thorax', at: [0, 0.012, 0] },
		{ name: 'head', parent: 'thorax', at: [0, 0.0125, 0.0032] },
		{ name: 'abdomen', parent: 'thorax', at: [0, 0.0115, -0.0028] },
		{ name: 'wingL', parent: 'thorax', at: [0.0013, 0.0146, 0.0006] },
		{ name: 'wingR', parent: 'thorax', at: [-0.0013, 0.0146, 0.0006] }
	];
	const s = sculpt(bones);
	s.egg([0, 0.012, 0.0], [0.0026, 0.0027, 0.0031], { bone: 'thorax', tag: 'thorax', bump: 0.00015, lumps: 0.0004 });
	s.egg([0, 0.0122, 0.0044], [0.0019, 0.0021, 0.0014], { bone: 'head', k: 0.0006, tag: 'head' });
	s.ball([0, 0.0116, -0.0028], 0.0007, { bone: 'abdomen', k: 0.0004, tag: 'waist' });
	s.egg([0, 0.0111, -0.0062], [0.0027, 0.0025, 0.0044], { bone: 'abdomen', k: 0.0006, tag: 'abdomen' }, [0.18, 0, 0]);
	const gold = new THREE.Color('#d9a23a'), black = new THREE.Color('#231c14'), fuzz = new THREE.Color('#b58a4a');
	const paint = (c: THREE.Color, at: Surface) => {
		const { p } = at;
		if (at.main === 'abdomen') {
			// bands of gold and black, the gold furred at its front edge
			const band = Math.floor((-p.z - 0.0034) / 0.00115);
			c.copy(band % 2 === 0 && band < 5 ? gold : black);
		} else if (at.main === 'thorax') c.copy(fuzz).multiplyScalar(0.85 + 0.3 * fbm3(p.x * 4000, p.y * 4000, p.z * 4000, 2, 3));
		else c.copy(black);
		mix(c, black, ramp(at.tag('waist'), 0.3, 0.6));
	};
	const skin = s.skin(0.00028, paint, 'bee');

	const parts: PartSpec[] = [{ skin }];
	for (const [side, x] of [['L', 1], ['R', -1]] as const) {
		// the compound eyes, the antennae elbowed forward
		parts.push({ geo: egg([x * 0.00135, 0.0127, 0.0045], [0.0007, 0.0012, 0.0008], [0, x * 0.3, 0]), color: '#14100c', bone: 'head', mat: 1 });
		const knee: V3 = [x * 0.0007, 0.0152, 0.0062];
		parts.push({ geo: limb([x * 0.0005, 0.0131, 0.0056], knee, 0.00013, 0.00012, { seg: 5 }), color: '#231c14', bone: 'head' });
		parts.push({ geo: limb(knee, [x * 0.0011, 0.0149, 0.0083], 0.00012, 0.00011, { seg: 5 }), color: '#231c14', bone: 'head' });
		// the wings: the fore pair and the smaller hind pair, glass
		parts.push({ geo: egg([x * 0.0047, 0.0149, -0.0012], [0.0035, 0.00025, 0.0013], [0, x * 0.32, 0]), color: '#ffffff', bone: `wing${side}`, mat: 2 });
		parts.push({ geo: egg([x * 0.0035, 0.0146, -0.0029], [0.0022, 0.0002, 0.0009], [0, x * 0.55, 0]), color: '#ffffff', bone: `wing${side}`, mat: 2 });
		// six legs in three joints each, hanging; the hind pair with their baskets of pollen
		[0.0013, 0.0001, -0.0012].forEach((z, i) => {
			const hip: V3 = [x * 0.0012, 0.0101, z];
			const knee2: V3 = [x * (0.0032 + i * 0.0005), 0.0092 - i * 0.0003, z + 0.0004 - i * 0.0006];
			const foot: V3 = [x * (0.0036 + i * 0.0006), 0.0062 - i * 0.0004, z - 0.0006 - i * 0.0008];
			parts.push({ geo: limb(hip, knee2, 0.00022, 0.00018, { seg: 5 }), color: '#231c14', bone: 'thorax' });
			parts.push({ geo: limb(knee2, foot, 0.00017, 0.00012, { seg: 5 }), color: '#231c14', bone: 'thorax' });
			if (i === 2) parts.push({ geo: egg([knee2[0] * 1.02, (knee2[1] + foot[1]) / 2, (knee2[2] + foot[2]) / 2], [0.0005, 0.0008, 0.0005]), color: '#e8b03a', bone: 'thorax' });
		});
	}
	parts.push({ geo: spike([0, 0.0106, -0.0104], [0, -0.2, -1], 0.0003, 0.001, { seg: 6 }), color: '#231c14', bone: 'abdomen' });
	const glass = new THREE.MeshPhysicalMaterial({ color: '#f4f8ff', roughness: 0.12, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, iridescence: 0.6 });
	const r = rig(bones, parts, [...animalMaterials(0.75), glass]);
	r.object.name = 'bee';
	// the figure of eight: each wing swept forward and back, turned over at either end of the stroke
	const beat = (t: number) => {
		const w = t * 70;
		return { stroke: Math.sin(w), turn: Math.cos(w) };
	};
	const wings = (t: number) => {
		const { stroke, turn } = beat(t);
		return { wingL: [0.45 * turn, 0.55 * stroke, 0.35 + 0.25 * stroke] as V3, wingR: [0.45 * turn, -0.55 * stroke, -0.35 - 0.25 * stroke] as V3 };
	};
	const hover: Clip = (t) => ({ ...wings(t), root: [0.0008 * Math.sin(t * 1.3), 0.0015 * Math.sin(t * 5), 0], thorax: [0.1 + 0.05 * Math.sin(t * 2), 0.25 * wander(t, 1.2, 5), 0], abdomen: [0.12 * Math.sin(t * 4), 0, 0], head: [0, 0.15 * wander(t, 0.9, 8), 0] });
	const fly: Clip = (t) => ({ ...hover(t), thorax: [0.45, 0, 0.15 * Math.sin(t * 1.5)], abdomen: [-0.2 + 0.05 * Math.sin(t * 4), 0, 0] });
	return { rig: r, clips: { hover, fly }, first: 'hover' };
}
