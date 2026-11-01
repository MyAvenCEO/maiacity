// theOS, told as stories in text. Each slide is one moment; {word} marks a term the moment introduces, and a slide may
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
  card.classList.toggle('has-code', Boolean(s.code || s.flow || s.table));
  document.querySelectorAll('#stories button').forEach((b) => b.classList.toggle('on', b.dataset.story === story.id));
  const fresh = new Set(termsOf(s));
  const known = [...new Set(deck.slice(0, at + 1).flatMap(termsOf))];
  $('#terms').innerHTML = known.map((t) => `<span class="${fresh.has(t) ? 'new' : ''}">${esc(cap(t))}</span>`).join('');
  $('#prev').disabled = at === 0;
  const nxt = stories[stories.indexOf(story) + 1];
  $('#next').textContent = at < deck.length - 1 ? 'Next →' : nxt && !nxt.kind ? 'Next chapter →' : 'Start over';
  $('#next').title = at < deck.length - 1 ? deck[at + 1].title : nxt && !nxt.kind ? nxt.title : '';
  document.querySelectorAll('#track button').forEach((b, i) => { b.className = i === at ? 'now' : i < at ? 'past' : ''; });
  $('#fill').style.width = `calc(100% / var(--n) * ${at})`;
  const h = `#${story.id}-${at + 1}`;
  if (location.hash !== h) history.replaceState(null, '', h);
  renderSpec();
  void card.offsetWidth;
  card.classList.add('enter');
}
function go(i) {
  if (i >= deck.length) { const nxt = stories[stories.indexOf(story) + 1]; if (nxt && !nxt.kind) return open(nxt, 0); }
  at = (i + deck.length) % deck.length; render();
}
function fromHash() {
  const m = /^#([a-z]+)-(\d+)(-spec)?$/.exec(location.hash);
  if (m?.[3]) specOpen = true;
  const st = stories.find((x) => x.id === m?.[1]) || stories[0];
  const n = m && st.id === m[1] ? Number(m[2]) : 0;
  return [st, st.kind ? n : Math.max(0, n - 1)];
}
async function open(st, i) {
  const list = Boolean(st.kind);
  document.body.classList.toggle('show-decisions', list);
  if (list) return openIntents(st, i);
  if (story !== st) {
    story = st;
    deck = (await (await fetch(st.file)).json()).slides;
    $('#track').style.setProperty('--n', deck.length);
    $('#track').innerHTML = '<span class="fill" id="fill"></span>' +
      deck.map((s, n) => `<button type="button" aria-label="${n + 1}: ${esc(s.title)}" title="${esc(s.title)}" data-go="${n}"><i></i><span>${termsOf(s).map((t) => esc(cap(t))).join('<br>')}</span></button>`).join('');
  }
  at = Math.max(0, Math.min(i, deck.length - 1));
  render();
}

// Architecture: each slide's detailed definition, colocated in its JSON as "spec": the records field by field, the
// rules with stable IDs (the names a Lean formalisation refers to), and every decision behind it.
let specOpen = false, intents = null;
function renderSpec() {
  const s = deck[at], sp = s.spec, ref = `${story.id}-${at + 1}`;
  $('#spectab').classList.toggle('has', Boolean(sp));
  $('#spectab').hidden = specOpen;
  $('#spectab').setAttribute('aria-expanded', String(specOpen));
  $('#spec').hidden = !specOpen;
  if (!specOpen) return;
  const ids = [...new Set([...(sp?.decisions || []), ...(intents?.intents || []).filter((d) => d.slides.includes(ref)).map((d) => d.id)])]
    .sort((x, y) => num(x) - num(y));
  $('#spec').innerHTML = `<header><b>Architecture</b><button type="button" class="sclose" aria-label="Close">×</button></header>
    <h2>${esc(s.title)}</h2>` + (sp ? `${sp.summary ? `<p>${esc(sp.summary)}</p>` : ''}` +
    (sp.records || []).map((r) => `<h3>${esc(r.name)}</h3>${r.about ? `<p>${esc(r.about)}</p>` : ''}<table class="sfields">${r.fields.map(([f, t, m]) =>
      `<tr><td><code>${esc(f)}</code></td><td>${esc(t)}</td><td>${esc(m)}</td></tr>`).join('')}</table>`).join('') +
    (sp.rules?.length ? `<h3>Rules</h3><ol class="srules">${sp.rules.map((r) => `<li><code>${esc(r.id)}</code>${esc(r.text)}</li>`).join('')}</ol>` : '')
    : '<p class="snone">Not defined in detail yet.</p>') +
    (ids.length ? `<h3>Intents</h3><div class="arefs">${aipLinks(ids)}</div>` : '');
}

