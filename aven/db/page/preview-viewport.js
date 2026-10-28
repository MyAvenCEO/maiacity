// @ts-nocheck — plain JS
/** One observer for a mounted row. Updating its world record keeps its visibility and ownership; the caller
 * synchronizes the current preview inside untrack so publication cannot subscribe this action to its own URLs. */
export function previewViewport(node, initial, changed, Observer = globalThis.IntersectionObserver) {
	let value = initial, showing = !Observer, alive = true;
	const publish = () => changed(value, showing, !!Observer);
	const observer = Observer && new Observer(([entry]) => {
		if (!alive || !entry) return;
		showing = entry.isIntersecting;
		publish();
	});
	if (observer) observer.observe(node); else publish();
	return {
		update(next) { if (alive) { value = next; publish(); } },
		destroy() {
			if (!alive) return;
			alive = false; showing = false; observer?.disconnect(); publish();
		}
	};
}
