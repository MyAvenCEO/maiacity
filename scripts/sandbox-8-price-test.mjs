// Sandbox 7: the real-card test of a candidate price rule against a world's own, as the research "Fast scarcity prices
// for aven markets" (2026-10-11) fixed it before any run. It takes the next world's cards and the prices that world
// inherits, and plays the NAIVE stand-in (scripts/sandbox-8-posted.mjs) on nine paired seeds for three Trading cards,
// all from those same prices:
//   own     the cards as they are (MIP #42: the flow price, step 0.15)
//   middle  the same price rule, every good's first price at the middle of the inherited prices
//   buffer  the card's `price` hook replaced by the candidate (scripts/sandbox-8-buffer-price.js)
// It prints each arm's numbers, the report's decision for each pair (adopt; extend: nine more seeds; or keep), and which
// Trading card the next world should take; each arm's card code stays in the out folder, so a MIP proposes exactly the
// code that was tested.
// Run: node scripts/sandbox-8-price-test.mjs <cards.json> <inherited-prices.json> [--days 58] [--seeds 1,2,3]
//   [--rule scripts/sandbox-8-buffer-price.js] [--out folder]
// cards.json: the next world's cards, an array (or an object holding `cards`); inherited-prices.json: { good: price },
// the last prices of the world it follows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCode } from '../src/lib/sandbox-8/sandbox.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (why) => {
	console.error(`sandbox-8-price-test: ${why}`);
	process.exit(1);
};

const opt = { days: '58', seeds: '120693980,7,99,1,2,3,42,4,5', rule: path.join(ROOT, 'scripts/sandbox-8-buffer-price.js'), out: '' };
const files = [];
for (let i = 2; i < process.argv.length; i++) {
	const m = process.argv[i].match(/^--(\w+)$/);
	if (m && m[1] in opt) opt[m[1]] = process.argv[++i] ?? '';
	else if (m) fail(`no option --${m[1]}`);
	else files.push(process.argv[i]);
}
if (files.length !== 2) fail('run: node scripts/sandbox-8-price-test.mjs <cards.json> <inherited-prices.json> [--days 58] [--seeds 1,2,3] [--rule file.js] [--out folder]');
const days = Number(opt.days);
const seeds = opt.seeds.split(',').map(Number);
if (!(days > 0) || !seeds.length || seeds.some((s) => !Number.isInteger(s))) fail('--days takes a number of days, --seeds whole numbers split by commas');

const raw = JSON.parse(fs.readFileSync(files[0], 'utf8'));
const cards = Array.isArray(raw) ? raw : (raw.cards ?? raw.config?.cards);
if (!Array.isArray(cards)) fail(`${files[0]} holds no cards: an array, or an object with \`cards\``);
const inheritedFile = path.resolve(files[1]);
const inherited = JSON.parse(fs.readFileSync(inheritedFile, 'utf8'));
if (!Object.values(inherited).length || Object.values(inherited).some((p) => !(p > 0))) fail(`${files[1]} must hold each good's last price above 0, as { "water": 4.8, ... }`);

