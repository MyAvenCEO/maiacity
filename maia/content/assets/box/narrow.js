// @ts-nocheck — plain JS, run by Vite in Node
/*
 * ONE ASSET'S OWN CODE — what makes a recipe library of one asset (./plugin.js): a rolldown plugin that reads each
 * module of ours as it is bundled and leaves in it only what that asset needs, so tree shaking takes out every other
 * asset's builder and its recipe's hash moves only with its own code. The group's lists stay as they are written; only
 * the copy bundled is narrowed. In a module it narrows:
 *
 * - an asset list: an array at the top of the module (outside any function or object) whose items are each one of the
 *   group's assets, its `id` written out and a `label` beside it, or that is made of such lists spread into it, here or
 *   in another module (`[...ALL, ...WALD, ...FIELDS]`). Every item but the asset's is dropped, and every list spread in
 *   that does not hold it. A part catalog, a stages list or a kind's variants is never one: its ids are not the
 *   group's, or it sits inside an item.
 * - a history: an object at the top of the module whose keys are the group's assets, each an array of versions
 *   (`HISTORY`). Every other asset's entry is dropped, and the frozen builders it named with it.
 * - the imports only those read: dropped, so the modules of the other assets are not even loaded.
 *
 * And every declaration at the top of a module of ours that runs code (`export const mango = orchard({…})`) is marked
 * free of side effects, so it is left out when nothing reads it: in a file of many assets, the asset's own is kept and
 * the others go. Each module is read once for as long as its code stays the same (`surveyOf`).
 *
 * So an asset composes others by their builders (or by ref), never by reading its group's list as it is built: in its
 * own library the list holds only itself. ./plugin.js checks each library lists the recipes the group's whole library
 * lists of it, each with the same meta; the box's lab builds every one against the page.
 */
import { readFileSync, statSync } from 'node:fs';
import MagicString from 'magic-string';
import { parseAst } from 'rolldown/parseAst';

/** a module of code (a JSON file or a picture is bundled as it is) */
const SCRIPT = /\.(m?js|ts)$/;

/** what can stand round an expression without changing it: parentheses, a type cast */
const WRAPS = new Set(['ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression']);
const bare = (n) => {
	while (n && WRAPS.has(n.type)) n = n.expression;
	return n;
};
/** code that is not run where it is written */
const FUNCTIONS = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration', 'ClassExpression', 'ClassDeclaration']);
/** expressions that may do something besides making their value (and `delete`) */
const ACTIVE = new Set(['CallExpression', 'NewExpression', 'MemberExpression', 'SpreadElement', 'TaggedTemplateExpression', 'AssignmentExpression', 'UpdateExpression', 'ChainExpression', 'ImportExpression']);

/** each node directly under `node` */
function* under(node) {
	for (const k in node) {
		if (k === 'type' || k === 'start' || k === 'end') continue;
		const v = node[k];
		if (Array.isArray(v)) {
			for (const x of v) if (x && typeof x.type === 'string') yield x;
		} else if (v && typeof v.type === 'string') yield v;
	}
}

/** the name a property is written under, if it is written out */
const keyOf = (p) => (p.type !== 'Property' || p.computed ? undefined : p.key.type === 'Identifier' ? p.key.name : typeof p.key.value === 'string' ? p.key.value : undefined);
/** a string written out */
const textOf = (n) => (n?.type === 'Literal' && typeof n.value === 'string' ? n.value : n?.type === 'TemplateLiteral' && !n.expressions.length ? n.quasis[0].value.cooked : undefined);

/** an array that may be an asset list: each element an item with its id and label, or a list spread in by its name */
function listOf(node) {
	const elements = [];
	for (const e of node.elements) {
		if (e?.type === 'ObjectExpression') {
			const id = textOf(e.properties.find((p) => keyOf(p) === 'id')?.value);
			if (id === undefined || !e.properties.some((p) => keyOf(p) === 'label')) return null;
			elements.push({ start: e.start, end: e.end, id });
		} else if (e?.type === 'SpreadElement' && e.argument.type === 'Identifier') elements.push({ start: e.start, end: e.end, name: e.argument.name });
		else return null;
	}
	return elements.length ? { start: node.start, end: node.end, elements } : null;
}

