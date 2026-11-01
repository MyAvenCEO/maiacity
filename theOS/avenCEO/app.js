// Intents: avenCEO's own viewer. It reads theOS's docs (one JSON doc per thing), never writes them. Every page is one
// doc, drawn by its type; "Linked from" comes from following every path from avenCEO's definition and the indexes.
const HERE = 'avenCEO';
const $ = (s) => document.querySelector(s);
const e = W.esc;
let G = null; // { docs, back, def }

const LISTS = [['aips', 'AIPs', 'intent'], ['waiting', 'Waiting for you', null], ['gap'], ['decisions', 'Decisions', 'decision'], ['sessions', 'Sessions', 'session'],
  ['gap'], ['steps', 'Steps', 'step'], ['gates', 'Gates', 'gate'], ['types', 'Types', 'type'], ['checkers', 'Checkers', 'checker'], ['terms', 'Terms', 'term'],
  ['gap'], ['metrics', 'Metrics', 'metric'], ['lessons', 'Lessons', 'lesson']];
const ofType = (t) => [...G.docs].filter(([, d]) => d?.type === t).map(([p, d]) => [p, d]);
const T = (t) => W.text(t, HERE, G.docs);
const L = (p) => W.link(p, HERE, G.docs);
const sec = (h, body, note = '') => (body ? `<section class="sec"><h2>${h}</h2>${note ? `<p class="note">${note}</p>` : ''}${body}</section>` : '');
const ul = (xs) => (xs?.length ? `<ul>${xs.map((v) => `<li>${T(v)}</li>`).join('')}</ul>` : '');
const table = (heads, rows) => (rows.length ? `<table class="t"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td>${k ? c : `<b>${c}</b>`}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '');
const commit = (h) => (h ? `<a class="path" href="https://github.com/myavenceo/maiacity/commit/${e(h)}" target="_blank" rel="noopener">${e(h)}</a>` : '');

// An AIP stands at the first step whose output is missing; the Specify label reads its review rounds (derived, never stored).
function stageOf(I) {
  const ev = I.events || [], has = (w) => ev.some((x) => x.what === w);
  if (!has('understood')) return [1, 'Understand'];
  if (!has('gate-A')) {
    const reviews = (I.reviews || []).map((p) => G.docs.get(p)).filter(Boolean);
    const last = Math.max(0, ...reviews.map((r) => r.round));
    const lastKind = [...ev].reverse().find((x) => ['review', 'revised', 'stopped'].includes(x.what))?.what;
    const clean = last && !reviews.filter((r) => r.round === last).some((r) => r.findings.some((f) => f.sev !== 'Nit'));
    return [2, !last ? 'Specify: waiting for the spec review' : clean ? 'Specify: waiting for Gate A' : lastKind === 'stopped' ? 'Specify: stopped, waiting for you'
      : lastKind === 'revised' ? `Specify: spec review round ${last + 1}` : `Specify: revising after round ${last}`];
  }
  if (!has('gate-B')) return [3, 'Build'];
  if (!has('measured')) return [4, 'Learn'];
  return [5, 'Closed'];
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
  const cols = [['Memory in', ['session', 'decision', 'reference']], ['Work', ['intent', 'review']], ['Definition', ['step', 'gate', 'checker', 'check']], ['Learning', ['metric', 'lesson', 'term', 'type']]];
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
  return ofType('intent').flatMap(([p, I]) => (I.questions || []).filter((q) => !q.answered).map((q) => `<div class="wait"><span class="path">${L(p)}</span><b>${T(q.q)}</b><ul>${q.options.map((o) => `<li>${T(o)}</li>`).join('')}</ul></div>`)).join('');
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
  return `<article class="doc"><header><h1>AIPs</h1><p class="lead">Every intent of avenCEO's sequence, in the step its record says. The 91 legacy intents are the <a href="../docs/#intents-0">OLD-AIPs</a>, until they are consolidated.</p></header>
    <div class="cols">${cols.map((c, k) => { const xs = cards.filter((x) => x.s[0] === k + 1); return `<section class="col"><h2>${c}<span>${xs.length}</span></h2>${xs.map(({ p, I, s }) => `<a class="card" href="#${p}"><span class="top"><b>${e(I.id)}</b><span class="chip clay">${e(s[1].replace(/^\w+: /, ''))}</span></span><b>${e(I.title)}</b><small>${e(I.kind)} · ${(I.claims || []).length} claims · ${(I.reviews || []).length} reviews</small></a>`).join('') || '<p class="note">Nothing here.</p>'}</section>`; }).join('')}</div></article>`;
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
  return `<header><div class="top"><span class="chip dark">${e(d.type)}</span>${chips.join('')}${d.at ? `<span class="when">${e(d.at)}</span>` : ''}</div><h1>${e(W.label(d, d.id))}</h1>${sub}<p class="path">theOS/${e(d.id.includes('/') ? d.id : 'aip/' + d.id)}.json</p></header>`;
}

const PAGES = {
  intent(I) {
    const [at, stage] = stageOf(I); const p = I.problem || {};
    const reviews = (I.reviews || []).map((x) => G.docs.get(x)).filter(Boolean);
    const rounds = [...new Set(reviews.map((r) => r.round))];
    return `${head(I, [`<span class="chip">${e(I.kind)}</span>`, `<span class="chip clay">${e(stage)}</span>`], `<p class="lead">${T(I.source?.text)} ${I.source?.ref ? L(I.source.ref) : ''}</p>${I.note ? `<p class="note">${T(I.note)}</p>` : ''}`)}
      <div class="svgwrap">${flowSvg(flowDef(at), 'r')}</div>
      ${sec('Waiting for you', (I.questions || []).filter((q) => !q.answered).map((q) => `<div class="wait"><b>${T(q.q)}</b><ul>${q.options.map((o) => `<li>${T(o)}</li>`).join('')}</ul></div>`).join(''), 'Asked here in chat; your answers become decision docs.')}
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
      ${sec('Your decisions', (I.decisions || []).length ? `<ul>${I.decisions.map((d) => `<li>${L(d)}</li>`).join('')}</ul>` : '')}
      ${sec('History', table(['When', 'Who', 'What', ''], (I.events || []).slice().reverse().map((x) => [e(x.at), e(x.by), e(x.what), T(x.text) + (x.ref ? ` ${L(x.ref)}` : '')])), 'Append-only, newest first.')}`;
  },
  review(R) {
    const count = ['Blocker', 'Major', 'Nit'].map((v) => [v, R.findings.filter((f) => f.sev === v).length]).filter(([, c]) => c).map(([v, c]) => `${c} ${v}`).join(', ') || 'clean';
    return `${head({ ...R, title: `${R.intent.split('/').pop()}, round ${R.round}: ${R.lens}` }, [`<span class="chip">${e(R.lens)}</span>`, `<span class="chip clay">${count}</span>`], `<p class="by">Reviewed ${L(R.intent)} at commit ${commit(R.commit)}, by ${e(R.checker)}.</p>`)}
      ${sec('The exact prompt it got', `<details><summary>Show the prompt</summary><pre class="code">${e(R.prompt)}</pre></details>`)}
      ${R.paraphrase ? sec('Its paraphrase', `<div class="para"><div><span class="label">What this proposes</span><p>${T(R.paraphrase.proposes)}</p></div><div><span class="label">How the existing system works, per this record</span><p>${T(R.paraphrase.existing)}</p></div></div>`) : ''}
      ${sec('Findings and their answers', table(['Severity', 'Where', 'Finding', 'Answer'], R.findings.map((f) => [`<span class="chip ${e(f.sev.toLowerCase())}">${e(f.sev)}</span>`, T(f.scope), T(f.text), `<b>${e(f.answer || 'open')}</b> ${T(f.note || '')}`])))}`;
  },
  decision(D) {
    return `${head({ ...D, title: D.means }, [`<span class="chip clay">${e(D.subtype)}</span>`], `<p class="by">${e(D.by)}, in ${L(D.session)}</p>`)}
      ${sec('Your words', `<blockquote class="lead">“${e(D.quote)}”</blockquote>`)}
      ${sec('Affects', `<p>${D.intents.map(L).join(' · ')}</p>`)}`;
  },
  session(S) {
    return `${head({ ...S, title: `Session ${S.from} to ${S.to}` }, [`<span class="chip">${e(S.orchestrator)}</span>`, `<span class="chip">${e(S.commits.theOS)} commits</span>`], `<p class="lead">${T(S.summary)}</p>`)}
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
  gate(D) { return `${head(D, [`<span class="chip clay">${e(D.subtype)}</span>`])}${sec('What it checks', `<p>${T(D.what)}</p>`)}${sec('After', `<p>${L(D.after)}</p>`)}${sec('Who', `<p>${T(D.who)}</p>`)}${sec('How', D.how ? `<p>${T(D.how)}</p>` : D.when ? `<p>${T(D.when)}</p>` : '')}`; },
  type(D) {
    const docs = D.name === 'reference' ? (G.sources?.items || []).map((p) => `<a class="wl" href="${W.href(p, HERE)}">${e(p.split('/').pop())}</a>`) : ofType(D.name).map(([p]) => L(p));
    return `${head(D, D.subtypes.map((s) => `<span class="chip">${e(s)}</span>`), `<p class="lead">${T(D.what)}</p>`)}
      ${sec('Where', `<p class="path">theOS/${e(D.file)}</p>`)}
      ${sec('Fields', table(['Field', 'Holds'], D.fields.map((f) => [e(f.name), T(f.means)])))}
      ${sec('Written by', `<p>${T(D.written_by)}</p>`)}
      ${sec('Links to', `<p>${D.links_to.map(L).join(' · ') || '–'}</p>`)}
      ${sec(`Its docs (${docs.length})`, `<p>${docs.join(' · ') || 'None yet.'}</p>`)}`;
  },
  checker(D) { return `${head(D, [`<span class="chip">${e(D.lens)}</span>`], `<p class="lead">${T(D.what)}</p>`)}${sec('Its prompt', `<p class="note">${e(D.record_placeholder || '')}</p><pre class="code">${e(D.prompt)}</pre>`)}`; },
  metric(D) { return `${head(D, [`<span class="chip">${e(D.how)}</span>`], `<p class="lead">${T(D.what)}. Want: ${T(D.want)}.</p>`)}${sec('Measurements', table(['Session', 'Value', 'Count', 'Commits', 'Note'], (D.measurements || []).map((m) => [L(m.session), String(m.value), String(m.count ?? ''), String(m.commits ?? ''), T(m.note || '')])) || '<p class="note">None yet.</p>')}`; },
  lesson(D) { return `${head({ ...D, title: D.lesson }, [`<span class="chip sage">${e(D.status)}</span>`, `<span class="chip">${e(D.confidence)}</span>`])}${sec('Cue', `<p>${T(D.cue)}</p>`)}${sec('Evidence', `<p>${T(D.evidence)}</p>`)}`; },
  term(D) { return `${head(D)}${sec('Means', `<p class="lead">${T(D.means)}</p>`)}`; },
  index(D) { return `${head(D)}<div class="cards">${D.items.map((p) => `<a class="card" href="${W.href(p, HERE)}"><b>${e(W.label(G.docs.get(p), p))}</b><small class="path">${e(p)}</small></a>`).join('')}</div>`; },
};

