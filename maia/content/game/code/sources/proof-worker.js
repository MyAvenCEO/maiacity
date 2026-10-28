/** One public-proof verifier, released after a burst so its separate WASM heap
 * does not live beside the personal device forever. Verification stays unchanged.
 * @param {() => Worker} create
 * @param {{idle?:number, later?:typeof setTimeout, cancel?:typeof clearTimeout}} [options]
 */
export function proofWorker(create, { idle = 1000, later = setTimeout, cancel = clearTimeout } = {}) {
	/** @type {Worker | null} */
	let worker = null;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	let next = 0;
	/** @type {Map<number, {resolve:(rows:string)=>void,reject:(why:Error)=>void}>} */
	const waiting = new Map();
	const stopTimer = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
	const rest = (/** @type {Worker} */ owner) => {
		if (waiting.size || worker !== owner) return;
		stopTimer();
		timer = later(() => {
			if (worker !== owner || waiting.size) return;
			timer = undefined; worker = null; owner.terminate();
		}, idle);
	};
	const start = () => {
		if (worker) return worker;
		const owner = create(); worker = owner;
		owner.onmessage = ({ data: { id, rows, error } }) => {
			if (worker !== owner) return;
			const call = waiting.get(id);
			if (!call) return;
			waiting.delete(id);
			if (error == null) call.resolve(rows); else call.reject(new Error(error));
			rest(owner);
		};
		const failed = (/** @type {string} */ why) => {
			if (worker !== owner) return;
			stopTimer(); worker = null; owner.terminate();
			for (const call of waiting.values()) call.reject(new Error(why));
			waiting.clear();
		};
		owner.onerror = (event) => { event.preventDefault?.(); failed(event.message || 'the proof worker failed'); };
		owner.onmessageerror = () => failed('the proof worker answer could not be read');
		return owner;
	};
	return (/** @type {Uint8Array} */ bytes, /** @type {string} */ vault, /** @type {string} */ kinds) => {
		stopTimer();
		return new Promise((resolve, reject) => {
			const owner = start();
			const id = ++next;
			waiting.set(id, { resolve, reject });
			try { owner.postMessage({ id, bytes, vault, kinds }, [bytes.buffer]); }
			catch (error) {
				waiting.delete(id); reject(error); rest(owner);
			}
		});
	};
}
