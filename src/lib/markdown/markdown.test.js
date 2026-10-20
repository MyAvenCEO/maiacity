// @ts-nocheck — plain JS
// The Markdown engine against hostile Markdown: whatever goes in, only the tags and attributes in TAGS come out, no
// address leads to a script, and the Markdown we write ourselves still reads as before.
import { describe, expect, test } from 'bun:test';
import { TAGS, decoded, markdown, safeHref } from './index.js';

const HOSTILE = [
	'<script>alert(1)</script>',
	'<img src=x onerror=alert(1)>',
	'hello <img src=x onerror="alert(1)"> world',
	'<svg onload=alert(1)>',
	'<iframe src="https://evil.example"></iframe>',
	'<meta http-equiv="refresh" content="0;url=https://evil.example">',
	'<a href="javascript:alert(1)">x</a>',
	'<style>body{background:url(https://evil.example/x)}</style>',
	'<link rel="dns-prefetch" href="//evil.example">',
	'<form action="https://evil.example"><input name=a></form>',
	'<details open ontoggle=alert(1)>',
	'[x](javascript:alert(1))',
	'[x](JaVaScRiPt:alert(1))',
	'[x](&#106;avascript:alert(1))',
	'[x](&#x6A;avascript&colon;alert(1))',
	'[x](java\tscript:alert(1))',
	'[x](  javascript:alert(1))',
	'[x](vbscript:msgbox(1))',
	'[x](data:text/html,<script>alert(1)</script>)',
	'[x](//evil.example/path)',
	'[x](/\\evil.example)',
	'[x](https://ok.example "a\\" onmouseover=\\"alert(1))',
	'![p](javascript:alert(1))',
	'![p](https://evil.example/x.png)',
	'![p" onerror="alert(1)](x.png)',
	'<https://ok.example/?a="><script>alert(1)</script>>',
	'```js" onmouseover="alert(1)\ncode\n```',
	'```\n</code></pre><script>alert(1)</script>\n```',
	'`</code><script>alert(1)</script>`',
	'# <img src=x onerror=alert(1)>',
	'| a | b |\n|---|---|\n| <script>x</script> | [x](javascript:y) |',
	'- [ ] <b onclick=x>task</b>',
	'> <iframe srcdoc="<script>parent.alert(1)</script>">',
	'**<u onmouseover=alert(1)>bold</u>**',
	'<!-- comment --><script>x</script>',
	'<x-custom onclick=alert(1)>',
	'&lt;script&gt;alert(1)&lt;/script&gt;',
	'[a][b]\n\n[b]: javascript:alert(1)',
	'www.evil.example/<script>',
	'1. one\n2. <object data="x.swf"></object>'
];

