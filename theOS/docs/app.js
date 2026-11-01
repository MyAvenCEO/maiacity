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
  document.body.classList.toggle('show-intents', list);
  if (list) return st.kind === 'sources' ? openSources(st) : st.kind === 'doc' ? openDoc(st, i) : openIntents(st, i);
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
  const ids = [...new Set([...(sp?.intents || []), ...(intents?.intents || []).filter((d) => d.slides.includes(ref)).map((d) => d.id)])]
    .sort((x, y) => num(x) - num(y));
  $('#spec').innerHTML = `<header><b>Architecture</b><button type="button" class="sclose" aria-label="Close">×</button></header>
    <h2>${esc(s.title)}</h2>` + (sp ? `${sp.summary ? `<p>${esc(sp.summary)}</p>` : ''}` +
    (sp.records || []).map((r) => `<h3>${esc(r.name)}</h3>${r.about ? `<p>${esc(r.about)}</p>` : ''}<table class="sfields">${r.fields.map(([f, t, m]) =>
      `<tr><td><code>${esc(f)}</code></td><td>${esc(t)}</td><td>${esc(m)}</td></tr>`).join('')}</table>`).join('') +
    (sp.rules?.length ? `<h3>Rules</h3><ol class="srules">${sp.rules.map((r) => `<li><code>${esc(r.id)}</code>${esc(r.text)}</li>`).join('')}</ol>` : '')
    : '<p class="snone">Not defined in detail yet.</p>') +
    (ids.length ? `<h3>Intents</h3><div class="arefs">${aipLinks(ids)}</div>` : '');
}

// Intents: every architecture intent as one card through three stages: learn (a finding), propose (a drafted
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
    $('#intents').classList.add('isboard');
    $('#intents').innerHTML = `<div class="board">${intents.stages.map((s) => { const ys = col(s.id); return `<section class="col"><h2>${esc(s.title)} <span>${ys.length}</span></h2>${ys.length ? ys.map((y) =>
        `<a class="mini ${stateOf(y)}" href="#intents-${y.n}"><span class="mtop"><b>${y.id}</b>${y.learn?.severity ? chip('sev ' + y.learn.severity, y.learn.severity) : ''}${y.stage === 'decided' ? chip(y.outcome, y.outcome) : ''}</span><span class="mt">${esc(y.title)}</span>${y.learn ? `<span class="mc">${esc(chap[y.learn.chapter]?.title || '')}</span>` : ''}</a>`).join('')
        : '<p class="mnone">Nothing here.</p>'}</section>`; }).join('')}</div>`;
    $('#intents').scrollTo?.(0, 0);
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
    body = `${l.weakness ? `<div><b class="ilabel">Weakness</b><p class="ddec">${linkify(l.weakness)}</p></div>` : ''}
      ${l.strengths.length || l.elsewhere.length ? `<div class="agrid"><div><b>Strengths</b>${ul(l.strengths)}</div><div><b>Elsewhere</b>${ul(l.elsewhere)}</div></div>` : ''}
      ${l.scenarios.length ? `<div class="scens"><b class="ilabel">Scenarios</b>${l.scenarios.map((r) =>
        `<section class="scen"><p class="shead"><span class="verdict ${r.verdict}">${r.verdict}</span><span>${linkify(r.scenario)}</span></p><div class="sgrid"><div><b class="ilabel">Why</b><p>${linkify(r.why)}</p></div>${r.fix ? `<div><b class="ilabel">Fix</b><p>${linkify(r.fix)}</p></div>` : ''}</div></section>`).join('')}</div>` : ''}`;
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
  $('#intents').classList.remove('isboard');
  $('#intents').innerHTML = `<a class="iback" href="#intents-0">← Intents</a>
    <article class="dcard intent ${stateOf(x)}">
      <div class="dtop"><span class="did">${x.id}</span>${chip('phase', x.stage)}${x.outcome ? chip(x.outcome, x.outcome) : ''}${x.learn?.severity ? chip('sev ' + x.learn.severity, x.learn.severity) : ''}${x.learn ? `<a class="achap" href="#${x.learn.chapter}-1">${esc(chap[x.learn.chapter]?.title || '')}</a>` : ''}<span class="ddate">${esc(x.date)}</span></div>
      <h2>${esc(x.title)}</h2>
      <div class="itabs">${tabs.map(([k, l]) => `<button type="button" data-itab="${k}" class="${k === current ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${body}
      ${sources.length ? `<ul class="dsrc">${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ul>` : ''}
    </article>`;
  $('#intents').scrollTo?.(0, 0);
  const h = `#intents-${x.n}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

