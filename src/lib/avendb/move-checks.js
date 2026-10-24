/** Rechecks key migration without retaining a timer or an async result from a previous device.
 * @param {{current: () => any, ask: (device: any) => Promise<any>, show: (asked: any) => void,
 * move: () => Promise<any>, warn: (error: any) => void, later?: typeof setTimeout,
 * cancel?: typeof clearTimeout, retry?: number, idle?: number}} options */
export function createMoveChecks({
	current, ask, show, move, warn,
	later = setTimeout, cancel = clearTimeout,
	retry = 30000, idle = 180000
}) {
	let generation = 0;
	let timer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
	const stop = () => {
		generation += 1;
		if (timer !== undefined) cancel(timer);
		timer = undefined;
	};
	/** @param {any} device @param {boolean} [again] */
	const check = async (device, again = false) => {
		if (!device || current() !== device) return;
		stop();
		const turn = generation;
		const live = () => generation === turn && current() === device;
		if (!device || !live()) return;
		/** @param {number} delay @param {boolean} keep */
		const schedule = (delay, keep) => {
			if (!live()) return;
			timer = later(() => {
				timer = undefined;
				if (live()) void check(device, keep);
			}, delay);
		};
		if (!again) show(null);
		try {
			const asked = (await ask(device)) ?? null;
			if (!live()) return;
			show(asked);
			if (asked?.behind) schedule(retry, true);
			else if (asked && !asked.passkey && !asked.touch) await move();
			// A no-work probe is only of today's local history. New grants, devices or next keys can arrive later.
			else if (!asked) schedule(idle, true);
		} catch (error) {
			if (!live()) return;
			warn(error);
			schedule(retry, false);
		}
	};
	return { check, stop };
}