/** an object that may be a history: each key written out, each value an array */
function historyOf(node) {
	const props = [];
	for (const p of node.properties) {
		const key = keyOf(p);
		if (key === undefined || p.kind !== 'init' || p.method || bare(p.value)?.type !== 'ArrayExpression') return null;
		props.push({ start: p.start, end: p.end, key });
	}
	return props.length ? { start: node.start, end: node.end, props } : null;
}

/**
 * Whether an initialiser runs code, and whether it can be moved into a function as it is (it waits for nothing, and
 * reads no `import.meta` or `new.target`).
 */
function activity(init) {
	let active = false;
	let waits = false;
	const go = (n) => {
		if (FUNCTIONS.has(n.type)) return;
		if (n.type === 'AwaitExpression' || n.type === 'YieldExpression' || n.type === 'MetaProperty') waits = true;
		if (ACTIVE.has(n.type) || (n.type === 'UnaryExpression' && n.operator === 'delete')) active = true;
		for (const c of under(n)) go(c);
	};
	go(init);
	return { active, waits };
}

/**
 * What a module holds that narrowing reads: its imports and what each is read by, what it exports, its lists and
 * histories, and the declarations at its top that run code.
 * @param {string} code @param {string} file
 */
export function survey(code, file) {
	const ast = parseAst(code, { lang: /\.tsx?$/.test(file) ? 'ts' : 'js' }, file);
	const imports = [];
	const exports = new Map();
	const named = new Map();
	const lists = [];
	const histories = [];
	const refs = new Map();
	const active = [];

	const top = (decl) => {
		if (decl?.type !== 'VariableDeclaration') return;
		for (const d of decl.declarations) {
			if (d.id.type !== 'Identifier' || !d.init) continue;
			named.set(d.id.name, bare(d.init));
			const a = activity(d.init);
			if (a.active && !a.waits) active.push({ start: d.init.start, end: d.init.end });
		}
	};
	for (const s of ast.body) {
		if (s.type === 'ImportDeclaration') {
			imports.push({
				start: s.start,
				end: s.end,
				source: s.source.value,
				types: s.importKind === 'type',
				specifiers: s.specifiers.map((x) => ({ start: x.start, end: x.end, local: x.local.name, kind: x.type, imported: x.type === 'ImportSpecifier' ? (x.imported.name ?? x.imported.value) : x.type === 'ImportDefaultSpecifier' ? 'default' : '*' }))
			});
		} else if (s.type === 'ExportNamedDeclaration') {
			top(s.declaration);
			if (s.declaration?.type === 'VariableDeclaration') for (const d of s.declaration.declarations) if (d.id.type === 'Identifier') exports.set(d.id.name, { local: d.id.name });
			if (s.declaration?.id?.name) exports.set(s.declaration.id.name, { local: s.declaration.id.name });
			for (const x of s.specifiers ?? []) {
				const as = x.exported.name ?? x.exported.value;
				const local = x.local.name ?? x.local.value;
				exports.set(as, s.source ? { source: s.source.value, imported: local } : { local });
			}
		} else top(s);
	}

	// the lists, the histories and every name read, outside the imports
	const go = (n, parent, inFunction, inObject) => {
		if (n.type === 'ImportDeclaration') return;
		if (n.type === 'Identifier') {
			const key = (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) || ((parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && parent.key === n && !parent.computed && !parent.shorthand);
			if (!key) {
				if (!refs.has(n.name)) refs.set(n.name, []);
				refs.get(n.name).push(n.start);
			}
		}
		if (n.type === 'ArrayExpression' && !inObject) {
			const l = listOf(n);
			// items only where the module's own lists are written; a list made of lists anywhere outside an object
			if (l && (!inFunction || l.elements.every((e) => e.name))) lists.push(l);
		}
		if (n.type === 'ObjectExpression' && !inObject && !inFunction) {
			const h = historyOf(n);
			if (h) histories.push(h);
		}
		const f = inFunction || FUNCTIONS.has(n.type);
		const o = inObject || n.type === 'ObjectExpression';
		for (const c of under(n)) go(c, n, f, o);
	};
	go(ast, null, false, false);

	// each list by the name it is declared under, if it is
	for (const l of lists) for (const [name, init] of named) if (init?.start === l.start && init.type === 'ArrayExpression') l.name = name;
	return { imports, exports, lists, histories, refs, active };
}

const surveys = new Map();
/**
 * A module's survey, made again only when its code changes: the code it is bundled with, or else its file as it is
 * (read again only once it has changed since). @param {string} file @param {string} [code]
 */
export function surveyOf(file, code) {
	const had = surveys.get(file);
	let at;
	if (code === undefined) {
		at = statSync(file).mtimeMs;
		if (had && had.at === at) return had.survey;
		code = readFileSync(file, 'utf8');
	}
	if (had?.code === code) {
		if (at !== undefined) had.at = at;
		return had.survey;
	}
	const s = survey(code, file);
	surveys.set(file, { code, at, survey: s });
	return s;
}

/** each declaration at the top that runs code, marked to be left out when nothing reads it */
function mark(ms, s) {
	for (const a of s.active) {
		ms.appendLeft(a.start, '/* @__PURE__ */ (() => (');
		ms.prependRight(a.end, '))()');
	}
}

const marked = new Map();
/** a module with nothing of one asset's to narrow, only marked: the same for every asset, made once for its code */
function markedOf(file, code, s) {
	const had = marked.get(file);
	if (had?.code === code) return had.out;
	let out = null;
	if (s.active.length) {
		const ms = new MagicString(code);
		mark(ms, s);
		out = ms.toString();
	}
	marked.set(file, { code, out });
	return out;
}

/** what narrowing reads of a module it does not bundle: its lists (each item's id, each list spread in) and its exports */
const listsKey = (s) => JSON.stringify([s.lists.map((l) => [l.name, l.elements.map((e) => e.id ?? `...${e.name}`)]), [...s.exports]]);

/** the same of a module as its file is now ('' when it is gone or cannot be read) @param {string} file */
export function listsKeyOf(file) {
	try {
		return listsKey(surveyOf(file));
	} catch {
		return '';
	}
}

/**
 * The plugin that narrows each module of ours to one asset of its group.
 * @param {{ id: string, ids: Set<string>, ours: (file: string) => boolean }} o the asset, every asset id of its group,
 *   and which modules are ours (the others are bundled as they are)
 * @returns the plugin, and `consulted`: the modules whose lists were read from their files to tell which lists spread
 *   in hold the asset, each with what was read of it (`listsKeyOf`): a change to one that is not bundled matters only
 *   if that changes
 */
export function narrowTo({ id, ids, ours }) {
	const consulted = new Map();

	/** the list a name in a module is, declared there or imported, and the module it is declared in; null if none */
	async function listNamed(ctx, file, s, name, depth = 0) {
		if (depth > 8) return null;
		const here = s.lists.find((l) => l.name === name);
		if (here) return { file, s, list: here };
		const imp = s.imports.flatMap((i) => i.specifiers.map((x) => ({ ...x, source: i.source }))).find((x) => x.local === name && x.kind === 'ImportSpecifier');
		if (!imp) return null;
		const resolved = await ctx.resolve(imp.source, file);
		if (!resolved || resolved.external || !ours(resolved.id) || !SCRIPT.test(resolved.id)) return null;
		return exported(ctx, resolved.id, imp.imported, depth + 1);
	}
	/** the list a module exports under a name; the module is read from its file, and kept in `consulted` */
	async function exported(ctx, file, as, depth) {
		const s = surveyOf(file);
		consulted.set(file, listsKey(s));
		const e = s.exports.get(as);
		if (!e) return null;
		if (e.local) return listNamed(ctx, file, s, e.local, depth);
		const resolved = await ctx.resolve(e.source, file);
		return resolved && !resolved.external && ours(resolved.id) && SCRIPT.test(resolved.id) ? exported(ctx, resolved.id, e.imported, depth + 1) : null;
	}
	/**
	 * Whether a list is one of the group's (its items the group's assets, or one of the lists spread in one), and the
	 * ids it holds: null when a list spread in cannot be read, as it might hold any.
	 */
	async function idsOf(ctx, at, depth = 0) {
		const items = at.list.elements.filter((e) => e.id !== undefined);
		if (items.some((e) => !ids.has(e.id))) return { ours: false };
		const out = new Set(items.map((e) => e.id));
		let mine = items.length > 0;
		let known = true;
		for (const e of at.list.elements.filter((x) => x.name)) {
			const inner = depth < 8 ? await listNamed(ctx, at.file, at.s, e.name) : null;
			const got = inner ? await idsOf(ctx, inner, depth + 1) : null;
			if (got?.ours) {
				mine = true;
				if (got.ids) got.ids.forEach((x) => out.add(x));
				else known = false;
			} else known = false;
		}
		return { ours: mine, ids: known ? out : null };
	}

	const plugin = {
		name: 'narrow-to-one-asset',
		async transform(code, file) {
			if (!ours(file) || !SCRIPT.test(file)) return null;
			const s = surveyOf(file, code);
			const edits = [];
			const dropped = [];
			// the lists: the asset's item, and the lists spread in that hold it
			for (const list of s.lists) {
				if (!(await idsOf(this, { file, s, list })).ours) continue;
				const kept = [];
				for (const e of list.elements) {
					let keep = e.id !== undefined ? e.id === id : true;
					if (e.name) {
						const inner = await listNamed(this, file, s, e.name);
						const got = inner && (await idsOf(this, inner));
						if (got?.ours && got.ids) keep = got.ids.has(id);
					}
					(keep ? kept : dropped).push(e);
				}
				if (kept.length < list.elements.length) edits.push({ start: list.start, end: list.end, text: `[${kept.map((e) => code.slice(e.start, e.end)).join(', ')}]` });
			}
			// the histories: the asset's own entry
			for (const h of s.histories) {
				if (!h.props.some((p) => ids.has(p.key))) continue;
				const kept = h.props.filter((p) => !ids.has(p.key) || p.key === id);
				if (kept.length === h.props.length) continue;
				dropped.push(...h.props.filter((p) => !kept.includes(p)));
				edits.push({ start: h.start, end: h.end, text: `{ ${kept.map((p) => code.slice(p.start, p.end)).join(', ')} }` });
			}
			if (!edits.length) {
				const out = markedOf(file, code, s);
				return out === null ? null : { code: out, map: null };
			}
			const ms = new MagicString(code);
			for (const e of edits) ms.overwrite(e.start, e.end, e.text);
			// the imports read only by what was dropped
			const gone = (at) => dropped.some((d) => at >= d.start && at < d.end);
			for (const imp of s.imports) {
				if (imp.types) continue;
				const read = imp.specifiers.filter((x) => {
					const at = s.refs.get(x.local) ?? [];
					return !at.length || at.some((p) => !gone(p));
				});
				if (read.length === imp.specifiers.length) continue;
				if (!read.length) {
					ms.remove(imp.start, imp.end);
					continue;
				}
				const def = read.find((x) => x.kind === 'ImportDefaultSpecifier');
				const ns = read.find((x) => x.kind === 'ImportNamespaceSpecifier');
				const each = read.filter((x) => x.kind === 'ImportSpecifier').map((x) => code.slice(x.start, x.end));
				const what = [def && code.slice(def.start, def.end), ns && code.slice(ns.start, ns.end), each.length && `{ ${each.join(', ')} }`].filter(Boolean).join(', ');
				ms.overwrite(imp.start, imp.end, `import ${what} from ${JSON.stringify(imp.source)};`);
			}
			mark(ms, s);
			return { code: ms.toString(), map: null };
		}
	};
	return { plugin, consulted };
}
