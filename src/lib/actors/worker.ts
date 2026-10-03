/*
 * The worker that meshes actors' skins (./build.ts): it builds the actor asked for, and sends back every skin that took.
 */
import { CASTS } from './casts';
import { lowDetail } from './rig';
import { fresh } from './sculpt';
import { packed } from './build';

self.onmessage = (e: MessageEvent<{ call: number; id: string; detail: number }>) => {
	const { call, id, detail } = e.data;
	const make = CASTS[id];
	try {
		if (make) detail < 1 ? lowDetail(make, detail) : make();
	} catch (err) {
		console.error(`actors: ${id} would not build`, err);
	}
	const out = fresh().map(([key, skin]) => packed(key, skin));
	(self as unknown as Worker).postMessage({ call, skins: out.map(([s]) => s) }, out.flatMap(([, t]) => t));
};