// the `price` hook a card's code exports, and the same code with that export taken off (the function stays, under its
// own name, for anything in the card that calls it)
const PRICE = /export\s+((?:async\s+)?function\s+price\s*\(|(?:const|let|var)\s+price\s*=)/g;
const unexport = (code, what) => {
	if ((code.match(PRICE) ?? []).length !== 1 || /export\s*\{[^}]*\bprice\b/.test(code)) fail(`${what} must export one \`price\` hook, as \`export function price(...)\``);
	return code.replace(PRICE, '$1');
};
const trading = cards.find((c) => c.id === 'trading');
if (!trading?.code?.trim()) fail("the cards have no Trading card with code: the test compares a posted-price world's price rules");
const own = unexport(trading.code, "the Trading card's code");
const rule = fs.readFileSync(path.resolve(opt.rule), 'utf8');
const candidate = unexport(rule, opt.rule);
if (/^\s*(import|export)\s/m.test(candidate)) fail(`${opt.rule} may export only its \`price\` hook and import nothing`);

const ARMS = {
	own: trading.code,
	middle: `${own}

// the price test's middle arm: this card's own price rule, every good's first price at the middle of the inherited
// prices (the same for every good)
const ownPrice__ = price;
function middlePrice__(x) {
  const p = ownPrice__(x);
  if (x.price != null) return p;
  const all = Object.values(x.previous ?? {}).filter((q) => q > 0).sort((a, b) => a - b);
  return all.length ? all[Math.floor(all.length / 2)] : p;
}
export { middlePrice__ as price };
`,
	buffer: `${own}

// the price test's buffer arm: the candidate price rule (${path.basename(opt.rule)}) in place of this card's own
const candidatePrice__ = (() => {
${candidate}
return price;
})();
export { candidatePrice__ as price };
`
};

const out = opt.out ? path.resolve(opt.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-8-price-test-'));
for (const [arm, code] of Object.entries(ARMS)) {
	const armCards = cards.map((c) => (c.id === 'trading' ? { ...c, code } : c));
	const run = await loadCode(armCards);
	const info = run?.info();
	if (!run?.has('price') || info.errors.length) fail(`the ${arm} arm's cards don't load: ${JSON.stringify(info?.errors ?? [])}`);
	const others = run.units.filter((u) => u.id !== 'trading' && u.hooks.includes('price')).map((u) => u.name);
	if (others.length) console.log(`note: ${others.join(', ')} export \`price\` too, and are called after the Trading card's`);
	run.dispose();
	// a card's code holds at most 20,000 characters (checkCard in game/economy/params.js)
	if (code.length > 20000) console.log(`note: the ${arm} arm's Trading card is ${code.length} characters, over a card's 20,000: drop the own price function it no longer exports before proposing it`);
	fs.mkdirSync(path.join(out, arm), { recursive: true });
	fs.writeFileSync(path.join(out, arm, 'cards.json'), JSON.stringify(armCards, null, 1));
	fs.writeFileSync(path.join(out, arm, 'trading.js'), code);
}

// every arm on every seed, a few at a time
const jobs = Object.keys(ARMS).flatMap((arm) => seeds.map((seed) => ({ arm, seed, log: path.join(out, arm, `seed-${seed}.log`) })));
const width = Math.max(1, Math.min(jobs.length, (os.availableParallelism?.() ?? os.cpus().length) - 1));
console.log(`Playing ${jobs.length} runs of ${days} days (${width} at a time), logs in ${out}`);
const play = (j) =>
	new Promise((resolve, reject) => {
		const fd = fs.openSync(j.log, 'w');
		const child = spawn(process.execPath, [path.join(ROOT, 'scripts/sandbox-8-posted.mjs'), path.join(out, j.arm, 'cards.json'), String(days), String(j.seed), inheritedFile], { cwd: ROOT, env: { ...process.env, NAIVE: '1', ROWS: '1' }, stdio: ['ignore', fd, 'pipe'] });
		fs.closeSync(fd);
		let err = '';
		child.stderr.on('data', (d) => (err += d));
		child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`the ${j.arm} arm, seed ${j.seed}, stopped (${code}): ${err.slice(-1500)}`))));
	});
let next = 0;
await Promise.all(
	Array.from({ length: width }, async () => {
		while (next < jobs.length) await play(jobs[next++]);
	})
);

