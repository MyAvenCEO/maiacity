/*
 * THE CHECKER — every piece of data an asset hands us is read through here before our code builds anything from it: a
 * card, and later each pack file's JSON. It reads the JSON Schema keywords our schemas use (./card.v1.json), nothing
 * more, and holds every value to these rules, whatever the schema says:
 *
 * - JSON only: no key that reaches an object's prototype (`__proto__`, `constructor`, `prototype`), no value that is
 *   not plain JSON (a function, a class instance, a number that is not finite);
 * - no way out: no string names a place to load from (`://`, `data:`, `blob:`, `javascript:`), except where the schema
 *   says `"format": "link"`, and there only an `https://` address or a path of our own site (`/app/buildings/`): text
 *   for a reader to follow, never loaded;
 * - bounded: at most LIMITS.depth deep and LIMITS.bytes long as text, so a card can't be made to cost what its schema
 *   would allow a thousand times over.
 *
 * avenDB judges its own entries (an asset's entry, ./asset.v1.json) with its own engine; this checker is for what an
 * asset carries in its files, which avenDB stores as bytes and never reads.
 */

/** what any value may cost, whatever its schema allows */
export const LIMITS = { depth: 12, bytes: 4_000_000 };

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const WAY_OUT = /:\/\/|^\s*(data|blob|javascript|file|about|ws|wss):/i;

/** @typedef {{ ok: true, value: any } | { ok: false, errors: string[] }} Verdict */

/**
 * A JSON text read and checked against `schema`.
 * @param {object} schema @param {string} text
 * @returns {Verdict}
 */
export function checkText(schema, text) {
	if (typeof text !== 'string') return { ok: false, errors: ['not JSON text'] };
	if (text.length > LIMITS.bytes) return { ok: false, errors: [`${text.length} bytes, more than ${LIMITS.bytes}`] };
	let value;
	try {
		value = JSON.parse(text);
	} catch (err) {
		return { ok: false, errors: [`not JSON: ${/** @type {Error} */ (err).message}`] };
	}
	return check(schema, value);
}

/**
 * A value checked against `schema`.
 * @param {object} schema @param {unknown} value
 * @returns {Verdict}
 */
export function check(schema, value) {
	/** @type {string[]} */
	const errors = [];
	const plain = plainJson(value, '', 0, errors);
	if (plain) {
		const size = JSON.stringify(value).length;
		if (size > LIMITS.bytes) errors.push(`${size} bytes, more than ${LIMITS.bytes}`);
		else walk(schema, schema, value, '', errors);
	}
	return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, value };
}

/**
 * Whether `v` is plain JSON within the depth, with no forbidden key; what is wrong goes to `errors`.
 * @param {unknown} v @param {string} at @param {number} depth @param {string[]} errors
 * @returns {boolean}
 */
function plainJson(v, at, depth, errors) {
	const no = (/** @type {string} */ why) => (errors.push(`${at || 'it'} ${why}`), false);
	if (depth > LIMITS.depth) return no(`is more than ${LIMITS.depth} deep`);
	if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
	if (typeof v === 'number') return Number.isFinite(v) || no('is not a finite number');
	if (Array.isArray(v)) return v.every((x, i) => plainJson(x, `${at}[${i}]`, depth + 1, errors));
	if (typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return no(`is not plain JSON (${typeof v})`);
	// a `__proto__` key JSON.parse made is an own key Object.keys lists; ask for it by name too
	if (Object.prototype.hasOwnProperty.call(v, '__proto__')) return no('has the key __proto__');
	for (const [k, x] of Object.entries(v)) {
		if (FORBIDDEN_KEYS.has(k)) return no(`has the key ${k}`);
		if (!plainJson(x, `${at}.${k}`, depth + 1, errors)) return false;
	}
	return true;
}

const typeOf = (/** @type {unknown} */ v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

/** the keywords our schemas use, checked; `root` resolves `$ref`s to its `$defs` */
function walk(/** @type {any} */ root, /** @type {any} */ s, /** @type {any} */ v, /** @type {string} */ at, /** @type {string[]} */ errors) {
	const here = at || 'it';
	if (s.$ref) {
		const m = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(s.$ref);
		const def = m && Object.prototype.hasOwnProperty.call(root.$defs ?? {}, m[1]) ? root.$defs[m[1]] : null;
		if (!def) return errors.push(`schema: no ${s.$ref}`);
		return walk(root, def, v, at, errors);
	}
	if (s.anyOf) {
		const ok = s.anyOf.some((/** @type {any} */ x) => walk(root, x, v, at, /** @type {string[]} */ ([])) === 0);
		return ok ? 0 : errors.push(`${here} fits none of its kinds`);
	}
	const before = errors.length;
	if ('const' in s && v !== s.const) errors.push(`${here} is not ${JSON.stringify(s.const)}`);
	if (s.enum && !s.enum.includes(v)) errors.push(`${here} is not one of ${s.enum.join(', ')}`);
	if (s.type) {
		const t = typeOf(v);
		if (!(t === s.type || (s.type === 'number' && t === 'integer'))) return errors.push(`${here} is ${t}, not ${s.type}`);
	}
	if (typeof v === 'string') {
		if (s.maxLength !== undefined && v.length > s.maxLength) errors.push(`${here} is longer than ${s.maxLength}`);
		if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${here} does not match ${s.pattern}`);
		if (s.format === 'link') {
			if (!/^(https:\/\/[^\s<>"'`]+|\/(?!\/)[^\s<>"'`:]*)$/.test(v) || v.includes('..')) errors.push(`${here} is not an https address or a path of ours`);
		} else if (WAY_OUT.test(v)) errors.push(`${here} names a place to load from`);
	}
	if (typeof v === 'number') {
		if (s.minimum !== undefined && v < s.minimum) errors.push(`${here} is below ${s.minimum}`);
		if (s.maximum !== undefined && v > s.maximum) errors.push(`${here} is above ${s.maximum}`);
	}
	if (Array.isArray(v)) {
		if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${here} has fewer than ${s.minItems} items`);
		if (s.maxItems !== undefined && v.length > s.maxItems) return errors.push(`${here} has more than ${s.maxItems} items`);
		v.forEach((x, i) => {
			const item = s.prefixItems ? s.prefixItems[i] : s.items;
			if (item) walk(root, item, x, `${at}[${i}]`, errors);
		});
	}
	if (v && typeof v === 'object' && !Array.isArray(v)) {
		const keys = Object.keys(v);
		if (s.maxProperties !== undefined && keys.length > s.maxProperties) return errors.push(`${here} has more than ${s.maxProperties} keys`);
		for (const r of s.required ?? []) if (!Object.prototype.hasOwnProperty.call(v, r)) errors.push(`${here} has no ${r}`);
		for (const k of keys) {
			const p = s.properties && Object.prototype.hasOwnProperty.call(s.properties, k) ? s.properties[k] : null;
			if (s.propertyNames) walk(root, s.propertyNames, k, `${at}.${k} (its name)`, errors);
			if (p) walk(root, p, v[k], `${at}.${k}`, errors);
			else if (s.additionalProperties === false) errors.push(`${here} has a key it may not have: ${k}`);
			else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(root, s.additionalProperties, v[k], `${at}.${k}`, errors);
		}
	}
	return errors.length - before;
}
