/**
 * THE RESOURCE LIBRARY: every base resource of the game (./resources.js), in its groups, drawn from its pixels
 * (./pixels.js): a block as a cube seen from above, an item flat. A search and the group chips narrow it; a card opens
 * the resource beside the list, and its id goes in the address after #, so a link opens it too.
 */
import { GROUPS, RESOURCES, TOOLS, resourceOf } from './resources.js';
import { SIZE, tilesOf } from './pixels.js';

/** @typedef {import('./resources.js').Resource} Resource */

/**
 * @param {string} tag @param {Record<string, any>} [attrs] @param {...any} children
 * @returns {HTMLElement}
 */
function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === false || value == null) continue;
		if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
		else if (key === 'class') el.className = value;
		else if (key === 'style') el.style.cssText = value;
		else el.setAttribute(key, value === true ? '' : String(value));
	}
	el.append(...children.flat().filter((c) => c != null && c !== false));
	return el;
}

/** a tile on a canvas of its own, 16 × 16 @param {(string | null)[]} pixels */
function tileCanvas(pixels) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = SIZE;
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
	const image = ctx.createImageData(SIZE, SIZE);
	pixels.forEach((c, i) => {
		if (!c) return;
		image.data.set([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255], i * 4);
	});
	ctx.putImageData(image, 0, 0);
	return canvas;
}

/** @type {Map<string, Record<string, HTMLCanvasElement>>} each resource's tiles, painted once */
const painted = new Map();
/** @param {Resource} resource */
function tiles(resource) {
	let found = painted.get(resource.id);
	if (!found) {
		found = Object.fromEntries(Object.entries(tilesOf(resource)).map(([face, pixels]) => [face, tileCanvas(pixels)]));
		painted.set(resource.id, found);
	}
	return found;
}

/**
 * One face of a cube: the tile mapped onto it by `m` (a canvas transform from tile pixels), darkened by `dark` for the
 * faces turned from the light. Drawn a hair larger than the tile, so no seam shows between the faces.
 * @param {CanvasRenderingContext2D} ctx @param {HTMLCanvasElement} tile @param {number[]} m @param {number} dark
 */
function face(ctx, tile, m, dark) {
	ctx.save();
	ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
	ctx.drawImage(tile, 0, 0, SIZE, SIZE, -0.04, -0.04, SIZE + 0.08, SIZE + 0.08);
	if (dark) {
		ctx.fillStyle = `rgba(0, 0, 0, ${dark})`;
		ctx.fillRect(-0.04, -0.04, SIZE + 0.08, SIZE + 0.08);
	}
	ctx.restore();
}

/** draws a resource on a canvas `size` CSS pixels square @param {HTMLCanvasElement} canvas @param {Resource} resource @param {number} size */
function draw(canvas, resource, size) {
	const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
	const w = Math.round(size * ratio);
	canvas.width = canvas.height = w;
	canvas.style.width = canvas.style.height = `${size}px`;
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
	ctx.imageSmoothingEnabled = false;
	const t = tiles(resource);
	if (t.item) {
		// whole screen pixels per art pixel, so every pixel of the item stays square and sharp
		const scale = Math.max(1, Math.floor((w * 0.8) / SIZE)), side = scale * SIZE, at = Math.round((w - side) / 2);
		ctx.drawImage(t.item, at, at, side, side);
		return;
	}
	// a cube in the 2:1 view: the top a diamond twice as wide as high, the sides a little taller than that
	const a = w * 0.42, height = a * 1.12, cx = w / 2, y0 = (w - a - height) / 2, u = a / SIZE;
	ctx.globalAlpha = resource.alpha ?? 1;
	face(ctx, t.side, [u, u / 2, 0, height / SIZE, cx - a, y0 + a / 2], 0.16);
	face(ctx, t.side, [u, -u / 2, 0, height / SIZE, cx, y0 + a], 0.34);
	face(ctx, t.top, [u, u / 2, -u, u / 2, cx, y0], 0);
}

/** @param {Resource} resource @param {number} size */
function icon(resource, size) {
	const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'icon', 'aria-hidden': 'true' }));
	draw(canvas, resource, size);
	return canvas;
}

const number = new Intl.NumberFormat('en');
const groupOf = (/** @type {string} */ id) => /** @type {import('./resources.js').Group} */ (GROUPS.find((g) => g.id === id));
/** what a search looks through @param {Resource} r */
const searchable = (r) => [r.name, r.id, r.found, r.note, r.mineral ?? '', r.yields ?? '', groupOf(r.group).name].join(' ').toLowerCase();

const state = { group: 'all', query: '' };
/** @type {{ el: HTMLElement, count: HTMLElement, cards: { el: HTMLElement, resource: Resource, text: string }[] }[]} */
const sections = [];

const main = /** @type {HTMLElement} */ (document.querySelector('#library'));
const chips = /** @type {HTMLElement} */ (document.querySelector('#groups'));
const search = /** @type {HTMLInputElement} */ (document.querySelector('#search'));
const tally = /** @type {HTMLElement} */ (document.querySelector('#tally'));
const detail = /** @type {HTMLElement} */ (document.querySelector('#detail'));
const scrim = /** @type {HTMLElement} */ (document.querySelector('#scrim'));