/** Every tag in `html` with its attributes, as written: fails a test on anything outside TAGS. */
function scan(html) {
	const problems = [];
	for (const m of html.matchAll(/<\s*(\/?)\s*([a-zA-Z][\w-]*)([^>]*)>/g)) {
		const [, close, tag, rest] = m;
		const name = tag.toLowerCase();
		if (!(name in TAGS)) {
			problems.push(`tag <${name}>`);
			continue;
		}
		if (close) continue;
		const body = rest.replace(/\/\s*$/, '');
		for (const a of body.matchAll(/\s([^\s=]+)(?:="([^"]*)")?/g)) {
			const [, attr, value = ''] = a;
			if (!TAGS[name].includes(attr)) problems.push(`<${name} ${attr}>`);
			if (attr === 'href' && !safeHref(value.replace(/&amp;/g, '&'))) problems.push(`href ${value}`);
			if (/script:|^\s*data:text/i.test(decoded(value.replace(/&amp;/g, '&')))) problems.push(`${attr}=${value}`);
		}
		// anything left in the tag that is not name="value" is a smuggled attribute
		if (body.replace(/\s[^\s=]+(?:="[^"]*")?/g, '').trim()) problems.push(`<${name}${rest}>`);
	}
	return problems;
}

const picture = (name) => (/^[0-9a-f]{64}\.(png|jpe?g)$/.test(name) ? `https://api.maia.city/vault/files/${name}` : null);

describe('hostile Markdown', () => {
	for (const md of HOSTILE)
		test(JSON.stringify(md).slice(0, 60), () => {
			for (const o of [{}, { picture }, { ids: true }, { picture: (n) => n }]) {
				const html = markdown(md, o);
				expect(scan(html)).toEqual([]);
				expect(html).not.toMatch(/<\s*(script|iframe|meta|style|link|form|object|svg|embed|base)/i);
			}
		});
});

describe('our own Markdown reads as before', () => {
	test('paragraphs, emphasis, code, lists, tables, quotes', () => {
		const html = markdown('# Title\n\nSome **bold** and *it* and `code`.\n\n- a\n- [x] done\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n> said\n\n```js\nlet a = 1 < 2;\n```');
		expect(html).toContain('<h1>Title</h1>');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>it</em>');
		expect(html).toContain('<code>code</code>');
		expect(html).toContain('<input type="checkbox" disabled checked /> done');
		expect(html).toContain('<th align="left">a</th>');
		expect(html).toContain('<blockquote>');
		expect(html).toContain('<pre><code class="language-js">let a = 1 &lt; 2;</code></pre>');
		expect(scan(html)).toEqual([]);
	});
	test('links: the web in a new tab, the site through link()', () => {
		const html = markdown('[web](https://a.example/?x=1&y=2) and [site](/blog/day-01) and [mail](mailto:a@b.example)', { link: (h) => (h.startsWith('/') ? `/base${h}` : h) });
		expect(html).toContain('<a href="https://a.example/?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">web</a>');
		expect(html).toContain('<a href="/base/blog/day-01">site</a>');
		expect(html).toContain('<a href="mailto:a@b.example">mail</a>');
	});
	test('a picture alone is a figure; one without an address shows its words', () => {
		const hash = 'a'.repeat(64);
		expect(markdown(`![A tree](${hash}.png)`, { picture })).toBe(`<figure><img src="https://api.maia.city/vault/files/${hash}.png" alt="A tree" loading="lazy" /><figcaption>A tree</figcaption></figure>\n`);
		expect(markdown('![A tree](tree.png)', { picture })).toContain('<span class="unshown">A tree</span>');
	});
	test('an SVG shows only as an image, from a data URL, its markup never in the page', () => {
		const svg = markdown('![A round](d.svg)', { picture: () => 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
		expect(svg).toContain('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="A round"');
		const raw = markdown('![x](d.svg)', { picture: () => 'data:image/svg+xml;utf8,<svg onload=alert(1)>' });
		expect(scan(raw)).toEqual([]);
		expect(raw).not.toMatch(/<\s*svg/i);
		expect(markdown('![x](d.svg)', { picture: () => 'data:image/svg+xml,<svg/>' })).toContain('<span class="unshown">x</span>');
	});
	test('raw HTML shows only its words', () => {
		expect(markdown('a <b>b</b> c')).toBe('<p>a b c</p>\n');
		expect(markdown('<h1 align="center">Title</h1>\n\n<!-- note -->')).toBe('<p>Title</p>\n');
		expect(markdown('x < y and a<b')).toBe('<p>x &lt; y and a&lt;b</p>\n');
	});
	test('relative links stay links, schemes do not', () => {
		expect(markdown('[r](references/des.md)')).toBe('<p><a href="references/des.md">r</a></p>\n');
		expect(markdown('[r](x:y)')).toBe('<p>r</p>\n');
	});
	test('heading ids', () => {
		expect(markdown('## How to rerun it', { ids: true })).toBe('<h2 id="how-to-rerun-it">How to rerun it</h2>\n');
	});
});

describe('maths, where a caller asks for it (math)', () => {
	const m = (md, o = {}) => markdown(md, { math: true, ...o });
	const inline = (tex) => `<span class="math" data-math="inline">${tex}</span>`;
	const display = (tex) => `<span class="math" data-math="display">${tex}</span>`;
	test('$…$ is inline maths, $$…$$ display maths: each a placeholder holding its source, escaped', () => {
		expect(m('Let $x^2 < y$ be.')).toBe(`<p>Let ${inline('x^2 &lt; y')} be.</p>\n`);
		expect(m('$$\n\\begin{gathered} a \\\\\n- b \\end{gathered} \\tag{1}\n$$')).toBe(`<p>${display('\\begin{gathered} a \\\\\n- b \\end{gathered} \\tag{1}')}</p>\n`);
		expect(m('Text\n$$\nx\n$$\nmore')).toBe(`<p>Text</p>\n<p>${display('x')}</p>\n<p>more</p>\n`);
		expect(m('in a line $$x^2$$ too')).toBe(`<p>in a line ${display('x^2')} too</p>\n`);
	});
	test('prices stay words: the opening $ before a non-space, the closing after one and before no digit', () => {
		expect(m('Costs $5 and $10.')).toBe('<p>Costs $5 and $10.</p>\n');
		expect(m('drained of more than $450,000 due to an exploit')).toBe('<p>drained of more than $450,000 due to an exploit</p>\n');
		expect(m('from $5 to $x$')).toBe(`<p>from $5 to ${inline('x')}</p>\n`);
		expect(m('a $x$5 b, a $ x$ c, a $x $ d')).toBe('<p>a $x$5 b, a $ x$ c, a $x $ d</p>\n');
		expect(m('$5\n\n$6')).toBe('<p>$5</p>\n<p>$6</p>\n');
	});
	test('an escaped \\$ stays a dollar, and one in maths closes nothing', () => {
		expect(m('\\$5 and \\$x\\$')).toBe('<p>$5 and $x$</p>\n');
		expect(m('$a\\$b$')).toBe(`<p>${inline('a\\$b')}</p>\n`);
		expect(m('$\\text{costs $5}$')).toBe(`<p>${inline('\\text{costs $5}')}</p>\n`);
	});
	test('code is untouched', () => {
		expect(m('`$x$` and `$$y$$`')).toBe('<p><code>$x$</code> and <code>$$y$$</code></p>\n');
		expect(m('```\n$$\nx\n$$\n```')).toBe('<pre><code>$$\nx\n$$</code></pre>\n');
		expect(m('    $x$')).toBe('<pre><code>$x$</code></pre>\n');
	});
	test('maths is read as written, before marked: no escape eats its \\, , no emphasis ends in it', () => {
		expect(m('$1 - e^{-r/365} \\approx 0.0192\\,\\%$')).toBe(`<p>${inline('1 - e^{-r/365} \\approx 0.0192\\,\\%')}</p>\n`);
		expect(m('*With $m = m^{*}$, a member $c = r$.* Then')).toBe(`<p><em>With ${inline('m = m^{*}')}, a member ${inline('c = r')}.</em> Then</p>\n`);
		expect(m('$a_1 + b_2$ and _em_')).toBe(`<p>${inline('a_1 + b_2')} and <em>em</em></p>\n`);
	});
	test('in a table cell and a figure’s caption too, never across them', () => {
		expect(m('| a | b |\n|---|---|\n| $\\mu$ | $M, V$ |')).toContain(`<td>${inline('\\mu')}</td><td>${inline('M, V')}</td>`);
		expect(m('| $a | b$ |\n|---|---|\n| x | y |')).toContain('<th>$a</th><th>b$</th>');
		const fig = m('![Figure 5. All meet at $u/r$, then.](f.svg)', { picture: (n) => ({ src: '', name: n }) });
		expect(fig).toBe(`<figure><img alt="Figure 5. All meet at $u/r$, then." data-picture="f.svg" loading="lazy" /><figcaption>Figure 5. All meet at ${inline('u/r')}, then.</figcaption></figure>\n`);
	});
	test('with math off, a $ is a dollar and nothing changes', () => {
		// marked's own reading, as before: its escape eats the backslash of \,
		expect(markdown('Let $a\\,b$ and $x^{*}$ be *it*, $$y$$.')).toBe('<p>Let $a,b$ and $x^{*}$ be <em>it</em>, $$y$$.</p>\n');
		expect(markdown('$$\nx\n$$')).toBe('<p>$$\nx\n$$</p>\n');
	});
	test('hostile Markdown, maths among it, writes only what TAGS holds', () => {
		const tries = [
			...HOSTILE,
			'$</span><script>alert(1)</script>$',
			'$x" onclick="alert(1)$',
			"$x' onclick='alert(1)$",
			'$$\n<img src=x onerror=alert(1)>\n$$',
			'$\\text{<iframe src=//evil.example>}$',
			'![a $<img src=x onerror=alert(1)>$ b](x.png)',
			'[link $x$](javascript:alert(1))',
			'<b>$x$</b> $<b>$ $</b>$',
			'$$</p><script>x</script>$$'
		];
		for (const md of tries) {
			const html = m(md, { picture: (n) => n });
			expect(scan(html)).toEqual([]);
			expect(html).not.toMatch(/<\s*(script|iframe|meta|style|link|form|object|svg|embed|base|img\s+src=x)/i);
			for (const s of html.matchAll(/<span([^>]*)>/g)) expect(s[1]).toMatch(/^ class="(math" data-math="(inline|display)|unshown)"$/);
		}
	});
	test('text made to be slow reads in time', () => {
		for (const md of ['$x '.repeat(30000), '$5 '.repeat(30000), '$a'.repeat(30000), `$${'\\text{'.repeat(30000)}`, '$$\n\n'.repeat(20000), '$$a '.repeat(30000), '*a $b*c$ d* '.repeat(10000)]) {
			const t = performance.now();
			m(md);
			expect(performance.now() - t).toBeLessThan(2000);
		}
	});
});

// Raw HTML on our pages ({@html}) comes only from an engine that makes it safe, or from strings of our own: each place
// is named here with what feeds it. A new {@html} fails until its HTML comes through one of these (for Markdown:
// $lib/markdown) and is added below.
const RAW_HTML = {
	'src/lib/blog/PostLayout.svelte': "its html prop: an avenDB article through avenDB's escaping article renderer (render, $lib/avendb/ArticleView.svelte)",
	'src/lib/avendb/ArticleView.svelte': "avenDB's escaping article renderer (render)",
	'src/lib/avendb/Docs.svelte': "avenDB's escaping article renderer (render), a doc's or a skill's text; its maths drawn after by the math host's checker, as elements, never as HTML",
	'src/lib/universe/InspirePost.svelte': "an inspire post's report and source through journalHtml ($lib/markdown), its shifts split into spans of ours (./inspire.js)",
	'src/routes/[doc=doc]/+page.svelte': "avenDB's escaping article renderer (render)",
	'src/routes/app/math/probe/+page.svelte': "the math probe's doc through avenDB's escaping article renderer (render), as the docs draw one, its maths drawn after by the checker",
	'src/lib/aven-city/components/ResourceIcon.svelte': 'our own SVG icons (ICONS)',
	'src/lib/avendb/Settings.svelte': 'a QR code drawn here as SVG',
	'src/lib/chat/Message.svelte': "a chat message's text through $lib/markdown"
};
describe('raw HTML on our pages', () => {
	test('every {@html} is fed by a safe engine or our own strings', async () => {
		const { readdirSync, readFileSync, statSync } = await import('node:fs');
		const root = new URL('../../../', import.meta.url).pathname;
		const found = [];
		const walk = (dir) => {
			for (const name of readdirSync(root + dir)) {
				const path = `${dir}/${name}`;
				if (statSync(root + path).isDirectory()) walk(path);
				else if (name.endsWith('.svelte') && readFileSync(root + path, 'utf8').includes('{@html')) found.push(path);
			}
		};
		walk('src');
		expect(found.filter((p) => !RAW_HTML[p])).toEqual([]);
		expect(Object.keys(RAW_HTML).filter((p) => !found.includes(p))).toEqual([]);
	});
});
