// The tree drawer (os/web/runtimes/draw.js), held to Lean's vectors in all three of Playwright's engines (README rule
// 10): `bun run box node sandbox/drawer.mjs`, which `bun run up --check` runs. The vectors are aven/runtimes'
// (spec/vectors), which the box mounts at /aven/runtimes; no expected value is written here. Checked, in Chromium, WebKit and Firefox:
//   1. every tree of tree.json, and every face's of face.json, gets the model's verdict from the drawer's own check;
//   2. every tree that passes is drawn into a shadow root and read back node by node: it is exactly the tree, its
//      attributes in their order; every tree that fails is refused, and nothing is drawn;
//   3. every face's style is written as the model's CSS text (`Rule.css`); the drawer refuses exactly the rules the
//      model counts as bad, and a rule outside Face's types;
//   4. a click on a node with data-on is heard as its event, and a click on a link is handed to the host: the page
//      never follows it; text that looks like markup stays text, and nothing in it runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

const run = process.argv[2] ?? 'runs/latest';
mkdirSync(run, { recursive: true });
// in the box at /aven/runtimes; beside aven/DB2 in a checkout
const dir = ['/aven/runtimes/spec/vectors', new URL('../../runtimes/spec/vectors', import.meta.url).pathname].find(existsSync);
const vectors = (file) => JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
const drawJs = readFileSync(new URL('../os/web/runtimes/draw.js', import.meta.url));

// a vector's tree, {text} or {tag, attrs, kids}, in the shape a runtime's answer has: text, or [tag, attrs, kids]
const shape = (n) => ('text' in n ? n.text : [n.tag, n.attrs, n.kids.map(shape)]);
const hexBytes = (s) => (s === null ? null : [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)));
const rule = (r) => [r.class, hexBytes(r.color), hexBytes(r.background), r.size, r.bold];

const trees = [
	...vectors('tree.json').map((v) => ({ name: v.name, tree: shape(v.input.tree), ok: v.expected })),
	...vectors('face.json').map((v) => ({ name: `face: ${v.name}`, tree: shape(v.input.tree), ok: v.expected.check })),
];
const faces = vectors('face.json').map((v) => ({ name: v.name, style: v.input.style.map(rule), css: v.expected.css, bad: v.expected.badClass }));

const page = `<!doctype html><meta charset="utf-8"><title>drawer</title><body><div id="hosts"></div>
<script type="module">import * as d from '/draw.js'; window.d = d; window.ready = true;</script>`;
const server = createServer((req, res) => {
	if (req.url === '/draw.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end(drawJs);
	else res.writeHead(200, { 'content-type': 'text/html' }).end(page);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

// in the page: draw each tree, read it back from its shadow root, and say what differs
function inPage({ trees, faces }) {
	const { d } = window;
	const problems = [];
	const read = (node) =>
		node.nodeType === Node.TEXT_NODE
			? node.data
			: [node.localName, [...node.attributes].map((a) => [a.name, a.value]), [...node.childNodes].map(read)];
	for (const { name, tree, ok } of trees) {
		if (d.checkTree(tree) !== ok) problems.push(`${name}: the check says ${!ok}`);
		const host = document.createElement('div');
		document.getElementById('hosts').append(host);
		let drawn = true;
		try {
			d.draw(host, { tree });
		} catch {
			drawn = false;
		}
		if (drawn !== ok) problems.push(`${name}: ${drawn ? 'drawn' : 'refused'}`);
		if (drawn) {
			const nodes = [...host.shadowRoot.childNodes].filter((n) => n.localName !== 'style');
			const back = JSON.stringify(nodes.map(read));
			if (back !== JSON.stringify([tree])) problems.push(`${name}: read back ${back}`);
		} else if (host.shadowRoot && host.shadowRoot.childNodes.length) problems.push(`${name}: refused, yet drawn`);
	}
	for (const { name, style, css, bad } of faces) {
		const got = style.map(d.ruleCss);
		if (JSON.stringify(got) !== JSON.stringify(css)) problems.push(`${name}: css ${JSON.stringify(got)}`);
		// the drawer refuses exactly the rules the model counts as bad (`badClass`)
		const refused = style.filter((r) => !d.ruleOk(r)).length;
		if (refused !== bad) problems.push(`${name}: ${refused} rules refused, the model ${bad}`);
	}
	for (const bad of [['x}y', null, null, null, null], ['row', [1, 2], null, null, null], ['row', null, null, -1, null], ['row', 'red', null, null, null]])
		if (d.ruleOk(bad)) problems.push(`a rule outside Face's types taken: ${JSON.stringify(bad)}`);
	return problems;
}

async function clicks(page) {
	return page.evaluate(async () => {
		const { d } = window;
		const problems = [];
		const host = document.createElement('div');
		document.getElementById('hosts').append(host);
		const heard = [];
		const tree = ['div', [], [
			['button', [['type', 'button'], ['data-on', 'add'], ['aria-label', 'Add']], [['span', [], ['+']]]],
			['a', [['href', 'https://maia.city']], ['out']],
			['p', [], ['<img src=x onerror="window.ran=1"><script>window.ran=1</script>']],
		]];
		d.draw(host, { tree }, { onEvent: (name) => heard.push(`event ${name}`), onLink: (href) => heard.push(`link ${href}`) });
		const before = location.href;
		host.shadowRoot.querySelector('button span').click();
		host.shadowRoot.querySelector('a').click();
		await new Promise((done) => setTimeout(done, 300));
		if (JSON.stringify(heard) !== JSON.stringify(['event add', 'link https://maia.city'])) problems.push(`heard ${JSON.stringify(heard)}`);
		if (location.href !== before) problems.push(`the page followed a link to ${location.href}`);
		if (window.ran) problems.push('text that looks like markup ran');
		if (host.shadowRoot.querySelector('img, script')) problems.push('text that looks like markup became elements');
		// an image named by its hash is read from where `file` says, and has no src where it says nowhere
		const hash = 'ab'.repeat(32);
		const art = document.createElement('div');
		document.getElementById('hosts').append(art);
		const img = (n) => ['img', [['src', `/files/${n}`], ['alt', '']], []];
		d.draw(art, { tree: ['figure', [], [img(hash), img('cd'.repeat(32))]] }, { file: (h) => (h === hash ? `blob:bundle/${h}` : null) });
		const srcs = [...art.shadowRoot.querySelectorAll('img')].map((x) => x.getAttribute('src'));
		if (JSON.stringify(srcs) !== JSON.stringify([`blob:bundle/${hash}`, null])) problems.push(`images read from ${JSON.stringify(srcs)}`);
		return problems;
	});
}

const report = {};
let failed = false;
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit], ['firefox', firefox]]) {
	const started = Date.now();
	const browser = await type.launch();
	const tab = await browser.newPage();
	await tab.goto(url);
	await tab.waitForFunction(() => window.ready);
	const problems = [...(await tab.evaluate(inPage, { trees, faces })), ...(await clicks(tab))];
	await browser.close();
	report[engine] = { problems, trees: trees.length, faces: faces.length, ms: Date.now() - started };
	if (problems.length) failed = true;
	console.log(`drawer, ${engine}: ${problems.length ? `${problems.length} problems: ${problems.slice(0, 5).join('; ')}` : `${trees.length} trees and ${faces.length} faces as the model has them`}`);
}
server.close();
writeFileSync(`${run}/drawer.json`, JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
