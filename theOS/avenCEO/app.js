// Intents: avenCEO's own viewer. It reads theOS's docs (one JSON doc per thing), never writes them. Every page is one
// doc, drawn by its type; "Linked from" comes from following every path from avenCEO's definition and the indexes.
const HERE = 'avenCEO';
const $ = (s) => document.querySelector(s);
const e = W.esc;
let G = null; // { docs, back, def }

const LISTS = [['aips', 'AIPs', 'intent'], ['waiting', 'Waiting for you', null], ['gap'], ['decisions', 'Decisions', 'decision'], ['sessions', 'Sessions', 'session'],
  ['gap'], ['steps', 'Steps', 'step'], ['gates', 'Gates', 'gate'], ['types', 'Types', 'type'], ['checkers', 'Checkers', 'checker'], ['terms', 'Terms', 'term'],
  ['gap'], ['metrics', 'Metrics', 'metric'], ['lessons', 'Lessons', 'lesson'], ['authors', 'Authors', 'author']];
const ofType = (t) => [...G.docs].filter(([, d]) => d?.type === t).map(([p, d]) => [p, d]);
const T = (t) => W.text(t, HERE, G.docs);
const L = (p) => W.link(p, HERE, G.docs);
const sec = (h, body, note = '') => (body ? `<section class="sec"><h2>${h}</h2>${note ? `<p class="note">${note}</p>` : ''}${body}</section>` : '');
const ul = (xs) => (xs?.length ? `<ul>${xs.map((v) => `<li>${T(v)}</li>`).join('')}</ul>` : '');
const table = (heads, rows) => (rows.length ? `<table class="t"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td>${k ? c : `<b>${c}</b>`}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '');
const tally = (fs) => ['Blocker', 'Major', 'Nit'].map((v) => [v, fs.filter((f) => f.sev === v).length]).filter(([, c]) => c).map(([v, c]) => `${c} ${v}`).join(', ') || 'clean';
const commit = (h) => (h ? `<a class="path" href="https://github.com/myavenceo/maiacity/commit/${e(h)}" target="_blank" rel="noopener">${e(h)}</a>` : '');
const current = () => decodeURIComponent(location.hash.slice(1));
const who = (b) => W.who(b, HERE, G.docs);
const chips = (xs, cls = '') => (xs || []).map((t) => `<span class="chip ${cls}">${e(t)}</span>`).join('');

// The Specify label reads the review rounds (derived, never stored).
function stageOf(I) {
  const ev = I.events || [], n = W.stepAt(ev, ev.length);
  if (n === 5 && ev.some((x) => x.what === 'dropped')) return [5, 'Closed: dropped'];
  if (n !== 2) return [n, W.STEPS[n - 1]];
  const reviews = (I.reviews || []).map((p) => G.docs.get(p)).filter((r) => r?.findings);
  const last = Math.max(0, ...reviews.map((r) => r.round));
  const lastKind = [...ev].reverse().find((x) => ['review', 'revised', 'stopped'].includes(x.what))?.what;
  const clean = last && !reviews.filter((r) => r.round === last).some((r) => r.findings.some((f) => f.sev !== 'Nit'));
  return [2, !last ? 'Specify: waiting for the spec review' : clean ? 'Specify: waiting for Gate A' : lastKind === 'stopped' ? 'Specify: stopped, waiting for you'
    : lastKind === 'revised' ? `Specify: spec review round ${last + 1}` : `Specify: revising after round ${last}`];
}

// An intent's tasks: what is left to do, step by step. A task's status is computed from the events that name it:
// "done" once an event of what "done" names it, "doing" once any event does, else "todo".
function taskStatus(I, id) {
  const ev = (I.events || []).filter((x) => x.task === id);
  return ev.some((x) => x.what === 'done') ? 'done' : ev.length ? 'doing' : 'todo';
}
const statusChip = (s) => `<span class="chip ${s === 'done' ? 'sage' : s === 'doing' ? 'ochre' : ''}">${s}</span>`;
function tasks(I) {
  const ts = I.tasks || [];
  if (!ts.length) return '';
  const n = ts.filter((t) => taskStatus(I, t.id) === 'done').length;
  const steps = [...new Set(ts.map((t) => t.step))].sort();
  const item = (t) => {
    const st = taskStatus(I, t.id);
    const meta = [t.for ? e(t.for) : '', W.isPath(t.who) ? who(t.who) : e(t.who || '')].filter(Boolean).join(' · ');
    return `<li class="task ${st}"><span class="tick" aria-label="${st}"></span><div class="body"><span class="what">${T(t.what)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</div>${st === 'doing' ? '<span class="chip ochre">doing</span>' : ''}</li>`;
  };
  return `<section class="sec tasks-sec"><h2>Tasks</h2>
    <div class="progress"><span class="bar"><span style="width:${ts.length ? Math.round(100 * n / ts.length) : 0}%"></span></span><span class="count">${n} of ${ts.length} done</span></div>
    ${steps.map((k) => `<div class="tgroup"><span class="label">${W.stepLink(k, HERE, G.docs)}</span><ul class="tasks">${ts.filter((t) => t.step === k).map(item).join('')}</ul></div>`).join('')}
    <p class="note">A task is done when an event in the trace says so.</p></section>`;
}

// An intent's progress, pinned at the top of the page: the four steps and the two gates, the current one marked.
function stepper(I) {
  const [at, label] = stageOf(I), ev = I.events || [];
  const passed = (g) => ev.some((x) => x.what === `gate-${g}`);
  const step = (n) => { const s = G.def.steps.find((q) => q.startsWith(`avenCEO/steps/${n}-`)); const cls = n < at ? 'done' : n === at ? 'at' : '';
    return `<a class="st ${cls}" href="#${s}"><span class="n">${n < at ? '✓' : n}</span>${W.STEPS[n - 1]}</a>`; };
  const gate = (g) => `<span class="gt ${passed(g) ? 'done' : ''}" title="Gate ${g}"><span>${g}</span></span>`;
  return `<nav class="stepper" aria-label="Where ${e(I.id)} stands">${step(1)}<span class="ln"></span>${step(2)}<span class="ln"></span>${gate('A')}<span class="ln"></span>${step(3)}<span class="ln"></span>${gate('B')}<span class="ln"></span>${step(4)}<span class="where"><b>${e(I.id)}</b> ${e(label)}</span></nav>`;
}

// Every page with four or more sections gets a nav of them on the right; the one in view is marked.
function toc() {
  const doc = $('#main > .doc');
  if (!doc) return;
  const secs = [...doc.querySelectorAll(':scope > .sec')].filter((x) => x.querySelector(':scope > h2'));
  if (secs.length < 4) return;
  const page = document.createElement('div');
  page.className = 'page';
  const bar = $('#main > .stepper');
  doc.replaceWith(page);
  if (bar) { page.classList.add('pinned'); page.append(bar); }
  page.append(doc);
  const nav = document.createElement('nav');
  nav.className = 'toc';
  nav.setAttribute('aria-label', 'On this page');
  nav.innerHTML = '<span class="label">On this page</span>' + secs.map((x, i) => `<button type="button" data-i="${i}">${e(x.querySelector('h2').textContent)}</button>`).join('');
  page.append(nav);
  const btns = [...nav.querySelectorAll('button')], seen = new Set();
  nav.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) secs[b.dataset.i].scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  G.io?.disconnect();
  G.io = new IntersectionObserver((xs) => {
    xs.forEach((x) => (x.isIntersecting ? seen.add(+x.target.dataset.i) : seen.delete(+x.target.dataset.i)));
    if (seen.size) { const on = Math.min(...seen); btns.forEach((b, i) => b.classList.toggle('on', i === on)); }
  }, { rootMargin: '0px 0px -65% 0px' });
  secs.forEach((x, i) => { x.dataset.i = i; G.io.observe(x); });
}

// The trace (shared with Sources): the events of every intent that wrote or read a doc.
const traceOf = (path) => sec('Trace', W.traceTable(path, HERE, G.docs, G.trace ??= W.trace(G.docs)), "The events that wrote or read this doc, from the intents' lifecycles.");

// brain's reflection (ui/wiki.js, shared with brain.mjs): a doc holds until a newer one supersedes it; superseded in part, the rest still holds.
const supersededBy = (path) => W.supersededBy(G.docs, path);
const holds = (path) => W.holds(G.docs, path);
const holdChip = (path) => { const h = holds(path); return `<span class="chip ${h === 'holds' ? 'sage' : h === 'superseded' ? 'blocker' : 'ochre'}">${h}</span>`; };
function reflection(d, path) {
  const by = supersededBy(path), word = d.type === 'term' ? 'Term' : 'Decision';
  return sec('Superseded by', by.length ? table([word, 'Part', 'What changed'], by.map((s) => [L(s.p), e(s.part || 'whole'), T(s.what || s.how)])) : '')
    + sec('Supersedes', d.supersedes?.length ? table([word, 'Part', 'What changed'], d.supersedes.map((s) => [L(W.target(s)), e(s.part || 'whole'), T(s.what || s.how)])) : '')
    + sec('Builds on', d.relates?.length ? `<p>${d.relates.map(L).join(' · ')}</p>` : '')
    + sec("brain's reflection", d.reflection ? `<p>Checked against ${T(d.reflection.checked)}: ${T(d.reflection.result)}.</p>` : '');
}
function reflected(title, type) {
  const xs = ofType(type).sort((a, b) => (b[1].n ?? 0) - (a[1].n ?? 0) || W.label(a[1], a[0]).localeCompare(W.label(b[1], b[0])));
  const card = ([p, d]) => {
    const part = supersededBy(p).filter((s) => !W.whole(s)).map((s) => `${s.p.split('/').pop()}: ${s.what || s.how}`).join(' ');
    return `<a class="card" href="#${p}"><span class="top">${holdChip(p)}${chips(d.about)}</span><b>${e(type === 'decision' ? `${d.id} · ${d.title || d.means}` : W.label(d, p))}</b>
      <small>${e(d.means)}</small>${part ? `<small><b>Changed by</b> ${e(part)}</small>` : ''}</a>`;
  };
  const now = xs.filter(([p]) => holds(p) !== 'superseded'), old = xs.filter(([p]) => holds(p) === 'superseded');
  return `<article class="doc"><header><h1>${title}</h1><p class="lead">${type === 'decision' ? 'Your decisions, newest first.' : 'The glossary.'} What holds is computed by brain's reflection: one holds until a later one supersedes ${type === 'decision' ? 'it' : 'or merges it'}; superseded in part, the rest still holds.</p></header>
    ${sec(`${type === 'decision' ? 'Hold now' : 'Current'} (${now.length})`, `<div class="cards">${now.map(card).join('')}</div>`)}
    ${sec(`Superseded${type === 'term' ? ' or merged' : ''} (${old.length})`, old.length ? `<div class="cards">${old.map(card).join('')}</div>` : '<p class="note">None.</p>')}</article>`;
}

// The four steps as a diagram, from the step and gate docs.
function flowDef(at) {
  const steps = G.def.steps.map((p) => G.docs.get(p)).filter(Boolean);
  const nOf = Object.fromEntries(steps.map((s) => [s.id, s.n]));
  const gates = G.def.gates.map((p) => G.docs.get(p)).filter((g) => g?.subtype === 'human').map((g) => ({ id: g.id.split('/').pop(), after: nOf[g.after], what: g.what }));
  const loops = steps.flatMap((s) => s.back.map((b) => ({ from: s.n, to: nOf[b.to], when: b.when })));
  return { steps, bands: G.def.bands, gates, loops, at };
}

// The doc types as a map: what is kept, in four columns, with the links between them.
function typeMap() {
  const cols = [['Memory in', ['author', 'session', 'decision', 'reference']], ['Work', ['intent', 'review']], ['Definition', ['step', 'gate', 'checker', 'check']], ['Learning', ['metric', 'lesson', 'term', 'type']]];
  const W0 = 1000, bw = 196, bh = 58, gx = (W0 - 4 * bw) / 5, top = 34, gy = 22, pos = {};
  cols.forEach(([, ts], c) => ts.forEach((t, r) => { pos[t] = { x: gx + c * (bw + gx), y: top + r * (bh + gy) }; }));
  const H = top + 4 * (bh + gy) + 6;
  const count = (t) => (t === 'reference' ? (G.sources?.items.length ?? 0) : ofType(t).length);
  const types = Object.fromEntries(ofType('type').map(([, d]) => [d.name, d]));
  const edges = Object.values(types).flatMap((d) => d.links_to.map((p) => [d.name, p.split('/').pop()])).filter(([a, b]) => pos[a] && pos[b] && a !== b);
  const path = ([a, b]) => { const A = pos[a], B = pos[b]; const ax = A.x + (B.x > A.x ? bw : B.x < A.x ? 0 : bw / 2), ay = A.y + (B.x === A.x ? (B.y > A.y ? bh : 0) : bh / 2);
    const bx = B.x + (A.x > B.x ? bw : A.x < B.x ? 0 : bw / 2), by = B.y + (A.x === B.x ? (A.y > B.y ? bh : 0) : bh / 2), mx = (ax + bx) / 2;
    return `<path class="tedge" d="M${ax} ${ay} C${mx} ${ay} ${mx} ${by} ${bx} ${by}"/>`; };
  return `<svg class="flowsvg tmap" viewBox="0 0 ${W0} ${H}" role="img" aria-label="The doc types of avenCEO">
    ${cols.map(([h], c) => `<text class="tcolh" x="${gx + c * (bw + gx)}" y="18">${h}</text>`).join('')}
    ${edges.map(path).join('')}
    ${Object.entries(pos).map(([t, p]) => { const d = types[t]; return `<a href="#avenCEO/types/${t}"><g class="tbox"><rect x="${p.x}" y="${p.y}" width="${bw}" height="${bh}" rx="8"/>
      <text class="tname" x="${p.x + 12}" y="${p.y + 22}">${t}</text><text class="tcount" x="${p.x + bw - 12}" y="${p.y + 22}" text-anchor="end">${count(t)}</text>
      <text class="tfile" x="${p.x + 12}" y="${p.y + 42}">${e(d ? d.file : '')}</text></g></a>`; }).join('')}
  </svg>`;
}

function waiting() {
  return ofType('intent').flatMap(([p, I]) => (I.questions || []).filter((q) => !q.answered && !q.replaced_by).map((q) => `<div class="wait"><span class="path">${L(p)}</span><b>${T(q.q)}</b><ul>${q.options.map((o) => `<li>${T(o)}</li>`).join('')}</ul></div>`)).join('');
}

function home() {
  const D = G.def;
  const types = ofType('type').map(([p, d]) => [L(p), `<span class="path">theOS/${e(d.file)}</span>`, e(d.what), d.subtypes.map((s) => `<span class="chip">${e(s)}</span>`).join(' '), String(d.name === 'reference' ? G.sources?.items.length ?? 0 : ofType(d.name).length)]);
  return `<article class="doc">
    <header><div class="top"><span class="chip ochre">${e(D.status)}</span><span class="when">${e(D.date)}</span></div><h1>${e(D.title)}</h1><p class="lead">${e(D.summary)}</p></header>
    ${sec('Waiting for you', waiting(), 'Asked here in chat; your answers become decision docs.')}
    <div class="svgwrap">${flowSvg(flowDef(), 'f')}</div>
    <p class="note">Click a step for its doc. Diamonds are your gates; dashed lines go back.</p>
    ${sec('What is live, and what comes later', `<div class="grid2"><div><span class="label">Live now</span>${ul(D.live.now)}</div><div><span class="label">Later</span>${ul(D.live.later)}</div></div>`)}
    ${sec('The pieces, as files', `<div class="svgwrap">${typeMap()}</div>${table(['Type', 'File', 'What', 'Subtypes', 'Docs'], types)}`, 'Everything avenCEO keeps lives in theOS/, one JSON doc per thing. The numbers are the docs of each type.')}
    ${sec('Principles', `<ol>${D.principles.map((v) => `<li>${T(v)}</li>`).join('')}</ol>`)}
    ${sec('Rules in every step', `<ol>${D.rules.map((v) => `<li>${T(v)}</li>`).join('')}</ol>`)}
    ${sec('Checkpoints', `${ul(D.checkpoint_rules)}<p>${D.checkpoint_cycle.map((c) => `<span class="chip">${e(c)}</span>`).join(' → ')}</p>`)}
    ${sec('How avenCEO improves itself', `<div class="grid3"><div><span class="label">Signals</span>${ul(D.improve.signals)}</div><div><span class="label">A change, in this order</span><ol>${D.improve.order.map((v) => `<li>${T(v)}</li>`).join('')}</ol></div><div><span class="label">Guards</span>${ul(D.improve.guards)}</div></div>`)}
    ${sec('Where an AIP stands', `<p>${T(D.stage.rule)}</p>${table(['Still missing', 'The AIP stands at'], D.stage.rows.map((r) => [e(r.missing), e(r.at)]))}`)}
    ${sec('Who does what', table(['Who', 'Steps', 'Does'], D.roles.map((r) => [e(r.role), r.steps.join(', '), T(r.does)])))}
    ${sec('Risk decides depth', table(['Risk', 'Means', 'Evidence', 'Gates', 'Build'], D.risk.map((r) => [e(r.level), T(r.means), T(r.evidence), T(r.gates), T(r.build)])))}
    ${sec(e(D.memory.title), table(['Kind', 'How it is kept'], D.memory.rows.map((m) => [e(m.kind), T(m.how)])))}
    ${sec('Assumptions that must hold', table(['Holds', 'If it breaks'], D.assumptions.map((a) => [T(a.holds), T(a.else)])))}
    ${sec('Added since, and what each replaces', table(['Added', 'Replaces', 'From'], D.added.map((a) => [T(a.what), T(a.replaces), T(a.from)])))}
    ${sec('What we deleted, and why', table(['Deleted', 'Now', 'Why'], D.deleted.map((d) => [T(d.what), T(d.now), T(d.why)])))}
    ${sec('Automate last', `<div class="grid2"><div><span class="label">By hand now</span>${ul(D.automate.now)}</div><div><span class="label">After three runs by hand</span>${ul(D.automate.later)}</div></div>`)}
    ${backlinks(D.id)}
  </article>`;
}

function board() {
  const cols = ['Understand', 'Specify', 'Build', 'Learn', 'Closed'];
  const cards = ofType('intent').map(([p, I]) => ({ p, I, s: stageOf(I) }));
  return `<article class="doc"><header><h1>AIPs</h1><p class="lead">Every intent of avenCEO's sequence, in the step its record says. The 91 legacy intents are the <a href="../docs/index.html#intents-0">OLD-AIPs</a>, until they are consolidated.</p></header>
    <div class="cols">${cols.map((c, k) => { const xs = cards.filter((x) => x.s[0] === k + 1); return `<section class="col"><h2>${c}<span>${xs.length}</span></h2>${xs.map(({ p, I, s }) => `<a class="card" href="#${p}"><span class="top"><b>${e(I.id)}</b><span class="chip clay">${e(s[1].replace(/^\w+: /, ''))}</span></span><b>${e(I.title)}</b><small>${e(I.kind)} · ${(I.claims || []).length} claims · ${(I.tasks || []).filter((t) => taskStatus(I, t.id) === 'done').length} of ${(I.tasks || []).length} tasks done · ${(I.reviews || []).length} reviews</small></a>`).join('') || '<p class="note">Nothing here.</p>'}</section>`; }).join('')}</div></article>`;
}

function list(kind, title, type) {
  const xs = ofType(type).sort((a, b) => (a[1].n ?? 0) - (b[1].n ?? 0) || String(b[1].at || '').localeCompare(String(a[1].at || '')) || a[0].localeCompare(b[0]));
  const sub = (d) => d.subtype || d.lens || d.kind || d.status || '';
  const blurb = (d) => d.quote || d.what || d.means || d.summary || d.question || d.lesson || '';
  return `<article class="doc"><header><h1>${title}</h1><p class="path">theOS/${e(ofType('type').find(([, d]) => d.name === type)?.[1].file || '')}</p></header>
    ${kind === 'types' ? `<div class="svgwrap">${typeMap()}</div>` : ''}
    <div class="cards">${xs.map(([p, d]) => `<a class="card" href="#${p}"><span class="top">${sub(d) ? `<span class="chip">${e(sub(d))}</span>` : ''}${d.at ? `<span class="when">${e(d.at)}</span>` : ''}</span><b>${e(W.label(d, p))}</b><small>${e(String(blurb(d)).slice(0, 180))}</small></a>`).join('')}</div></article>`;
}

function backlinks(path) {
  const from = [...(G.back.get(path) || [])].filter((p) => !p.endsWith('/index'));
  return from.length ? sec('Linked from', `<p>${from.map(L).join(' · ')}</p>`) : '';
}

function head(d, chips = [], sub = '') {
  return `<header><div class="top"><span class="chip dark">${e(d.type)}</span>${chips.join('')}${d.at ? `<span class="when">${e(d.at)}</span>` : ''}</div><h1>${e(W.label(d, d.id))}</h1>${sub}<p class="path">theOS/${e(current())}.json</p></header>`;
}

const PAGES = {
  intent(I) {
    const [at, stage] = stageOf(I); const p = I.problem || {};
    const all = (I.reviews || []).map((x) => G.docs.get(x)).filter(Boolean);
    const reviews = all.filter((r) => r.findings), cpReviews = all.filter((r) => r.rounds);
    const rounds = [...new Set(reviews.map((r) => r.round))];
    return `${head(I, [`<span class="chip">${e(I.kind)}</span>`, `<span class="chip clay">${e(stage)}</span>`], `<p class="lead">${T(I.source?.text)} ${I.source?.ref ? L(I.source.ref) : ''}</p>${I.note ? `<p class="note">${T(I.note)}</p>` : ''}`)}
      ${sec('Waiting for you', (I.questions || []).filter((q) => !q.answered && !q.replaced_by).map((q) => `<div class="wait"><b>${T(q.q)}</b><ul>${q.options.map((o) => `<li>${T(o)}</li>`).join('')}</ul></div>`).join(''), 'Asked here in chat; your answers become decision docs.')}
      ${tasks(I)}
      ${sec('1 · Understand: the problem', p.who ? `<p><b>Who</b></p>${ul(p.who)}<p><b>What they experience</b> ${T(p.experience)}</p><p><b>Evidence</b> ${T(p.baseline)}</p>
        ${(p.evidence || []).map((g) => `<span class="label">${e(g.group)}</span><ul>${g.items.map((x) => `<li>${T(x.text)} ${x.commit ? `<span class="note">fixed in</span> ${commit(x.commit)}` : ''}</li>`).join('')}</ul>`).join('')}
        <p><b>Why, until the root</b></p><ol>${p.whys.map((w) => `<li>${T(w)}</li>`).join('')}</ol>${p.whys_note ? `<p class="note">${T(p.whys_note)}</p>` : ''}
        <div class="grid2"><div><span class="label">Truths</span>${ul(p.truths)}</div><div><span class="label">Assumptions</span>${ul(p.assumptions)}</div></div><p><b>Risk</b> ${T(p.risk)}</p>` : '<p class="note">Not understood yet.</p>')}
      ${sec('Used, and learned from', table(['What', 'How'], (I.reuse || []).map((r) => [e(r.what), T(r.use)])))}
      ${sec('2 · Specify: options', table(['Option', 'Why', ''], (I.options || []).map((o) => [e(o.name), T(o.note), o.chosen ? '<span class="chip sage">chosen</span>' : ''])))}
      ${sec('Claims', table(['Claim', 'Promise', 'How it could fail', 'Check', 'Kind', 'Result'], (I.claims || []).map((c) => [e(c.id), T(c.promise), T(c.fails), T(c.check), e(c.kind), e(c.result)]))
        + (I.outcome?.promise ? `<p><b>Outcome claim</b> ${T(I.outcome.promise)} ${T(I.outcome.how || '')} <span class="note">(${e(I.outcome.kind)}, ${e(I.outcome.result)})</span></p>` : '') + (I.gaps?.length ? `<p class="note">Not covered yet: ${I.gaps.map(T).join(' ')}</p>` : ''))}
      ${sec('The done rule', I.done_rule ? `<p>${T(I.done_rule)}</p>${I.aip_when ? `<p class="note">${T(I.aip_when)}</p>` : ''}` : '')}
      ${sec('Mockup', ul(I.mockup))}
      ${sec('Checkpoints', table(['#', 'Adds', 'Claims'], (I.checkpoints || []).map((c) => [String(c.n), T(c.adds), e(c.claims.join(', '))])))}
      ${sec('Deferred, on purpose', table(['What', 'Until'], (I.deferred || []).map((d) => [e(d.what), T(d.until)])))}
      ${sec('Deleted', ul(I.deleted))}
      ${sec('Spec review', rounds.map((n) => `<p><b>Round ${n}</b> ${reviews.filter((r) => r.round === n).map((r) => `${L(r.id)} <span class="note">${['Blocker', 'Major', 'Nit'].map((v) => [v, r.findings.filter((f) => f.sev === v).length]).filter(([, c]) => c).map(([v, c]) => `${c} ${v}`).join(', ') || 'clean'}</span>`).join(' · ')}</p>`).join(''), 'Fresh checkers that saw only the record and what it links. Each review is its own doc.')}
      ${sec('Checkpoint reviews', cpReviews.map((r) => `<p><b>Checkpoint ${e(r.checkpoint)}</b> ${L(r.id)} <span class="note">${r.rounds.map((x, i) => `round ${i + 1}: ${tally(x.findings || [])}`).join(' · ')}</span></p>`).join(''), 'One fresh critic per round, on the checkpoint\'s diff.')}
      ${sec('Your decisions', table(['Decision', 'Holds', 'Means'], ofType('decision').filter(([, d]) => d.intents.includes(current())).sort((a, b) => b[1].n - a[1].n).map(([q, d]) => [L(q), holdChip(q), T(d.means)])), 'Every decision that names this intent, newest first.')}
      ${sec('Trace', table(['When', 'Step', 'Who', 'What', 'How', 'Wrote or read'], (I.events || []).map((x, i) => [e(x.at), W.stepLink(W.stepAt(I.events, i), HERE, G.docs), who(x.by), `<b>${e(x.what)}</b> ${T(x.text)}`, T(x.how || ''), [...(x.writes || []).map(L), ...(x.reads || []).map((r) => `read ${L(r)}`)].join(' · ')]).reverse()),
        "Append-only, newest first: every write of this intent's lifecycle. The step is where the intent stood, computed from the events before it.")}`;
  },
  review(R) {
    if (R.rounds) {
      const fin = (fs) => table(['Severity', 'Where', 'Finding', 'Answer'], fs.map((f) => [`<span class="chip ${e(String(f.sev).toLowerCase())}">${e(f.sev)}</span>`, T(f.scope || ''), T(f.text || ''), `<b>${e(f.answer || 'open')}</b> ${T(f.note || '')}`]));
      return `${head({ ...R, title: `${R.intent.split('/').pop()}, checkpoint ${R.checkpoint}: ${R.lens || 'critic'}` }, [`<span class="chip">${e(R.lens || 'critic')}</span>`, `<span class="chip clay">${R.rounds.length} rounds</span>`], `<p class="by">Reviewed ${L(R.intent)} by ${e(R.checker || 'a fresh agent')}.</p>`)}
        ${R.rounds.map((x, i) => sec(`Round ${x.round || i + 1}: ${tally(x.findings || [])}`, `${x.commit ? `<p class="path">at ${e(x.commit)}</p>` : ''}${x.prompt ? `<details><summary>Show the prompt</summary><pre class="code">${e(x.prompt)}</pre></details>` : ''}${fin(x.findings || [])}`)).join('')}`;
    }
    const count = ['Blocker', 'Major', 'Nit'].map((v) => [v, R.findings.filter((f) => f.sev === v).length]).filter(([, c]) => c).map(([v, c]) => `${c} ${v}`).join(', ') || 'clean';
    return `${head({ ...R, title: `${R.intent.split('/').pop()}, round ${R.round}: ${R.lens}` }, [`<span class="chip">${e(R.lens)}</span>`, `<span class="chip clay">${count}</span>`], `<p class="by">Reviewed ${L(R.intent)} at commit ${commit(R.commit)}, by ${e(R.checker)}.</p>`)}
      ${sec('The exact prompt it got', `<details><summary>Show the prompt</summary><pre class="code">${e(R.prompt)}</pre></details>`)}
      ${R.paraphrase ? sec('Its paraphrase', `<div class="para"><div><span class="label">What this proposes</span><p>${T(R.paraphrase.proposes)}</p></div><div><span class="label">How the existing system works, per this record</span><p>${T(R.paraphrase.existing)}</p></div></div>`) : ''}
      ${sec('Findings and their answers', table(['Severity', 'Where', 'Finding', 'Answer'], R.findings.map((f) => [`<span class="chip ${e(f.sev.toLowerCase())}">${e(f.sev)}</span>`, T(f.scope), T(f.text), `<b>${e(f.answer || 'open')}</b> ${T(f.note || '')}`])))}`;
  },
  decision(D) {
    return `${head({ ...D, title: `${D.id} · ${D.title || D.means}` }, [holdChip(current()), `<span class="chip clay">${e(D.subtype)}</span>`, chips(D.about)], `${D.title ? `<p class="lead">${T(D.means)}</p>` : ''}<p class="by">${who(D.by)}, in ${L(D.session)}</p>`)}
      ${sec('Your words', `<blockquote class="lead">“${e(D.quote)}”</blockquote>`)}
      ${reflection(D, current())}
      ${sec('Affects', `<p>${D.intents.map(L).join(' · ')}</p>`)}`;
  },
  session(S) {
    return `${head({ ...S, title: `Session ${S.from} to ${S.to}` }, [`<span class="chip">${e(W.label(G.docs.get(S.orchestrator), S.orchestrator))}</span>`, `<span class="chip">${e(S.commits.theOS)} commits</span>`], `<p class="lead">${T(S.summary)}</p>`)}
      ${sec('What you asked, and what was done', table(['About', 'You asked', 'Done'], S.asks.map((a) => [e(a.about), `“${e(a.quote)}”`, T(a.did)])))}
      ${sec('Your decisions in it', `<ul>${S.decisions.map((d) => `<li>${L(d)}</li>`).join('')}</ul>`)}
      ${sec('Your corrections in it', `<ul>${S.corrections.map((c) => `<li>${T(c.text)} ${commit(c.commit)}</li>`).join('')}</ul>`, 'The baseline of the Corrections metric.')}
      ${sec('Intents', `<p>${S.intents.map(L).join(' · ')}</p>`)}`;
  },
  step(S) {
    return `${head({ ...S, title: `${S.n} · ${S.name}` }, S.gate ? [`<span class="chip clay">then ${e(S.gate.split('/').pop() === 'A' || S.gate.split('/').pop() === 'B' ? 'Gate ' + S.gate.split('/').pop() : S.gate)}</span>`] : [], `<p class="lead">${T(S.question)}</p>`)}
      <div class="svgwrap">${flowSvg(flowDef(S.n), 's')}</div>
      ${sec('What to do', ul(S.do))}
      ${sec('Writes', `<p>${T(S.output)}</p>`)}
      ${sec('Gate', `<p>${T(S.gate_text)} ${S.gate ? L(S.gate) : ''}</p>`)}
      ${sec('Who', `<p>${T(S.who)}</p>`)}
      ${sec('Goes back', table(['To', 'When'], S.back.map((b) => [L(b.to), T(b.when)])))}
      ${sec('Comes from', ul(S.from))}`;
  },
  gate(D) { return `${head(D, [`<span class="chip clay">${e(D.subtype)}</span>`])}${sec('What it checks', `<p>${T(D.what)}</p>`)}${sec('After', `<p>${L(D.after)}</p>`)}${sec('Who', `<p>${W.isPath(D.who) ? who(D.who) : T(D.who)}</p>`)}${sec('How', D.how ? `<p>${T(D.how)}</p>` : D.when ? `<p>${T(D.when)}</p>` : '')}`; },
  type(D) {
    const docs = D.name === 'reference' ? (G.sources?.items || []).map((p) => `<a class="wl" href="${W.href(p, HERE)}">${e(p.split('/').pop())}</a>`) : ofType(D.name).map(([p]) => L(p));
    return `${head(D, D.subtypes.map((s) => `<span class="chip">${e(s)}</span>`), `<p class="lead">${T(D.what)}</p>`)}
      ${sec('Where', `<p class="path">theOS/${e(D.file)}</p>`)}
      ${sec('Fields', table(['Field', 'Holds'], D.fields.map((f) => [e(f.name), T(f.means)])))}
      ${sec('Written by', `<p>${T(D.written_by)}</p>`)}
      ${sec('Its trace', D.trace ? table(['Written by events', 'In', 'Author', 'How'], [[e(D.trace.events.join(', ')), e(D.trace.step), e(D.trace.author), T(D.trace.note)]]) : '', 'The same for every type: brain (AIP-3) keeps it, and its check enforces it.')}
      ${sec('Links to', `<p>${D.links_to.map(L).join(' · ') || '–'}</p>`)}
      ${sec(`Its docs (${docs.length})`, `<p>${docs.join(' · ') || 'None yet.'}</p>`)}`;
  },
  research(D) {
    const groups = [['now', 'Adopt now', 'sage'], ['later', 'Later', 'ochre'], ['no', 'Not for us', '']];
    return `${head({ ...D, title: `${D.intent.split('/').pop()}: research` }, [], `<p class="lead">${T(D.question)}</p>`)}
      ${sec('Recommendation', `<p>${T(D.recommendation)}</p>`)}
      ${groups.map(([k, h, c]) => sec(`${h} (${D.patterns.filter((p) => p.adopt === k).length})`, table(['Pattern', 'What', 'Seen in', 'Why'], D.patterns.filter((p) => p.adopt === k).map((p) => [e(p.name), T(p.what), p.seen_in.map(L).join(' · '), T(p.why)])))).join('')}
      ${sec('What only you can answer', ul(D.open_questions))}
      ${sec('Sources, and how each was read', table(['Source', 'How'], D.reads.map((r) => [L(r.source), e(r.how)])))}`;
  },
  checker(D) { return `${head(D, [`<span class="chip">${e(D.lens)}</span>`], `<p class="lead">${T(D.what)}</p>`)}${sec('Its prompt', `<p class="note">${e(D.record_placeholder || '')}</p><pre class="code">${e(D.prompt)}</pre>`)}`; },
  metric(D) { return `${head(D, [`<span class="chip">${e(D.how)}</span>`], `<p class="lead">${T(D.what)}. Want: ${T(D.want)}.</p>`)}${sec('Measurements', table(['Session', 'Value', 'Count', 'Commits', 'Note'], (D.measurements || []).map((m) => [L(m.session), String(m.value), String(m.count ?? ''), String(m.commits ?? ''), T(m.note || '')])) || '<p class="note">None yet.</p>')}`; },
  lesson(D) { return `${head({ ...D, title: D.lesson }, [`<span class="chip sage">${e(D.status)}</span>`, `<span class="chip">${e(D.confidence)}</span>`])}${sec('Cue', `<p>${T(D.cue)}</p>`)}${sec('Evidence', `<p>${T(D.evidence)}</p>`)}`; },
  term(D) { return `${head(D, [holdChip(current())])}${sec('Means', `<p class="lead">${T(D.means)}</p>`)}${reflection(D, current())}`; },
  author(D) { return `${head(D, [`<span class="chip">${e(D.kind)}</span>`], `<p class="lead">${T(D.what)}</p>`)}${sec('Wrote', table(['When', 'Intent', 'What'], ofType('intent').flatMap(([p, I]) => (I.events || []).filter((x) => x.by === current()).map((x) => [e(x.at), L(p), `<b>${e(x.what)}</b> ${T(x.text)}`])).reverse()))}`; },
  index(D) { return `${head(D)}<div class="cards">${D.items.map((p) => `<a class="card" href="${W.href(p, HERE)}"><b>${e(W.label(G.docs.get(p), p))}</b><small class="path">${e(p)}</small></a>`).join('')}</div>`; },
};

async function show() {
  const h = decodeURIComponent(location.hash.slice(1));
  const route = h || 'home';
  if (route.startsWith('sources/')) { location.href = `../sources/index.html#${route}`; return; }
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === route || (a.dataset.r === 'home' && route === 'avenCEO/avenCEO')));
  let html;
  if (route === 'home' || route === 'avenCEO/avenCEO') html = home();
  else if (route === 'aips') html = board();
  else if (route === 'waiting') html = `<article class="doc"><header><h1>Waiting for you</h1><p class="lead">Every open question of every AIP. You answer here in chat; your answer becomes a decision doc.</p></header>${waiting() || '<p class="note">Nothing waits for you.</p>'}</article>`;
  else if (LISTS.some(([k]) => k === route)) { const [k, t, type] = LISTS.find(([x]) => x === route); html = ['decision', 'term'].includes(type) ? reflected(t, type) : list(k, t, type); }
  else {
    const d = G.docs.get(route) || await W.get(route);
    html = d && PAGES[d.type] ? `${d.type === 'intent' ? stepper(d) : ''}<article class="doc">${PAGES[d.type](d)}${d.type === 'intent' ? '' : traceOf(route)}${backlinks(route)}</article>` : `<article class="doc"><h1>Not found</h1><p class="path">${e(route)}</p></article>`;
  }
  $('#main').innerHTML = html;
  toc();
  $('#main').scrollTo(0, 0);
}

async function start() {
  const def = await W.get('avenCEO/avenCEO');
  G = { ...(await W.crawl(['avenCEO/avenCEO', ...def.indexes.filter((p) => !p.startsWith('sources/'))])), def };
  G.sources = await W.get('sources/index');
  const n = (type) => ofType(type).length;
  $('#nav').innerHTML = `<a href="#home" data-r="home">avenCEO</a>` + LISTS.map(([k, t, type]) => (k === 'gap' ? '<span class="gap"></span>'
    : `<a href="#${k}" data-r="${k}">${t}<span>${k === 'waiting' ? ofType('intent').reduce((s, [, I]) => s + (I.questions || []).filter((q) => !q.answered && !q.replaced_by).length, 0) : n(type)}</span></a>`)).join('');
  $('#main').addEventListener('click', (ev) => { const j = ev.target.closest('[data-jump]'); if (j) { const s = G.def.steps.find((p) => p.startsWith(`avenCEO/steps/${j.dataset.jump.split('-')[1]}-`)); if (s) location.hash = s; } });
  addEventListener('hashchange', show);
  show();
}
start();
