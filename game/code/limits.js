// @ts-nocheck — plain JS, kept loose on purpose
/**
 * WHAT A VIEW MAY USE, ONCE — the one table the checker (./rules.js, ./views.js), the page's view host
 * (src/lib/sandbox/view-host.js) and the kernel's bundler (src/lib/sandbox/bundle.js) all read, so the libraries a view
 * may load, the module names a script may import them by, the frozen engine each is, and the limits on a view can never
 * say one thing in one place and another in the next.
 */

/**
 * The libraries an html view's script may use, each a frozen engine of ours (src/lib/sandbox/engines.json, kind
 * `engine`, bundled from the npm `package` at `version`, from src/lib/sandbox/view/libs/<name>.js): nothing else, and
 * nothing from a CDN. A module script imports them by name (`imports`): `import * as THREE from 'three'` (addons from
 * 'three/addons/…'), `import { App } from '@modelcontextprotocol/ext-apps'`; d3 is also the global `d3`.
 */
export const LIBS = {
	three: { version: '0.186.0', engine: 'lib-three', package: 'three', imports: (m) => m === 'three' || m.startsWith('three/addons/') || m.startsWith('three/examples/jsm/') },
	d3: { version: '7.9.0', engine: 'lib-d3', package: 'd3', imports: (m) => m === 'd3' },
	// the MCP Apps SDK: import { App } from '@modelcontextprotocol/ext-apps'
	'mcp-apps': { version: '2.0.3', engine: 'lib-mcp-apps', package: '@modelcontextprotocol/ext-apps', imports: (m) => m === '@modelcontextprotocol/ext-apps' || m === '@modelcontextprotocol/ext-apps/app-with-deps' }
};

/** how big a view and its parts may be, and how tall its frame */
export const LIMITS = { title: 80, note: 400, html: 200_000, components: 300, json: 100_000, logic: 20_000, height: [160, 1200] };
