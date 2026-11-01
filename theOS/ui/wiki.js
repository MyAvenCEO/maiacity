// theOS's memory: one JSON doc per thing, each with a "type", linked to others by path ("aip/AIP-1", "decisions/…").
// Shared by the three apps. A path is a doc's file under theOS/ without ".json". Nothing here writes.
const W = {
  root: '../',
  cache: new Map(),
  folders: ['aip', 'decisions', 'sessions', 'sources', 'metrics', 'lessons', 'authors', 'avenCEO'],
  get(path) {
    if (!this.cache.has(path)) this.cache.set(path, fetch(`${this.root}${path}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return this.cache.get(path);
  },
  esc: (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  isPath(s) { return typeof s === 'string' && /^[A-Za-z]+\/[\w@-]+(\/[\w@-]+)*$/.test(s) && this.folders.includes(s.split('/')[0]); },
  // every path a doc points at, anywhere inside it
  paths(o, out = new Set()) {
    if (typeof o === 'string') { if (this.isPath(o)) out.add(o); }
    else if (Array.isArray(o)) o.forEach((x) => this.paths(x, out));
    else if (o && typeof o === 'object') Object.values(o).forEach((x) => this.paths(x, out));
    return out;
  },
  appOf: (path) => (path.startsWith('sources/') ? 'sources' : 'avenCEO'),
  href(path, here) { const a = this.appOf(path); return a === here ? `#${path}` : `../${a}/index.html#${path}`; },
  label: (d, path) => (d && (d.type === 'decision' ? d.id : d.title || d.name || d.word || d.id)) || path.split('/').pop(),
  // all docs reachable from the starting paths, and who points at whom
  async crawl(starts) {
    const docs = new Map(), back = new Map(), queue = [...starts];
    while (queue.length) {
      const batch = queue.splice(0).filter((p) => !docs.has(p));
      batch.forEach((p) => docs.set(p, null));
      const got = await Promise.all(batch.map((p) => this.get(p)));
      batch.forEach((p, i) => {
        docs.set(p, got[i]);
        if (!got[i]) return;
        for (const q of this.paths(got[i])) {
          if (q === p) continue;
          if (!back.has(q)) back.set(q, new Set());
          back.get(q).add(p);
          if (!docs.has(q)) queue.push(q);
        }
      });
    }
    return { docs, back };
  },
  // text with AIP-n linked to its doc, OLD-AIP-n to the Docs app's legacy board, and paths to their docs
  text(t, here, docs) {
    return this.esc(t)
      .replace(/(?<![\w-])OLD-AIP-(\d+)/g, '<a href="../docs/index.html#intents-$1">OLD-AIP-$1</a>')
      .replace(/(?<![\w-])AIP-(\d+)(?![\w-])/g, (m, n) => (docs?.has(`aip/AIP-${n}`) ? `<a href="${this.href(`aip/AIP-${n}`, here)}">${m}</a>` : m));
  },
  link(path, here, docs) {
    const d = docs?.get(path);
    const tip = d?.type === 'decision' && d.title ? ` title="${this.esc(d.title)}"` : '';
    return `<a class="wl" href="${this.href(path, here)}"${tip}>${this.esc(this.label(d, path))}</a>`;
  },
  who(by, here, docs) { return this.isPath(by) ? this.link(by, here, docs) : this.esc(by); },
  // brain's reflection, one rule for every type (AIP-3): a doc holds until a newer doc supersedes it; superseded in
  // part, the rest still holds. Computed from the supersedes entries, never stored. Shared by the apps and brain.mjs.
  target: (s) => s.doc || s.decision || s.term,
  // part is all (also written whole, or left out) or a part; any other text names the part, so the rest still holds
  whole: (s) => !s.part || s.part === 'all' || s.part === 'whole',
  supersededBy(docs, path) {
    const out = [];
    for (const [p, d] of docs) for (const s of d?.supersedes || []) if (this.target(s) === path) out.push({ p, ...s });
    return out;
  },
  holds(docs, path) {
    const by = this.supersededBy(docs, path);
    return by.some((s) => this.whole(s)) ? 'superseded' : by.length ? 'holds in part' : 'holds';
  },
  // The trace: every write to brain, and every read of a source, is an event of an intent's lifecycle. The step is where
  // the intent stood, computed from the events before it: an AIP stands at the first step whose output is missing.
  STEPS: ['Understand', 'Specify', 'Build', 'Learn', 'Closed'],
  stepAt(ev, i) {
    // an event of what "sent back" sends the intent back to Understand: only what follows it counts
    const before = ev.slice(0, i), back = before.map((x) => x.what).lastIndexOf('sent back');
    const has = (w) => before.slice(back + 1).some((x) => x.what === w);
    // an event of what "dropped" closes the intent where it stood
    if (has('dropped')) return 5;
    return !has('understood') ? 1 : !has('gate-A') ? 2 : !has('gate-B') ? 3 : !has('measured') ? 4 : 5;
  },
  stepLink(n, here, docs) {
    const s = `avenCEO/steps/${n}-${this.STEPS[n - 1].toLowerCase()}`;
    return docs?.has(s) ? `<a class="wl" href="${this.href(s, here)}">${n} · ${this.STEPS[n - 1]}</a>` : this.STEPS[n - 1];
  },
  // path → the events that wrote or read it, from every intent among the docs
  trace(docs) {
    const t = new Map(), add = (k, v) => { if (!t.has(k)) t.set(k, []); t.get(k).push(v); };
    for (const [p, I] of docs) {
      if (I?.type !== 'intent') continue;
      (I.events || []).forEach((x, i) => {
        const step = this.stepAt(I.events, i);
        (x.writes || []).forEach((w) => add(w, { p, x, step, did: 'wrote' }));
        (x.reads || []).forEach((r) => add(r, { p, x, step, did: x.what }));
      });
    }
    return t;
  },
  traceTable(path, here, docs, trace) {
    const rows = trace.get(path) || [];
    return rows.length ? `<table class="t"><thead><tr><th>When</th><th>Intent</th><th>Step</th><th>Who</th><th>Did</th><th>How</th></tr></thead><tbody>${rows.map(({ p, x, step, did }) => `<tr><td><b>${this.esc(x.at)}</b></td><td>${this.link(p, here, docs)}</td><td>${this.stepLink(step, here, docs)}</td><td>${this.who(x.by, here, docs)}</td><td><b>${did}</b> ${this.text(x.text, here, docs)}</td><td>${this.text(x.how || '', here, docs)}</td></tr>`).join('')}</tbody></table>` : '';
  },
};
