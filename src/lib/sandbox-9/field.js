// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE FIELD — one hex of land seen from above, drawn on one canvas in the style of Primer's blobs: the
 * City COOP's land in the middle with the protocol's pools beside it, the basics COOPs on their plots in a first
 * ring, the crafted and scarce goods' COOPs in a second, and the people's homes round the edge.
 *
 * What moves is only what the world did that day (a frame from ./view.js):
 *   - people are small round blobs with eyes, coloured by their holdings tenth (light: holds least; dark: most);
 *     owner-only people are grey; a person short of a basic looks down and wears a red rim;
 *   - COOPs are bigger blobs, one colour per good, with a ring for the treasury (a full ring: the reserve is there);
 *     under each, a bar: its price, with a tick at its cost floor (variable cost ÷ 0.8);
 *   - coins, one colour per MIND, fly from a buyer to a pool (in the MIND it pays with) and on to the seller (in the
 *     seller's own MIND); a fifth of each sale splits off as tiny coins to holders of the seller's MIND;
 *   - food dots ripen on the forest by the season's harvest, rain falls into the tanks as hard as it rained, yellow
 *     sparks leave the dome cells and the geothermal pad as much as they harvested, and the field darkens with the
 *     month's sun.
 *
 *   const f = createField(canvas);  f.resize(w, h, dpr);  f.setFrame(frame);  f.draw(now);  f.pick(x, y)
 */
import { GOOD_IDS } from './consts.js';

export const GOOD_COLOUR = ['#6aa84f', '#3d8fd6', '#e9ac00', '#c8744f', '#8b6b3e', '#7d8794', '#6fbfd3', '#3f5aa8', '#d0789c', '#2bb3a3', '#7a5cc7'];
/** the holdings tenths, light (least) to dark (most): one blue ramp */
export const DECILE_COLOUR = ['#a9cbf3', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#0d366b'];
export const OWNER_COLOUR = '#9a9a94';
const BASIC_GOODS = [0, 1, 2, 3];

/** a MIND's colour: its COOP's good, a little lighter or darker for the second, third… COOP of that good */
export function mindColour(coops, k) {
	const co = coops?.find((c) => c.k === k);
	if (!co) return '#888';
	if (co.city) return '#5b6b5f';
	const same = coops.filter((c) => c.good === co.good && !c.city);
	const j = same.findIndex((c) => c.k === k);
	return shade(GOOD_COLOUR[co.good] ?? '#888', [0, -0.18, 0.18, -0.32, 0.3][j % 5]);
}

function shade(hex, t) {
	const n = parseInt(hex.slice(1), 16);
	let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
	const to = t < 0 ? 0 : 255, a = Math.abs(t);
	r = Math.round(r + (to - r) * a);
	g = Math.round(g + (to - g) * a);
	b = Math.round(b + (to - b) * a);
	return `rgb(${r},${g},${b})`;
}

/** a tiny seeded random source for fixed decorations (trees, dots) */
function rand(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 4294967296;
	};
}

const HEX = Array.from({ length: 6 }, (_, i) => [Math.cos((Math.PI / 3) * i), Math.sin((Math.PI / 3) * i)]);
const INNER = Math.sqrt(3) / 2;

export function createField(canvas) {
	const ctx = canvas.getContext('2d');
	let W = 0, H = 0, dpr = 1, S = 1, cx = 0, cy = 0;
	let frame = null;
	let lastDay = -1;
	let layout = { coops: new Map(), pools: [], key: '' };
	let people = []; // [x, y] in field units
	let coins = [];
	let sparks = [];
	let drops = [];
	let toasts = [];
	let sprites = null; // pre-drawn people blobs per colour (and a sad one)
	let bg = null; // the land, drawn once per size and layout
	let sel = null; // { kind: 'person', i } | { kind: 'coop', id }
	let bars = -1; // which basic's limit bar every blob wears (-1: none)
	let foodPeak = 1e-9;
	const deco = new Map(); // fixed decoration per COOP id
	let dim = 0;

	const X = (u) => cx + u * S;
	const Y = (v) => cy + v * S;

	function resize(w, h, ratio) {
		W = Math.max(1, w);
		H = Math.max(1, h);
		dpr = Math.min(1.5, ratio || 1);
		canvas.width = Math.round(W * dpr);
		canvas.height = Math.round(H * dpr);
		// the hex (flat top, radius 1) fits the canvas with a little room
		S = Math.min(W / 2, H / (2 * INNER)) * 0.96;
		cx = W / 2;
		cy = H / 2;
		sprites = null;
		bg = null;
	}

	// ── layout: where each COOP, pool and person sits ──
	function placeAll() {
		const list = frame.coops;
		const key = list.map((c) => c.id).join(',') + '|' + frame.pools.length + '|' + frame.N;
		if (key === layout.key) return;
		const prev = layout.coops;
		const coops = new Map();
		const city = list.find((c) => c.city);
		if (city) coops.set(city.id, { x: 0, y: 0, r: 0.07, plot: 0 });
		const inner = list.filter((c) => !c.city && BASIC_GOODS.includes(c.good));
		const outer = list.filter((c) => !c.city && !BASIC_GOODS.includes(c.good));
		const ring = (arr, R, r, plot, a0) =>
			arr.forEach((c, j) => {
				const a = a0 + (2 * Math.PI * j) / arr.length;
				const p = { x: R * Math.cos(a), y: R * Math.sin(a), r, plot };
				const old = prev.get(c.id);
				if (old) (p.fx = old.x), (p.fy = old.y), (p.ft = performance.now());
				coops.set(c.id, p);
			});
		ring(inner, 0.33, 0.045, Math.min(0.13, (Math.PI * 0.33) / Math.max(4, inner.length)), -Math.PI / 2);
		ring(outer, 0.565, 0.036, Math.min(0.1, (Math.PI * 0.565) / Math.max(8, outer.length)), -Math.PI / 2 + Math.PI / Math.max(8, outer.length));
		const pools = frame.pools.map((_, j, a) => {
			const ang = Math.PI / 4 + (2 * Math.PI * j) / a.length;
			return { x: 0.15 * Math.cos(ang), y: 0.15 * Math.sin(ang) };
		});
		// people: three rows round the edge, inside the hex
		const N = frame.N, rows = [0.84, 0.9, 0.96];
		people = [];
		const per = Math.ceil(N / rows.length);
		for (let i = 0; i < N; i++) {
			const row = i % rows.length, j = Math.floor(i / rows.length);
			const a = (2 * Math.PI * (j + row * 0.33)) / per;
			// each row follows the hex's edge, a little inside it
			const R = rows[row] * hexRadius(a);
			people.push([R * Math.cos(a), R * Math.sin(a)]);
		}
		layout = { coops, pools, key };
		bg = null;
	}
	/** how far the hex's edge is in direction a, as a share of its corner radius */
	function hexRadius(a) {
		const t = (((a % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6;
		return INNER / Math.cos(t);
	}
	function coopPos(id, now) {
		const p = layout.coops.get(id);
		if (!p) return { x: 0, y: 0, r: 0.03, plot: 0 };
		if (p.ft != null) {
			const t = Math.min(1, (now - p.ft) / 900);
			if (t >= 1) p.ft = null;
			else return { ...p, x: p.fx + (p.x - p.fx) * ease(t), y: p.fy + (p.y - p.fy) * ease(t) };
		}
		return p;
	}

	// ── a new day from the worker ──
	function setFrame(f) {
		const now = performance.now();
		const first = !frame;
		frame = f;
		placeAll();
		if (f.day === lastDay) return;
		const skipped = first ? 1 : Math.max(1, f.day - lastDay);
		lastDay = f.day;
		const forest = f.coops.find((c) => c.tech === 'forest');
		if (forest) foodPeak = Math.max(foodPeak * 0.999, forest.made);
		if (coins.length < 90) spawnCoins(now, skipped);
		spawnSparks(now);
		for (const e of f.events) {
			const text = e.kind === 'found' ? `${e.coop} founded (Law 3)` : e.kind === 'receivership' ? `${e.coop} in receivership${e.heir ? ` → ${e.heir}` : ''}` : `Shock: ${shockName(e.what)}`;
			toasts.push({ text, id: e.coop, t0: now });
		}
		if (toasts.length > 4) toasts = toasts.slice(-4);
	}

	function spawnCoins(now, skipped) {
		const f = frame;
		// at speed a frame stands for several days: fewer coins, so the field shows the flow and not a swarm
		const keep = skipped <= 1 ? 1 : skipped <= 4 ? 0.5 : 0.25;
		for (const c of f.coins) {
			const seller = f.coops.find((x) => x.k === c.k);
			if (!seller) continue;
			const sp = coopPos(seller.id, now);
			const pool = layout.pools[c.pool] ?? { x: 0, y: 0 };
			const colS = mindColour(f.coops, c.k);
			c.buyers.forEach((i, j) => {
				if (Math.random() > keep || !people[i]) return;
				const [bx, by] = people[i];
				const via = c.pays[j] !== c.k;
				const colB = mindColour(f.coops, c.pays[j]);
				const pts = via ? [[bx, by], [pool.x, pool.y], [sp.x, sp.y]] : [[bx, by], [sp.x, sp.y]];
				const dur = via ? 1100 : 700;
				coins.push({ pts, cols: via ? [colB, colS] : [colS], t0: now + Math.random() * 250, dur, size: 1, then: { k: c.k, from: [sp.x, sp.y], holders: c.holders, tre: c.tre, col: colS } });
			});
			for (const j of c.coopBuyers ?? []) {
				if (Math.random() > keep * 0.6) continue;
				const buyer = f.coops.find((x) => x.k === j);
				if (!buyer) continue;
				const bp = coopPos(buyer.id, now);
				coins.push({ pts: [[bp.x, bp.y], [pool.x, pool.y], [sp.x, sp.y]], cols: [mindColour(f.coops, j), colS], t0: now + Math.random() * 250, dur: 1100, size: 1, then: { k: c.k, from: [sp.x, sp.y], holders: c.holders, tre: c.tre, col: colS } });
			}
		}
	}
	/** a coin that reached its seller: a fifth splits off to holders (Law 5), as tiny coins of the seller's MIND */
	function splitFifth(c, now) {
		const t = c.then;
		for (const i of t.holders) if (people[i]) coins.push({ pts: [t.from, people[i]], cols: [t.col], t0: now, dur: 650, size: 0.5 });
		if (t.tre >= 0) {
			const co = frame.coops.find((x) => x.k === t.tre);
			if (co) {
				const p = coopPos(co.id, now);
				coins.push({ pts: [t.from, [p.x, p.y]], cols: [t.col], t0: now, dur: 650, size: 0.5 });
			}
		}
	}

	function spawnSparks(now) {
		const f = frame, per = f.N || 1;
		for (const co of f.coops) {
			if (!co.alive || co.good !== 2) continue;
			const kwh = co.tech === 'solar' ? f.energy.solar : co.tech === 'geo' ? f.energy.geo : 0;
			// about one spark for each 6 kWh a person harvested today, at most 8 a source
			const n = Math.min(8, Math.round(kwh / per / 6 + Math.random() * 0.6));
			const p = coopPos(co.id, now);
			for (let j = 0; j < n && sparks.length < 70; j++) {
				const to = Math.random() < 0.7 && people.length ? people[Math.floor(Math.random() * people.length)] : [Math.random() - 0.5, Math.random() - 0.5];
				sparks.push({ from: [p.x + (Math.random() - 0.5) * p.plot, p.y + (Math.random() - 0.5) * p.plot], to, t0: now + Math.random() * 400, dur: 700 + Math.random() * 500 });
			}
		}
	}

	// ── drawing ──
	function makeSprites() {
		const r = Math.max(2, 0.021 * S);
		const size = Math.ceil((r * 2 + 4) * dpr);
		const one = (col, sad) => {
			const c = document.createElement('canvas');
			c.width = c.height = size;
			const g = c.getContext('2d');
			g.scale(dpr, dpr);
			const m = size / dpr / 2;
			blob(g, m, m, r, col, sad ? 1 : 0, sad ? '#d03b3b' : null);
			return c;
		};
		sprites = { r, size, deciles: DECILE_COLOUR.map((c) => one(c)), owner: one(OWNER_COLOUR), sad: DECILE_COLOUR.map((c) => one(c, true)), ownerSad: one(OWNER_COLOUR, true) };
	}

	/** a soft blob with two eyes; look: 0 ahead, 1 down (short of a basic) */
	function blob(g, x, y, r, col, look = 0, rim = null) {
		g.beginPath();
		g.ellipse(x, y + r * 0.05, r, r * 0.94, 0, 0, Math.PI * 2);
		g.fillStyle = col;
		g.fill();
		if (rim) {
			g.lineWidth = Math.max(1, r * 0.22);
			g.strokeStyle = rim;
			g.stroke();
		}
		// a soft light from the upper left
		g.beginPath();
		g.ellipse(x - r * 0.35, y - r * 0.4, r * 0.32, r * 0.2, -0.6, 0, Math.PI * 2);
		g.fillStyle = 'rgba(255,255,255,0.28)';
		g.fill();
		if (r < 1.6) return;
		const ex = r * 0.34, ey = -r * 0.12, er = r * 0.27;
		for (const s of [-1, 1]) {
			g.beginPath();
			g.arc(x + s * ex, y + ey, er, 0, Math.PI * 2);
			g.fillStyle = '#fff';
			g.fill();
			g.beginPath();
			g.arc(x + s * ex + er * 0.15, y + ey + er * (look ? 0.45 : 0.1), er * 0.55, 0, Math.PI * 2);
			g.fillStyle = '#1d2420';
			g.fill();
		}
	}

	function drawBackground() {
		const c = document.createElement('canvas');
		c.width = canvas.width;
		c.height = canvas.height;
		const g = c.getContext('2d');
		g.scale(dpr, dpr);
		// the hex of land
		g.beginPath();
		HEX.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
		g.closePath();
		g.fillStyle = '#dfe6c8';
		g.fill();
		g.lineWidth = 1.5;
		g.strokeStyle = '#c3cca8';
		g.stroke();
		// the homes' band along the edge
		g.beginPath();
		HEX.forEach(([x, y], i) => (i ? g.lineTo(X(x * 0.9), Y(y * 0.9)) : g.moveTo(X(x * 0.9), Y(y * 0.9))));
		g.closePath();
		g.lineWidth = 0.13 * S;
		g.lineJoin = 'round';
		g.strokeStyle = 'rgba(236,224,200,0.6)';
		g.stroke();
		// the City COOP's land in the middle
		g.beginPath();
		g.arc(cx, cy, 0.215 * S, 0, Math.PI * 2);
		g.fillStyle = '#ece6d6';
		g.fill();
		g.strokeStyle = '#d6ccb4';
		g.lineWidth = 1;
		g.setLineDash([3, 3]);
		g.stroke();
		g.setLineDash([]);
		// paths from the centre to each COOP
		g.strokeStyle = 'rgba(214,204,180,0.7)';
		g.lineWidth = Math.max(1, 0.012 * S);
		for (const [, p] of layout.coops) {
			if (!p.plot) continue;
			g.beginPath();
			g.moveTo(cx, cy);
			g.lineTo(X(p.x), Y(p.y));
			g.stroke();
		}
		// plots
		for (const co of frame.coops) {
			const p = layout.coops.get(co.id);
			if (!p || !p.plot) continue;
			plot(g, co, p);
		}
		bg = c;
	}

	/** a COOP's plot, by what it runs (fixed parts; what changes by the day is drawn in drawPlotLive) */
	function plot(g, co, p) {
		const x = X(p.x), y = Y(p.y), R = p.plot * S;
		let d = deco.get(co.id);
		if (!d) {
			const r = rand([...co.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
			d = { pts: Array.from({ length: 40 }, () => { const a = r() * Math.PI * 2, s = Math.sqrt(r()); return [Math.cos(a) * s, Math.sin(a) * s, r()]; }) };
			deco.set(co.id, d);
		}
		g.save();
		g.globalAlpha = co.alive ? 1 : 0.45;
		const disc = (fill, stroke) => {
			g.beginPath();
			g.arc(x, y, R, 0, Math.PI * 2);
			g.fillStyle = fill;
			g.fill();
			if (stroke) {
				g.strokeStyle = stroke;
				g.lineWidth = 1;
				g.stroke();
			}
		};
		switch (co.tech) {
			case 'forest':
				disc('#b9d39a', '#a3c182');
				for (const [u, v] of d.pts.slice(0, 22)) {
					g.beginPath();
					g.arc(x + u * R * 0.85, y + v * R * 0.85, R * 0.14, 0, Math.PI * 2);
					g.fillStyle = '#7fa860';
					g.fill();
				}
				break;
			case 'greenhouse':
				disc('#d6ecd9', '#a9cdb0');
				for (const s of [0.45, 0.75]) {
					g.beginPath();
					g.arc(x, y, R * s, 0, Math.PI * 2);
					g.strokeStyle = 'rgba(120,170,130,0.6)';
					g.stroke();
				}
				break;
			case 'rain':
				disc('#e4ebef', '#cfd9df');
				break;
			case 'solar':
				disc('#d8dde6', '#b9c2d0');
				g.fillStyle = '#5b72a6';
				for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (i * i + j * j <= 5) g.fillRect(x + i * R * 0.3 - R * 0.12, y + j * R * 0.3 - R * 0.12, R * 0.24, R * 0.24);
				break;
			case 'geo':
				g.beginPath();
				for (let i = 0; i < 6; i++) g[i ? 'lineTo' : 'moveTo'](x + Math.cos((Math.PI / 3) * i) * R, y + Math.sin((Math.PI / 3) * i) * R);
				g.closePath();
				g.fillStyle = '#d4cfc6';
				g.fill();
				g.strokeStyle = '#b7afa2';
				g.stroke();
				for (const [u, v] of [[-0.4, 0.2], [0.35, 0.3], [0, -0.4]]) {
					g.beginPath();
					g.arc(x + u * R, y + v * R, R * 0.12, 0, Math.PI * 2);
					g.fillStyle = '#8a8277';
					g.fill();
				}
				break;
			case 'home':
				disc('#efe3cf', '#d9c6a6');
				for (const s of [0.9, 0.62, 0.34]) {
					g.beginPath();
					g.arc(x, y, R * s, 0, Math.PI * 2);
					g.strokeStyle = 'rgba(180,150,110,0.55)';
					g.stroke();
				}
				for (let i = 0; i < 6; i++) {
					g.beginPath();
					g.moveTo(x, y);
					g.lineTo(x + Math.cos((Math.PI / 3) * i) * R * 0.9, y + Math.sin((Math.PI / 3) * i) * R * 0.9);
					g.stroke();
				}
				break;
			case 'timber':
				disc('#c9d7ae', '#b0c290');
				for (const [u, v] of d.pts.slice(0, 12)) {
					const tx = x + u * R * 0.75, ty = y + v * R * 0.75, s = R * 0.2;
					g.beginPath();
					g.moveTo(tx, ty - s);
					g.lineTo(tx + s * 0.7, ty + s * 0.6);
					g.lineTo(tx - s * 0.7, ty + s * 0.6);
					g.closePath();
					g.fillStyle = '#5f8a4c';
					g.fill();
				}
				break;
			case 'spring':
				disc('#d7eee9', '#acd6cd');
				g.beginPath();
				g.ellipse(x, y, R * 0.7, R * 0.5, 0.3, 0, Math.PI * 2);
				g.fillStyle = '#7dcfc1';
				g.fill();
				break;
			default: {
				// the works: a building on its plot
				disc('#e6e1d6', '#d2cab8');
				const col = { steel: '#9aa3ad', glass: '#a9dbe7', panel: '#6f84bf', goods: '#e0a8bd', compute: '#7d6aa8' }[co.tech] ?? '#b8b0a0';
				g.fillStyle = col;
				g.fillRect(x - R * 0.55, y - R * 0.35, R * 1.1, R * 0.7);
				if (co.tech === 'steel') g.fillRect(x + R * 0.25, y - R * 0.75, R * 0.18, R * 0.45);
			}
		}
		g.restore();
	}

	function drawPlotLive(co, p, now) {
		const x = X(p.x), y = Y(p.y), R = p.plot * S, f = frame;
		const d = deco.get(co.id);
		if (co.tech === 'forest' && d) {
			// food dots by the day's harvest: at most 36, ripening red in summer and autumn
			const n = Math.round(36 * Math.min(1, co.made / foodPeak));
			const col = f.season === 'spring' ? '#e7f0a0' : f.season === 'winter' ? '#d8b38a' : '#e0503c';
			for (let j = 0; j < n; j++) {
				const [u, v] = d.pts[j % d.pts.length];
				g2(x + u * R * 0.9 + (j > 39 ? 2 : 0), y + v * R * 0.9, Math.max(1, R * 0.06), col);
			}
		} else if (co.tech === 'greenhouse') {
			const n = Math.round(10 * Math.min(1, co.made / Math.max(1e-9, co.capacity)));
			for (let j = 0; j < n && d; j++) g2(x + d.pts[j][0] * R * 0.6, y + d.pts[j][1] * R * 0.6, Math.max(1, R * 0.06), '#e0503c');
		} else if (co.tech === 'rain') {
			// three tanks, filled as full as the COOP's store against its tanks
			const fill = co.tankL > 0 ? Math.max(0, Math.min(1, co.stock / co.tankL)) : 0;
			for (let j = -1; j <= 1; j++) {
				const tx = x + j * R * 0.55 - R * 0.2, ty = y - R * 0.45, tw = R * 0.4, th = R * 0.9;
				ctx.fillStyle = '#f6f8fa';
				ctx.fillRect(tx, ty, tw, th);
				ctx.fillStyle = '#5aa2dd';
				ctx.fillRect(tx, ty + th * (1 - fill), tw, th * fill);
				ctx.strokeStyle = '#a9b8c4';
				ctx.lineWidth = 1;
				ctx.strokeRect(tx, ty, tw, th);
			}
		} else if (co.tech === 'spring' && co.made > 0) {
			const t = now / 1000;
			for (let j = 0; j < 3; j++) {
				const k = (t * 0.5 + j / 3) % 1;
				ctx.beginPath();
				ctx.arc(x + (j - 1) * R * 0.3, y - k * R * 0.9, R * (0.08 + k * 0.1), 0, Math.PI * 2);
				ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - k)})`;
				ctx.fill();
			}
		} else if (co.tech === 'geo' && co.made > 0) {
			const t = now / 1000;
			for (let j = 0; j < 3; j++) {
				const k = (t * 0.4 + j / 3) % 1;
				ctx.beginPath();
				ctx.arc(x + (j - 1) * R * 0.25, y - R * 0.2 - k * R * 1.1, R * (0.1 + k * 0.18), 0, Math.PI * 2);
				ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k)})`;
				ctx.fill();
			}
		}
	}
	function g2(x, y, r, col) {
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fillStyle = col;
		ctx.fill();
	}

	function draw(now) {
		if (!frame || !W) return;
		if (!sprites) makeSprites();
		if (!bg) drawBackground();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(bg, 0, 0);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const f = frame, t = now / 1000;
		// live parts of the plots
		for (const co of f.coops) {
			const p = layout.coops.get(co.id);
			if (p?.plot) drawPlotLive(co, p, now);
		}
		// pools: small baskets beside the City COOP
		for (let j = 0; j < layout.pools.length; j++) {
			const p = layout.pools[j], m = f.pools[j] ?? [];
			const x = X(p.x), y = Y(p.y), r = 0.035 * S;
			ctx.beginPath();
			ctx.arc(x, y, r, 0, Math.PI * 2);
			ctx.fillStyle = 'rgba(255,255,255,0.85)';
			ctx.fill();
			ctx.strokeStyle = '#9f9682';
			ctx.lineWidth = 1;
			ctx.stroke();
			m.forEach((k, i) => {
				const a = (2 * Math.PI * i) / m.length;
				g2(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, Math.max(1.2, r * 0.22), mindColour(f.coops, k));
			});
		}
		// COOPs
		for (const co of f.coops) drawCoop(co, coopPos(co.id, now), t);
		// rain, into the field and the tanks
		const rainN = Math.round(Math.min(40, 10 * f.rain));
		while (drops.length < rainN) drops.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, v: 0.5 + Math.random() * 0.5 });
		if (drops.length > rainN) drops.length = rainN;
		ctx.save();
		ctx.beginPath();
		HEX.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
		ctx.closePath();
		ctx.clip();
		ctx.strokeStyle = 'rgba(70,130,190,0.45)';
		ctx.lineWidth = 1;
		for (const d of drops) {
			d.y += d.v * 0.03;
			if (d.y > 1) (d.y = -1), (d.x = Math.random() * 2 - 1);
			ctx.beginPath();
			ctx.moveTo(X(d.x), Y(d.y));
			ctx.lineTo(X(d.x) - 1.5, Y(d.y) + 0.035 * S);
			ctx.stroke();
		}
		ctx.restore();
		// people
		const sp = sprites, half = sp.size / dpr / 2;
		for (let i = 0; i < people.length && i < f.N; i++) {
			const [u, v] = people[i];
			const bob = Math.sin(t * 2.2 + i * 1.7) * sp.r * 0.22;
			const short = f.met[i] < 0.98; // NaN before the first day: nobody is short yet
			const img = f.owner[i] ? (short ? sp.ownerSad : sp.owner) : (short ? sp.sad : sp.deciles)[f.dec[i]] ?? sp.deciles[0];
			ctx.drawImage(img, X(u) - half, Y(v) - half + bob, sp.size / dpr, sp.size / dpr);
			if (bars >= 0) limitBar(i, X(u) + sp.r * 1.15, Y(v) + bob + sp.r, sp.r);
		}
		// sparks
		ctx.fillStyle = '#f5c400';
		sparks = sparks.filter((s) => now - s.t0 < s.dur);
		for (const s of sparks) {
			const k = (now - s.t0) / s.dur;
			if (k < 0) continue;
			const x = s.from[0] + (s.to[0] - s.from[0]) * k, y = s.from[1] + (s.to[1] - s.from[1]) * k - Math.sin(k * Math.PI) * 0.06;
			star(X(x), Y(y), Math.max(1.5, 0.012 * S) * (1 - k * 0.5));
		}
		// coins
		const done = [];
		coins = coins.filter((c) => {
			const k = (now - c.t0) / c.dur;
			if (k >= 1) {
				if (c.then) done.push(c);
				return false;
			}
			return true;
		});
		for (const c of done) splitFifth(c, now);
		for (const c of coins) {
			const k = (now - c.t0) / c.dur;
			if (k < 0) continue;
			const legs = c.pts.length - 1, lk = Math.min(legs - 1e-9, ease(k) * legs), li = Math.floor(lk), lt = lk - li;
			const [ax, ay] = c.pts[li], [bx, by] = c.pts[li + 1];
			const x = ax + (bx - ax) * lt, y = ay + (by - ay) * lt - Math.sin(lt * Math.PI) * 0.04;
			const r = Math.max(c.size < 1 ? 1.2 : 2, (c.size < 1 ? 0.008 : 0.014) * S);
			ctx.beginPath();
			ctx.arc(X(x), Y(y), r, 0, Math.PI * 2);
			ctx.fillStyle = c.cols[Math.min(c.cols.length - 1, li)];
			ctx.fill();
			ctx.strokeStyle = 'rgba(255,255,255,0.9)';
			ctx.lineWidth = 1;
			ctx.stroke();
		}
		// the selected person or COOP
		if (sel?.kind === 'person' && people[sel.i] && sel.i < f.N) {
			const [u, v] = people[sel.i];
			ctx.beginPath();
			ctx.arc(X(u), Y(v), sp.r * 1.9, 0, Math.PI * 2);
			ctx.strokeStyle = '#26382c';
			ctx.lineWidth = 2;
			ctx.stroke();
			if (bars < 0) limitBar(sel.i, X(u) + sp.r * 1.15, Y(v) + sp.r, sp.r, Math.max(0, sel.b ?? 1));
		}
		// sunlight: the field is as bright as the month's sun (and a dark winter's)
		const target = 0.22 * (1 - Math.min(1, f.sun / 1.5));
		dim += (target - dim) * 0.08;
		if (dim > 0.005) {
			ctx.beginPath();
			HEX.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
			ctx.closePath();
			ctx.fillStyle = `rgba(24,34,64,${dim})`;
			ctx.fill();
		}
		// events of the last seconds, by their COOP
		toasts = toasts.filter((x) => now - x.t0 < 3500);
		ctx.font = `600 ${Math.max(10, Math.round(0.034 * S))}px system-ui, sans-serif`;
		ctx.textAlign = 'center';
		toasts.forEach((x, j) => {
			const p = x.id ? coopPos(x.id, now) : { x: 0, y: -0.25 };
			const tx = X(p.x), ty = Y(p.y) - 0.08 * S - j * 14;
			const w = ctx.measureText(x.text).width + 10;
			ctx.fillStyle = 'rgba(38,56,44,0.85)';
			roundRect(tx - w / 2, ty - 10, w, 16, 8);
			ctx.fill();
			ctx.fillStyle = '#fff';
			ctx.fillText(x.text, tx, ty + 2);
		});
	}

	function drawCoop(co, p, t) {
		const x = X(p.x), y = Y(p.y), r = p.r * S;
		const col = co.city ? '#5b6b5f' : mindColour(frame.coops, co.k);
		const bob = Math.sin(t * 1.6 + co.k) * r * 0.08;
		ctx.save();
		ctx.globalAlpha = co.alive ? 1 : 0.4;
		// the treasury ring: full when the treasury holds its reserve
		const fill = co.reserveR > 0 ? Math.min(1, co.treasuryR / co.reserveR) : 1;
		ctx.beginPath();
		ctx.arc(x, y + bob, r * 1.32, 0, Math.PI * 2);
		ctx.strokeStyle = 'rgba(255,255,255,0.8)';
		ctx.lineWidth = Math.max(2, r * 0.22);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(x, y + bob, r * 1.32, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * fill);
		ctx.strokeStyle = fill >= 1 ? '#c8961a' : '#d9b54a';
		ctx.stroke();
		blob(ctx, x, y + bob, r, col, co.alive ? 0 : 1);
		// price and cost floor: a bar under the blob, as long as the price, with a tick at the floor
		if (co.alive && co.priceR > 0) {
			const bw = r * 2.2, bx = x - bw / 2, by = y + bob + r * 1.55, bh = Math.max(2, r * 0.18);
			ctx.fillStyle = 'rgba(255,255,255,0.85)';
			ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
			ctx.fillStyle = col;
			ctx.fillRect(bx, by, bw, bh);
			const fl = Math.max(0, Math.min(1.2, (co.floorR || 0) / co.priceR));
			ctx.fillStyle = '#26382c';
			ctx.fillRect(bx + bw * Math.min(1, fl) - 1, by - 2, 2, bh + 4);
		}
		if (sel?.kind === 'coop' && sel.id === co.id) {
			ctx.beginPath();
			ctx.arc(x, y + bob, r * 1.75, 0, Math.PI * 2);
			ctx.strokeStyle = '#26382c';
			ctx.lineWidth = 2;
			ctx.stroke();
		}
		if (S > 230) {
			ctx.font = `600 ${Math.round(Math.max(9, r * 0.62))}px system-ui, sans-serif`;
			ctx.textAlign = 'center';
			ctx.fillStyle = '#26382c';
			ctx.fillText(co.id, x, y + bob - r * 1.6);
		}
		ctx.restore();
	}

	/** a person's limit bar for one basic, beside its blob: green above the price mark, red below it */
	function limitBar(i, x, y, r, b = bars) {
		const lim = frame.lim[i * 4 + b], p = frame.price[b];
		const ratio = p > 0 ? lim / p : 0;
		const h0 = r * 1.3; // the price mark
		const h = ratio > 0 ? Math.max(0.5, Math.min(r * 4, h0 * (1 + Math.log10(ratio) / 2))) : 0.5;
		ctx.fillStyle = ratio >= 1 ? '#2f9e5a' : '#d03b3b';
		ctx.fillRect(x, y - h, Math.max(1.5, r * 0.35), h);
		ctx.fillStyle = '#26382c';
		ctx.fillRect(x - 1, y - h0, Math.max(1.5, r * 0.35) + 2, 1.2);
	}

	function star(x, y, r) {
		ctx.beginPath();
		for (let i = 0; i < 8; i++) {
			const a = (Math.PI / 4) * i, rr = i % 2 ? r * 0.45 : r;
			ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
		}
		ctx.closePath();
		ctx.fill();
	}
	function roundRect(x, y, w, h, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	/** what is under a point of the canvas (CSS pixels): a person, a COOP, or nothing */
	function pick(px, py) {
		if (!frame) return null;
		const u = (px - cx) / S, v = (py - cy) / S, now = performance.now();
		let best = null, bd = Infinity;
		for (const co of frame.coops) {
			const p = coopPos(co.id, now);
			const d = Math.hypot(u - p.x, v - p.y);
			if (d < Math.max(p.r * 1.6, 0.06) && d < bd) (bd = d), (best = { kind: 'coop', id: co.id, k: co.k });
		}
		if (best) return best;
		for (let i = 0; i < people.length && i < frame.N; i++) {
			const d = Math.hypot(u - people[i][0], v - people[i][1]);
			if (d < 0.045 && d < bd) (bd = d), (best = { kind: 'person', i });
		}
		return best;
	}

	return {
		resize,
		setFrame,
		draw,
		pick,
		select: (s) => (sel = s),
		setBars: (b) => (bars = b),
		get frame() {
			return frame;
		}
	};
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const shockName = (k) => ({ drought: 'drought', darkWinter: 'a dark winter', coopFail: 'a COOP fails', wellFail: 'the geothermal well fails', germany: 'holdings as unequal as Germany’s', ring: 'a founder ring' })[k] ?? k;
export { GOOD_IDS, shockName };
