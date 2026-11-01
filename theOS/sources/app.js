// Sources: one doc per source theOS and avenCEO learned from. A protocol is drawn as its flow. "Used by" follows every
// path from avenCEO's definition, the AIPs and their reviews to this source. Reads only.
const HERE = 'sources';
const $ = (s) => document.querySelector(s);
const e = W.esc;
let G = null;

const GROUPS = [['protocol', 'Protocols'], ['article', 'Articles'], ['repo', 'Repositories'], ['spec', 'Specifications'], ['retelling', 'Retellings'], ['paper', 'Papers'], ['code', 'Code']];
const sec = (h, body, note = '') => (body ? `<section class="sec"><h2>${h}</h2>${note ? `<p class="note">${note}</p>` : ''}${body}</section>` : '');
const readChip = (r) => { const s = String(r || ''); return `<span class="chip ${s.startsWith('yes') ? 'sage' : s.startsWith('no') ? 'blocker' : 'ochre'}">read: ${e(s.split(':')[0] || 'unknown')}</span>`; };
const refs = () => G.items.map((p) => [p, G.docs.get(p)]).filter(([, d]) => d);
const usedBy = (p) => [...(G.back.get(p) || [])].filter((q) => !q.endsWith('/index'));

function list(sub) {
  const groups = GROUPS.filter(([k]) => !sub || k === sub).map(([k, t]) => [t, refs().filter(([, d]) => d.subtype === k)]).filter(([, xs]) => xs.length);
  return `<article class="doc"><header><h1>${sub ? GROUPS.find(([k]) => k === sub)[1] : 'Sources'}</h1><p class="lead">One doc per source, with whether it was read, what it says and what we took. ${refs().length} sources.</p></header>
    ${groups.map(([t, xs]) => sec(`${t} (${xs.length})`, `<div class="cards">${xs.map(([p, d]) => `<a class="card" href="#${p}"><span class="top">${readChip(d.read)}${usedBy(p).length ? `<span class="chip">used by ${usedBy(p).length}</span>` : ''}</span><b>${e(d.title)}</b><small>${e(d.summary || d.url || '')}</small></a>`).join('')}</div>`)).join('')}</article>`;
}

function page(p, d) {
  const used = usedBy(p);
  return `<article class="doc">
    <header><div class="top"><span class="chip dark">${e(d.type)}</span><span class="chip">${e(d.subtype)}</span>${readChip(d.read)}</div><h1>${e(d.title)}</h1>
      ${d.by ? `<p class="by">${e(d.by)}</p>` : ''}${d.summary ? `<p class="lead">${e(d.summary)}</p>` : ''}
      ${d.url ? `<p><a class="wl" href="${e(d.url)}" target="_blank" rel="noopener">${e(d.url)}</a></p>` : ''}<p class="path">theOS/${e(p)}.json · read: ${e(d.read)}</p></header>
    ${d.subtype === 'protocol' ? `<div class="svgwrap">${flowSvg({ steps: d.steps, bands: d.bands, gates: d.gates, loops: d.loops }, 'p')}</div>` : ''}
    ${d.steps ? sec('Its steps', `<ol>${d.steps.map((s) => `<li><b>${e(s.name)}</b> ${e(s.writes)}</li>`).join('')}</ol>`) : ''}
    ${d.gates?.length ? sec('Its gates', `<ul>${d.gates.map((g) => `<li><b>${e(g.id)}</b> after ${e(d.steps[g.after - 1].name)}: ${e(g.what)}</li>`).join('')}</ul>`) : ''}
    ${d.ideas?.length ? sec('Key ideas', `<ul>${d.ideas.map((v) => `<li>${e(v)}</li>`).join('')}</ul>`) : ''}
    ${d.took?.length ? sec('What we took', `<table class="t"><thead><tr><th>Idea</th><th>Where it lives in avenCEO</th></tr></thead><tbody>${d.took.map((t) => `<tr><td>${e(t.idea)}</td><td>${e(t.where)}</td></tr>`).join('')}</tbody></table>`) : ''}
    ${d.sources?.length ? sec('Its own sources', `<p>${d.sources.map((q) => W.link(q, HERE, G.docs)).join(' · ')}</p>`) : ''}
    ${sec('Used by', used.length ? `<p>${used.map((q) => W.link(q, HERE, G.docs)).join(' · ')}</p>` : '<p class="note">No doc links here yet. The 91 OLD-AIPs in the Docs app cite their sources by name.</p>')}
  </article>`;
}

function show() {
  const route = decodeURIComponent(location.hash.slice(1)) || 'all';
  if (route && !route.startsWith('sources/') && W.isPath(route)) { location.href = `../avenCEO/index.html#${route}`; return; }
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === route));
  const d = G.docs.get(route);
  $('#main').innerHTML = route === 'all' ? list() : GROUPS.some(([k]) => k === route) ? list(route) : d ? page(route, d) : `<article class="doc"><h1>Not found</h1><p class="path">${e(route)}</p></article>`;
  $('#main').scrollTo(0, 0);
}

async function start() {
  const index = await W.get('sources/index');
  const def = await W.get('avenCEO/avenCEO');
  G = { ...(await W.crawl(['sources/index', 'avenCEO/avenCEO', ...def.indexes.filter((p) => !p.startsWith('sources/'))])), items: index.items };
  $('#nav').innerHTML = `<a href="#all" data-r="all">All<span>${refs().length}</span></a><span class="gap"></span>`
    + GROUPS.map(([k, t]) => [k, t, refs().filter(([, d]) => d.subtype === k).length]).filter(([, , n]) => n).map(([k, t, n]) => `<a href="#${k}" data-r="${k}">${t}<span>${n}</span></a>`).join('');
  addEventListener('hashchange', show);
  show();
}
start();