async function show() {
  const h = decodeURIComponent(location.hash.slice(1));
  const route = h || 'home';
  if (route.startsWith('sources/')) { location.href = `../sources/#${route}`; return; }
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === route || (a.dataset.r === 'home' && route === 'avenCEO/avenCEO')));
  let html;
  if (route === 'home' || route === 'avenCEO/avenCEO') html = home();
  else if (route === 'aips') html = board();
  else if (route === 'waiting') html = `<article class="doc"><header><h1>Waiting for you</h1><p class="lead">Every open question of every AIP. You answer here in chat; your answer becomes a decision doc.</p></header>${waiting() || '<p class="note">Nothing waits for you.</p>'}</article>`;
  else if (LISTS.some(([k]) => k === route)) { const [k, t, type] = LISTS.find(([x]) => x === route); html = list(k, t, type); }
  else {
    const d = G.docs.get(route) || await W.get(route);
    html = d && PAGES[d.type] ? `<article class="doc">${PAGES[d.type](d)}${backlinks(route)}</article>` : `<article class="doc"><h1>Not found</h1><p class="path">${e(route)}</p></article>`;
  }
  $('#main').innerHTML = html;
  $('#main').scrollTo(0, 0);
}

async function start() {
  const def = await W.get('avenCEO/avenCEO');
  G = { ...(await W.crawl(['avenCEO/avenCEO', ...def.indexes.filter((p) => !p.startsWith('sources/'))])), def };
  G.sources = await W.get('sources/index');
  const n = (type) => ofType(type).length;
  $('#nav').innerHTML = `<a href="#home" data-r="home">avenCEO</a>` + LISTS.map(([k, t, type]) => (k === 'gap' ? '<span class="gap"></span>'
    : `<a href="#${k}" data-r="${k}">${t}<span>${k === 'waiting' ? ofType('intent').reduce((s, [, I]) => s + (I.questions || []).filter((q) => !q.answered).length, 0) : n(type)}</span></a>`)).join('');
  $('#main').addEventListener('click', (ev) => { const j = ev.target.closest('[data-jump]'); if (j) { const s = G.def.steps.find((p) => p.startsWith(`avenCEO/steps/${j.dataset.jump.split('-')[1]}-`)); if (s) location.hash = s; } });
  addEventListener('hashchange', show);
  show();
}
start();
