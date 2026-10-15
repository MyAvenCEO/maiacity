/*
 * AN ASSET'S PARAMETERS — what its recipe is built with, declared by the recipe itself (a plant's stage and seed,
 * $lib/plants), so a world, a viewer or the asset box can name any build of it by one ref:
 *
 *   plants/apple@2?seed=maia&stage=9
 *
 * A recipe's arguments are its declared parameters in the order it declares them; one it is not given takes its
 * `value`. What a ref says is checked here against the declaration (a number in its range, a string no longer than it
 * may be, no parameter the recipe does not declare) before the recipe runs, in the page and in the box alike. The
 * values in a ref are text (`stage=9`); this turns them into what the recipe takes. An asset that declares none takes
 * none in its ref.
 */

/**
 * @typedef {{
 *   id: string, label: string, type: 'number' | 'integer' | 'string', value: number | string,
 *   min?: number, max?: number, step?: number, names?: string[], maxLength?: number
 * }} Param one parameter as a recipe declares it: `value` is what it takes when not given; `names` names the whole
 *   numbers of a range (a plant's stages)
 */
/** @typedef {Record<string, number | string>} Values */

/** how long a string parameter may be when its recipe does not say */
export const MAX_LENGTH = 80;
/** the shape of a parameter's id, the same as the card's keys */
export const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

/**
 * One parameter's value, checked: from the text of a ref or from a recipe's argument.
 * @param {Param} p @param {unknown} raw
 * @returns {number | string}
 */
function valueOf(p, raw) {
	if (p.type === 'string') {
		const s = String(raw);
		if (s.length > (p.maxLength ?? MAX_LENGTH)) throw new Error(`${p.id}: longer than ${p.maxLength ?? MAX_LENGTH}`);
		return s;
	}
	const x = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
	if (!Number.isFinite(x)) throw new Error(`${p.id}: not a number`);
	if (p.type === 'integer' && !Number.isInteger(x)) throw new Error(`${p.id}: not a whole number`);
	if ((p.min !== undefined && x < p.min) || (p.max !== undefined && x > p.max)) throw new Error(`${p.id}: ${x} is out of ${p.min ?? '…'}–${p.max ?? '…'}`);
	return x;
}

/**
 * Every declared parameter's value: from a ref's (`given`, its text), else from the recipe's arguments in their order
 * (`args`, as a page passes them), else its `value`. Throws for a parameter not declared and for a value out of shape.
 * @param {Param[]} params @param {Record<string, string>} [given] @param {unknown[]} [args]
 * @returns {Values}
 */
export function valuesOf(params, given = {}, args = []) {
	const known = new Set(params.map((p) => p.id));
	for (const k of Object.keys(given)) if (!known.has(k)) throw new Error(`no parameter ${k}${known.size ? ` (${[...known].join(', ')})` : ''}`);
	if (args.length > params.length) throw new Error(`${args.length} arguments for ${params.length} parameters`);
	/** @type {Values} */
	const out = {};
	params.forEach((p, i) => {
		const raw = Object.hasOwn(given, p.id) ? given[p.id] : args[i] !== undefined ? args[i] : p.value;
		out[p.id] = valueOf(p, raw);
	});
	return out;
}

/** A recipe's arguments, its parameters' values in their order. @param {Param[]} params @param {Values} values */
export const argsOf = (params, values) => params.map((p) => values[p.id]);

/**
 * The query of a ref: its parameters, sorted by id, as text (`seed=maia&stage=9`), so the same values always read the
 * same; empty for none.
 * @param {Record<string, unknown> | undefined} values
 */
export function queryOf(values) {
	if (!values) return '';
	const q = new URLSearchParams();
	for (const k of Object.keys(values).sort()) q.append(k, String(values[k]));
	return q.toString();
}

/**
 * The parameters a ref's query names, as text; undefined for none. Throws for an id out of shape or one named twice.
 * @param {string | undefined} query
 * @returns {Record<string, string> | undefined}
 */
export function paramsIn(query) {
	if (!query) return undefined;
	/** @type {Record<string, string>} */
	const out = {};
	for (const [k, v] of new URLSearchParams(query)) {
		if (!KEY.test(k)) throw new Error(`not a parameter: ${k.slice(0, 40)}`);
		if (Object.hasOwn(out, k)) throw new Error(`parameter ${k} named twice`);
		out[k] = v;
	}
	return Object.keys(out).length ? out : undefined;
}
