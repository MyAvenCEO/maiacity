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
  const m = /^#([a-z]+)-(\d+)$/.exec(location.hash);
  const st = stories.find((x) => x.id === m?.[1]) || stories[0];
  const n = m && st.id === m[1] ? Number(m[2]) : 0;
  return [st, st.kind ? n : Math.max(0, n - 1)];
}
async function open(st, i) {
  const list = Boolean(st.kind);
  document.body.classList.toggle('show-decisions', list);
  if (list) return st.kind === 'audit' ? openAudit(st, i) : openDecisions(st, i);
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
let specOpen = false, allDecisions = null;
function renderSpec() {
  const s = deck[at], sp = s.spec, ref = `${story.id}-${at + 1}`;
  $('#spectab').classList.toggle('has', Boolean(sp));
  $('#spectab').hidden = specOpen;
  $('#spectab').setAttribute('aria-expanded', String(specOpen));
  $('#spec').hidden = !specOpen;
  if (!specOpen) return;
  const ids = [...new Set([...(sp?.decisions || []), ...(allDecisions || []).filter((d) => d.slides.includes(ref)).map((d) => d.id)])]
    .sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  const status = Object.fromEntries((allDecisions || []).map((d) => [d.id, d.status]));
  $('#spec').innerHTML = `<header><b>Architecture</b><button type="button" class="sclose" aria-label="Close">×</button></header>
    <h2>${esc(s.title)}</h2>` + (sp ? `${sp.summary ? `<p>${esc(sp.summary)}</p>` : ''}` +
    (sp.records || []).map((r) => `<h3>${esc(r.name)}</h3>${r.about ? `<p>${esc(r.about)}</p>` : ''}<table class="sfields">${r.fields.map(([f, t, m]) =>
      `<tr><td><code>${esc(f)}</code></td><td>${esc(t)}</td><td>${esc(m)}</td></tr>`).join('')}</table>`).join('') +
    (sp.rules?.length ? `<h3>Rules</h3><ol class="srules">${sp.rules.map((r) => `<li><code>${esc(r.id)}</code>${esc(r.text)}</li>`).join('')}</ol>` : '')
    : '<p class="snone">Not defined in detail yet.</p>') +
    (ids.length ? `<h3>Decisions</h3><div class="arefs">${ids.map((d) => `<a class="${status[d] === 'proposed' ? 'prop' : ''}" href="#decisions-${d.slice(1)}">${d}${status[d] === 'proposed' ? ' proposed' : ''}</a>`).join('')}</div>` : '');
}

// theDECISIONS: every decision as a card, numbered D1, D2 …, with its sources and the slides that tell it.
let decisions = null, filter = 'all';
async function openDecisions(st, i) {
  story = st;
  document.querySelectorAll('#stories button').forEach((b) => b.classList.toggle('on', b.dataset.story === st.id));
  if (!decisions) decisions = await (await fetch(st.file)).json();
  const titles = Object.fromEntries(stories.filter((x) => !x.kind).map((x) => [x.id, x.title.replace(/^\d+ · /, '')]));
  // Newest first: D68 at the top.
  const shown = decisions.decisions.filter((d) => filter === 'all' || d.status === filter)
    .sort((x, y) => Number(y.id.slice(1)) - Number(x.id.slice(1)));
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
      ${(audit?.items || []).some((x) => x.decisions.includes(d.id)) ? `<div class="arefs"><b>From theAUDIT</b>${audit.items.filter((x) => x.decisions.includes(d.id)).map((x) => `<a href="#audit-${x.id.slice(1)}">${x.id} · ${esc(x.severity)}</a>`).join('')}</div>` : ''}
      ${d.slides.length ? `<div class="dslides">${d.slides.map((r) => { const [sid, n] = r.split('-'); return `<a href="#${r}">${esc(titles[sid] || sid)} ${n}</a>`; }).join('')}</div>` : ''}
      ${d.sources.length ? `<ul class="dsrc">${d.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></li>`).join('')}</ul>` : ''}
    </article>`).join('');
  const target = i > 0 && document.getElementById(`D${i}`);
  if (target) target.scrollIntoView({ block: 'start' }); else scrollTo(0, 0);
  const h = i > 0 ? `#decisions-${i}` : '#decisions-0';
  if (location.hash !== h) history.replaceState(null, '', h);
}

