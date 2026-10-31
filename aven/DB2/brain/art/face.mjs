// A slide as a face: one node tree, built by art/slides.mjs from what it lays out, in two forms. `markup` is the
// part's markup, as FaceRuntime.lean has it, which avenOS hands the face-runtime; `html` is the same tree as a readable
// preview, `<id>.html`, which nothing reads back. A node is text, or `[tag, [[name, value], …], [kid, …]]`; the
// allowlist over it is the face-runtime's own (aven/runtimes/spec/Aven/Runtime/Tree.lean).

// a node in FaceRuntime.lean's markup forms: `["el", tag, [[name, ["lit", value]], …], null, [kid, …]]`, `["text", ["lit", text]]`
export const markup = (n) =>
	typeof n === 'string' ? ['text', ['lit', n]] : ['el', n[0], n[1].map(([k, v]) => [k, ['lit', v]]), null, n[2].map(markup)];

// the tree back from a part's markup, which holds only literals
export const fromMarkup = (m) => {
	if (m[0] === 'text' && m[1][0] === 'lit') return m[1][1];
	if (m[0] === 'el' && m[3] === null && m[2].every(([, v]) => v[0] === 'lit')) return [m[1], m[2].map(([k, v]) => [k, v[1]]), m[4].map(fromMarkup)];
	throw new Error(`not a literal node: ${JSON.stringify(m).slice(0, 80)}`);
};

const voids = new Set(['img', 'br', 'hr', 'input']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
// an element whose children are all elements goes one child a line, indented; the rest stays on its line
export function html(n, indent = '') {
	if (typeof n === 'string') return esc(n);
	const [tag, attrs, kids] = n;
	const open = `<${tag}${attrs.map(([k, v]) => ` ${k}="${attr(v)}"`).join('')}>`;
	if (voids.has(tag)) return open;
	const lines = kids.length > 1 && kids.every((k) => typeof k !== 'string');
	if (!lines) return `${open}${kids.map((k) => html(k)).join('')}</${tag}>`;
	return `${open}\n${kids.map((k) => `${indent}\t${html(k, `${indent}\t`)}`).join('\n')}\n${indent}</${tag}>`;
}
