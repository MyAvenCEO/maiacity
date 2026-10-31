// theID, told as stories in text. Each slide is one moment; {word} marks a term the moment introduces, and a slide may
// show a small JSON example, a flow of steps or a table. The hash is #<story>-<n>.
const $ = (s) => document.querySelector(s);
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rich = (t) => esc(t).replace(/\{([^}]+)\}/g, '<b>$1</b>');
const termsOf = (s) => [...(s.text || '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const cap = (t) => t[0].toUpperCase() + t.slice(1);
let stories = [], story = null, deck = [], at = 0;

function json(v, ind = '', lead = 0) {
  // Short values stay on one line; "lead" is what already sits on the line before them (indent and key).
  const pad = ind + '  ', fits = (x) => JSON.stringify(x).length * 1.15 + ind.length + lead < 46;
  if (Array.isArray(v)) {
    const flat = v.every((x) => typeof x !== 'object') && fits(v);
    return flat ? `[${v.map((x) => json(x)).join(', ')}]` : `[\n${v.map((x) => pad + json(x, pad)).join(',\n')}\n${ind}]`;
  }
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    if (fits(v)) return `{ ${e.map(([k, x]) => `<i>"${esc(k)}"</i>: ${json(x)}`).join(', ')} }`;
    return `{\n${e.map(([k, x]) => `${pad}<i>"${esc(k)}"</i>: ${json(x, pad, k.length + 4)}`).join(',\n')}\n${ind}}`;
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
  $('#table').innerHTML = s.table ? `<thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${s.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>` : '';
  $('#table').hidden = !s.table;
  $('#deep').innerHTML = s.deep ? `<b>Under the hood</b>${esc(s.deep)}` : '';
  $('#deep').hidden = !s.deep;
  card.classList.toggle('has-code', Boolean(s.code || s.flow || s.table || s.deep));
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
  const n = m && st.id === m[1] ? Number(m[2]) : 0;
  return [st, st.kind ? n : Math.max(0, n - 1)];
}
async function open(st, i) {
  const list = st.kind === 'decisions';
  document.body.classList.toggle('show-decisions', list);
  if (list) return openDecisions(st, i);
  if (story !== st) {
    story = st;
    deck = (await (await fetch(st.file)).json()).slides;
    $('#track').innerHTML = '<span class="fill" id="fill"></span>' +
      deck.map((s, n) => `<button type="button" aria-label="${n + 1}: ${esc(s.title)}" data-go="${n}"></button>`).join('');
  }
  at = Math.max(0, Math.min(i, deck.length - 1));
  render();
}

// theDECISIONS: every decision as a card, numbered D1, D2 …, with its sources and the slides that tell it.
let decisions = null, filter = 'all';
async function openDecisions(st, i) {
  story = st;
  document.querySelectorAll('#stories button').forEach((b) => b.classList.toggle('on', b.dataset.story === st.id));
  if (!decisions) decisions = await (await fetch(st.file)).json();
  const titles = Object.fromEntries(stories.filter((x) => !x.kind).map((x) => [x.id, x.title.replace(/^\d+ · /, '')]));
  const shown = decisions.decisions.filter((d) => filter === 'all' || d.status === filter);
  const count = (k) => decisions.decisions.filter((d) => d.status === k).length;
  $('#decisions').innerHTML = `<header class="dhead"><h1>${esc(decisions.title)}</h1><p>${esc(decisions.note)}</p>
    <div class="dfilter">${[['all', `All ${decisions.decisions.length}`], ['decided', `Decided ${count('decided')}`], ['proposed', `Proposed ${count('proposed')}`], ['superseded', `Superseded ${count('superseded')}`]]
      .map(([k, l]) => `<button type="button" data-filter="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div></header>` +
    shown.map((d) => `<article class="dcard" id="${d.id}">
      <div class="dtop"><span class="did">${d.id}</span><span class="dstatus ${d.status}">${d.status}</span><span class="ddate">${esc(d.date)}</span></div>
      <h2>${esc(d.title)}</h2>
      <p class="ddec">${esc(d.decision)}</p>
      ${d.why ? `<p class="dwhy"><b>Why</b> ${esc(d.why)}</p>` : ''}
      ${d.rejected ? `<p class="dwhy"><b>Rejected</b> ${esc(d.rejected)}</p>` : ''}
      ${d.supersedes ? `<p class="dwhy"><b>Supersedes</b> ${esc(d.supersedes)}</p>` : ''}
      ${d.superseded_by ? `<p class="dwhy"><b>Superseded by</b> ${esc(d.superseded_by)}</p>` : ''}
      ${d.slides.length ? `<div class="dslides">${d.slides.map((r) => { const [sid, n] = r.split('-'); return `<a href="#${r}">${esc(titles[sid] || sid)} ${n}</a>`; }).join('')}</div>` : ''}
      ${d.sources.length ? `<ul class="dsrc">${d.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></li>`).join('')}</ul>` : ''}
    </article>`).join('');
  const target = i > 0 && document.getElementById(`D${i}`);
  if (target) target.scrollIntoView({ block: 'start' }); else scrollTo(0, 0);
  const h = i > 0 ? `#decisions-${i}` : '#decisions-0';
  if (location.hash !== h) history.replaceState(null, '', h);
}

async function start() {
  stories = (await (await fetch('stories.json')).json()).stories;
  $('#stories').innerHTML = stories.map((x) => `<button type="button" data-story="${x.id}">${esc(x.title)}</button>`).join('');
  $('#stories').addEventListener('click', (e) => { const b = e.target.closest('[data-story]'); if (b) open(stories.find((x) => x.id === b.dataset.story), 0); });
  $('#decisions').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; openDecisions(story, 0); } });
  $('#track').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
  $('#prev').addEventListener('click', () => at > 0 && go(at - 1));
  $('#next').addEventListener('click', () => go(at + 1));
  $('#card').addEventListener('click', (e) => { if (!e.target.closest('pre')) go(at + 1); });
  // Arrows always move, wherever focus is; space and Enter leave a focused button to do its own job.
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || story?.kind === 'decisions') return;
    const onButton = e.target instanceof Element && e.target.closest('button');
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || ((e.key === ' ' || e.key === 'Enter') && !onButton)) { e.preventDefault(); go(at + 1); }
    if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && at > 0) { e.preventDefault(); go(at - 1); }
  });
  let x0 = null;
  addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (x0 === null || story?.kind === 'decisions') return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) { if (dx < 0) go(at + 1); else if (at > 0) go(at - 1); }
    x0 = null;
  });
  addEventListener('hashchange', () => { const [st, i] = fromHash(); if (st !== story || i !== at || st.kind) open(st, i); });
  const [st, i] = fromHash();
  open(st, i);
}
start();