/** one run's numbers, from the stand-in's daily rows and its totals */
function measure(j) {
	const lines = fs.readFileSync(j.log, 'utf8').split('\n');
	const errors = JSON.parse(lines.find((l) => l.startsWith('errors '))?.slice(7) ?? 'null');
	if (!Array.isArray(errors) || errors.length) fail(`the ${j.arm} arm's cards failed on seed ${j.seed}: ${JSON.stringify(errors)} (log: ${j.log})`);
	const t = lines.find((l) => l.startsWith('totals:'))?.match(/deaths (\d+) \(first 10 days (\d+)\).*units short (\d+), rotted (\d+)/);
	const rows = lines.filter((l) => l.startsWith('row ')).map((l) => JSON.parse(l.slice(4)));
	if (!t || !rows.length) fail(`no totals in ${j.log}`);
	const goods = Object.keys(rows[0].need);
	const moves = rows.flatMap((r) => r.moves.map((m) => ({ ...m, day: r.day })));
	// crowding: three or more avens moving fields into one crop within the time that crop takes to grow
	let crowding = 0;
	for (const g of goods) {
		let was = 0;
		for (const r of rows) {
			const into = new Set(moves.filter((m) => m.to === g && (m.kind === 'open' || m.kind === 'change') && m.day > r.day - r.ramp[g] && m.day <= r.day).map((m) => m.name));
			if (into.size >= 3 && was < 3) crowding += 1;
			was = into.size;
		}
	}
	// the most fields any crop held beyond its need, counted at their grown yield (rain left out)
	let peak = -Infinity;
	for (const r of rows)
		for (const g of goods) {
			const grown = r.avens.filter((a) => a.alive).reduce((n, a) => n + a.fields.filter((f) => f[0] === g).reduce((m, f) => m + f[2], 0), 0);
			if (r.field[g] > 0) peak = Math.max(peak, (grown - r.need[g]) / r.field[g]);
		}
	// for the record: how far prices swung after day 10, days a good grown above its need was dearer than one grown
	// below, the day's cost of what one aven needs, and the least HEARTS of an aven with no field
	const late = rows.filter((r) => r.day > 10);
	const swing = goods.map((g) => late.map((r) => r.posted[g]).filter((p) => p > 0)).filter((p) => p.length).map((p) => Math.log10(Math.max(...p) / Math.min(...p)));
	let upside = 0;
	for (const r of rows) {
		const below = goods.filter((g) => r.harvest[g] < r.need[g]).map((g) => r.posted[g] ?? Infinity);
		upside += goods.filter((g) => r.harvest[g] > r.need[g] && r.posted[g] > Math.min(...below)).length;
	}
	const bundle = rows.map((r) => goods.reduce((n, g) => n + ((r.posted[g] ?? 0) * r.need[g]) / Math.max(1, r.alive), 0));
	const fieldless = rows.flatMap((r) => r.avens.filter((a) => a.alive && !a.fields.length).map((a) => a.hearts));
	return {
		deaths: Number(t[1]),
		deaths10: Number(t[2]),
		short: Number(t[3]),
		rot: Number(t[4]),
		paid: rows.at(-1).paid,
		opened: moves.filter((m) => m.kind === 'open').length,
		changed: moves.filter((m) => m.kind === 'change').length,
		crowding,
		peak,
		swing: swing.reduce((n, x) => n + x, 0) / Math.max(1, swing.length),
		upside,
		bundle: bundle.reduce((n, x) => n + x, 0) / bundle.length,
		poorest: fieldless.length ? Math.min(...fieldless) : null
	};
}

const SUM = ['deaths', 'deaths10', 'short', 'rot', 'paid', 'opened', 'changed', 'crowding', 'upside'];
const arms = {};
for (const arm of Object.keys(ARMS)) {
	const per = seeds.map((seed) => measure(jobs.find((j) => j.arm === arm && j.seed === seed)));
	const mean = (k) => per.reduce((n, x) => n + x[k], 0) / per.length;
	const poor = per.map((x) => x.poorest).filter((x) => x != null);
	arms[arm] = { per, ...Object.fromEntries(SUM.map((k) => [k, per.reduce((n, x) => n + x[k], 0)])), peak: mean('peak'), swing: mean('swing'), bundle: mean('bundle'), poorest: poor.length ? Math.min(...poor) : null };
}

