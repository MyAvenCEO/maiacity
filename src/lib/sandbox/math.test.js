// @ts-nocheck — plain JS
// The math engine against hostile LaTeX, and the checker against hostile MathML: whatever goes in, only the elements
// and attributes the checker allows come out (./mathml.js ELEMENTS), and a formula that is refused anywhere on the way
// has no MathML at all, so its source is shown. The frozen engine is the bytes its hash names, and those bytes, booted
// in a realm of their own as a worker boots them, answer the same. The paper's formulas all typeset.
// Run: bun test src/lib/sandbox/math.test.js
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import MANIFEST from './engines.json' with { type: 'json' };
import { hashText } from '../../../game/hash.js';
import { LIMITS, OPTIONS, UNKNOWN } from './math.js';
import { ELEMENTS, MATHML, MAX, check, draw, serialise } from './mathml.js';
import { typeset } from './math-host.js';

const ROOT = new URL('../../../', import.meta.url).pathname;

/** the theOS paper's display formulas, as its vault text holds them */
const DISPLAY = [
	'\\begin{gathered} B_{\\text{now}} = B_{\\text{last}}\\; e^{-r\\,\\Delta t} \\\\ \\Delta t = \\frac{\\text{seconds elapsed}}{31\\,536\\,000} \\end{gathered} \\tag{1}',
	't_{1/2} = \\frac{\\ln 2}{r} \\approx 9.9\\ \\text{years}. \\tag{2}',
	'\\begin{gathered} \\frac{dm}{dt} = u - r\\,m, \\qquad m^{*} = \\frac{u}{r} \\\\ m(t) = m^{*} + \\left(m_0 - m^{*}\\right) e^{-rt} \\end{gathered} \\tag{3}',
	'\\begin{gathered} c = \\frac{\\ln(e_v/2)}{e_v/2} \\\\ e_v = 80 \\;\\Rightarrow\\; c \\approx 9.2\\,\\% \\end{gathered} \\tag{4}',
	'\\begin{gathered} \\prod_{i=1}^{n} x_i^{\\,1/n} = K \\\\ p_{ij} = \\frac{x_i}{x_j}, \\qquad \\text{fee } \\varphi = 0.3\\,\\% \\end{gathered} \\tag{5}',
	'\\begin{gathered} \\frac{\\ell}{V} = \\tfrac12\\Big(\\sum_i w_i \\sigma_i^2 - w^{\\top}\\Sigma\\,w\\Big) \\\\ \\overset{w_i = 1/n}{=}\\; \\tfrac12\\,\\sigma^2 (1-\\rho)\\Big(1 - \\frac1n\\Big) \\end{gathered} \\tag{6}',
	'\\begin{gathered} v_k = \\frac{p_k}{\\bar p}, \\qquad \\bar p = \\frac{\\sum_j s_j\\, p_j}{\\sum_j s_j} \\\\ \\Rightarrow\\; \\sum_k s_k\\, v_k = \\sum_k s_k \\end{gathered} \\tag{7}',
	'\\begin{gathered} \\dot s_i = \\kappa\\, s_i \\left(f_i - \\bar f\\right) \\\\ \\bar f = \\textstyle\\sum_j s_j f_j \\end{gathered} \\tag{8}',
	'\\begin{gathered} G(t) = \\frac{G_0\\, e^{-rt}\\, \\bar W_0}{e^{-rt}\\, \\bar W_0 + W^{*}\\left(1 - e^{-rt}\\right)} \\\\ \\bar W_0 = W^{*} \\;\\Rightarrow\\; G(t) = G_0\\, e^{-rt} \\end{gathered} \\tag{9}',
	'G_{\\infty} = \\frac{\\Gamma\\!\\left(\\alpha - \\tfrac12\\right)}{\\sqrt{\\pi}\\;\\Gamma(\\alpha)} \\tag{10}',
	'\\begin{gathered} \\frac{dW_i}{dt} = \\omega + D_i - r\\,W_i - X_i \\\\ 365\\,p_b < \\omega + D_i \\;\\Rightarrow\\; W_i(t) > 0 \\\\ T_i = \\frac{1}{r}\\,\\ln\\!\\Big(1 + \\frac{r\\,W_i}{365\\,p_b}\\Big) \\end{gathered} \\tag{11}',
	'\\begin{gathered} \\sum_i D_i = \\lambda\\, s_p\\, Q \\ge N\\,p_b \\\\ \\Rightarrow\\; \\frac{N\\,p_b}{Q} \\le \\lambda\\, s_p \\le \\lambda \\end{gathered} \\tag{12}',
	'\\begin{gathered} D_i \\approx \\bar\\eta\\, W_i = \\lambda\\,Y\\,\\frac{W_i}{\\bar W} \\\\ D_i \\ge p_b \\iff \\frac{W_i}{\\bar W} \\ge \\frac{p_b}{\\lambda\\,Y} \\end{gathered} \\tag{13}',
	'S \\ge \\big(d - (1 - \\delta)\\,q\\big)\\,\\tau \\tag{14}',
	'\\begin{gathered} \\left(\\mathrm{HEARTS} + \\mathrm{MINDs}\\right) \\cdot \\mathrm{ACTION} \\\\ = \\mathrm{ABUNDANCE} \\end{gathered} \\tag{15}'
];