// theINTENTS: every architecture intent as one card through three stages: learn (a finding), propose (a drafted
// answer) and decided (accepted, rejected or superseded). The board shows the stages as columns; a card opens in full,
// with each stage it has passed through as a tab. One record per intent, so nothing drifts. #intents-<n>, 0 = board.
const num = (id) => Number(String(id).replace(/^\D+/, ''));
const byId = () => Object.fromEntries((intents?.intents || []).map((x) => [x.id, x]));
const stateOf = (x) => (x ? (x.stage === 'decided' ? x.outcome : x.stage) : 'unknown');
function aipLinks(ids) {
  const all = byId();
  return ids.map((id) => `<a class="${stateOf(all[id])}" href="#intents-${num(id)}">${id} · ${esc(stateOf(all[id]))}</a>`).join('');
}
const linkify = (t) => esc(t).replace(/AIP-(\d+)/g, '<a href="#intents-$1">AIP-$1</a>');
let tab = null;
async function openIntents(st, i) {
  if (story !== st || i !== openIntents.last) tab = null;
  openIntents.last = i;
  story = st;
  document.querySelectorAll('#stories button').forEach((b) => b.classList.toggle('on', b.dataset.story === st.id));
  if (!intents) intents = await (await fetch(st.file)).json();
  const all = intents.intents, chap = Object.fromEntries(intents.chapters.map((c) => [c.id, c]));
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const chip = (cls, t) => `<span class="chipx ${cls}">${esc(t)}</span>`;
  const x = i > 0 && all.find((y) => y.n === i);
  if (!x) {
    const col = (stage) => all.filter((y) => y.stage === stage).sort((p, q) => stage === 'decided' ? q.n - p.n
      : (rank[p.learn?.severity] ?? 4) - (rank[q.learn?.severity] ?? 4) || p.n - q.n);
    $('#decisions').innerHTML = `<header class="dhead"><h1>${esc(intents.title)}</h1><p>${esc(intents.note)}</p></header>
      <div class="board">${intents.stages.map((s) => { const ys = col(s.id); return `<section class="col"><h2>${esc(s.title)} <span>${ys.length}</span></h2>${ys.length ? ys.map((y) =>
        `<a class="mini ${stateOf(y)}" href="#intents-${y.n}"><span class="mtop"><b>${y.id}</b>${y.learn?.severity ? chip('sev ' + y.learn.severity, y.learn.severity) : ''}${y.stage === 'decided' ? chip(y.outcome, y.outcome) : ''}</span><span class="mt">${esc(y.title)}</span>${y.learn ? `<span class="mc">${esc(chap[y.learn.chapter]?.title || '')}</span>` : ''}</a>`).join('')
        : '<p class="mnone">Nothing here.</p>'}</section>`; }).join('')}</div>
      <article class="dcard"><h2>Sources read</h2><ul class="dsrc">${intents.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ul></article>`;
    $('#decisions').scrollTo?.(0, 0);
    if (location.hash !== '#intents-0') history.replaceState(null, '', '#intents-0');
    return;
  }
  const tabs = [['learn', 'Learn', x.learn], ['propose', 'Propose', x.proposal], ['decided', 'Decision', x.decision]].filter((t) => t[2]);
  const current = tabs.find((t) => t[0] === tab) ? tab : (tabs.find((t) => t[0] === x.stage) || tabs[tabs.length - 1])[0];
  const ul = (xs) => `<ul>${xs.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>`;
  const titles = Object.fromEntries(stories.filter((s) => !s.kind).map((s) => [s.id, s.title]));
  const decks = {};
  for (const sid of new Set(x.slides.map((r) => r.split('-')[0]))) decks[sid] = (await (await fetch(stories.find((s) => s.id === sid).file)).json()).slides;
  let body = '';
  if (current === 'learn') {
    const l = x.learn;
    body = `${l.weakness ? `<p class="ddec"><b>Weakness</b> ${linkify(l.weakness)}</p>` : ''}
      ${l.strengths.length || l.elsewhere.length ? `<div class="agrid"><div><b>Strengths</b>${ul(l.strengths)}</div><div><b>Elsewhere</b>${ul(l.elsewhere)}</div></div>` : ''}
      ${l.scenarios.length ? `<table class="atable ends"><thead><tr><th>Scenario</th><th>Verdict</th><th>Why</th><th>Fix</th></tr></thead><tbody>${l.scenarios.map((r) =>
        `<tr><td>${esc(r.scenario)}</td><td><span class="verdict ${r.verdict}">${r.verdict}</span></td><td>${esc(r.why)}</td><td>${esc(r.fix || '–')}</td></tr>`).join('')}</tbody></table>` : ''}`;
  } else if (current === 'propose') {
    body = `<p class="ddec">${linkify(x.proposal.text)}</p>${x.proposal.why ? `<p class="dwhy"><b>Why</b> ${linkify(x.proposal.why)}</p>` : ''}`;
  } else {
    const d = x.decision;
    body = `<p class="ddec">${linkify(d.text)}</p>${d.why ? `<p class="dwhy"><b>Why</b> ${linkify(d.why)}</p>` : ''}
      ${d.rejected ? `<p class="dwhy"><b>Rejected</b> ${linkify(d.rejected)}</p>` : ''}
      ${d.supersedes ? `<p class="dwhy"><b>Supersedes</b> ${linkify(d.supersedes)}</p>` : ''}
      ${d.superseded_by ? `<p class="dwhy"><b>Superseded by</b> ${aipLinks([d.superseded_by])}</p>` : ''}
      ${x.slides.length ? `<h3 class="ih3">Slides and their Architecture</h3><ul class="islides">${x.slides.map((r) => { const [sid, n] = r.split('-'); const s = decks[sid]?.[n - 1];
        return `<li><a href="#${r}">${esc(titles[sid] || sid)} ${n}: ${esc(s?.title || '')}</a>${s?.spec ? ` <a class="specl" href="#${r}-spec">Architecture · ${(s.spec.rules || []).length} rules</a>` : ''}</li>`; }).join('')}</ul>` : ''}`;
  }
  const sources = (current === 'decided' ? x.decision?.sources : current === 'propose' ? x.proposal?.sources : null) || [];
  $('#decisions').innerHTML = `<a class="iback" href="#intents-0">← theINTENTS</a>
    <article class="dcard intent ${stateOf(x)}">
      <div class="dtop"><span class="did">${x.id}</span>${chip('phase', x.stage)}${x.outcome ? chip(x.outcome, x.outcome) : ''}${x.learn?.severity ? chip('sev ' + x.learn.severity, x.learn.severity) : ''}${x.learn ? `<a class="achap" href="#${x.learn.chapter}-1">${esc(chap[x.learn.chapter]?.title || '')}</a>` : ''}<span class="ddate">${esc(x.date)}</span></div>
      <h2>${esc(x.title)}</h2>
      <div class="itabs">${tabs.map(([k, l]) => `<button type="button" data-itab="${k}" class="${k === current ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${body}
      ${sources.length ? `<ul class="dsrc">${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ul>` : ''}
    </article>`;
  $('#decisions').scrollTo?.(0, 0);
  const h = `#intents-${x.n}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

async function start() {
  stories = (await (await fetch('stories.json')).json()).stories;
  const counts = await Promise.all(stories.map(async (x) => (x.kind ? null : (await (await fetch(x.file)).json()).slides.length)));
  $('#stories').innerHTML = '<b class="navhead">theOS</b>' + stories.map((x, i) => x.kind
    ? `<button type="button" class="navdec" data-story="${x.id}">${esc(x.title)}</button>`
    : `<button type="button" data-story="${x.id}"><span class="nn">${String(i + 1).padStart(2, '0')}</span><span class="nt">${esc(x.title)}</span><span class="nc">${counts[i]}</span></button>`).join('');
  $('#stories').addEventListener('click', (e) => { const b = e.target.closest('[data-story]'); if (b) open(stories.find((x) => x.id === b.dataset.story), 0); });
  $('#decisions').addEventListener('click', (e) => { const b = e.target.closest('[data-itab]'); if (b) { tab = b.dataset.itab; openIntents(story, num(location.hash)); } });
  $('#track').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
  $('#spectab').addEventListener('click', () => { specOpen = true; renderSpec(); });
  $('#spec').addEventListener('click', (e) => { if (e.target.closest('.sclose')) { specOpen = false; renderSpec(); } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && specOpen) { specOpen = false; renderSpec(); } });
  intents = await (await fetch(stories.find((x) => x.kind === 'intents').file)).json();
  $('#prev').addEventListener('click', () => at > 0 && go(at - 1));
  $('#next').addEventListener('click', () => go(at + 1));
  $('#card').addEventListener('click', (e) => { if (!e.target.closest('pre')) go(at + 1); });
  // Arrows always move, wherever focus is; space and Enter leave a focused button to do its own job.
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || story?.kind) return;
    const onButton = e.target instanceof Element && e.target.closest('button');
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || ((e.key === ' ' || e.key === 'Enter') && !onButton)) { e.preventDefault(); go(at + 1); }
    if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && at > 0) { e.preventDefault(); go(at - 1); }
  });
  let x0 = null;
  addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (x0 === null || story?.kind) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) { if (dx < 0) go(at + 1); else if (at > 0) go(at - 1); }
    x0 = null;
  });
  addEventListener('hashchange', () => { const [st, i] = fromHash(); if (st !== story || i !== at || st.kind) open(st, i); });
  const [st, i] = fromHash();
  open(st, i);
}
start();