// Sources: every source the intents were learned from, one list.
async function openSources(st) {
  story = st;
  document.querySelectorAll('#stories button').forEach((b) => b.classList.toggle('on', b.dataset.story === st.id));
  if (!intents) intents = await (await fetch(st.file)).json();
  const docs = await Promise.all(stories.filter((x) => x.kind === 'doc').map(async (x) => [x, (({ sources = [], protocols = [] }) => [...new Map([...sources, ...protocols.flatMap((p) => p.sources)].map((y) => [y.label, y])).values()])(await (await fetch(x.file)).json())]));
  const list = (xs) => `<ul class="dsrc srclist">${xs.map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label)}</li>`).join('')}</ul>`;
  $('#intents').classList.remove('isboard');
  $('#intents').innerHTML = `<header class="dhead"><h1>Sources</h1><p>Everything the intents and the flow were learned from: papers, specifications, design notes and the code of the systems compared.</p></header>
    <article class="dcard"><h2>Intents</h2>${list(intents.sources)}</article>
    ${docs.map(([x, xs]) => `<article class="dcard"><h2>${esc(x.title)}</h2>${list(xs)}</article>`).join('')}`;
  $('#intents').scrollTo?.(0, 0);
  if (location.hash !== '#sources-0') history.replaceState(null, '', '#sources-0');
}

// Flow: how we work, as one draft document. The diagram is drawn from the same JSON as the text below it.
function flowSvg(F, key = 'f') {
  const n = F.steps.length, W = 1000, gap = 22, w = (W - 40 - gap * (n - 1)) / n, h = 74, y = F.bands?.length ? 58 : 16, chars = Math.floor((w - 16) / 6.3);
  const x = (k) => 20 + (k - 1) * (w + gap), mid = (k) => x(k) + w / 2;
  const loops = [...F.loops].sort((p, q) => Math.abs(p.from - p.to) - Math.abs(q.from - q.to) || p.from - q.from);
  const depth = new Map(loops.map((l, k) => [l, 30 + 30 * k]));
  const ends = {};
  loops.forEach((l) => { (ends[l.from] ||= []).push(l); (ends[l.to] ||= []).push(l); });
  const at = (node, l) => { const xs = ends[node].slice().sort((p, q) => (p === q ? 0 : (p.from === node ? p.to : p.from) - (q.from === node ? q.to : q.from))); return mid(node) + (xs.indexOf(l) - (xs.length - 1) / 2) * 16; };
  const H = y + h + (loops.length ? Math.max(...depth.values()) * 0.75 + 30 : 16);
  const words = (t, max) => t.split(' ').reduce((ls, wd) => { const l = ls[ls.length - 1]; if (l && (l + ' ' + wd).length <= max) ls[ls.length - 1] = l + ' ' + wd; else ls.push(wd); return ls; }, []);
  const bands = (F.bands || []).map((b) => { const a = x(b.steps[0]), z = x(b.steps[b.steps.length - 1]) + w;
    return `<rect class="fband" x="${a}" y="12" width="${z - a}" height="26" rx="6"/><text class="fbandt" x="${(a + z) / 2}" y="29">${esc(b.name)}</text>`; }).join('');
  const nodes = F.steps.map((s) => `<g class="fnode${F.at === s.n ? ' at' : ''}" data-jump="step-${s.n}" tabindex="0" role="button" aria-label="${esc(s.name)}">
    <rect x="${x(s.n)}" y="${y}" width="${w}" height="${h}" rx="8"/>
    <text class="fnum" x="${x(s.n) + 10}" y="${y + 20}">${s.n}</text><text class="fname" x="${x(s.n) + 24}" y="${y + 20}">${esc(s.name)}</text>
    ${words(s.writes, chars).slice(0, 3).map((l, k) => `<text class="fwrite" x="${x(s.n) + 10}" y="${y + 40 + k * 13}">${esc(l)}</text>`).join('')}</g>`).join('');
  const arrows = F.steps.slice(0, -1).map((s) => `<line class="fline" x1="${x(s.n) + w}" y1="${y + h / 2}" x2="${x(s.n + 1) - 2}" y2="${y + h / 2}" marker-end="url(#${key}head)"/>`).join('');
  const gates = (F.gates || []).filter((g) => g.after < n).map((g) => { const cx = x(g.after) + w + gap / 2, cy = y + h / 2;
    return `<g class="fgate"><title>${esc(g.what)}</title><path d="M${cx} ${cy - 11} L${cx + 11} ${cy} L${cx} ${cy + 11} L${cx - 11} ${cy} Z"/><text x="${cx}" y="${cy + 4}">${g.id}</text></g>`; }).join('');
  const back = loops.map((l) => { const d = depth.get(l), fx = at(l.from, l), tx = at(l.to, l), by = y + h;
    return `<path class="floop" d="M${fx} ${by} C${fx} ${by + d} ${tx} ${by + d} ${tx} ${by + 3}" marker-end="url(#${key}back)"/>
      <text class="floopt" x="${(fx + tx) / 2}" y="${by + d * 0.75 + 4}">${esc(l.when)}</text>`; }).join('');
  return `<svg class="flowsvg" viewBox="0 0 ${W} ${Math.ceil(H)}" role="img" aria-label="The flow: ${F.steps.map((s) => s.name).join(', ')}">
    <defs><marker id="${key}head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="fheadp" d="M0 0 L8 4 L0 8 Z"/></marker>
    <marker id="${key}back" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="fbackp" d="M0 0 L8 4 L0 8 Z"/></marker></defs>
    ${bands}${arrows}${back}${nodes}${gates}</svg>`;
}

// One avenCEO record, as its intent page: where it stands, then every part of the record in step order.
const stageOf = (R) => { const has = (w) => R.events.some((e) => e.what === w);
  const last = Math.max(0, ...R.review.map((r) => r.round || 1));
  const clean = last && !R.review.filter((r) => (r.round || 1) === last).some((r) => r.findings.some((f) => f.sev !== 'Nit'));
  const spec = !last ? 'Specify: waiting for the spec review' : clean ? 'Specify: waiting for Gate A' : `Specify: spec review round ${last + 1}`;
  return !R.problem ? [1, 'Understand'] : !has('gate-A') ? [2, spec] : !has('gate-B') ? [3, 'Build'] : !has('measured') ? [4, 'Learn'] : [5, 'Closed']; };
function renderRecord(R, F) {
  const [at, stage] = stageOf(R);
  const commit = (h) => `<a class="commit" href="https://github.com/myavenceo/maiacity/commit/${esc(h)}" target="_blank" rel="noopener">${esc(h)}</a>`;
  const table = (heads, rows) => `<table class="dtable"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td>${k ? esc(c) : `<b>${esc(c)}</b>`}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const ul = (xs) => `<ul>${xs.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>`;
  const sec = (h, body, note = '') => `<section class="dsec"><h2>${h}</h2>${note ? `<p class="dnote">${note}</p>` : ''}${body}</section>`;
  const p = R.problem;
  const rounds = [...new Set(R.review.map((r) => r.round || 1))];
  const review = R.review.length ? rounds.map((n) => `<div class="round"><h3>Round ${n}</h3>${R.review.filter((r) => (r.round || 1) === n).map((r) => {
      const count = ['Blocker', 'Major', 'Nit'].map((v) => [v, r.findings.filter((f) => f.sev === v).length]).filter(([, c]) => c).map(([v, c]) => `${c} ${v}`).join(', ') || 'no findings';
      return `<div class="rv"><h4>${esc(r.checker)} <span class="dnote">${count}</span></h4>
      ${r.prompt ? `<details class="prompt"><summary>The exact prompt it got</summary><pre>${esc(r.prompt)}</pre></details>` : ''}
      ${r.paraphrase ? `<div class="para"><div><b class="ilabel">What this proposes</b><p>${esc(r.paraphrase.proposes)}</p></div><div><b class="ilabel">How the existing system works, per this record</b><p>${esc(r.paraphrase.existing)}</p></div></div>` : ''}
      ${r.findings.length ? `<table class="dtable"><thead><tr><th>Severity</th><th>Where</th><th>Finding</th><th>Answer</th></tr></thead><tbody>${r.findings.map((f) => `<tr><td><span class="chipx sevx ${esc(f.sev.toLowerCase())}">${esc(f.sev)}</span></td><td>${esc(f.scope)}</td><td>${esc(f.text)}</td><td><b>${esc(f.answer || 'open')}</b>${f.note ? ` ${esc(f.note)}` : ''}</td></tr>`).join('')}</tbody></table>` : ''}</div>`; }).join('')}</div>`).join('')
    : '<p class="dnote">Not run yet.</p>';
  return `<article class="doc">
    <header class="dochead"><div class="dtop"><span class="chipx">${esc(R.kind)}</span><span class="chipx stagechip">${esc(stage)}</span><span class="ddate">${esc(R.source.at)}</span></div>
      <h1>${esc(R.id)}: ${esc(R.title)}</h1><p class="dlead">${esc(R.source.text)} <span class="dby">(${esc(R.source.by)}, ${esc(R.source.type)})</span></p>
      ${R.note ? `<p class="dnote">${esc(R.note)}</p>` : ''}</header>
    <div class="dsvg">${flowSvg({ ...F, at }, 'r')}</div>
    <p class="dnote">The highlighted step is where this AIP stands, computed from the record.</p>
    ${sec('1 · Understand: the problem', `<p><b>Who</b></p>${ul(p.who)}<p><b>What they experience</b> ${esc(p.experience)}</p>
      <p><b>Evidence</b> ${esc(p.baseline)}</p>${p.evidence.map((g) => `<p class="evg">${esc(g.group)}</p><ul>${g.items.map((x) => `<li>${esc(x.text)}${x.commit ? ` <span class="dnote">fixed in</span> ${commit(x.commit)}` : ''}</li>`).join('')}</ul>`).join('')}
      <p><b>Why, until the root</b></p><ol>${p.whys.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>${p.whys_note ? `<p class="dnote">${esc(p.whys_note)}</p>` : ''}
      <div class="agrid"><div><b>Truths</b>${ul(p.truths)}</div><div><b>Assumptions</b>${ul(p.assumptions)}</div></div>
      <p><b>Risk</b> ${esc(p.risk)}</p>`)}
    ${sec('What exists already', table(['What', 'Used as'], R.reuse.map((r) => [r.what, r.use])), 'The zoom-out question first: what can we reuse instead of build?')}
    ${sec('2 · Specify: options', table(['Option', 'Why', ''], R.options.map((o) => [o.name, o.note, o.chosen ? 'chosen' : ''])))}
    ${sec('Claims', table(['Claim', 'Promise', 'How it could fail', 'Check', 'Kind', 'Result'], R.claims.map((c) => [c.id, c.promise, c.fails, c.check, c.kind, c.result])) + `<p class="outcome"><b>Outcome claim</b> ${esc(R.outcome.promise)} ${esc(R.outcome.how || '')} <span class="dnote">(${esc(R.outcome.kind)}, ${esc(R.outcome.result)})</span></p>${R.gaps?.length ? `<p class="dnote">Not covered yet: ${R.gaps.map(esc).join(' ')}</p>` : ''}`, 'Each claim is a promise with the check that would catch it failing. You approve these at Gate A.')}
    ${R.mockup ? sec('Mockup', ul(R.mockup)) : ''}
    ${sec('Checkpoints', table(['#', 'Adds', 'Claims'], R.checkpoints.map((c) => [String(c.n), c.adds, c.claims.join(', ')])), 'Smallest first; each passes the Mechanical and Review gates before the next starts.')}
    ${R.deferred ? sec('Deferred, on purpose', table(['What', 'Until'], R.deferred.map((d) => [d.what, d.until])), 'Deleted from this AIP, each with what would bring it back.') : ''}
    ${R.design ? sec(esc(R.design.title), table(['Kind', 'How it is kept'], R.design.rows.map((m) => [m.kind, m.how]))) : ''}
    ${sec('Spec review', review, 'Fresh checkers that saw only this record and the files it names, never the conversation that wrote it. Every finding is answered: fix, contest with evidence, escalate to you, or decline a Nit.')}
    ${sec('Gate A: your questions', `<ol class="gq">${R.questions.map((q) => `<li><b>${esc(q.q)}</b><ul>${q.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></li>`).join('')}</ol>`, 'What only you can decide. Your answers are written into this record, with the time.')}
    ${sec('History', table(['When', 'Who', 'What', ''], R.events.slice().reverse().map((e) => [e.at, e.by, e.what, e.text])), 'Append-only, newest first.')}
  </article>`;
}

