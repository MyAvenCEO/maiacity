// theOS's memory: one JSON doc per thing, each with a "type", linked to others by path ("aip/AIP-1", "decisions/…").
// Shared by the three apps. A path is a doc's file under theOS/ without ".json". Nothing here writes.
const W = {
  root: '../',
  cache: new Map(),
  folders: ['aip', 'decisions', 'sessions', 'sources', 'metrics', 'lessons', 'avenCEO'],
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
  label: (d, path) => (d && (d.title || d.name || d.word || d.id)) || path.split('/').pop(),
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
    return `<a class="wl" href="${this.href(path, here)}">${this.esc(this.label(d, path))}</a>`;
  },
};
