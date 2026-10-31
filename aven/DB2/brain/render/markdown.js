// Markdown → a node tree (tree.js's shape), the markdown-runtime's job until it exists (aven/runtimes/README.md): the
// part of GitHub's Markdown the brain is written in. Headings, paragraphs, lists (nested, tight), tables, fenced code,
// quotes and rules; inline code, links, strong and emphasis. Raw HTML stays text. Every link goes through `link`, which
// rewrites it or returns null to keep only its text, so nothing the allowlist refuses comes out.

const inlinePattern = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s](?:[^*]*?[^*\s])?)\*/g;

export function inline(text, options = {}) {
	const nodes = [];
	let last = 0;
	for (const m of text.matchAll(inlinePattern)) {
		if (m.index > last) nodes.push(text.slice(last, m.index));
		const [, code, strong, label, href, em] = m;
		if (code !== undefined) nodes.push(['code', [], [code]]);
		else if (strong !== undefined) nodes.push(['strong', [], inline(strong, options)]);
		else if (label !== undefined) {
			const to = (options.link ?? defaultLink)(href);
			const kids = inline(label, options);
			if (to) nodes.push(['a', [['href', to]], kids]);
			else nodes.push(...kids);
		} else nodes.push(['em', [], inline(em, options)]);
		last = m.index + m[0].length;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}

const defaultLink = (href) => (/^(https:\/\/|mailto:|#)/.test(href) ? href : null);

// a heading's anchor, as GitHub makes it: lower case, punctuation gone, spaces to hyphens
export const slug = (text) =>
	text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s/g, '-');

const textOf = (nodes) => nodes.map((n) => (typeof n === 'string' ? n : textOf(n[2]))).join('');
const indentOf = (line) => line.match(/^ */)[0].length;
const listItem = /^( *)([-*]|\d+\.) +(.*)$/;
const cells = (line) =>
	line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((c) => c.trim());

export function blocks(source, options = {}) {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const out = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			i++;
			continue;
		}
		let m;
		if ((m = /^(#{1,6}) +(.*?)#*\s*$/.exec(line))) {
			const kids = inline(m[2], options);
			out.push([`h${m[1].length}`, [['id', (options.idPrefix ?? '') + slug(textOf(kids))]], kids]);
			i++;
		} else if (/^```/.test(line)) {
			const body = [];
			for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
			i++;
			out.push(['pre', [], [['code', [], [body.join('\n')]]]]);
		} else if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
			out.push(['hr', [], []]);
			i++;
		} else if (/^>/.test(line)) {
			const body = [];
			for (; i < lines.length && /^>/.test(lines[i]); i++) body.push(lines[i].replace(/^> ?/, ''));
			out.push(['blockquote', [], blocks(body.join('\n'), options)]);
		} else if (/^\|/.test(line) && /^\|?[\s:|-]+\|?$/.test(lines[i + 1] ?? '') && lines[i + 1].includes('-')) {
			const head = cells(line);
			const rows = [];
			for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
			out.push([
				'table',
				[],
				[
					['thead', [], [['tr', [], head.map((c) => ['th', [['scope', 'col']], inline(c, options)])]]],
					['tbody', [], rows.map((r) => ['tr', [], r.map((c) => ['td', [], inline(c, options)])])],
				],
			]);
		} else if ((m = listItem.exec(line))) {
			const base = m[1].length;
			const ordered = /\d/.test(m[2]);
			const items = [];
			while (i < lines.length) {
				const item = listItem.exec(lines[i]);
				if (!item || item[1].length !== base || /\d/.test(item[2]) !== ordered) break;
				const inner = base + item[0].length - item[3].length - item[1].length;
				const body = [item[3]];
				for (i++; i < lines.length; i++) {
					const next = lines[i];
					if (!next.trim()) {
						// a blank line ends the item unless the item goes on, indented, after it
						if (lines[i + 1] && indentOf(lines[i + 1]) > base) body.push('');
						else break;
					} else if (indentOf(next) > base) body.push(next.slice(Math.min(indentOf(next), inner)));
					else if (listItem.test(next) || /^(#|```|>|\|)/.test(next)) break;
					else body.push(next); // a lazy continuation
				}
				items.push(body.join('\n'));
			}
			const start = ordered ? Number(m[2].slice(0, -1)) : 1;
			const attrs = ordered && start !== 1 ? [['start', String(start)]] : [];
			out.push([
				ordered ? 'ol' : 'ul',
				attrs,
				items.map((body) => {
					const kids = blocks(body, options);
					// a tight item: its one paragraph's text straight in the li
					if (kids[0]?.[0] === 'p') kids.splice(0, 1, ...kids[0][2]);
					return ['li', [], kids];
				}),
			]);
		} else {
			const body = [];
			for (; i < lines.length && lines[i].trim() && !/^(#{1,6} |```|>|\|)/.test(lines[i]) && !listItem.test(lines[i]); i++)
				body.push(lines[i].trim());
			out.push(['p', [], inline(body.join(' '), options)]);
		}
	}
	return out;
}
