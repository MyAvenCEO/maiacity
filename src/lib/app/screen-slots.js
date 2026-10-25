/** Screen chrome belongs to the app layout, not to individual worlds.
 * Actions register real nodes (and their handlers); the layout owns placement.
 * Pending registrations and host teardown are safe during client navigation. */
const hosts = new Map();
const members = new Map();

/** @param {HTMLElement} node @param {string} name */
export function screenHost(node, name) {
 hosts.set(name, node);
 for (const [member, entry] of members) if (entry.name === name) node.append(member);
 return { destroy() {
  if (hosts.get(name) !== node) return;
  hosts.delete(name);
  for (const [member, entry] of members) if (entry.name === name) entry.anchor.after(member);
 } };
}

/** @param {HTMLElement} node @param {string} name */
export function screenSlot(node, name) {
 const anchor = document.createComment('screen slot');
 node.before(anchor);
 const entry = {name, anchor};
 members.set(node, entry);
 const place = () => {
  node.dataset.screenSlot = entry.name;
  const host = hosts.get(entry.name);
  if (host) host.append(node); else anchor.after(node);
 };
 place();
 return {
  update(/** @type {string} */ next) { entry.name = next; place(); },
  destroy() { members.delete(node); node.remove(); anchor.remove(); }
 };
}

/** Publish the actual occupied height, including wrapped controls on small screens. @param {HTMLElement} node */
export function screenSize(node) {
 const root = document.documentElement;
 const measure = () => root.style.setProperty('--screen-head-room', `${Math.ceil(node.getBoundingClientRect().bottom + 8)}px`);
 const observer = new ResizeObserver(measure);
 observer.observe(node); measure();
 return { destroy() { observer.disconnect(); root.style.removeProperty('--screen-head-room'); } };
}
