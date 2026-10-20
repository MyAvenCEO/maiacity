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

// Raw HTML on our pages ({@html}) comes only from an engine that makes it safe, or from strings of our own: each place
// is named here with what feeds it. A new {@html} fails until its HTML comes through one of these (for Markdown:
// $lib/markdown) and is added below.
const RAW_HTML = {
	'src/lib/blog/PostLayout.svelte': 'its html prop: blog posts through journalHtml ($lib/markdown, $lib/server/blog.ts)',
	'src/lib/avendb/ArticleView.svelte': "avenDB's escaping article renderer (render)",
	'src/lib/avendb/Docs.svelte': "avenDB's escaping article renderer (render), a doc's or a skill's text",
	'src/lib/universe/InspirePost.svelte': "an inspire post's report and source through journalHtml ($lib/markdown), its shifts split into spans of ours (./inspire.js)",
	'src/routes/[doc=doc]/+page.svelte': "avenDB's escaping article renderer (render)",
	'src/lib/theos/Tex.svelte': "KaTeX's own output for the paper's formulas (no \\href, no HTML extension)",
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
