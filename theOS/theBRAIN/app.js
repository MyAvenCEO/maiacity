// theID, told as stories in text. Each slide is one moment; {word} marks a term the moment introduces, and a slide may
// show a small JSON example and a flow of steps. The hash is #<story>-<n>.
const $ = (s) => document.querySelector(s);
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rich = (t) => esc(t).replace(/\{([^}]+)\}/g, '<b>$1</b>');
const termsOf = (s) => [...(s.text || '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const cap = (t) => t[0].toUpperCase() + t.slice(1);
let stories = [], story = null, deck = [], at = 0;

function json(v, ind = '') {
  const pad = ind + '  ';
  if (Array.isArray(v)) {
    const flat = v.every((x) => typeof x !== 'object');
    return flat ? `[${v.map((x) => json(x)).join(', ')}]` : `[\n${v.map((x) => pad + json(x, pad)).join(',\n')}\n${ind}]`;
  }
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    if (JSON.stringify(v).length < 44) return `{ ${e.map(([k, x]) => `<i>"${esc(k)}"</i>: ${json(x)}`).join(', ')} }`;
    return `{\n${e.map(([k, x]) => `${pad}<i>"${esc(k)}"</i>: ${json(x, pad)}`).join(',\n')}\n${ind}}`;
  }
  if (typeof v === 'string') return `<u>"${esc(v)}"</u>`;
  return `<s>${String(v)}</s>`;
}

function render() {
  const s = deck[at], card = $('#card');
  card.classList.remove('enter');
  $('#num').textContent = `${String(at + 1).padStart(2, '0')} / ${deck.length}`;
  $('#title').textContent = s.title;
  $('#text').innerHTML = s.text ? rich(s.text) : '';
  $('#text').hidden = !s.text;
  $('#list').innerHTML = (s.list || []).map((l) => `<li>${esc(l)}</li>`).join('');
  $('#list').hidden = !s.list;
  $('#code').innerHTML = s.code ? json(s.code) : '';
  $('#code').hidden = !s.code;
  $('#flow').innerHTML = (s.flow || []).map((f) => `<span>${esc(f)}</span>`).join('<i>→</i>');
  $('#flow').hidden = !s.flow;
  card.classList.toggle('has-code', Boolean(s.code || s.flow));
  document.querySelectorAll('#stories button').forEach((b) => b.classList.toggle('on', b.dataset.story === story.id));
  const fresh = new Set(termsOf(s));
  const known = [...new Set(deck.slice(0, at + 1).flatMap(termsOf))];
  $('#terms').innerHTML = known.map((t) => `<span class="${fresh.has(t) ? 'new' : ''}">${esc(cap(t))}</span>`).join('');
  $('#prev').disabled = at === 0;
  $('#next').textContent = at === deck.length - 1 ? 'Start over' : `${s.action} →`;
  document.querySelectorAll('#track button').forEach((b, i) => { b.className = i === at ? 'now' : i < at ? 'past' : ''; });
  $('#fill').style.width = `${(at / (deck.length - 1)) * 100}%`;
  const h = `#${story.id}-${at + 1}`;
  if (location.hash !== h) history.replaceState(null, '', h);
  void card.offsetWidth;
  card.classList.add('enter');
}
function go(i) { at = (i + deck.length) % deck.length; render(); }
function fromHash() {
  const m = /^#([a-z]+)-(\d+)$/.exec(location.hash);
  const st = stories.find((x) => x.id === m?.[1]) || stories[0];
  return [st, m && st.id === m[1] ? Number(m[2]) - 1 : 0];
}
async function open(st, i) {
  if (story !== st) {
    story = st;
    deck = (await (await fetch(st.file)).json()).slides;
    $('#track').innerHTML = '<span class="fill" id="fill"></span>' +
      deck.map((s, n) => `<button type="button" aria-label="${n + 1}: ${esc(s.title)}" data-go="${n}"></button>`).join('');
  }
  at = Math.max(0, Math.min(i, deck.length - 1));
  render();
}

async function start() {
  stories = (await (await fetch('stories.json')).json()).stories;
  $('#stories').innerHTML = stories.map((x) => `<button type="button" data-story="${x.id}">${esc(x.title)}</button>`).join('');
  $('#stories').addEventListener('click', (e) => { const b = e.target.closest('[data-story]'); if (b) open(stories.find((x) => x.id === b.dataset.story), 0); });
  $('#track').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
  $('#prev').addEventListener('click', () => at > 0 && go(at - 1));
  $('#next').addEventListener('click', () => go(at + 1));
  $('#card').addEventListener('click', (e) => { if (!e.target.closest('pre')) go(at + 1); });
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
  addEventListener('hashchange', () => { const [st, i] = fromHash(); if (st !== story || i !== at) open(st, i); });
  const [st, i] = fromHash();
  open(st, i);
}
start();
