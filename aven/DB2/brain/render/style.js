// A slide's CSS as the face-runtime's style data (aven/runtimes/spec/Aven/Runtime/Style.lean, `Rule.value`): each
// rule `[[compound, …], [declaration, …]]`, a compound `[tag or null, [class, …]]`, a declaration its property's name
// then its values. Lengths are `[hundredths, unit]`, colours `{ bytes: "rrggbb" }`, a rotation in hundredths of a
// degree, a line height in hundredths. Only the subset the slides are written in is read; anything else throws, so a
// slide never carries a declaration the face-runtime would not take.

const hundredths = (n) => Math.round(Number(n) * 100);

function length(text) {
	const m = /^(-?[\d.]+)(cqw|%|px|em)?$/.exec(text.trim());
	if (!m) throw new Error(`not a length: ${text}`);
	if (!m[2] && Number(m[1]) !== 0) throw new Error(`a length without its unit: ${text}`);
	return [hundredths(m[1]), m[2] ?? 'px'];
}

function colour(text) {
	const m = /^#([0-9a-f]{6})$/i.exec(text.trim());
	if (!m) throw new Error(`not a colour: ${text}`);
	return { bytes: m[1].toLowerCase() };
}

const arrowhead = 'polygon(0 0, 100% 50%, 0 100%, 25% 50%)';
const sans = "'Inter Variable', system-ui, sans-serif";

function declaration(name, value) {
	const v = value.trim();
	const only = (want, out) => {
		if (v !== want) throw new Error(`${name}: ${v} (only ${want})`);
		return out;
	};
	switch (name) {
		case 'position':
			if (v !== 'absolute' && v !== 'relative') throw new Error(`position: ${v}`);
			return [name, v];
		case 'inset':
			return only('0', ['inset']);
		case 'left':
		case 'top':
		case 'right':
		case 'bottom':
		case 'width':
		case 'height':
		case 'gap':
		case 'border-radius':
		case 'font-size':
		case 'letter-spacing':
			return [name, length(v)];
		case 'margin':
		case 'padding':
			if (v.split(/\s+/).length !== 1) throw new Error(`${name}: one length only, not ${v}`);
			return [name, length(v)];
		case 'display':
			if (!['block', 'inline-block', 'flex'].includes(v)) throw new Error(`display: ${v}`);
			return [name, v];
		case 'aspect-ratio': {
			const m = /^(\d+)\s*\/\s*(\d+)$/.exec(v);
			if (!m) throw new Error(`aspect-ratio: ${v}`);
			return [name, Number(m[1]), Number(m[2])];
		}
		case 'container-type':
			return only('inline-size', [name]);
		case 'overflow':
			return only('hidden', [name]);
		case 'border':
		case 'border-top':
		case 'border-right':
		case 'border-bottom':
		case 'border-left': {
			const [w, line, c] = v.split(/\s+/);
			if (!['solid', 'dotted'].includes(line)) throw new Error(`${name}: ${v}`);
			return [name, length(w), line, colour(c)];
		}
		case 'background':
		case 'background-color':
			return ['background-color', colour(v)];
		case 'color':
			return [name, colour(v)];
		case 'font-family':
			return only(sans, [name]);
		case 'font-weight':
			return [name, Number(v)];
		case 'line-height':
			if (!/^[\d.]+$/.test(v)) throw new Error(`line-height: ${v}`);
			return [name, hundredths(v)];
		case 'text-transform':
			return only('uppercase', [name]);
		case 'text-align':
			return only('center', [name]);
		case 'white-space':
			return only('nowrap', [name]);
		case 'transform':
			return [
				name,
				[...v.matchAll(/(\w+)\(([^)]*)\)/g)].map(([, step, arg]) => {
					if (step === 'rotate') return ['rotate', hundredths(arg.replace(/deg$/, ''))];
					if (step === 'translateX' || step === 'translateY') return [step, length(arg)];
					if (step === 'scale') return ['scale', hundredths(arg)];
					throw new Error(`transform: ${step}`);
				}),
			];
		case 'transform-origin': {
			const [x, y] = v.split(/\s+/);
			return [name, length(x), length(y)];
		}
		case 'clip-path':
			return only(arrowhead, [name]);
		default:
			throw new Error(`a property outside the face-runtime's style: ${name}`);
	}
}

const compound = (text) => {
	const m = /^([a-z][a-z0-9]*)?((?:\.[a-z][a-z0-9-]*)*)$/.exec(text);
	if (!m) throw new Error(`a selector outside the face-runtime's style: ${text}`);
	return [m[1] ?? null, m[2] ? m[2].slice(1).split('.') : []];
};

// CSS text → the face-runtime's rules, one rule per selector of a list
export function toStyle(css) {
	const rules = [];
	for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		const decls = body
			.split(';')
			.map((d) => d.trim())
			.filter(Boolean)
			.map((d) => {
				const i = d.indexOf(':');
				return declaration(d.slice(0, i).trim(), d.slice(i + 1));
			});
		for (const selector of selectors.split(',')) rules.push([selector.trim().split(/\s+/).map(compound), decls]);
	}
	return rules;
}

// The style data back to CSS text, as Style.lean writes it (`Rule.css`): the tests hold the two directions, and the
// runtimes' vectors, to each other
const num = (h) => String(h / 100);
const len = ([h, unit]) => (h === 0 ? '0' : `${num(h)}${unit}`);
const hex = (c) => `#${c.bytes}`;
function declCss([name, ...v]) {
	switch (name) {
		case 'position':
		case 'display':
			return `${name}:${v[0]}`;
		case 'inset':
			return 'inset:0';
		case 'aspect-ratio':
			return `aspect-ratio:${v[0]}/${v[1]}`;
		case 'container-type':
			return 'container-type:inline-size';
		case 'overflow':
			return 'overflow:hidden';
		case 'background-color':
		case 'color':
			return `${name}:${hex(v[0])}`;
		case 'font-family':
			return `font-family:${sans.replaceAll(', ', ',')}`;
		case 'font-weight':
			return `font-weight:${v[0]}`;
		case 'line-height':
			return `line-height:${num(v[0])}`;
		case 'text-transform':
			return 'text-transform:uppercase';
		case 'text-align':
			return 'text-align:center';
		case 'white-space':
			return 'white-space:nowrap';
		case 'transform':
			return `transform:${v[0].map(([s, a]) => (s === 'rotate' ? `rotate(${num(a)}deg)` : s === 'scale' ? `scale(${num(a)})` : `${s}(${len(a)})`)).join(' ')}`;
		case 'transform-origin':
			return `transform-origin:${len(v[0])} ${len(v[1])}`;
		case 'clip-path':
			return `clip-path:${arrowhead.replaceAll(', ', ',')}`;
		default:
			if (name.startsWith('border') && name !== 'border-radius') return `${name}:${len(v[0])} ${v[1]} ${hex(v[2])}`;
			return `${name}:${len(v[0])}`;
	}
}
const compoundCss = ([tag, classes]) => `${tag ?? ''}${classes.map((c) => `.${c}`).join('')}`;
export const toCss = (rules) => rules.map(([sel, decls]) => `${sel.map(compoundCss).join(' ')}{${decls.map(declCss).join(';')}}`);
