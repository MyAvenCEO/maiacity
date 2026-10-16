// @ts-nocheck — plain JS, part of the view engine (./engine.js)
/*
 * OUR LOOK IN EVERY VIEW — the brand's tokens (src/app.css), its two fonts (inline, so a view loads nothing), plain
 * elements in our style, and the few layout classes the a2ui lens (./a2ui.js) writes. A view's own CSS comes after it
 * and may change any of it.
 */

/** the tokens a view may use, as src/app.css has them */
export const TOKENS = {
	'--cream': '#f1ede3',
	'--paper': '#faf8f2',
	'--ink': '#26382c',
	'--ink-soft': '#4d5d51',
	'--muted': '#7b857a',
	'--line': '#dcd5c4',
	'--mustard': '#efb54d',
	'--sage': '#a8b88a',
	'--terracotta': '#c8744f',
	'--brand-green': '#24452f',
	'--accent': '#2f6f5e',
	'--good': '#3f8a52',
	'--warn': '#c98a2b',
	'--bad': '#c0473b',
	'--font-display': "'Fraunces Variable', 'Iowan Old Style', Georgia, serif",
	'--font-body': "'DM Sans Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
	'--radius': '16px'
};

/** our look under the names the MCP Apps spec gives a host's style variables (hostContext.styles.variables) */
export const MCP_STYLES = {
	'--color-background-primary': '#ffffff',
	'--color-background-secondary': TOKENS['--paper'],
	'--color-background-tertiary': TOKENS['--cream'],
	'--color-background-inverse': TOKENS['--brand-green'],
	'--color-background-success': '#e3efe4',
	'--color-background-warning': '#f8ecd6',
	'--color-background-danger': '#f6e1de',
	'--color-background-info': '#e1ece9',
	'--color-text-primary': TOKENS['--ink'],
	'--color-text-secondary': TOKENS['--ink-soft'],
	'--color-text-tertiary': TOKENS['--muted'],
	'--color-text-inverse': '#ffffff',
	'--color-text-success': TOKENS['--good'],
	'--color-text-warning': TOKENS['--warn'],
	'--color-text-danger': TOKENS['--bad'],
	'--color-text-info': TOKENS['--accent'],
	'--color-border-primary': TOKENS['--line'],
	'--color-border-secondary': TOKENS['--line'],
	'--color-ring-primary': TOKENS['--accent'],
	'--font-sans': TOKENS['--font-body'],
	'--font-mono': "ui-monospace, 'SF Mono', Menlo, monospace",
	'--border-radius-sm': '8px',
	'--border-radius-md': '12px',
	'--border-radius-lg': TOKENS['--radius'],
	'--border-radius-full': '9999px'
};

/** @font-face rules for our two fonts, from their woff2 files as base64 */
export const fontFaces = (dmSans, fraunces) =>
	`@font-face{font-family:'DM Sans Variable';font-style:normal;font-display:swap;font-weight:100 1000;src:url(data:font/woff2;base64,${dmSans}) format('woff2-variations')}` +
	`@font-face{font-family:'Fraunces Variable';font-style:normal;font-display:swap;font-weight:100 900;src:url(data:font/woff2;base64,${fraunces}) format('woff2-variations')}`;

/** the frame's own stylesheet, before the view's */
export const BASE = `:root{${Object.entries({ ...TOKENS, ...MCP_STYLES })
	.map(([k, v]) => `${k}:${v}`)
	.join(';')};color-scheme:light}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
body{font:15px/1.45 var(--font-body);color:var(--ink);background:transparent;padding:2px}
h1,h2,h3,h4{font-family:var(--font-display);margin:0;line-height:1.2}
h2{font-size:1.3rem}h3{font-size:1.15rem}h4{font-size:1rem}
p{margin:0}
small{color:var(--muted)}
hr{border:0;border-top:1px solid var(--line);margin:.2rem 0;width:100%}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--line)}
button{font:inherit;font-size:.9rem;border:1px solid var(--line);background:#fff;color:var(--ink);padding:.45rem .85rem;border-radius:99px;cursor:pointer}
button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
input[type=range]{width:100%;accent-color:var(--accent)}
label{display:flex;flex-direction:column;gap:.3rem}
.col{display:flex;flex-direction:column;gap:.7rem}
.row{display:flex;flex-direction:row;align-items:center;gap:.7rem}
.wrap{flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:.7rem}
@media (max-width:520px){.grid{grid-template-columns:repeat(min(var(--cols,2),2),minmax(0,1fr))}}
.gap-s{gap:.5rem}.gap-m{gap:.9rem}.gap-l{gap:1.4rem}
.align-start{align-items:flex-start}.align-center{align-items:center}.align-end{align-items:flex-end}
.small{font-size:.85rem}.large{font-size:1.15rem}
.muted{color:var(--muted)}.accent{color:var(--accent)}.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.label{font-size:.78rem;color:var(--muted);letter-spacing:.04em}
.label b{color:var(--ink)}
button.accent{color:var(--ink)}
`;

/** the style inside each of our components (./components.js) */
export const PARTS = `:host{display:block}
:host([hidden]){display:none}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:.9rem 1rem;display:flex;flex-direction:column;gap:.6rem}
.card.accent{border-color:color-mix(in srgb,var(--mustard) 60%,var(--line))}
h3{margin:0;font-family:var(--font-display);font-size:1.15rem}
.sub{margin:-.35rem 0 0;color:var(--muted);font-size:.9rem}
.metric{background:#fff;border:1px solid var(--line);border-radius:14px;padding:.7rem .85rem;display:flex;flex-direction:column;gap:.15rem}
.metric b{font-size:1.6rem;font-family:var(--font-display);font-weight:600}
.metric small{margin-left:.25rem;font-size:.8rem;color:var(--muted);font-family:var(--font-body);font-weight:400}
.metric.accent b{color:var(--accent)}.metric.good b{color:var(--good)}.metric.warn b{color:var(--warn)}.metric.bad b{color:var(--bad)}
.delta{font-size:.8rem;color:var(--muted)}
.label{font-size:.78rem;color:var(--muted);letter-spacing:.04em}
.label b{color:var(--ink)}
.badge{display:inline-block;padding:.15rem .55rem;border-radius:99px;font-size:.78rem;background:var(--cream)}
.good{--tone:var(--good)}.warn{--tone:var(--warn)}.bad{--tone:var(--bad)}.accent{--tone:var(--accent)}.default{--tone:var(--ink)}
.badge.good,.badge.warn,.badge.bad,.badge.accent{color:#fff;background:var(--tone)}
.progress{display:flex;flex-direction:column;gap:.35rem}
.track{display:block;height:10px;background:var(--cream);border-radius:99px;overflow:hidden}
.track i{display:block;height:100%;background:var(--tone,var(--accent));border-radius:99px;transition:width .25s}
.box{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:.9rem 1rem;display:flex;flex-direction:column;gap:.4rem}
svg{display:block;overflow:visible}
svg text{font:12px var(--font-body);fill:var(--ink)}
svg .axis{fill:var(--muted);font-size:11px}
svg .grid{stroke:var(--line);stroke-width:1}
svg .track{fill:var(--cream)}
svg .value{font-weight:600}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--line)}
.scroll{overflow-x:auto}
ul{margin:0;padding-left:1.1rem}
`;