// theAUDIT: one item per finding, each linked to the decisions that answer it. An item's status is computed from those
// decisions (resolved once every one is decided, following supersessions), never stored, so nothing can drift.
let audit = null, auditFilter = 'open';
function decisionState(id, seen = new Set()) {
  const d = (allDecisions || []).find((x) => x.id === id);
  if (!d || seen.has(id)) return 'open';
  seen.add(id);
  if (d.status === 'decided') return 'resolved';
  if (d.status === 'superseded' && d.superseded_by) return decisionState(d.superseded_by, seen);
  return 'open';
}
const itemState = (ids) => (ids.length && ids.every((d) => decisionState(d) === 'resolved') ? 'resolved' : 'open');
function decLinks(ids) {
  const st = Object.fromEntries((allDecisions || []).map((d) => [d.id, d]));
  const link = (d) => `<a class="${st[d]?.status === 'proposed' ? 'prop' : ''}" href="#decisions-${d.slice(1)}">${d}${st[d] ? ` · ${esc(st[d].status)}` : ''}</a>`;
  const chain = (d, seen = new Set()) => (st[d]?.status === 'superseded' && st[d].superseded_by && !seen.has(d) ? link(d) + '→' + chain(st[d].superseded_by, seen.add(d)) : link(d));
  return ids.map((d) => chain(d)).join('');
}
async function openAudit(st, i) {
  story = st;
  document.querySelectorAll('#stories button').forEach((b) => b.classList.toggle('on', b.dataset.story === st.id));
  if (!audit) audit = await (await fetch(st.file)).json();
  const ul = (xs) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const sev = (s) => `<span class="sev ${s}">${s}</span>`;
  const state = (s) => `<span class="astate ${s}">${s}</span>`;
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const chap = Object.fromEntries(audit.chapters.map((c) => [c.id, c]));
  const items = audit.items.map((x) => ({ ...x, state: itemState(x.decisions) }));
  const count = (s) => items.filter((x) => x.state === s).length;
  const shown = items.filter((x) => auditFilter === 'all' || x.state === auditFilter)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || chap[a.chapter].n - chap[b.chapter].n);
  $('#decisions').innerHTML = `<header class="dhead"><h1>${esc(audit.title)}</h1><p>${esc(audit.note)}</p>
    <div class="dfilter">${[['open', `Open ${count('open')}`], ['resolved', `Resolved ${count('resolved')}`], ['all', `All ${items.length}`]]
      .map(([k, l]) => `<button type="button" data-afilter="${k}" class="${auditFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div></header>` +
    shown.map((x) => `<article class="dcard aitem ${x.state}" id="${x.id}">
      <div class="dtop"><span class="did">${x.id}</span>${sev(x.severity)}${state(x.state)}<a class="achap" href="#${x.chapter}-1">${String(chap[x.chapter].n).padStart(2, '0')} ${esc(chap[x.chapter].title)}</a></div>
      <h2>${esc(x.concept)}</h2>
      <p class="ddec"><b>Weakness</b> ${esc(x.weakness)}</p>
      <div class="agrid"><div><b>Strengths</b>${ul(x.strengths)}</div><div><b>Elsewhere</b>${ul(x.elsewhere)}</div></div>
      <div class="arefs"><b>Answered by</b>${decLinks(x.decisions)}</div>
    </article>`).join('') +
    `<article class="dcard" id="A0"><h2>${esc(audit.endings.title)}</h2><p class="dwhy">${esc(audit.endings.note)}</p>
      <table class="atable ends"><thead><tr><th>Scenario</th><th>Verdict</th><th>Why</th><th>Fixed by</th></tr></thead><tbody>${audit.endings.rows.map((r) => {
        const fixed = r.verdict !== 'holds' && r.decisions.length && itemState(r.decisions) === 'resolved';
        return `<tr><td>${esc(r.scenario)}</td><td><span class="verdict ${fixed ? 'holds' : r.verdict}">${fixed ? 'fixed' : r.verdict}</span></td><td>${esc(r.why)}</td><td><span class="arefs">${r.decisions.length ? decLinks(r.decisions) : '–'}</span></td></tr>`;
      }).join('')}</tbody></table></article>
    <article class="dcard"><h2>Sources read</h2><ul class="dsrc">${audit.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></li>`).join('')}</ul></article>`;
  const target = i > 0 && document.getElementById(`A${i}`);
  if (target) target.scrollIntoView({ block: 'start' }); else $('#decisions').scrollTo?.(0, 0);
  const h = `#audit-${i}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

async function start() {
  stories = (await (await fetch('stories.json')).json()).stories;
  const counts = await Promise.all(stories.map(async (x) => (x.kind ? null : (await (await fetch(x.file)).json()).slides.length)));
  $('#stories').innerHTML = '<b class="navhead">theOS</b>' + stories.map((x, i) => x.kind
    ? `<button type="button" class="navdec" data-story="${x.id}">${esc(x.title)}</button>`
    : `<button type="button" data-story="${x.id}"><span class="nn">${String(i + 1).padStart(2, '0')}</span><span class="nt">${esc(x.title)}</span><span class="nc">${counts[i]}</span></button>`).join('');
  $('#stories').addEventListener('click', (e) => { const b = e.target.closest('[data-story]'); if (b) open(stories.find((x) => x.id === b.dataset.story), 0); });
  $('#decisions').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; openDecisions(story, 0); } });
  $('#decisions').addEventListener('click', (e) => { const b = e.target.closest('[data-afilter]'); if (b) { auditFilter = b.dataset.afilter; openAudit(story, 0); } });
  $('#track').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
  $('#spectab').addEventListener('click', () => { specOpen = true; renderSpec(); });
  $('#spec').addEventListener('click', (e) => { if (e.target.closest('.sclose')) { specOpen = false; renderSpec(); } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && specOpen) { specOpen = false; renderSpec(); } });
  allDecisions = (await (await fetch(stories.find((x) => x.kind === 'decisions').file)).json()).decisions;
  audit = await (await fetch(stories.find((x) => x.kind === 'audit').file)).json();
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
