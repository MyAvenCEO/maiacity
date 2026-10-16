// @ts-nocheck — plain JS, part of the view engine (./engine.js)
/*
 * THE VIEW SANITIZER — the one way markup becomes a view's DOM: a view's HTML when it arrives, and every picture of its
 * DOM its draw script sends after (./worker.js). Whatever goes in, only the tags and attributes below come out, and no
 * address in them leads anywhere: no script, no handler, no frame, no form, no link that navigates, no picture from the
 * network. It works on a DOM tree (a real one in the frame, linkedom's in our tests), never on text.
 *
 * - Elements outside the lists are dropped with what they hold (script, style in the body is kept only after its CSS is
 *   cleaned, iframe, object, embed, link, meta, base, form, frame...). An `<a>` keeps its words but not its address.
 * - Attributes outside the lists are dropped; every `on…` attribute is. A value that names a script is dropped.
 * - Addresses: a picture only from `data:image/…` or `blob:`; an SVG reference only to `#id` on this page.
 * - CSS (style attributes and style elements): no @import, no url() but `#id`, `data:image/…` and `data:font/…`, no
 *   old script hooks (expression, behavior, -moz-binding). The frame's policy refuses every connection anyway.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** HTML elements a view may hold */
const HTML = new Set(
	'a abbr article aside b bdi bdo blockquote br button caption cite code col colgroup data dd del details dfn div dl dt em fieldset figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img input ins kbd label legend li main mark meter nav ol optgroup option output p pre progress q s samp section select small span strong style sub summary sup table tbody td template textarea tfoot th thead time tr u ul var wbr canvas'.split(
		' '
	)
);
/** our own components (./components.js) */
export const COMPONENTS = new Set(['maia-card', 'maia-metric', 'maia-badge', 'maia-progress', 'maia-chart', 'maia-table', 'maia-list']);
/** SVG elements a view may hold (no script, no foreignObject, no animation that could change an address) */
const SVG = new Set(
	'svg g defs symbol use style path rect circle ellipse line polyline polygon text tspan textPath title desc linearGradient radialGradient stop clipPath mask pattern marker image filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feDropShadow feMorphology feTurbulence feDisplacementMap feComponentTransfer feFuncA feFuncR feFuncG feFuncB'.split(
		' '
	)
);
const SVG_LOWER = new Map([...SVG].map((t) => [t.toLowerCase(), t]));

/** attributes any element may carry */
const GLOBAL = new Set('id class style title lang dir role hidden tabindex'.split(' '));
/** attributes of HTML elements */
const HTML_ATTRS = new Set(
	'width height align valign colspan rowspan span scope headers abbr alt src value min max step type name checked disabled readonly placeholder selected multiple size rows cols for maxlength open datetime start reversed label high low optimum wrap spellcheck'.split(
		' '
	)
);
/** attributes of SVG elements (as written, case kept) */
const SVG_ATTRS = new Set(
	'viewBox preserveAspectRatio xmlns d x y x1 x2 y1 y2 cx cy r rx ry fx fy points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit opacity font-size font-family font-weight font-style text-anchor dominant-baseline alignment-baseline baseline-shift dx dy rotate textLength lengthAdjust offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform clip-path clipPathUnits clip-rule mask maskUnits maskContentUnits marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient filter filterUnits primitiveUnits in in2 result stdDeviation mode operator k1 k2 k3 k4 values flood-color flood-opacity color visibility display pointer-events vector-effect shape-rendering text-rendering paint-order letter-spacing word-spacing pathLength overflow cursor color-interpolation-filters baseFrequency numOctaves seed type scale xChannelSelector yChannelSelector radius slope intercept amplitude exponent tableValues width height href xlink:href startOffset method spacing side'.split(
		' '
	)
);
const SVG_ATTRS_LOWER = new Map([...SVG_ATTRS].map((a) => [a.toLowerCase(), a]));
/** the kinds of input a view may show */
const INPUTS = new Set(['text', 'number', 'range', 'checkbox', 'radio', 'color', 'date', 'time', 'search']);
/** what a button may be */
const BUTTONS = new Set(['button']);

/** the controls, spaces and invisible marks a browser skips inside an address */
const hidden = (n) => n <= 0x20 || (n >= 0x7f && n <= 0x9f) || n === 0xad || (n >= 0x200b && n <= 0x200f) || n === 0x2028 || n === 0x2029 || n === 0xfeff;
/** a value as a browser would read it for an address: entities decoded, hidden marks out, lower case */
const plainOf = (v) =>
	String(v ?? '')
		.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
		.replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
		.split('')
		.filter((c) => !hidden(c.charCodeAt(0)))
		.join('')
		.toLowerCase();