/** some of its inline ones: the plain, and those the Markdown engine once mangled (`\,`, `^{*}`) */
const INLINE = [
	'\\mu', 'r', '\\sigma_W', 'W_i', '\\mu \\ge r', '\\theta = 0.5', 'u/m(t)', '\\ln 2/(r - \\mu)', 'a/(r - \\mu)',
	'1 - e^{-r/365} \\approx 0.0192\\,\\%', 'W_i^{*} = a_i / r', 'c\\,M/N', '\\dot b = c\\,(1 - b)', 'm = m^{*}',
	'\\dot B_i = u/2 - r\\,B_i', '\\dot b_i = \\frac{u}{m(t)}\\,(1 - b_i)', 'W^{*} = \\omega/r \\approx 62{,}571',
	'dW_i = \\big(a_i - (r - \\mu)\\,W_i\\big)\\,dt + \\sigma_W W_i\\, dZ', 'X_i = 365\\,p_b', '\\mu = 1.6\\,\\%',
	'\\alpha = 1 + 2(r - \\mu)/\\sigma_W^2', '\\bar\\eta = \\lambda Y / \\bar W', 'B,\\ \\Delta t', 'm,\\ m_0,\\ m^{*}',
	'M, V, P, Q', 'u = 24 \\times 365 = 8{,}760', '1/\\sqrt{8}', 'G,\\ G_0,\\ G_{\\infty}', 's_i,\\ f_i,\\ \\bar f,\\ \\kappa',
	'\\theta/(\\theta + r)', 'MV = PQ', 't_{1/2}', 'm^{*} \\approx 125{,}143', 'x_i,\\ K,\\ p_{ij}'
];

/** LaTeX made to do harm, or to break out of what maths may be */
const HOSTILE = [
	'\\href{https://evil.example/}{click}',
	'\\href{javascript:alert(1)}{x}',
	'\\url{https://evil.example/}',
	'\\includegraphics[height=1em]{https://evil.example/x.png}',
	'\\htmlClass{evil}{x}',
	'\\htmlStyle{position:fixed;inset:0;background:url(https://evil.example/)}{x}',
	'\\htmlId{evil}{x}',
	'\\htmlData{foo=bar}{x}',
	'\\text{<script>alert(1)</script>}',
	'\\text{<img src=x onerror=alert(1)>}',
	'\\text{</mtext></math><img src=x onerror=alert(1)>}',
	'\\text{"><svg onload=alert(1)>}',
	'<script>alert(1)</script>',
	'\\def\\a{\\a\\a}\\a',
	'\\def\\a#1{#1#1}\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{\\a{x}}}}}}}}}}}}',
	'\\gdef\\b{\\b x}\\b',
	'\\newcommand{\\c}{\\c\\c}\\c',
	'{'.repeat(2000) + 'x' + '}'.repeat(2000),
	'\\frac{'.repeat(300) + 'x' + '}{y}'.repeat(300),
	'\\sqrt{'.repeat(1000) + 'x' + '}'.repeat(1000),
	'x'.repeat(1 << 20),
	'\\notacommand{x}',
	'\\evil',
	'\\label{x} y',
	'\\kern{-100em} x',
	'\\hspace{-50em} x',
	'\\rule{100em}{100em}',
	'\\vcenter{x}',
	'\\pmb{x}',
	'\\fcolorbox{red}{blue}{x}',
	'\\color{url(https://evil.example/)}{x}',
	'\\char"0',
	'é',
	'\\begin{align} a \\end{align}',
	'\\verb|<script>|',
	'\\operatorname{<img src=x>}'
];

