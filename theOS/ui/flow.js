// The flow diagram: steps in a row, bands above, gates as diamonds between steps, the ways back as dashed arcs below.
// def: {steps: [{n, name, writes}], bands?: [{name, steps}], gates?: [{id, after, what}], loops?: [{from, to, when}], at?}
function flowSvg(F, key = 'f') {
  const n = F.steps.length, VW = 1000, gap = 22, w = (VW - 40 - gap * (n - 1)) / n, h = 74, y = F.bands?.length ? 58 : 16, chars = Math.floor((w - 16) / 6.3);
  const x = (k) => 20 + (k - 1) * (w + gap), mid = (k) => x(k) + w / 2;
  const loops = [...F.loops].sort((p, q) => Math.abs(p.from - p.to) - Math.abs(q.from - q.to) || p.from - q.from);
  const depth = new Map(loops.map((l, k) => [l, 30 + 30 * k]));
  const ends = {};
  loops.forEach((l) => { (ends[l.from] ||= []).push(l); (ends[l.to] ||= []).push(l); });
  const at = (node, l) => { const xs = ends[node].slice().sort((p, q) => (p === q ? 0 : (p.from === node ? p.to : p.from) - (q.from === node ? q.to : q.from))); return mid(node) + (xs.indexOf(l) - (xs.length - 1) / 2) * 16; };
  const H = y + h + (loops.length ? Math.max(...depth.values()) * 0.75 + 30 : 16);
  const words = (t, max) => t.split(' ').reduce((ls, wd) => { const l = ls[ls.length - 1]; if (l && (l + ' ' + wd).length <= max) ls[ls.length - 1] = l + ' ' + wd; else ls.push(wd); return ls; }, []);
  const bands = (F.bands || []).map((b) => { const a = x(b.steps[0]), z = x(b.steps[b.steps.length - 1]) + w;
    return `<rect class="fband" x="${a}" y="12" width="${z - a}" height="26" rx="6"/><text class="fbandt" x="${(a + z) / 2}" y="29">${W.esc(b.name)}</text>`; }).join('');
  const nodes = F.steps.map((s) => `<g class="fnode${F.at === s.n ? ' at' : ''}" data-jump="step-${s.n}" tabindex="0" role="button" aria-label="${W.esc(s.name)}">
    <rect x="${x(s.n)}" y="${y}" width="${w}" height="${h}" rx="8"/>
    <text class="fnum" x="${x(s.n) + 10}" y="${y + 20}">${s.n}</text><text class="fname" x="${x(s.n) + 24}" y="${y + 20}">${W.esc(s.name)}</text>
    ${words(s.writes, chars).slice(0, 3).map((l, k) => `<text class="fwrite" x="${x(s.n) + 10}" y="${y + 40 + k * 13}">${W.esc(l)}</text>`).join('')}</g>`).join('');
  const arrows = F.steps.slice(0, -1).map((s) => `<line class="fline" x1="${x(s.n) + w}" y1="${y + h / 2}" x2="${x(s.n + 1) - 2}" y2="${y + h / 2}" marker-end="url(#${key}head)"/>`).join('');
  const gates = (F.gates || []).filter((g) => g.after < n).map((g) => { const cx = x(g.after) + w + gap / 2, cy = y + h / 2;
    return `<g class="fgate"><title>${W.esc(g.what)}</title><path d="M${cx} ${cy - 11} L${cx + 11} ${cy} L${cx} ${cy + 11} L${cx - 11} ${cy} Z"/><text x="${cx}" y="${cy + 4}">${g.id}</text></g>`; }).join('');
  const back = loops.map((l) => { const d = depth.get(l), fx = at(l.from, l), tx = at(l.to, l), by = y + h;
    return `<path class="floop" d="M${fx} ${by} C${fx} ${by + d} ${tx} ${by + d} ${tx} ${by + 3}" marker-end="url(#${key}back)"/>
      <text class="floopt" x="${(fx + tx) / 2}" y="${by + d * 0.75 + 4}">${W.esc(l.when)}</text>`; }).join('');
  return `<svg class="flowsvg" viewBox="0 0 ${VW} ${Math.ceil(H)}" role="img" aria-label="The flow: ${F.steps.map((s) => s.name).join(', ')}">
    <defs><marker id="${key}head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="fheadp" d="M0 0 L8 4 L0 8 Z"/></marker>
    <marker id="${key}back" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="fbackp" d="M0 0 L8 4 L0 8 Z"/></marker></defs>
    ${bands}${arrows}${back}${nodes}${gates}</svg>`;
}
