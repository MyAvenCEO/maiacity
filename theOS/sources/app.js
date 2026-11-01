// Sources: one doc per source theOS and avenCEO learned from. A protocol is drawn as its flow. "Used by" follows every
// path from avenCEO's definition, the AIPs and their reviews to this source; who read it, when and how, is the trace of
// the intents that read it. Reads only.
// this app is brain's (in brain/) after AIP-3's migration, the Sources app (in sources/) before it
const HERE = location.pathname.includes('/brain/') ? 'brain' : 'sources';
const $ = (s) => document.querySelector(s);
const e = W.esc;
let G = null;

const GROUPS = [['protocol', 'Protocols'], ['article', 'Articles'], ['paper', 'Papers'], ['spec', 'Specifications'], ['docs', 'Design docs'], ['code', 'Code'], ['repo', 'Repositories'], ['retelling', 'Retellings']];
const topics = () => [...new Set(refs().flatMap(([, d]) => d.about || []))].sort().map((t) => [t, refs().filter(([, d]) => (d.about || []).includes(t)).length]);
const tagChips = (d) => (d.about || []).map((t) => `<span class="chip">${e(t)}</span>`).join('');
const sec = (h, body, note = '') => (body ? `<section class="sec"><h2>${h}</h2>${note ? `<p class="note">${note}</p>` : ''}${body}</section>` : '');
const readIn = (p) => [...new Set((G.trace.get(p) || []).filter((t) => t.did === 'read').map((t) => t.p.split('/').pop()))];
const readChip = (p) => (readIn(p).length ? `<span class="chip sage">read in ${e(readIn(p).join(', '))}</span>` : '');
const refs = () => G.items.map((p) => [p, G.docs.get(p)]).filter(([, d]) => d);
const usedBy = (p) => [...(G.back.get(p) || [])].filter((q) => !q.endsWith('/index'));

function list(sub, tag) {
  const groups = GROUPS.filter(([k]) => !sub || k === sub).map(([k, t]) => [t, refs().filter(([, d]) => d.subtype === k && (!tag || (d.about || []).includes(tag)))]).filter(([, xs]) => xs.length);
  return `<article class="doc"><header><h1>${tag ? e(tag) : sub ? GROUPS.find(([k]) => k === sub)[1] : 'Sources'}</h1><p class="lead">One doc per source: what it says and what we took. Who read it, when and how, is in the trace of the intent that read it. ${refs().length} sources.</p></header>
    ${groups.map(([t, xs]) => sec(`${t} (${xs.length})`, `<div class="cards">${xs.map(([p, d]) => `<a class="card" href="#${p}"><span class="top">${readChip(p)}${usedBy(p).length ? `<span class="chip clay">used by ${usedBy(p).length}</span>` : ''}${tagChips(d)}</span><b>${e(d.title)}</b><small>${e(d.summary || d.url || '')}</small></a>`).join('')}</div>`)).join('')}</article>`;
}

function page(p, d) {
  const used = usedBy(p);
  return `<article class="doc">
    <header><div class="top"><span class="chip dark">${e(d.type)}</span><span class="chip">${e(d.subtype)}</span>${readChip(p)}${tagChips(d)}</div><h1>${e(d.title)}</h1>
      ${d.by ? `<p class="by">${e(d.by)}</p>` : ''}${d.summary ? `<p class="lead">${e(d.summary)}</p>` : ''}
      ${d.url ? `<p><a class="wl" href="${e(d.url)}" target="_blank" rel="noopener">${e(d.url)}</a></p>` : ''}<p class="path">theOS/${e(p)}.json</p></header>
    ${d.subtype === 'protocol' ? `<div class="svgwrap">${flowSvg({ steps: d.steps, bands: d.bands, gates: d.gates, loops: d.loops }, 'p')}</div>` : ''}
    ${d.steps ? sec('Its steps', `<ol>${d.steps.map((s) => `<li><b>${e(s.name)}</b> ${e(s.writes)}</li>`).join('')}</ol>`) : ''}
    ${d.gates?.length ? sec('Its gates', `<ul>${d.gates.map((g) => `<li><b>${e(g.id)}</b> after ${e(d.steps[g.after - 1].name)}: ${e(g.what)}</li>`).join('')}</ul>`) : ''}
    ${d.ideas?.length ? sec('Key ideas', `<ul>${d.ideas.map((v) => `<li>${e(v)}</li>`).join('')}</ul>`) : ''}
    ${d.took?.length ? sec('What we took', `<table class="t"><thead><tr><th>Idea</th><th>Where it lives in avenCEO</th></tr></thead><tbody>${d.took.map((t) => `<tr><td>${e(t.idea)}</td><td>${e(t.where)}</td></tr>`).join('')}</tbody></table>`) : ''}
    ${d.sources?.length ? sec('Its own sources', `<p>${d.sources.map((q) => W.link(q, HERE, G.docs)).join(' · ')}</p>`) : ''}
    ${sec('Trace', W.traceTable(p, HERE, G.docs, G.trace) || '<p class="note">No intent has read or written it yet. The OLD-AIPs read their sources outside brain; those reads come in when they are consolidated.</p>', 'Which intent read or wrote it, in which step, who, when and how.')}
    ${sec('Used by', used.length ? `<p>${used.map((q) => W.link(q, HERE, G.docs)).join(' · ')}</p>` : '<p class="note">No doc links here yet. The 91 OLD-AIPs in the Docs app cite their sources by name.</p>')}
  </article>`;
}

function show() {
  const route = decodeURIComponent(location.hash.slice(1)) || 'all';
  if (route && W.isPath(route) && W.appOf(route) === 'avenCEO') { location.href = `../avenCEO/index.html#${route}`; return; }
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === route));
  const d = G.docs.get(route);
  $('#main').innerHTML = route === 'all' ? list() : route.startsWith('topic/') ? list(null, route.slice(6)) : GROUPS.some(([k]) => k === route) ? list(route)
    : d ? page(route, d) : `<article class="doc"><h1>Not found</h1><p class="path">${e(route)}</p></article>`;
  $('#main').scrollTo(0, 0);
}

async function start() {
  await W.ready();
  const index = await W.get(W.indexOf('sources'));
  const def = await W.get(W.DEF);
  G = { ...(await W.crawl([W.indexOf('sources'), W.DEF, ...def.indexes])), items: index.items };
  G.trace = W.trace(G.docs);
  $('#nav').innerHTML = `<a href="#all" data-r="all">All<span>${refs().length}</span></a><span class="gap"></span>`
    + GROUPS.map(([k, t]) => [k, t, refs().filter(([, d]) => d.subtype === k).length]).filter(([, , n]) => n).map(([k, t, n]) => `<a href="#${k}" data-r="${k}">${t}<span>${n}</span></a>`).join('')
    + '<span class="gap"></span><span class="navh">Topics</span>' + topics().map(([t, n]) => `<a href="#topic/${encodeURIComponent(t)}" data-r="topic/${e(t)}">${e(t)}<span>${n}</span></a>`).join('');
  addEventListener('hashchange', show);
  show();
}
start();
