// theID tutorial: slides come from slides.json; each slide's drawing is one ink line plus an orange sun.
const L = (d, cls = '') => `<path class="ln ${cls}" pathLength="1" d="${d}"/>`;
const R = (x, y, w, h, r, cls = '') => `<rect class="ln ${cls}" pathLength="1" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const C = (cx, cy, r, cls = '') => `<circle class="ln ${cls}" pathLength="1" cx="${cx}" cy="${cy}" r="${r}"/>`;
const SUN = (cx, cy, r) => `<circle class="sun" cx="${cx}" cy="${cy}" r="${r}"/>`;
const T = (x, y, s) => `<text class="lbl" x="${x}" y="${y}">${s}</text>`;

const box = (x, y, s) => // a small box: front, top, side
  L(`M${x} ${y} H${x + s} V${y + s} H${x} Z`) +
  L(`M${x} ${y} L${x + s * .36} ${y - s * .28} H${x + s * 1.36} L${x + s} ${y}`) +
  L(`M${x + s} ${y + s} L${x + s * 1.36} ${y + s * .72} V${y - s * .28}`);
const envelope = (x, y, w, h) =>
  R(x, y, w, h, 7) + L(`M${x} ${y} L${x + w / 2} ${y + h * .55} L${x + w} ${y}`) +
  L(`M${x} ${y + h} L${x + w * .38} ${y + h * .45} M${x + w} ${y + h} L${x + w * .62} ${y + h * .45}`);
const lock = (x, y, w, h, open = false) =>
  R(x, y, w, h, Math.max(4, w * .1)) +
  L(open
    ? `M${x + w * .2} ${y} V${y - h * .45} A${w * .3} ${w * .3} 0 0 1 ${x + w * .8} ${y - h * .45} V${y - h * .65}`
    : `M${x + w * .2} ${y} V${y - h * .35} A${w * .3} ${w * .3} 0 0 1 ${x + w * .8} ${y - h * .35} V${y}`);
const key = (x, y, s = 1) =>
  C(x, y, 24 * s) + C(x, y, 9 * s, 'thin') +
  L(`M${x + 24 * s} ${y} H${x + 130 * s} M${x + 104 * s} ${y} V${y + 18 * s} H${x + 114 * s} V${y} M${x + 120 * s} ${y} V${y + 14 * s} H${x + 130 * s} V${y}`);
const finger = (cx, cy, s = 1) =>
  L(`M${cx - 25 * s} ${cy + 12 * s} A27 27 0 1 1 ${cx + 25 * s} ${cy + 12 * s}`, 'thin') +
  L(`M${cx - 14 * s} ${cy + 16 * s} A15 15 0 1 1 ${cx + 14 * s} ${cy + 16 * s}`, 'thin') +
  L(`M${cx} ${cy + 22 * s} V${cy + 2 * s}`, 'thin');
const sparkle = (cx, cy, r) =>
  L(`M${cx} ${cy - r} Q${cx + r * .1} ${cy - r * .1} ${cx + r} ${cy} Q${cx + r * .1} ${cy + r * .1} ${cx} ${cy + r} Q${cx - r * .1} ${cy + r * .1} ${cx - r} ${cy} Q${cx - r * .1} ${cy - r * .1} ${cx} ${cy - r} Z`);

const ART = {
  intro: () => SUN(470, 230, 105) +
    L('M0 380 C 200 380 250 380 300 330 S 340 170 430 180 S 560 290 500 330 S 370 320 420 250 S 560 140 630 240 S 690 380 800 380'),
  passkey: () => SUN(480, 220, 100) +
    L('M0 380 H335') + R(335, 140, 150, 240, 24) + R(351, 166, 118, 170, 10, 'thin') + finger(410, 238) + C(410, 358, 7, 'thin') +
    L('M485 375 C 560 380 600 352 650 360 S 730 380 800 380'),
  secret: () => SUN(575, 220, 92) +
    L('M0 380 H205') + R(205, 240, 92, 140, 16) + finger(251, 296, .55) +
    L('M297 270 C 350 230 360 310 420 270 S 480 205 520 232') + sparkle(575, 228, 52) +
    L('M612 300 C 660 330 700 380 800 380'),
  pen: () => SUN(520, 200, 95) +
    L('M0 380 H230 C 262 380 268 336 292 358 S 314 392 336 366 S 366 338 378 370 S 410 384 432 378') +
    L('M432 378 L446 346 L590 150 Q603 136 617 148 Q629 161 616 175 L470 366 Z') +
    L('M432 378 L456 356', 'thin') + L('M512 268 L536 286', 'thin') +
    L('M470 380 H800'),
  padlock: () => SUN(440, 180, 95) +
    L('M0 380 H335') + lock(335, 230, 170, 150) + C(420, 290, 12, 'thin') + L('M420 302 V336', 'thin') +
    L('M505 372 C 530 380 545 380 565 370') + lock(565, 310, 80, 62, true) +
    L('M645 370 C 700 382 740 380 800 380'),
  birth: () => SUN(570, 200, 88) +
    L('M0 380 H372') +
    L('M384 105 L580 92 Q592 92 594 104 L620 386 Q621 398 609 400 L414 414 Q402 415 400 403 L372 118 Q371 106 384 105 Z') +
    L('M410 210 L522 200', 'thin') + L('M414 250 L560 238', 'thin') + L('M418 288 L540 278', 'thin') +
    L('M420 350 C 444 318 452 358 474 336 S 506 326 528 344') +
    C(530, 150, 20, 'thin') + L('M518 150 A12 12 0 1 1 542 150', 'thin') +
    L('M620 380 H800'),
  id: () => SUN(570, 195, 92) +
    L('M0 380 C 220 380 262 380 300 350 L322 335') + R(322, 165, 300, 190, 18) +
    C(390, 240, 36) + finger(390, 236, .7) +
    L('M450 222 H590', 'thin') + L('M450 252 H570', 'thin') + L('M450 286 H594', 'thin') + L('M348 326 H596', 'thin') +
    L('M622 300 C 684 300 702 380 800 380'),
  entry: () => SUN(470, 190, 92) +
    L('M0 380 C 250 380 300 376 340 372') + box(340, 232, 140) +
    L('M366 290 H452', 'thin') + L('M366 318 H430', 'thin') +
    L('M480 372 C 560 380 650 380 800 380'),
  entrykey: () => SUN(560, 250, 86) +
    L('M0 380 C 200 380 240 376 270 372') + box(270, 262, 110) + C(325, 305, 9, 'thin') + L('M325 314 V336', 'thin') +
    key(548, 300) +
    L('M678 300 C 740 300 740 380 800 380'),
  envelope: () => SUN(470, 180, 90) +
    L('M0 380 C 250 380 300 374 322 362') + envelope(322, 214, 240, 150) +
    lock(426, 300, 34, 26) +
    L('M472 214 L490 168') + C(497, 152, 16) +
    L('M562 362 C 620 380 700 380 800 380'),
  share: () => SUN(560, 180, 86) +
    L('M0 380 C 150 380 190 372 210 362') + box(210, 262, 100) +
    L('M346 300 C 420 296 420 210 500 206') + envelope(500, 160, 130, 86) +
    L('M346 324 C 420 328 420 330 500 330') + envelope(500, 290, 130, 86) +
    T(650, 212, 'you') + T(650, 340, 'friend') +
    L('M630 376 C 700 380 740 380 800 380'),
  world: () => SUN(450, 215, 95) +
    L('M0 380 C 200 380 250 320 300 300') +
    L('M300 300 C 254 300 246 236 300 228 C 300 168 382 146 412 190 C 442 136 534 148 532 210 C 594 204 614 284 560 300 Z') +
    R(352, 238, 44, 40, 5, 'thin') + R(410, 230, 44, 40, 5, 'thin') + R(468, 240, 44, 40, 5, 'thin') +
    L('M602 158 Q642 136 682 158') + L('M616 154 L610 168 M642 148 V162 M668 154 L674 168', 'thin') +
    L('M560 300 C 640 330 700 380 800 380'),
  chain: () => {
    const y = 330, xs = [70, 175, 280, 385, 490, 595, 700];
    const icons = [
      x => R(x - 16, y - 58, 32, 52, 8) + C(x, y - 30, 7, 'thin'),
      x => sparkle(x, y - 34, 24),
      x => L(`M${x - 18} ${y - 6} L${x - 12} ${y - 18} L${x + 14} ${y - 58} L${x + 22} ${y - 52} L${x - 6} ${y - 12} Z`),
      x => lock(x - 20, y - 36, 40, 32),
      x => R(x - 30, y - 50, 60, 42, 7) + C(x - 14, y - 29, 9, 'thin'),
      x => box(x - 22, y - 40, 36),
      x => envelope(x - 26, y - 44, 52, 36),
    ];
    return SUN(400, 180, 110) + L(`M0 ${y} H800`) + xs.map((x, i) => icons[i](x)).join('');
  },
};

const $ = (s) => document.querySelector(s);
let deck = [], at = 0;

function render(animate = true) {
  const s = deck[at];
  const card = $('#card');
  card.classList.remove('enter');
  $('#art').innerHTML = (ART[s.art] || ART.intro)();
  $('#num').textContent = String(at + 1).padStart(2, '0');
  $('#title').textContent = s.title;
  $('#lead').textContent = s.lead;
  $('#more').textContent = s.more;
  $('#count').textContent = `${String(at + 1).padStart(2, '0')} / ${String(deck.length).padStart(2, '0')}`;
  $('#prev').disabled = at === 0;
  $('#next').disabled = at === deck.length - 1;
  document.querySelectorAll('#chain li').forEach((li) => {
    const i = Number(li.dataset.i);
    li.className = i === at ? 'now' : i < at ? 'learned' : '';
  });
  if (location.hash !== `#s${at + 1}`) history.replaceState(null, '', `#s${at + 1}`);
  if (animate) { void card.offsetWidth; card.classList.add('enter'); }
}
function go(i) { at = Math.max(0, Math.min(deck.length - 1, i)); render(); }
function fromHash() { const m = /^#s(\d+)$/.exec(location.hash); return m ? Number(m[1]) - 1 : 0; }

async function start() {
  const data = await (await fetch('slides.json')).json();
  deck = data.slides;
  $('#chain').innerHTML = deck.map((s, i) => s.term
    ? `<li data-i="${i}"><button type="button" data-go="${i}">${s.term}</button></li>` : '').join('');
  $('#chain').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
  $('#prev').addEventListener('click', () => go(at - 1));
  $('#next').addEventListener('click', () => go(at + 1));
  $('#card').addEventListener('click', () => go(at + 1));
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(at + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1); }
  });
  let x0 = null;
  addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(at + (dx < 0 ? 1 : -1)); x0 = null; });
  addEventListener('hashchange', () => { const i = fromHash(); if (i !== at) go(i); });
  at = Math.min(fromHash(), deck.length - 1);
  render();
}
start();
