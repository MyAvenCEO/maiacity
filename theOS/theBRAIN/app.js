// theID, told as a story. Each moment is drawn as ONE unbroken line: it enters at the left edge, draws its
// object without lifting, and leaves at the right edge. One quiet earth-toned shape sits beside it.
const LINE = {
  you: 'M0 370 H318 C318 312 348 287 386 281 L386 262 C362 256 350 232 352 210 C354 180 378 162 402 162 C426 162 448 180 450 210 C452 232 440 256 416 262 L416 281 C454 287 484 312 484 370 H800',
  tap: 'M0 370 H340 V172 Q340 150 362 150 H438 Q460 150 460 172 V292 C448 302 432 300 426 286 C418 262 384 258 376 284 C368 312 396 330 410 310 C420 296 404 282 396 296 C392 306 404 312 410 304 C430 318 450 328 460 330 V370 H800',
  secret: 'M0 370 H300 C340 370 336 300 378 300 S 420 338 452 298 C470 276 490 262 512 250 L528 186 Q536 238 588 248 Q536 258 528 310 Q520 258 468 248 Q520 238 528 186 C560 190 600 230 626 290 S 700 370 800 370',
  pen: 'M0 370 H210 C242 370 248 330 272 350 S 294 386 316 360 S 346 330 360 362 S 396 380 428 372 L444 342 L588 150 Q602 136 616 148 Q628 160 616 174 L470 364 L428 372 C470 372 496 370 530 370 H800',
  padlock: 'M0 370 H330 V240 H362 V190 A53 53 0 0 1 468 190 V240 H500 V370 H428 V318 A13 13 0 1 0 412 318 V370 H800',
  birth: 'M0 370 H372 L378 210 L522 198 L378 210 L384 122 Q386 108 400 108 L580 96 Q594 96 596 110 L606 250 L466 262 L606 250 L614 330 C592 344 576 300 560 322 S 530 346 516 318 S 492 300 480 332 L614 330 L618 370 H800',
  id: 'M0 370 H320 V256 H348 A38 38 0 1 0 424 256 A38 38 0 1 0 348 256 H320 V198 Q320 180 338 180 H602 Q620 180 620 198 V236 H468 H620 V286 H490 H620 V370 H800',
  keep: 'M0 370 H340 V240 L390 200 H530 V330 L480 370 V240 H340 H480 L530 200 V330 L480 370 H800',
  entrykey: 'M0 370 H250 V280 L285 255 H385 V340 L350 370 V280 H250 H350 L385 255 V340 L350 370 H500 C524 370 532 330 546 312 A28 28 0 1 1 602 312 A28 28 0 1 1 546 312 A28 28 0 0 1 602 312 H692 V332 H680 V312 H704 C744 312 752 370 800 370',
  envelope: 'M0 370 H322 V214 H562 L442 300 A13 13 0 1 0 442.1 300 L322 214 L442 300 L562 214 V370 H800',
  share: 'M0 370 H200 V290 L232 268 H322 V345 L290 370 V290 H200 H290 L322 268 V345 L290 370 C356 370 384 262 440 262 V190 L490 228 L540 190 H440 H540 V262 H440 H540 C574 262 566 362 592 362 V292 L642 330 L692 292 H592 H692 V362 H592 H692 C730 362 752 370 800 370',
  world: 'M0 370 C150 370 226 338 270 300 C228 300 222 236 276 228 C276 168 358 146 388 190 C418 136 510 148 508 210 C570 204 590 284 536 300 H470 V262 H440 V300 H410 V262 H380 V300 H350 V262 H320 V300 H270 H536 C600 330 640 300 676 252 Q716 228 756 252 C784 300 790 370 800 370',
  again: 'M0 330 H70 V280 H110 V330 H170 L200 282 L230 330 H286 L330 272 L340 282 L302 330 H380 V300 H384 A16 16 0 0 1 416 300 H420 V330 H470 V294 H530 V330 H580 V296 L600 282 H640 V318 L620 330 V296 H580 H620 V330 H668 V300 L694 318 L720 300 V330 H800',
};
const LABELS = { share: [[556, 226, 'you'], [706, 328, 'friend']] };
const COLORS = { clay: 'var(--clay)', ochre: 'var(--ochre)', sage: 'var(--sage)', moss: 'var(--moss)', sand: 'var(--sand)' };

const HATCH = Object.keys(COLORS).map((c) =>
  `<pattern id="h-${c}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="4" height="9" fill="${COLORS[c]}"/></pattern>`).join('');

