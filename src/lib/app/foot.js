/*
 * ONE PLACE FOR WHAT THE APP TELLS IN PASSING (Samuel 2026-10-22: "all the messages toasts here don't overlay … in the
 * bottom above the navpill"): every toast, status pill and waiting note of any page sits in one stack, centred just
 * above the nav pill (--nav-room, src/app.css), one above the other, so none covers another. An element joins it with
 * `use:foot` (or `use:foot={order}`): it is moved into the stack and leaves with its own transition as before. Lower
 * `order` sits nearer the nav pill; the stack's look is `.foot-stack` in src/app.css. A moved element is no longer
 * among its component's own nodes, so the action removes it itself once its block has gone (after any outro).
 */

/** where the stack's members sit, from the nav pill up */
export const FOOT = { status: 0, waiting: 10, toast: 20 };

/** @type {HTMLElement | null} */
let stack = null;

function host() {
	if (stack?.isConnected) return stack;
	stack = document.createElement('div');
	stack.className = 'foot-stack';
	document.body.append(stack);
	return stack;
}

/**
 * Svelte action: moves `node` into the app's foot stack.
 * @param {HTMLElement} node
 * @param {number} [order]
 */
export function foot(node, order = FOOT.toast) {
	node.style.order = String(order);
	host().append(node);
	return {
		/** @param {number} [next] */
		update(next = FOOT.toast) {
			node.style.order = String(next);
		},
		destroy() {
			node.remove();
		}
	};
}
