// The actors, measured: every animal of src/lib/actors/casts.ts built and checked, not looked at — how long its
// skin takes, how many vertices it is near and far, that every vertex's weights add up, that every clip gives a pose,
// and that a foot set down walking stays where it was set down (how far it slides while on the ground).
//
//   bun scripts/actors.ts            every cast
//   bun scripts/actors.ts sheep goat the casts whose ids start so
import * as THREE from 'three';
import { CASTS } from '../src/lib/actors/casts';
import { lowDetail, type Cast } from '../src/lib/actors/rig';
import { FAR } from '../src/lib/actors/crowd';

/** the most vertices an animal may be near the eye, and from afar (one of a hundred in a draw call) */
const NEAR_MAX = 20000, FAR_MAX = 2500;
/** how far a foot may slide over one stance (m) */
const SLIP_MAX = 0.01;

const only = process.argv.slice(2);
const ids = Object.keys(CASTS).filter((id) => !only.length || only.some((o) => id.startsWith(o)));
let failed = 0;
const fail = (id: string, why: string) => {
	failed++;
	console.log(`  ✗ ${id}: ${why}`);
};

for (const id of ids) {
	const t0 = performance.now();
	const cast: Cast = CASTS[id]!();
	const ms = performance.now() - t0;
	const far = lowDetail(CASTS[id]!, FAR);
	const g = cast.rig.object.geometry;
	const verts = g.attributes.position!.count, farVerts = far.rig.object.geometry.attributes.position!.count;
	console.log(`${id}: ${ms.toFixed(0)} ms, ${verts} vertices near, ${farVerts} far`);
	if (verts > NEAR_MAX) fail(id, `${verts} vertices near (at most ${NEAR_MAX})`);
	if (farVerts > FAR_MAX) fail(id, `${farVerts} vertices far (at most ${FAR_MAX})`);
	// every vertex carried in full, by bones that are there
	const w = g.attributes.skinWeight!, si = g.attributes.skinIndex!, bones = cast.rig.names.length;
	for (let v = 0; v < w.count; v++) {
		const sum = w.getX(v) + w.getY(v) + w.getZ(v) + w.getW(v);
		if (Math.abs(sum - 1) > 1e-3 || [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)].some((b) => b >= bones)) {
			fail(id, `vertex ${v}: weights sum to ${sum.toFixed(3)}`);
			break;
		}
	}
	// every clip a pose of finite numbers, at any time
	for (const [name, clip] of Object.entries(cast.clips))
		for (const t of [0, 0.37, 1.9, 13.3]) {
			const pose = clip(t);
			if (Object.values(pose).some((v) => (v as number[]).some((x) => !Number.isFinite(x)))) fail(id, `${name} at ${t} s: not a number`);
		}
	// walking: each foot's joint, while it is on the ground, kept where it was put down
	const feet = cast.feet ?? [];
	for (const [gait, speed] of Object.entries(feet.length ? (cast.gears ?? {}) : {})) {
		cast.rig.pose({});
		cast.rig.object.updateMatrixWorld(true);
		const rest = Object.fromEntries(feet.map((f) => [f, new THREE.Vector3().setFromMatrixPosition(cast.rig.bones[f]!.matrixWorld).y]));
		let worst = 0, where = '';
		const down: Record<string, { from: THREE.Vector3; slid: number } | null> = {};
		for (let k = 0; k < 240; k++) {
			const t = 2 + k / 60, dist = speed * t;
			cast.rig.pose(cast.clips[gait]!(t, { dist, speed }));
			cast.rig.object.updateMatrixWorld(true);
			for (const f of feet) {
				const p = new THREE.Vector3().setFromMatrixPosition(cast.rig.bones[f]!.matrixWorld);
				p.z += dist;
				if (p.y < rest[f]! + 0.002) {
					const d = down[f];
					if (!d) down[f] = { from: p, slid: 0 };
					else {
						d.slid = Math.max(d.slid, Math.hypot(p.x - d.from.x, p.z - d.from.z));
						if (d.slid > worst) [worst, where] = [d.slid, f];
					}
				} else down[f] = null;
			}
		}
		console.log(`  ${gait} at ${speed} m/s: a foot slides at most ${(worst * 100).toFixed(2)} cm on the ground${where ? ` (${where})` : ''}`);
		if (worst > SLIP_MAX) fail(id, `${gait}: ${where} slides ${(worst * 100).toFixed(1)} cm`);
	}
}
console.log(failed ? `\n${failed} problems` : '\nall well');
process.exit(failed ? 1 : 0);