/** a value that names a script, anywhere in it */
const scripted = (v) => /(java|vb|live)script:|data:\s*text\/html|expression\s*\(/.test(plainOf(v));
/** where a picture may come from */
const pictureSrc = (v) => /^(data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);|blob:)/.test(plainOf(v));
/** an SVG reference to this page */
const localRef = (v) => /^#[\w-]+$/.test(String(v ?? '').trim());

/** CSS made harmless: no imports, no addresses but this page's ids and inline pictures and fonts, no script hooks */
export function cleanCss(css) {
	let s = String(css ?? '');
	// escapes are how CSS hides a word: \75 rl( is url(; read them before judging
	s = s.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff))).replace(/\\(.)/g, '$1');
	s = s.replace(/\/\*[\s\S]*?(\*\/|$)/g, '');
	s = s.replace(/@import[^;]*;?/gi, '');
	s = s.replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, q, u) => (/^\s*(#[\w-]+|data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|font\/(woff2?|ttf|otf));)/i.test(u) && !/[<>]/.test(u) ? m : 'none'));
	s = s.replace(/(expression\s*\(|behavior\s*:|-moz-binding|javascript:)/gi, '');
	return s.replace(/<\/?style/gi, '');
}

/** whether attribute `name` (as the element has it) with `value` may stay on element `el` */
function allowed(el, name, value, svg) {
	if (/^on/i.test(name) || scripted(value)) return null;
	const tag = el.localName;
	if (name === 'style') return 'style';
	if (GLOBAL.has(name)) return name;
	if (/^(aria|data)-[a-z0-9_.-]+$/.test(name)) return name;
	if (svg) {
		const real = SVG_ATTRS.has(name) ? name : SVG_ATTRS_LOWER.get(name);
		if (!real) return null;
		if (real === 'href' || real === 'xlink:href') return (tag === 'image' ? pictureSrc(value) : localRef(value)) ? real : null;
		// presentation attributes may point at a gradient, clip or marker on this page, and nowhere else
		if (/url\s*\(/i.test(value) && !/^\s*url\(\s*#[\w-]+\s*\)\s*$/i.test(value)) return null;
		return real;
	}
	if (COMPONENTS.has(tag)) return /^[a-z][a-z0-9-]{0,40}$/.test(name) ? name : null;
	if (!HTML_ATTRS.has(name)) return null;
	if (name === 'src') return tag === 'img' && pictureSrc(value) ? name : null;
	// a name on a picture would shadow the document's own methods (document.createElement...): only form controls keep one
	if (name === 'name') return /^(input|select|textarea|button|output|fieldset)$/.test(tag) ? name : null;
	if (name === 'type') {
		if (tag === 'input') return INPUTS.has(String(value).toLowerCase()) ? name : null;
		if (tag === 'button') return BUTTONS.has(String(value).toLowerCase()) ? name : null;
		return null;
	}
	return name;
}

/**
 * `root`'s children made safe, in place: every element and attribute outside the lists dropped (an input of a kind
 * not listed is dropped, a button that isn't type=button becomes one). Elements are adopted as they are, so their
 * order and text stay.
 * @param {ParentNode} root @param {{ keep?: (el: Element) => boolean }} [o] keep: also drop an element it refuses
 */
export function sanitize(root, o = {}) {
	const walk = (parent, inSvg) => {
		for (const node of [...parent.childNodes]) {
			if (node.nodeType === 3) continue;
			if (node.nodeType !== 1) {
				node.remove();
				continue;
			}
			const tag = node.localName;
			const svg = node.namespaceURI === SVG_NS || (inSvg && SVG_LOWER.has(tag));
			const known = svg ? SVG.has(tag) || SVG_LOWER.has(tag) : HTML.has(tag) || COMPONENTS.has(tag);
			if (!known || (o.keep && !o.keep(node)) || (tag === 'input' && !INPUTS.has(String(node.getAttribute('type') ?? 'text').toLowerCase()))) {
				node.remove();
				continue;
			}
			for (const a of [...node.attributes]) {
				const keep = allowed(node, a.name, a.value, svg);
				if (!keep) node.removeAttribute(a.name);
				else if (keep === 'style') node.setAttribute('style', cleanCss(a.value));
			}
			if (tag === 'button') node.setAttribute('type', 'button');
			if (tag === 'style') {
				node.textContent = cleanCss(node.textContent);
				continue;
			}
			if (tag === 'template' && node.content) walk(node.content, false);
			walk(node, svg && tag !== 'foreignObject');
		}
	};
	walk(root, false);
	return root;
}