const n = seeds.length;
const num = (x, d = 0) => (x == null ? '-' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
/** the report's decision for a candidate arm against a base arm: adopt, extend (nine more seeds) or keep */
function judge(c, b) {
	const lower = seeds.filter((_, i) => c.per[i].short < b.per[i].short).length;
	const cut = b.short > 0 ? 1 - c.short / b.short : c.short ? -1 : 0;
	const broken = [];
	if (c.deaths > b.deaths) broken.push(`more deaths (${c.deaths} against ${b.deaths})`);
	if (c.crowding > b.crowding) broken.push(`more crowding (${c.crowding} against ${b.crowding})`);
	if (c.peak > b.peak + 0.05) broken.push(`more surplus fields at the peak (${num(c.peak, 1)} against ${num(b.peak, 1)})`);
	if (c.rot > 2.5 * b.rot) broken.push(`rot over 2.5x (${num(c.rot)} against ${num(b.rot)})`);
	if (c.changed > 2.5 * b.changed) broken.push(`crop changes over 2.5x (${c.changed} against ${b.changed})`);
	if (c.paid > 2 * b.paid) broken.push(`Coop payments over 2x (${num(c.paid)} against ${num(b.paid)})`);
	const short = `units short ${cut >= 0 ? `${Math.round(cut * 100)}% lower` : `${Math.round(-cut * 100)}% higher`} (${num(c.short)} against ${num(b.short)}), lower on ${lower} of ${n} seeds`;
	if (broken.length) return { verdict: 'keep', why: `${broken.join('; ')}; ${short}` };
	if (lower >= Math.ceil((7 / 9) * n) && cut >= 0.2) return { verdict: 'adopt', why: short };
	if (lower >= Math.ceil((6 / 9) * n) && cut >= 0.1) return { verdict: 'extend', why: short };
	return { verdict: 'keep', why: `${short}: not low enough` };
}

const label = { own: 'own (the cards as they are)', middle: 'middle (own rule, middle start)', buffer: `buffer (${path.basename(opt.rule)})` };
const report = [];
const say = (s = '') => report.push(s);
say(`# Price test: ${n} seeds x ${days} days, NAIVE stand-in`);
say();
say(`From ${files[1]}: ${Object.entries(inherited).map(([g, p]) => `${g} ${p}`).join(', ')}.`);
say();
say('| arm | deaths (first 10 days) | units short | seeds lower than own | rot | crop changes | fields opened | crowding | peak surplus fields | Coop paid | price swing | upside-down days | bundle a day | least HEARTS, no field |');
say('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [arm, a] of Object.entries(arms)) {
	const lower = arm === 'own' ? '-' : `${seeds.filter((_, i) => a.per[i].short < arms.own.per[i].short).length} of ${n}`;
	say(`| ${label[arm]} | ${a.deaths} (${a.deaths10}) | ${num(a.short)} | ${lower} | ${num(a.rot)} | ${a.changed} | ${a.opened} | ${a.crowding} | ${num(a.peak, 1)} | ${num(a.paid)} | ${num(a.swing, 2)} | ${a.upside} | ${num(a.bundle, 1)} | ${num(a.poorest)} |`);
}
say();
say(`Per seed, deaths / units short: ${seeds.map((s, i) => `${s}: ${Object.values(arms).map((a) => `${a.per[i].deaths}/${a.per[i].short}`).join(' ')}`).join('; ')} (own, middle, buffer).`);
say();
const bufOwn = judge(arms.buffer, arms.own);
const midOwn = judge(arms.middle, arms.own);
const bufMid = judge(arms.buffer, arms.middle);
say(`- buffer against own: **${bufOwn.verdict}**: ${bufOwn.why}`);
say(`- middle against own: **${midOwn.verdict}**: ${midOwn.why}`);
say(`- buffer against middle: **${bufMid.verdict}**: ${bufMid.why}`);
say();
// the next world takes the buffer price where it beats the cards' own rule and isn't beaten by the same rule from the
// middle start; else the middle start alone where that beats the own; a near thing asks for nine more seeds
const pick =
	bufOwn.verdict === 'adopt' && bufMid.verdict !== 'keep' ? 'buffer' : midOwn.verdict === 'adopt' ? 'middle' : bufOwn.verdict === 'adopt' ? 'buffer' : bufOwn.verdict === 'extend' || midOwn.verdict === 'extend' ? 'extend' : 'own';
if (pick === 'extend') say(`**Decision: extend.** Run nine more seeds (--seeds ${opt.seeds},10,11,12,13,14,15,16,17,18) and decide on all of them.`);
else if (pick === 'own') say("**Decision: keep the cards' own price rule.** Revisit the buffer (3 days in hand, or one per good) or the price level.");
else say(`**Decision: the next world takes the ${pick} arm's Trading card** (${path.join(out, pick, 'trading.js')}); it stays only if that world, with its Qwen brains, does as well.`);
const text = report.join('\n');
fs.writeFileSync(path.join(out, 'summary.md'), text + '\n');
console.log('\n' + text);
