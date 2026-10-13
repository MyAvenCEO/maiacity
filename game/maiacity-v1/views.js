// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1's screens as view cards (Samuel, 2026-10-13): MCP Apps the page runs in a sandboxed frame
 * (src/lib/genui/Frame.svelte: no origin, no network, no reach into the page) and hands the game as its tool result.
 * A MIP puts a screen in (`views`, a card with an id already there replaces it) or takes it out (`removeViews`),
 * beside the settings it changes, and both apply when it has its signatures. A screen only shows: every move stays a
 * button of the page, so the game plays exactly as before.
 *
 * Where a screen stands (data.slot): 'panel' gives it a tool of its own; any other slot is one of the page's panels.
 * In a panel that only shows (COOPs, Ledger, Rules) the screen takes the panel's place; in a panel with moves (You,
 * Mint, Invest, Swap) it stands on top and the panel's own buttons stay below it. Either way the page's built-in
 * screen is one tap away, and a MIP that takes the card out brings it back.
 *
 * What a screen is handed (structuredContent), every few seconds while it is open:
 *   { date, month, seat, minds: [{ id, label, colour }], hearts: { token: worth of 1 in HEARTS, shown as ❤︎ },
 *     players: [{ seat, name, wallet: { HEARTS, MAIA, SETTLEMENT, VILLAGE }, worth, arrears }],
 *     coops: [{ id, name, mind, treasury: {...}, worth, assets: [{ id, name, kind }] }],
 *     pool: { MAIA, SETTLEMENT, VILLAGE }, poolWorth, settings: { key: number },
 *     rents: [{ what, from, to, token, monthly, weekly, owed }], names: { who: name },
 *     ledger: [{ id, vm, kind, from, to, token, amount, note }] (the last 80, newest first) }
 */

/** the slots a screen may take, and their names in words */
export const SLOTS = ['panel', 'you', 'mint', 'invest', 'swap', 'coops', 'ledger', 'rules'];
export const SLOT_NAMES = { panel: 'a tool of its own', you: 'the player card', mint: 'Mint', invest: 'Invest', swap: 'Swap', coops: 'COOPs', ledger: 'the Ledger', rules: 'Rules' };
/** the panels that only show, which a screen replaces; in the others it stands over the moves */
export const REPLACES = ['coops', 'ledger', 'rules'];

const treasuries = `<style>
  html, body { margin: 0; font: 12px/1.4 system-ui, sans-serif; color: #26382c; background: #fff; }
  h3 { margin: 10px 12px 2px; font-size: 13px; }
  p { margin: 0 12px 8px; color: #7b857a; }
  .legend { display: flex; gap: 12px; margin: 0 12px 6px; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; }
  svg { display: block; width: 100%; }
  text { font: 11px system-ui, sans-serif; fill: #4d5d51; }
</style>
<h3>Who holds the MINDs, in ❤︎</h3>
<p id="date"></p>
<div class="legend" id="legend"></div>
<svg id="c"></svg>
<script>
  // an MCP App in plain JS: the handshake, then the game as the tool result
  let n = 0;
  const call = (method, params) => parent.postMessage({ jsonrpc: '2.0', id: ++n, method, params }, '*');
  const NS = 'http://www.w3.org/2000/svg';
  const node = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
  function render(g) {
    const minds = g.minds || [];
    document.getElementById('date').textContent = g.date ? 'As of ' + g.date + ': every wallet, treasury and the pool, each MIND at its worth in HEARTS (❤︎).' : '';
    const legend = document.getElementById('legend');
    legend.replaceChildren(...minds.map((m) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = m.colour; s.append(i, m.label); return s; }));
    const rows = [
      ...(g.players || []).map((p) => ({ name: p.name, hold: p.wallet })),
      ...(g.coops || []).map((c) => ({ name: c.name, hold: c.treasury })),
      { name: 'The AMM pool', hold: g.pool || {} }
    ];
    const worth = (r, m) => (r.hold[m.id] || 0) * ((g.hearts || {})[m.id] || 1);
    const total = (r) => minds.reduce((t, m) => t + worth(r, m), 0);
    const max = Math.max(1, ...rows.map(total));
    const W = innerWidth, L = 130, R = 60, bar = 18, gap = 10;
    const svg = document.getElementById('c');
    svg.setAttribute('height', rows.length * (bar + gap) + 10);
    svg.replaceChildren();
    rows.forEach((r, i) => {
      const y = 6 + i * (bar + gap);
      svg.append(node('text', { x: 12, y: y + 13 }, r.name));
      let x = L;
      for (const m of minds) {
        const w = (worth(r, m) / max) * (W - L - R);
        if (w > 0.5) svg.append(node('rect', { x, y, width: w, height: bar, rx: 3, fill: m.colour }));
        x += w;
      }
      svg.append(node('text', { x: x + 6, y: y + 13 }, '❤︎ ' + total(r).toFixed(2)));
    });
  }
  let last = null;
  addEventListener('resize', () => last && render(last));
  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (m && m.id === 1 && m.result) parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
    if (m && m.method === 'ui/notifications/tool-result') render((last = m.params.structuredContent || {}));
  });
  call('ui/initialize', { protocolVersion: '2026-01-26', appCapabilities: {}, clientInfo: { name: 'Who holds the MINDs', version: '1.0.0' } });
</script>`;

/** the game's own screens; a MIP's view card with the same id replaces one */
export const DEFAULT_VIEWS = [
	{ id: 'view-holders', kind: 'view', name: 'Holders', description: 'Every wallet, COOP treasury and the pool, side by side, in ❤︎.', values: {}, data: { slot: 'panel', libs: [], height: 300 }, code: treasuries }
];

/** the screens a game shows, in order: the defaults (or the MIPs' versions of them), then the MIPs' own */
export function viewsOf(s) {
	const own = s?.views ?? [];
	return [...DEFAULT_VIEWS.map((d) => own.find((v) => v.id === d.id) ?? d), ...own.filter((v) => !DEFAULT_VIEWS.some((d) => d.id === v.id))];
}

/** the screen standing in each panel, by slot (the last MIP's wins when two take one) */
export function slotsOf(s) {
	const out = {};
	for (const v of viewsOf(s)) if (v.data?.slot && v.data.slot !== 'panel') out[v.data.slot] = v;
	return out;
}
