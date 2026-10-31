// avenID's slides, laid out as an illustrated asset sheet: `bun brain/art/slides.mjs` builds each as one node tree
// (face.mjs) and writes id/slides/<id>.part.json (the face part avenOS draws through the face-runtime: its markup and
// every rule, style/slide.style.json's first), <id>.style.json (where each layer stands, as style data) and <id>.html
// (the tree as a readable preview). Coordinates are
// in cqw on both axes: a slide is 100 wide and 56.25 high. Objects are the drawings (objects.mjs), placed by their
// hash (images.json) as `<img src="/files/<hash>">`, the way the network names files. Each slide's text (<id>.md) is
// written by hand, and so are the rules every slide shares (style/slide.style.json).
import { readFileSync, writeFileSync } from 'node:fs';
import { html, markup } from './face.mjs';

// one rule per line, so a change to one layer reads as one line in a diff
const json = (rules) => `[\n${rules.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;
const images = JSON.parse(readFileSync(new URL('images.json', import.meta.url), 'utf8'));
const shared = JSON.parse(readFileSync(new URL('../style/slide.style.json', import.meta.url), 'utf8'));
const H = 56.25;
// lengths in hundredths, as Style.lean has them
const h = (v) => Math.round(v * 100);
const pct = (v) => [h(v), '%'];
const cqw = (v) => [h(v), 'cqw'];
const turn = (deg) => ['transform', [['rotate', h(deg)]]];
// how far down an object's label sits, as a share of its size: a phone fills its image to the bottom
const foot = { 'phone-key': 1, 'phone-print': 1, badge: 0.97, signet: 0.94 };
const at = (x, y) => [['left', pct(x)], ['top', pct((y / H) * 100)]];

function slide(id, title, aria) {
	const layers = [];
	const rules = [];
	const el = (tag, cls, kids = [], more = []) => [tag, [['class', cls], ...more], kids];
	// a rule for one of this slide's layers: `.<id> .<cls>`
	const rule = (cls, decls) => rules.push([[[null, [id]], [null, [cls]]], decls]);
	const s = {
		// an object, its top left at (x, y), s wide and high, its label centred under it (one line, or two)
		put(name, cls, x, y, size, label) {
			layers.push(el('img', `obj ${cls}`, [], [['src', `/files/${images[name]}`], ['alt', '']]));
			rule(cls, [...at(x, y), ['width', cqw(size)], ['height', cqw(size)]]);
			if (label) s.label(`${cls}-label`, label, x + size / 2, y + size * (foot[name] ?? 0.9));
			return s;
		},
		label(cls, text, x, y, relation = false) {
			layers.push(el('p', `label${relation ? ' relation' : ''} ${cls}`, [text]));
			rule(cls, at(x, y));
			return s;
		},
		note(cls, text, x, y, w) {
			layers.push(el('p', `note ${cls}`, [text]));
			rule(cls, [...at(x, y), ['width', cqw(w)]]);
			return s;
		},
		// a dotted path from a to b, arching by `lift`, named at its top
		path(cls, a, b, lift, name) {
			const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift];
			const pts = Array.from({ length: 9 }, (_, i) => {
				const t = i / 8;
				return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t ** 2 * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t ** 2 * b[1]];
			});
			const segs = [];
			for (let i = 0; i < 8; i++) {
				const [x0, y0] = pts[i];
				const [x1, y1] = pts[i + 1];
				segs.push(el('div', `dots ${cls}-${i + 1}`));
				rule(`${cls}-${i + 1}`, [...at(x0, y0), ['width', cqw(Math.hypot(x1 - x0, y1 - y0))], turn((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI)]);
			}
			const [x0, y0] = pts[7];
			const [x1, y1] = pts[8];
			segs.push(el('div', `head ${cls}-head`));
			rule(`${cls}-head`, [...at(x1 - 1.2, y1 - 1.2), turn((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI)]);
			layers.push(el('div', `path ${cls}`, segs));
			if (name) s.label(`${cls}-name`, name, c[0], (a[1] + b[1]) / 2 - lift / 2 - 4.6, true);
			return s;
		},
		write() {
			const tree = el('figure', `slide ${id}`, [...layers, el('header', 'title', [el('h2', 'headline', [title])])], [['role', 'img'], ['aria-label', aria]]);
			writeFileSync(new URL(`../id/slides/${id}.html`, import.meta.url), `${html(tree)}\n`);
			writeFileSync(new URL(`../id/slides/${id}.style.json`, import.meta.url), json(rules));
			const part = [markup(tree), [...shared, ...rules]];
			writeFileSync(new URL(`../id/slides/${id}.part.json`, import.meta.url), `${JSON.stringify(part)}\n`);
		},
	};
	return s;
}

slide('sign', 'A key signs', "Alice's key, a signet stamp. A dotted path labelled signs runs to a letter: Share the photos with Bob, with her signature mark pressed on it in red wax.")
	.put('signet', 'key', 9, 12, 28, 'Alice’s key')
	.path('signs', [36, 30], [58, 30], 8, 'signs')
	.put('letter', 'words', 58, 10, 32, 'Words + signature')
	.write();

slide('check', 'Anyone can check a signature', "The signed letter, plus a card with Alice's public imprint. A dotted path labelled checks runs to a magnifying glass, and on to a green tick: it fits.")
	.put('letter', 'words', 2, 14, 25, 'Signed letter')
	.label('plus', '+', 28.5, 26)
	.put('imprint', 'public', 30, 14, 25, 'Her public key')
	.path('checks', [55, 30], [66, 30], 6, 'checks')
	.put('magnifier', 'glass', 63, 13, 20)
	.put('tick', 'ok', 81, 17, 16, 'It fits')
	.write();

slide('vault', 'A vault', "Alice's vault, a sturdy strongbox with her nameplate. Beside it the four kinds of vault: a person's strongbox, a coop's green guild chest, an agent, a robot helper, and a device, a phone.")
	.put('chest', 'alice', 4, 9, 40, 'Alice’s vault')
	.put('chest', 'k-person', 52, 8, 17, 'Person')
	.put('guild-chest', 'k-coop', 75, 8, 17, 'Coop')
	.put('robot', 'k-agent', 52, 30, 17, 'Agent')
	.put('phone-key', 'k-device', 75, 30, 17, 'Device')
	.write();

slide('owns', 'A key owns a vault', "Alice's key, the signet. A dotted path labelled owns runs to her strongbox, whose brass plate bears the signet's mark: its owner.")
	.put('signet', 'key', 7, 12, 28, 'Alice’s key')
	.path('owns', [34, 30], [55, 30], 8, 'owns')
	.put('chest', 'alice', 54, 7, 38)
	.label('vault-label', 'Alice’s vault', 73, 41.5)
	.note('plate-note', 'Its plate bears her key’s mark: the owner', 55.5, 46.5, 40)
	.write();

slide('device', 'A device keeps its own key', "Alice's phone, a small signet shut in a glass case on its screen: its own key, made on the phone, never leaving it.")
	.put('phone-key', 'phone', 12, 7, 37, 'Alice’s phone')
	.note('keep-note', 'Its own key: made on the phone, never leaving it', 56, 24, 38)
	.write();

slide('passkey', 'A passkey', "Alice's phone with a fingerprint glowing on its screen: her passkey. A dotted path labelled unlocks runs to her owner key, the signet.")
	.put('phone-print', 'phone', 8, 7, 36, 'Her passkey')
	.path('unlocks', [42, 30], [60, 30], 8, 'unlocks')
	.put('signet', 'key', 60, 12, 28, 'Her owner key')
	.write();

slide('acts-for', 'A device acts for a vault', "Alice's phone with its own key, and a permit badge: its device cap. A dotted path labelled acts for runs to her strongbox.")
	.put('phone-key', 'phone', 1, 11, 27, 'Alice’s phone')
	.put('badge', 'cap', 28, 12, 21, 'Device cap')
	.path('acts', [48, 30], [62, 30], 8, 'acts for')
	.put('chest', 'alice', 60, 9, 34, 'Alice’s vault')
	.write();

slide('vaults-own', 'Vaults own vaults', "Alice's strongbox, a dotted path labelled owns down to Maia City's green guild chest, and another down to Aven, a robot helper: each owns the next.")
	.put('chest', 'alice', 3, 9, 25, 'Alice’s vault')
	.path('owns-1', [27, 24], [38, 30], 6, 'owns')
	.put('guild-chest', 'maia', 37, 15, 25, 'Maia City')
	.path('owns-2', [61, 30], [72, 36], 6, 'owns')
	.put('robot', 'aven', 72, 21, 24, 'Aven')
	.note('down-note', 'Alice’s vault governs everything below it. Authority runs only down.', 4, 46.5, 64)
	.write();

slide('cap', 'A cap', "Alice's strongbox. A dotted path labelled grants runs to a pass bearing her signature mark: Bob may read her photos until 31 Dec 2026. Another path labelled held by runs to Bob's teal strongbox.")
	.put('chest', 'alice', 2, 13, 25, 'Alice · issuer')
	.path('grants', [26, 30], [36, 30], 6, 'grants')
	.put('pass', 'pass', 35, 10, 30)
	.label('may', 'May read her photos', 50, 35)
	.label('until', 'until 31 Dec 2026', 50, 39.5)
	.path('held', [64, 30], [74, 30], 6, 'held by')
	.put('chest-bob', 'bob', 73, 13, 25, 'Bob · holder')
	.write();
