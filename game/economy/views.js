// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The valley's screens as view cards (Samuel, 2026-10-13): each one an html view (game/genui/views.js) the view host
 * shows (src/lib/sandbox/ViewHost.svelte: no origin, no network, no reach into the page, its script in a worker) and
 * hands the valley as its data and its MCP Apps tool result, again as the valley moves on. A config may carry its own view cards (kind 'view'); a card with a
 * default's id replaces that default, so a MIP changes a screen the way it changes a rule, in the same proposal.
 *
 * What a view is handed (structuredContent), every few seconds while it is open:
 *   { day, time, goods: [{ id, label, colour, need }],
 *     avens: [{ id, name, colour, alive, hearts, health, grows: [good], last: { good: units short last night },
 *               goods: { good: { has, need, buy } } }],
 *     market: { good: { price } }, values: { key: number } }
 * What it may tell the page: ui/update-model-context with structuredContent { select: avenId } opens that aven.
 */

const wants = `<style>
  html, body { margin: 0; font: 12px/1.35 system-ui, sans-serif; color: #26382c; background: #fff; overflow-x: auto; }
  p { margin: 8px 10px; color: #7b857a; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 4px 5px; border-bottom: 1px solid #ece6d8; text-align: right; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  th em { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
  button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  button i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .ok { color: #3f8a52; } .miss { color: #c0473b; font-weight: 600; }
  small { display: block; color: #7b857a; font-size: 10px; }
  .grown { background: #f6f3eb; } .dead td { color: #b3b0a6; }
</style>
<p>Tonight's needs per aven. <span class="ok">✓</span> it holds enough; <span class="miss">−n</span> it is n short unless it buys before night. "own": it grows it; "buys n": it still wants n.</p>
<table><thead id="h"></thead><tbody id="b"></tbody></table>
<script>
  // an MCP App in plain JS: the handshake, then the valley as the tool result
  let n = 0;
  const call = (method, params) => parent.postMessage({ jsonrpc: '2.0', id: ++n, method, params }, '*');
  const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); e.append(...kids); return e; };
  function render(v) {
    const goods = v.goods || [];
    const h = document.getElementById('h'), b = document.getElementById('b');
    h.replaceChildren(el('tr', null, el('th', { textContent: 'Aven' }), ...goods.map((g) => { const em = el('em'); em.style.background = g.colour; return el('th', null, em, g.label.slice(0, 3)); }), el('th', { textContent: 'Tonight' }), el('th', { textContent: 'Last night' })));
    b.replaceChildren(...(v.avens || []).map((a) => {
      const dot = el('i'); dot.style.background = a.colour;
      const who = el('button', { onclick: () => call('ui/update-model-context', { structuredContent: { select: a.id } }) }, dot, a.name);
      const tr = el('tr', { className: a.alive ? '' : 'dead' }, el('td', null, who));
      if (!a.alive) { tr.append(el('td', { colSpan: goods.length + 2, textContent: 'died' })); return tr; }
      let short = 0;
      for (const g of goods) {
        const c = a.goods[g.id], own = a.grows.includes(g.id);
        if (c.has < c.need) short++;
        tr.append(el('td', { className: own ? 'grown' : '' }, c.has >= c.need ? el('span', { className: 'ok', textContent: '✓' }) : el('span', { className: 'miss', textContent: '−' + (c.need - c.has) }), el('small', { textContent: own ? 'own' : c.buy ? 'buys ' + c.buy : '' })));
      }
      tr.append(el('td', null, short ? el('span', { className: 'miss', textContent: short + ' short' }) : el('span', { className: 'ok', textContent: 'all met' })));
      const last = Object.entries(a.last || {});
      tr.append(el('td', null, last.length ? el('span', { className: 'miss', textContent: last.map(([g, k]) => g.slice(0, 3) + ' −' + k).join(' ') }) : el('span', { className: 'ok', textContent: 'met' })));
      return tr;
    }));
  }
  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (m && m.id === 1 && m.result) parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
    if (m && m.method === 'ui/notifications/tool-result') render(m.params.structuredContent || {});
  });
  call('ui/initialize', { protocolVersion: '2026-01-26', appCapabilities: {}, clientInfo: { name: 'Wants', version: '1.0.0' } });
</script>`;

/** the valley's own screens, each a view card; a config's card with the same id replaces it */
export const DEFAULT_VIEWS = [
	{ id: 'view-wants', kind: 'view', name: 'Wants', description: 'What every aven holds against tonight\'s needs, and what it still wants to buy.', values: {}, data: { slot: 'panel', libs: [], height: 520 }, code: wants }
];

/** the view cards a config shows, in order: its own, and every default it does not replace */
export function viewsOf(cards) {
	const own = (cards ?? []).filter((c) => c?.kind === 'view');
	return [...DEFAULT_VIEWS.map((d) => own.find((c) => c.id === d.id) ?? d), ...own.filter((c) => !DEFAULT_VIEWS.some((d) => d.id === c.id))];
}
