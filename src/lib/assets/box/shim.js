// @ts-nocheck — plain JS, runs inside the box first
/*
 * WHAT A BUILDER EXPECTS OF A PAGE, IN THE BOX — imported by the engine (./engine.js) before any recipe runs. Builders draw their
 * textures on a canvas (an OffscreenCanvas here), and a few modules they share with the worlds keep Svelte state
 * (`$state`), which in the box is a plain value.
 */
globalThis.$state ??= (x) => x;
globalThis.document ??= {
	createElement(tag) {
		if (tag !== 'canvas') throw new Error(`the box has no <${tag}>`);
		const c = new OffscreenCanvas(1, 1);
		c.style = {};
		return c;
	}
};
