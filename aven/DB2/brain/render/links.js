// Links in a tree, rewritten in one pass over its `a` nodes, whoever made the tree: `link` gets each href and returns
// the href to keep, or null to keep only the link's text. So the brain's own links (`glossary:` terms, package pages,
// files in the repo) work on any tree, the markdown-runtime's included.
export function rewriteLinks(nodes, link) {
	return nodes.flatMap((node) => {
		if (typeof node === 'string') return [node];
		const [tag, attrs, kids] = node;
		const inner = rewriteLinks(kids, link);
		if (tag !== 'a') return [[tag, attrs, inner]];
		const href = attrs.find(([k]) => k === 'href')?.[1];
		const to = href === undefined ? null : link(href);
		if (to === null) return inner;
		return [[tag, attrs.map(([k, v]) => (k === 'href' ? [k, to] : [k, v])), inner]];
	});
}
