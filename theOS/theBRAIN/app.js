// theID, told as a story in text. Each slide is one moment; {word} marks a term the moment introduces.
const $ = (s) => document.querySelector(s);
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rich = (t) => esc(t).replace(/\{([^}]+)\}/g, '<b>$1</b>');
const termsOf = (s) => [...(s.text || '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const cap = (t) => t[0].toUpperCase() + t.slice(1);
let deck = [], at = 0;

function render() {
  const s = deck[at], card = $('#card');
  card.classList.remove('enter');
  $('#num').textContent = `${String(at + 1).padStart(2, '0')} / ${deck.length}`;
  $('#title').textContent = s.title;
  $('#text').innerHTML = s.text ? rich(s.text) : '';
  $('#text').hidden = !s.text;
  $('#list').innerHTML = (s.list || []).map((l) => `<li>${esc(l)}</li>`).join('');
  $('#list').hidden = !s.list;
  const fresh = new Set(termsOf(s));
  const known = [...new Set(deck.slice(0, at + 1).flatMap(termsOf))];
  $('#terms').innerHTML = known.map((t) => `<span class="${fresh.has(t) ? 'new' : ''}">${esc(cap(t))}</span>`).join('');
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
    deck.map((s, i) => `<button type="button" aria-label="${i + 1}: ${esc(s.title)}" data-go="${i}"></button>`).join('');
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
