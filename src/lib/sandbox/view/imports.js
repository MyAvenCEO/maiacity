// @ts-nocheck — plain JS, part of the view worker (./worker.js)
/*
 * A VIEW'S MODULE SCRIPT AS A PLAIN ONE — a worker in a frame with no origin may not load a module from a blob: URL,
 * so a view's `<script type="module">` is read with acorn and written as a classic script: each import becomes a
 * lookup in the modules the engine lends (`__maiaImport`, only what its libraries define), `export` words go, and the
 * whole runs in an async function, so a top-level await still waits.
 */
import { parse } from 'acorn';

/** the import statements of `code`, written as lookups, and the code around them @param {string} code */
export function classic(code) {
	const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
	const head = [];
	const cuts = [];
	const lit = (s) => JSON.stringify(String(s));
	for (const node of ast.body) {
		if (node.type === 'ImportDeclaration') {
			const from = `__maiaImport(${lit(node.source.value)})`;
			const named = [];
			for (const s of node.specifiers) {
				if (s.type === 'ImportNamespaceSpecifier') head.push(`const ${s.local.name} = ${from};`);
				else if (s.type === 'ImportDefaultSpecifier') head.push(`const ${s.local.name} = ((m) => (m && 'default' in m ? m.default : m))(${from});`);
				else {
					const name = s.imported.type === 'Literal' ? lit(s.imported.value) : s.imported.name;
					named.push(s.imported.type === 'Literal' || name !== s.local.name ? `${name}: ${s.local.name}` : name);
				}
			}
			if (named.length) head.push(`const { ${named.join(', ')} } = ${from};`);
			if (!node.specifiers.length) head.push(`${from};`);
			cuts.push([node.start, node.end, '']);
		} else if (node.type === 'ExportNamedDeclaration') {
			cuts.push(node.declaration ? [node.start, node.declaration.start, ''] : [node.start, node.end, '']);
		} else if (node.type === 'ExportDefaultDeclaration') {
			const d = node.declaration;
			const named = (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id;
			cuts.push([node.start, d.start, named ? '' : 'const __maiaDefault = ']);
		} else if (node.type === 'ExportAllDeclaration') cuts.push([node.start, node.end, '']);
	}
	// import(), import.meta: anywhere in the code
	const walk = (n) => {
		if (!n || typeof n.type !== 'string') return;
		if (n.type === 'ImportExpression') cuts.push([n.start, n.source.start, '__maiaDynamic(']);
		if (n.type === 'MetaProperty' && n.meta.name === 'import') cuts.push([n.start, n.end, '({ url: "" })']);
		for (const k in n) {
			if (k === 'type' || k === 'start' || k === 'end') continue;
			const v = n[k];
			if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === 'object') walk(v);
		}
	};
	walk(ast);
	cuts.sort((a, b) => b[0] - a[0]);
	let body = code;
	for (const [s, e, put] of cuts) body = body.slice(0, s) + put + body.slice(e);
	return `(async () => {\n${head.join('\n')}\n${body}\n})().catch((e) => __maiaError(e));\n`;
}
