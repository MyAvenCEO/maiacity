/** Layout-owned dock. Actions can mount before its host; they never create a
 * second body overlay. Low order is nearest navigation. */
export const FOOT = { status: 0, waiting: 10, toast: 20, menu: 30 };
/** @type {HTMLElement | null} */
let stack = null;
/** @type {Set<HTMLElement>} */
const members = new Set();
/** @param {HTMLElement} node */
export function footHost(node) {
 stack = node;
 for (const member of members) node.append(member);
 return { destroy() { if (stack === node) stack = null; } };
}
/** @param {HTMLElement} node @param {number} [order] */
export function foot(node, order = FOOT.toast) {
 node.style.order = String(order);
 members.add(node);
 stack?.append(node);
 return {
  update(next = FOOT.toast) { node.style.order = String(next); },
  destroy() { members.delete(node); node.remove(); }
 };
}