function build() {
	document.querySelector('#needs-server')?.remove();
	/** @type {HTMLElement} */ (document.querySelector('#lede')).textContent =
		`Everything the world gives before anything is made from it: ${RESOURCES.length} base resources in ${GROUPS.length} groups, each drawn by code at 16 × 16 pixels.`;

	chips.append(
		h('button', { class: 'chip', 'data-group': 'all', onclick: () => choose('all') }, 'All', h('span', { class: 'n' }, RESOURCES.length)),
		...GROUPS.map((g) =>
			h('button', { class: 'chip', 'data-group': g.id, style: `--group: ${g.colour}`, onclick: () => choose(g.id) },
				h('span', { class: 'dot' }), g.name, h('span', { class: 'n' }, RESOURCES.filter((r) => r.group === g.id).length))
		)
	);

	for (const g of GROUPS) {
		const members = RESOURCES.filter((r) => r.group === g.id);
		const count = h('span', { class: 'n' }, members.length);
		const cards = members.map((resource) => ({
			resource,
			text: searchable(resource),
			el: h('button', { class: 'card', 'data-id': resource.id, style: `--group: ${g.colour}`, onclick: () => open(resource.id) },
				h('span', { class: 'stage' }, icon(resource, 72)),
				h('span', { class: 'name' }, resource.name),
				h('span', { class: 'kind' }, resource.form === 'block' ? 'Block' : 'Item'))
		}));
		const el = h('section', { class: 'group', 'aria-labelledby': `group-${g.id}`, style: `--group: ${g.colour}` },
			h('header', {},
				h('h2', { id: `group-${g.id}` }, h('span', { class: 'dot' }), g.name, count),
				h('p', {}, g.note)),
			h('div', { class: 'grid' }, cards.map((c) => c.el)));
		sections.push({ el, count, cards });
		main.append(el);
	}
	main.append(h('p', { class: 'empty', id: 'empty', hidden: true }, 'Nothing matches that. Try another word, or All.'));

	search.addEventListener('input', () => {
		state.query = search.value;
		apply();
	});
	scrim.addEventListener('click', close);
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !detail.hidden) close();
		if (event.key === '/' && document.activeElement !== search) {
			event.preventDefault();
			search.focus();
		}
	});
	window.addEventListener('hashchange', fromAddress);
	apply();
	fromAddress();
}

/** @param {string} group */
function choose(group) {
	state.group = group;
	apply();
}

function apply() {
	const query = state.query.trim().toLowerCase();
	let shown = 0;
	for (const section of sections) {
		let n = 0;
		for (const card of section.cards) {
			const hit = (state.group === 'all' || card.resource.group === state.group) && (!query || card.text.includes(query));
			card.el.hidden = !hit;
			if (hit) n++;
		}
		section.el.hidden = n === 0;
		section.count.textContent = String(n);
		shown += n;
	}
	for (const chip of chips.children) chip.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (chip).dataset.group === state.group));
	tally.textContent = shown === RESOURCES.length ? `${shown} resources` : `${shown} of ${RESOURCES.length}`;
	/** @type {HTMLElement} */ (document.querySelector('#empty')).hidden = shown > 0;
}

/** @param {string} label @param {any} value */
const fact = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : []);

/** @param {string} id */
function open(id) {
	const r = resourceOf(id);
	if (!r) return close();
	const g = groupOf(r.group);
	const t = tilesOf(r);
	const flat = Object.entries(t).map(([name, pixels]) => {
		const canvas = tileCanvas(pixels);
		canvas.className = 'tile';
		return h('figure', {}, canvas, h('figcaption', {}, name === 'item' ? 'Item' : name === 'top' ? 'Top' : 'Side'));
	});
	const weight = r.group === 'ore'
		? null
		: r.density && `≈ ${number.format(r.density)} kg a block (1 m³)`;
	detail.replaceChildren(
		h('button', { class: 'close', 'aria-label': 'Close', onclick: close }, '×'),
		h('div', { class: 'hero', style: `--group: ${g.colour}` }, icon(r, 168)),
		h('p', { class: 'eyebrow', style: `--group: ${g.colour}` }, h('span', { class: 'dot' }), g.name, ' · ', r.form === 'block' ? 'Block' : 'Item'),
		h('h2', { id: 'detail-title' }, r.name),
		h('p', { class: 'note' }, r.note),
		h('dl', {},
			fact('Found', r.found),
			fact('Gathered', r.tool ? TOOLS[/** @type {keyof typeof TOOLS} */ (r.tool)] : 'From the animal'),
			fact('Weight', weight),
			fact('Mineral', r.mineral && `${r.mineral} · ${number.format(/** @type {number} */ (r.density))} kg/m³`),
			fact('Yields', r.yields)),
		h('div', { class: 'tiles' }, h('p', {}, 'Drawn at 16 × 16'), h('div', {}, flat))
	);
	detail.setAttribute('aria-labelledby', 'detail-title');
	detail.hidden = false;
	scrim.hidden = false;
	document.body.classList.add('open');
	for (const section of sections)
		for (const card of section.cards) card.el.toggleAttribute('aria-current', card.resource.id === id);
	if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
	/** @type {HTMLElement} */ (detail.querySelector('.close')).focus({ preventScroll: true });
}

function close() {
	const was = location.hash.slice(1);
	detail.hidden = true;
	scrim.hidden = true;
	document.body.classList.remove('open');
	if (location.hash) history.replaceState(null, '', location.pathname + location.search);
	const card = /** @type {HTMLElement | null} */ (main.querySelector(`[data-id="${CSS.escape(was)}"]`));
	card?.removeAttribute('aria-current');
	card?.focus({ preventScroll: true });
}

function fromAddress() {
	const id = decodeURIComponent(location.hash.slice(1));
	if (id && resourceOf(id)) open(id);
	else if (!detail.hidden) close();
}

build();