/** every element and attribute of a tree that is outside the allowlist, or leads anywhere */
function outside(tree) {
	const bad = [];
	const walk = (n) => {
		if (typeof n === 'string') return;
		if (!Object.hasOwn(ELEMENTS, n.name)) bad.push(`<${n.name}>`);
		for (const [k, v] of n.attrs) {
			if (!ELEMENTS[n.name]?.includes(k)) bad.push(`<${n.name} ${k}>`);
			if (/^(on|xlink|href|src|style|id)/i.test(k) || /script:|url\(/i.test(v)) bad.push(`${k}=${v}`);
		}
		n.children.forEach(walk);
	};
	walk(tree);
	return bad;
}

const settle = async (items) => typeset(items.map(([tex, display]) => ({ tex, display })));

describe('the frozen math engine', () => {
	const e = MANIFEST.math.at(-1);
	const bytes = readFileSync(`${ROOT}static/engines/math-v${e.v}.js`);
	test('its file is the bytes its hash in engines.json names, KaTeX the version package.json pins', () => {
		expect(bytes.length).toBe(e.bytes);
		expect(hashText(bytes.toString('utf8'))).toBe(e.blake3);
		const pinned = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')).dependencies.katex;
		expect(e.version).toBe(pinned);
	});
	test('booted as a worker boots it (a realm of its own), it answers a batch: MathML the checker passes, or nothing', () => {
		const said = [];
		const scope = { postMessage: (m) => said.push(m), performance, console };
		scope.self = scope;
		vm.createContext(scope);
		vm.runInContext(bytes.toString('utf8'), scope);
		expect(said[0][0]).toEqual({ op: 'ready' });
		const items = [...DISPLAY.map((tex) => ({ tex, display: true })), ...INLINE.map((tex) => ({ tex, display: false })), ...HOSTILE.slice(0, 20).map((tex) => ({ tex, display: false }))];
		scope.onmessage({ data: { id: 7, op: 'typeset', items } });
		const [answer] = said[1];
		expect(answer.id).toBe(7);
		expect(answer.ok).toBe(true);
		expect(answer.out.length).toBe(items.length);
		answer.out.forEach((mathml, i) => {
			const tree = check(mathml, { display: items[i].display });
			if (i < DISPLAY.length + INLINE.length) expect(tree).not.toBeNull();
			else if (tree) expect(outside(tree)).toEqual([]);
		});
		scope.onmessage({ data: { id: 8, op: 'run', code: 'x' } });
		expect(said[2][0]).toMatchObject({ id: 8, ok: false });
	});
	test('its settings: MathML only, trust off, strict, errors as nothing, tight bounds', () => {
		expect(OPTIONS).toMatchObject({ output: 'mathml', trust: false, throwOnError: false, strict: 'error', errorColor: UNKNOWN });
		expect(OPTIONS.maxExpand).toBeLessThanOrEqual(200);
		expect(OPTIONS.maxSize).toBeLessThanOrEqual(10);
		// the mark of a command it does not run is a colour no formula can name, and no value the checker lets through
		expect(check(`<math xmlns="${MATHML}"><semantics><mstyle mathcolor="${UNKNOWN}"><mtext>\\href</mtext></mstyle><annotation encoding="application/x-tex">\\href</annotation></semantics></math>`)).toBeNull();
	});
});

describe('hostile LaTeX', () => {
	for (const tex of HOSTILE)
		test(JSON.stringify(tex).slice(0, 60), async () => {
			for (const display of [false, true]) {
				const [tree] = await settle([[tex, display]]);
				if (tree) expect(outside(tree)).toEqual([]);
			}
		});

	test('what may lead anywhere or style anything is refused, and its source is what shows', async () => {
		const refused = ['\\href{https://evil.example/}{click}', '\\url{https://evil.example/}', '\\includegraphics{https://evil.example/x.png}', '\\htmlClass{a}{x}', '\\htmlStyle{color:red}{x}', '\\htmlId{a}{x}', '\\htmlData{a=b}{x}'];
		for (const tree of await settle(refused.map((t) => [t, false]))) expect(tree).toBeNull();
	});
	test('HTML in \\text{} is words, never markup', async () => {
		const [tree] = await settle([['\\text{<script>alert(1)</script><img src=x onerror=alert(1)>}', false]]);
		expect(serialise(tree)).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
		const { document } = parseHTML('<!doctype html><html><body></body></html>');
		const el = draw(tree, document);
		document.body.append(el);
		expect(document.querySelectorAll('script, img').length).toBe(0);
		expect(el.textContent).toContain('<script>alert(1)</script>');
	});
	test('a \\def that calls itself, a command it does not know, a far kern, a style: no formula', async () => {
		const trees = await settle([['\\def\\a{\\a\\a}\\a', false], ['\\gdef\\b{\\b x}\\b', true], ['\\evil x', false], ['\\kern{-100em} x', false], ['\\pmb{x}', false], ['\\vcenter{x}', false]]);
		expect(trees).toEqual([null, null, null, null, null, null]);
	});
	test('no macro carries from one formula to the next', async () => {
		const trees = await settle([['\\gdef\\carried{1} \\carried', false], ['\\carried', false]]);
		expect(trees[0]).not.toBeNull();
		expect(trees[1]).toBeNull();
	});
	test('a formula too long, and formulas past a batch, are never sent', async () => {
		const long = 'x'.repeat(LIMITS.tex + 1);
		expect(await settle([[long, false], ['y', false]])).toEqual([null, expect.anything()]);
		const many = Array.from({ length: LIMITS.batch + 5 }, (_, i) => [`z_{${i}}`, false]);
		const trees = await settle(many);
		expect(trees.slice(0, LIMITS.batch).every(Boolean)).toBe(true);
		expect(trees.slice(LIMITS.batch)).toEqual([null, null, null, null, null]);
	});
});

describe('hostile MathML: the checker refuses the whole formula', () => {
	const ok = (tree) => `<math xmlns="${MATHML}"><semantics>${tree}<annotation encoding="application/x-tex">x</annotation></semantics></math>`;
	test('the frame round it, as KaTeX writes it, passes', () => {
		expect(check(ok('<mrow><mi>x</mi></mrow>'))).not.toBeNull();
		expect(check(ok('<mi>x</mi>'), { display: false })).not.toBeNull();
		expect(check(ok('<mi>x</mi>'), { display: true })).toBeNull();
		expect(check(ok('<mi>x</mi>').replace('<math ', '<math display="block" '), { display: true })).not.toBeNull();
	});
	const BAD = {
		'an href': ok('<mrow href="https://evil.example/"><mi>x</mi></mrow>'),
		'an href on math': `<math xmlns="${MATHML}" href="https://evil.example/"><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>`,
		'xlink:href': ok('<mi xlink:href="https://evil.example/">x</mi>'),
		'a style': ok('<mstyle style="position:fixed"><mi>x</mi></mstyle>'),
		'a handler': ok('<mi onclick="alert(1)">x</mi>'),
		'an id': ok('<mi id="x">x</mi>'),
		'a class on a cell not KaTeX’s': ok('<mtable><mtr><mtd class="evil"><mi>x</mi></mtd></mtr></mtable>'),
		'a class elsewhere': ok('<mpadded class="vcenter"><mi>x</mi></mpadded>'),
		maction: ok('<maction actiontype="toggle"><mi>x</mi><mi>y</mi></maction>'),
		mglyph: ok('<mi><mglyph src="https://evil.example/x.png"/></mi>'),
		'a script': ok('<mtext><script>alert(1)</script></mtext>'),
		'an HTML element': ok('<mtext><img src="x"/></mtext>'),
		'a foreign object': ok('<annotation-xml encoding="text/html"><img src="x"/></annotation-xml>'),
		'a second annotation': `<math xmlns="${MATHML}"><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation><annotation encoding="application/x-tex">y</annotation></semantics></math>`,
		'an annotation not TeX': `<math xmlns="${MATHML}"><semantics><mi>x</mi><annotation encoding="text/html">&lt;b&gt;</annotation></semantics></math>`,
		'an annotation holding markup': `<math xmlns="${MATHML}"><semantics><mi>x</mi><annotation encoding="application/x-tex"><mi>x</mi></annotation></semantics></math>`,
		'semantics within': ok('<mrow><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></mrow>'),
		'math within': ok(`<mrow><math xmlns="${MATHML}"></math></mrow>`),
		'no semantics': `<math xmlns="${MATHML}"><mi>x</mi></math>`,
		'another namespace': `<math xmlns="http://www.w3.org/1999/xhtml"><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>`,
		'a comment': ok('<mi>x<!-- y --></mi>'),
		CDATA: ok('<mi><![CDATA[<img src=x>]]></mi>'),
		'a doctype': `<!DOCTYPE math>${ok('<mi>x</mi>')}`,
		'a processing instruction': `<?xml version="1.0"?>${ok('<mi>x</mi>')}`,
		'an entity not XML’s': ok('<mi>&nbsp;</mi>'),
		'an entity of nothing': ok('<mi>&#0;</mi>'),
		'an entity of half a character': ok('<mi>&#xD800;</mi>'),
		'a bare ampersand': ok('<mi>a & b</mi>'),
		'an element in capitals': ok('<MI>x</MI>'),
		'a value in single quotes': ok("<mi mathvariant='bold'>x</mi>"),
		'a value unquoted': ok('<mi mathvariant=bold>x</mi>'),
		'an attribute twice': ok('<mi mathvariant="bold" mathvariant="italic">x</mi>'),
		'a variant of no font': ok('<mi mathvariant="url(x)">x</mi>'),
		'two roots': ok('<mi>x</mi>') + ok('<mi>y</mi>'),
		'words after the root': `${ok('<mi>x</mi>')}<img src=x>`,
		'words before the root': `x${ok('<mi>x</mi>')}`,
		'an element left open': ok('<mrow><mi>x</mi>'),
		'an element closed wrongly': ok('<mrow><mi>x</mrow></mi>'),
		'words outside a token': ok('<mrow>x<mi>y</mi></mrow>'),
		'a space holding something': ok('<mspace width="1em"><mi>x</mi></mspace>'),
		'a far kern': ok('<mspace width="-100em"/>'),
		'a huge space': ok('<mspace width="30em"/>'),
		'a length in no unit': ok('<mspace width="12"/>'),
		'a colour that is a URL': ok('<mstyle mathcolor="url(https://evil.example/)"><mi>x</mi></mstyle>'),
		'a colour with a dash': ok(`<mstyle mathcolor="${UNKNOWN}"><mi>x</mi></mstyle>`),
		'a huge size': ok('<mstyle mathsize="40em"><mi>x</mi></mstyle>'),
		'a table wider than its place': ok('<mtable width="900%"><mtr><mtd><mi>x</mi></mtd></mtr></mtable>'),
		'too deep': ok('<mrow>'.repeat(MAX.depth) + '<mi>x</mi>' + '</mrow>'.repeat(MAX.depth)),
		'too many elements': ok(`<mrow>${'<mi/>'.repeat(MAX.nodes)}</mrow>`),
		'too long': ok(`<mtext>${'x'.repeat(MAX.chars)}</mtext>`),
		'not text': { toString: () => ok('<mi>x</mi>') }
	};
	for (const [what, mathml] of Object.entries(BAD)) test(what, () => expect(check(mathml)).toBeNull());

	test('draw makes only what check handed out, element by element', () => {
		const { document } = parseHTML('<!doctype html><html><body></body></html>');
		expect(() => draw({ name: 'math', attrs: [['href', 'javascript:alert(1)']], children: [] }, document)).toThrow();
		const tree = check(ok('<mrow><mi mathvariant="bold">x</mi><mo>&lt;</mo><mn>1</mn></mrow>'));
		const el = draw(tree, document);
		expect(el.localName).toBe('math');
		expect(el.querySelector('mi').getAttribute('mathvariant')).toBe('bold');
		expect(el.textContent).toBe('x<1x');
	});
});

describe("the paper's formulas", () => {
	test('every display formula and inline one typesets, and the checked tree reads back the same', async () => {
		const trees = await settle([...DISPLAY.map((t) => [t, true]), ...INLINE.map((t) => [t, false])]);
		trees.forEach((tree, i) => {
			expect(tree).not.toBeNull();
			expect(outside(tree)).toEqual([]);
			expect(check(serialise(tree), { display: i < DISPLAY.length })).toEqual(tree);
		});
	});
	test('each display formula carries its \\tag: the number its references point at', async () => {
		const trees = await settle(DISPLAY.map((t) => [t, true]));
		trees.forEach((tree, i) => {
			const text = serialise(tree);
			expect(text).toContain('<mtable width="100%">');
			expect(text).toContain(`<mtext>(${i + 1})</mtext>`);
		});
	});
	test('a numbered formula is drawn in display style, its number in the last cell', async () => {
		const { document } = parseHTML('<!doctype html><html><body></body></html>');
		const trees = await settle(DISPLAY.map((t) => [t, true]));
		trees.forEach((tree, i) => {
			const cells = [...draw(tree, document).querySelector('mtable').children[0].children];
			expect(cells.length).toBe(4);
			const style = cells[1].children[0];
			expect([cells[1].children.length, style.localName, style.getAttribute('displaystyle'), style.getAttribute('scriptlevel')]).toEqual([1, 'mstyle', 'true', '0']);
			expect(cells[3].textContent).toBe(`(${i + 1})`);
		});
		// a formula with no number is drawn as it was checked
		const [plain] = await settle([['\\frac{a}{b}', true]]);
		expect(draw(plain, document).querySelector('mstyle')).toBeNull();
	});
});