async function openDoc(st, i = 0) {
  story = st;
  document.querySelectorAll('#stories button').forEach((b) => b.classList.toggle('on', b.dataset.story === st.id));
  const F = await (await fetch(st.file)).json();
  const recs = await Promise.all((F.records || []).map(async (f) => (await fetch(f)).json()));
  const labels = [F.title, ...recs.map((r) => `${r.id}: ${r.title}`), ...F.protocols.map((p) => p.name)];
  const tabs = `<nav class="dtabs" aria-label="avenCEO">${labels.map((t, k) => `<a href="#${st.id}-${k}" class="${k === i ? 'on' : ''}${k > recs.length ? ' srctab' : ''}">${esc(t)}</a>`).join('')}</nav>`;
  const src = (xs) => `<ul class="dsrc">${xs.map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>` : esc(x.label)}</li>`).join('')}</ul>`;
  const sec = (h, body, note = '') => `<section class="dsec"><h2>${h}</h2>${note ? `<p class="dnote">${note}</p>` : ''}${body}</section>`;
  const R = i > 0 && i <= recs.length && recs[i - 1];
  const P = i > recs.length && F.protocols[i - 1 - recs.length];
  $('#intents').classList.remove('isboard');
  const hash = `#${st.id}-${P || R ? i : 0}`;
  if (R) {
    $('#intents').innerHTML = `${tabs}${renderRecord(R, F)}`;
    $('#intents').scrollTo?.(0, 0);
    if (location.hash !== hash) history.replaceState(null, '', hash);
    return;
  }
  if (P) {
    $('#intents').innerHTML = `${tabs}<article class="doc">
      <header class="dochead"><div class="dtop"><span class="chipx srcchip">source</span></div>
        <h1>${esc(P.name)}</h1><p class="dby">${esc(P.by)}</p><p class="dlead">${esc(P.summary)}</p></header>
      <div class="dsvg">${flowSvg(P)}</div>
      ${P.gates.length || P.loops.length ? `<p class="dnote">${P.gates.length ? 'Diamonds are gates (hover for what they check). ' : ''}${P.loops.length ? 'Dashed lines go back.' : ''}</p>` : ''}
      ${sec('The steps', `<ol class="psteps">${P.steps.map((x) => `<li><b>${esc(x.name)}</b> ${esc(x.writes)}</li>`).join('')}</ol>`)}
      ${P.gates.length ? sec('Gates', `<ul>${P.gates.map((g) => `<li><b>${esc(g.id)}</b> after ${esc(P.steps[g.after - 1].name)}: ${esc(g.what)}</li>`).join('')}</ul>`) : ''}
      ${sec('Key ideas', `<ul>${P.ideas.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>`)}
      ${sec('What we took', `<table class="dtable"><thead><tr><th>Idea</th><th>Where it lives in avenCEO</th></tr></thead><tbody>${P.took.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`)}
      ${sec('Sources', src(P.sources))}
    </article>`;
    $('#intents').scrollTo?.(0, 0);
    if (location.hash !== hash) history.replaceState(null, '', hash);
    return;
  }
  const gateAt = Object.fromEntries(F.gates.map((g) => [g.after, g]));
  const ol = (xs) => `<ol>${xs.map((v) => `<li>${linkify(v)}</li>`).join('')}</ol>`;
  const steps = F.steps.map((s) => `<section class="dstep" id="step-${s.n}">
      <span class="dsn">${s.n}</span>
      <div class="dsb"><h3>${esc(s.name)}${gateAt[s.n] ? ` <span class="chipx gatechip">Gate ${gateAt[s.n].id}</span>` : ''}</h3>
        <p class="dsq">${esc(s.question)}</p>
        <ul class="dsdo">${s.do.map((v) => `<li>${linkify(v)}</li>`).join('')}</ul>
        <dl class="dsdl"><dt>Writes</dt><dd>${esc(s.output)}</dd><dt>Gate</dt><dd>${esc(s.gate)}</dd><dt>Who</dt><dd>${esc(s.who)}</dd><dt>From</dt><dd>${s.from.map((f) => `<span class="dfrom">${esc(f)}</span>`).join('')}</dd></dl></div></section>`).join('');
  const roles = `<table class="dtable roles"><thead><tr><th>Who</th>${F.steps.map((s) => `<th title="${esc(s.name)}"><span class="rn">${s.n}</span><span class="rt">${esc(s.name)}</span></th>`).join('')}<th>Does</th></tr></thead>
    <tbody>${F.roles.map((r) => `<tr><td>${esc(r.role)}</td>${F.steps.map((s) => `<td class="dot">${r.steps.includes(s.n) ? '●' : ''}</td>`).join('')}<td>${esc(r.does)}</td></tr>`).join('')}</tbody></table>`;
  const risk = `<table class="dtable"><thead><tr><th>Risk</th><th>Means</th><th>Evidence</th><th>Gates</th><th>Build</th></tr></thead>
    <tbody>${F.risk.map((r) => `<tr><td><b>${esc(r.level)}</b></td><td>${esc(r.means)}</td><td>${esc(r.evidence)}</td><td>${esc(r.gates)}</td><td>${esc(r.build)}</td></tr>`).join('')}</tbody></table>`;
  const stage = `<p>${esc(F.stage.rule)}</p><table class="dtable"><thead><tr><th>Still missing</th><th>The AIP stands at</th></tr></thead>
    <tbody>${F.stage.rows.map((r) => `<tr><td>${esc(r.missing)}</td><td><b>${esc(r.at)}</b></td></tr>`).join('')}</tbody></table>`;
  const loops = `<table class="dtable"><thead><tr><th>From</th><th>Back to</th><th>When</th></tr></thead>
    <tbody>${F.loops.map((l) => `<tr><td>${esc(F.steps[l.from - 1].name)}</td><td>${esc(F.steps[l.to - 1].name)}</td><td>${esc(l.when)}</td></tr>`).join('')}</tbody></table>`;
  const gates = `<table class="dtable"><thead><tr><th>Gate</th><th>After</th><th>What</th></tr></thead>
    <tbody>${F.gates.map((g) => `<tr><td><b>${g.id}</b></td><td>${esc(F.steps[g.after - 1].name)}</td><td>${esc(g.what)}</td></tr>`).join('')}</tbody></table>`;
  const lessons = `<table class="dtable"><thead><tr><th>Cue</th><th>Lesson</th><th>Evidence</th><th>Confidence</th></tr></thead>
    <tbody>${F.lessons.map((l) => `<tr><td>${esc(l.cue)}</td><td>${esc(l.lesson)}</td><td>${linkify(l.evidence)}</td><td>${esc(l.confidence)}</td></tr>`).join('')}</tbody></table>`;
  const record = `<pre class="drec">${Object.entries(F.record).map(([k, v]) => `<b>${esc(k.padEnd(12))}</b>${esc(v)}`).join('\n')}</pre>`;
  const cps = `<ul>${F.checkpoints.rules.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>
    <div class="cpflow">${F.checkpoints.cycle.map((c, k, all) => `<span class="${k === all.length - 1 ? 'cpnext' : F.checkpoints.gates.some((g) => c.startsWith(g.name)) ? '' : 'cpwork'}">${esc(c)}</span>`).join('<i>→</i>')}</div>
    <table class="dtable"><thead><tr><th>Gate</th><th>Checks</th><th>Who</th><th>When</th></tr></thead><tbody>${F.checkpoints.gates.map((g) => `<tr><td><b>${esc(g.name)}</b></td><td>${esc(g.checks)}</td><td>${esc(g.who)}</td><td>${esc(g.when)}</td></tr>`).join('')}</tbody></table>`;
  const table = (heads, rows) => `<table class="dtable"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td>${k ? esc(c) : `<b>${esc(c)}</b>`}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const I = F.improve;
  const improve = `<div class="dsvg">${flowSvg(I, 'i')}</div>
    <div class="agrid three"><div><b>Signals</b><ul>${I.signals.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div>
      <div><b>A change, in this order of preference</b><ol>${I.order.map((v) => `<li>${esc(v)}</li>`).join('')}</ol></div>
      <div><b>Guards</b><ul>${I.guards.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div></div>`;
  $('#intents').innerHTML = `${tabs}<article class="doc">
    <header class="dochead"><div class="dtop"><span class="chipx draftchip">${esc(F.status)}</span><span class="ddate">${esc(F.date)}</span></div>
      <h1>${esc(F.title)}</h1><p class="dlead">${esc(F.summary)}</p></header>
    <div class="dsvg">${flowSvg(F)}</div>
    <p class="dnote">Click a step for its detail. Diamonds are your gates (hover for what they check); dashed lines go back.</p>
    ${sec('Principles', ol(F.principles))}
    ${sec('The steps', steps)}
    ${sec('Gates', gates, 'Your gates. Inside Build, every checkpoint also passes its own gates (below).')}
    ${sec('Checkpoints and their gates', cps, 'A rule is advice; a gate is enforced. An attempt may be wrong; it may not ship until it isn\'t.')}
    ${sec('How avenCEO improves itself', improve, 'Its base: every change to avenCEO is an intent of kind avenCEO, measured like any other, and kept only if its metric moves.')}
    ${sec('Measured', table(['Metric', 'What', 'Want'], F.metrics.map((m) => [m.name, m.what, m.want])), 'Computed from the records of every intent; they are the signals the flow learns from.')}
    ${sec('Going back', loops, 'Going back is normal: it is how a wrong idea dies cheaply.')}
    ${sec('Where an AIP stands', stage)}
    ${sec('Who does what', roles)}
    ${sec('Risk decides depth', risk, 'One question: can it be undone?')}
    ${sec('Rules in every step', ol(F.rules))}
    ${sec('Assumptions that must hold', table(['Holds', 'If it breaks'], F.assumptions.map((a) => [a.holds, a.else])), 'The deletions below are safe only while these hold. If one breaks, we add back what it needs.')}
    ${F.added ? sec('Added since, and what each replaces', table(['Added', 'Replaces', 'From'], F.added.map((a) => [a.what, a.replaces, a.from])), 'Every addition has to replace something weaker; otherwise it stays out.') : ''}
    ${sec('What we deleted, and why', table(['Deleted', 'Now', 'Why'], F.deleted.map((d) => [d.what, d.now, d.why])), 'From the first draft (in the git history), by asking of every part: what breaks if it goes?')}
    ${sec('The record', record, 'One per intent. Everything else is derived from it.')}
    ${sec('Learned so far', lessons, 'In the lesson format: the shape of situation it fires on, the operation, the evidence, the confidence.')}
    ${sec('Automate last', `<div class="agrid"><div><b>By hand now</b><ul>${F.automate.now.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div><div><b>After three runs by hand</b><ul>${F.automate.later.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div></div>`)}
    ${F.glossary ? sec('Words', table(['Word', 'Means'], F.glossary)) : ''}
    ${sec('Sources', src(F.sources))}
  </article>`;
  $('#intents').scrollTo?.(0, 0);
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

async function start() {
  stories = (await (await fetch('stories.json')).json()).stories;
  const counts = await Promise.all(stories.map(async (x) => (x.kind ? null : (await (await fetch(x.file)).json()).slides.length)));
  $('#stories').innerHTML = '<b class="navhead">theOS</b>' + stories.map((x, i) => x.kind
    ? `<button type="button" class="navdec" data-story="${x.id}">${esc(x.title)}</button>`
    : `<button type="button" data-story="${x.id}"><span class="nn">${String(i + 1).padStart(2, '0')}</span><span class="nt">${esc(x.title)}</span><span class="nc">${counts[i]}</span></button>`).join('');
  $('#stories').addEventListener('click', (e) => { const b = e.target.closest('[data-story]'); if (b) open(stories.find((x) => x.id === b.dataset.story), 0); });
  $('#intents').addEventListener('click', (e) => { const j = e.target.closest('[data-jump]'); if (j) document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#intents').addEventListener('click', (e) => { const b = e.target.closest('[data-itab]'); if (b) { tab = b.dataset.itab; openIntents(story, num(location.hash)); } });
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