function shape(s) {
  const c = COLORS[s.color] ? s.color : 'sand', base = 370;
  const fill = s.fill === 'hatch' ? `url(#h-${c})` : COLORS[c], a = `class="shape" fill="${fill}"`;
  if (s.kind === 'circle') return `<circle ${a} cx="${s.x}" cy="${s.y}" r="${s.r}"/>`;
  if (s.kind === 'semi') return `<path ${a} d="M${s.x - s.r} ${base} A${s.r} ${s.r} 0 0 1 ${s.x + s.r} ${base} Z"/>`;
  if (s.kind === 'arch') return `<path ${a} d="M${s.x - s.w} ${base} V${base - s.h + s.w} A${s.w} ${s.w} 0 0 1 ${s.x + s.w} ${base - s.h + s.w} V${base} Z"/>`;
  if (s.kind === 'hill') return `<path ${a} d="M${s.x - s.w} ${base} C${s.x - s.w / 2} ${base - s.h} ${s.x + s.w / 3} ${base - s.h * 1.1} ${s.x + s.w} ${base} Z"/>`;
  if (s.kind === 'leaf') return `<path ${a} transform="translate(${s.x} ${s.y}) scale(${s.s}) rotate(-28)" d="M0 -70 C46 -40 46 40 0 70 C-46 40 -46 -40 0 -70 Z"/>`;
  return `<path ${a} transform="translate(${s.x} ${s.y}) scale(${s.s})" d="M-62 8 C-70 -40 -20 -66 26 -58 C70 -50 82 -6 64 30 C46 64 -8 70 -38 54 C-54 46 -58 30 -62 8 Z"/>`;
}
// Each moment has its own camera: close-up, wide, tilted. The line is lengthened far past both edges, so whatever
// the framing, it still comes in from the left and leaves to the right as one stroke.
function camera(v = {}) {
  const s = v.s ?? 1, r = v.r ?? 0, [ax, ay] = v.at ?? [400, 225], [tx, ty] = v.to ?? v.at ?? [400, 225];
  return `translate(${tx} ${ty}) rotate(${r}) scale(${s}) translate(${-ax} ${-ay})`;
}
function longLine(d, v = {}) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  const end = p.getPointAtLength(p.getTotalLength()), y0 = Number(/^M0 (-?[\d.]+)/.exec(d)[1]);
  const s = v.s ?? 1, [ax] = v.at ?? [400, 225], [tx] = v.to ?? v.at ?? [400, 225], pad = 80 / s;
  const left = Math.min(0, ax - tx / s - pad), right = Math.max(end.x, ax + (800 - tx) / s + pad);
  return `M${left} ${y0} H0` + d.replace(/^M0 -?[\d.]+/, '') + ` L${right} ${end.y}`;
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rich = (t) => esc(t).replace(/\{([^}]+)\}/g, '<b>$1</b>');

const $ = (s) => document.querySelector(s);
let deck = [], at = 0;

function render() {
  const s = deck[at], card = $('#card');
  card.classList.remove('enter');
  card.dataset.tint = s.tint || 'paper';
  $('#art').innerHTML = `<defs>${HATCH}</defs><g transform="${camera(s.view)}">` + (s.shapes || []).map(shape).join('') +
    `<path class="ln" pathLength="1" style="stroke-width:${(2.3 / (s.view?.s ?? 1)).toFixed(2)}" d="${longLine(LINE[s.art], s.view)}"/>` +
    (LABELS[s.art] || []).map(([x, y, t]) => `<text class="lbl" x="${x}" y="${y}">${t}</text>`).join('') + '</g>';
  $('#num').textContent = String(at + 1).padStart(2, '0');
  $('#title').textContent = s.title;
  $('#text').innerHTML = rich(s.text);
  $('#prev').disabled = at === 0;
  $('#next').textContent = at === deck.length - 1 ? 'Start over' : `${s.action} →`;
  document.querySelectorAll('#track button').forEach((b, i) => { b.className = i === at ? 'now' : i < at ? 'past' : ''; });
  $('#fill').style.width = `${(at / (deck.length - 1)) * 100}%`;
  if (location.hash !== `#s${at + 1}`) history.replaceState(null, '', `#s${at + 1}`);
  void card.offsetWidth;
  card.classList.add('enter');
}
function go(i) { at = (i + deck.length) % deck.length; render(); }
function fromHash() { const m = /^#s(\d+)$/.exec(location.hash); return m ? Number(m[1]) - 1 : 0; }

async function start() {
  deck = (await (await fetch('slides.json')).json()).slides;
  $('#track').innerHTML = '<span class="fill" id="fill"></span>' +
    deck.map((s, i) => `<button type="button" aria-label="${String(i + 1).padStart(2, '0')}: ${esc(s.title)}" data-go="${i}"></button>`).join('');
  $('#track').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
  $('#prev').addEventListener('click', () => at > 0 && go(at - 1));
  $('#next').addEventListener('click', () => go(at + 1));
  $('#card').addEventListener('click', () => go(at + 1));
  addEventListener('keydown', (e) => {
    if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key) && !e.target.closest('button')) { e.preventDefault(); go(at + 1); }
    if (['ArrowLeft', 'PageUp'].includes(e.key) && at > 0) { e.preventDefault(); go(at - 1); }
  });
  let x0 = null;
  addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) { if (dx < 0) go(at + 1); else if (at > 0) go(at - 1); }
    x0 = null;
  });
  addEventListener('hashchange', () => { const i = fromHash(); if (i !== at) go(i); });
  at = Math.min(fromHash(), deck.length - 1);
  render();
}
start();
