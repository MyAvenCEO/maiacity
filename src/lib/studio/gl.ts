// The viewer's picture path, on the GPU (WebGL2): every frame of a video, still or canvas goes
//   its input transform (the proxy's own encoding → ACEScct) → the grades (ASC CDL, clip then film look) → the output
//   transform (ACEScct → Rec.709 display) → the screen,
// the same order and the same maths as the render worker (C5). The browser is told not to colour-manage the pixels
// (UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE): a log picture's code values reach the shader as they are.
import type { Cdl } from '$lib/auth/client';
import { REC709_TO_AP1 } from '../../../game/film/color.js';
import type { Lut } from './luts';

/** How a picture comes in: 0 as it is (already ACEScct, or shown untouched), 1 through its IDT LUT, 2 by formula (display-referred Rec.709/sRGB). */
export type InMode = 0 | 1 | 2;
/** How it goes out: 0 as it is, 1 through the output LUT, 2 by formula (an approximation, when the LUT is missing). */
export type OutMode = 0 | 1 | 2;
export type DrawOpts = {
	idt: InMode;
	odt: OutMode;
	grades: Cdl[];
	falseColor?: boolean;
	/** the part of the source to show: u0, v0, width, height (0…1, top-left origin) */
	crop: [number, number, number, number];
};

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
in vec2 uv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform sampler3D uIdt;
uniform sampler3D uOdt;
uniform int uIdtSize, uOdtSize, uIdtMode, uOdtMode, uGrades, uFalse;
uniform vec3 uSlope[2], uOffset[2], uPower[2];
uniform float uSat[2];
uniform mat3 uToAp1, uFromAp1;
uniform vec4 uCrop;

// tetrahedral interpolation, as ffmpeg's lut3d (interp=tetrahedral) and bake.py's check do
vec3 lut3d(sampler3D t, int n, vec3 p) {
	vec3 x = clamp(p, 0.0, 1.0) * float(n - 1);
	ivec3 i = min(ivec3(floor(x)), ivec3(n - 2));
	vec3 f = x - vec3(i);
	vec3 c000 = texelFetch(t, i, 0).rgb, c111 = texelFetch(t, i + ivec3(1), 0).rgb;
	ivec3 s1, s2; vec3 w;
	if (f.r >= f.g && f.g >= f.b) { s1 = ivec3(1,0,0); s2 = ivec3(1,1,0); w = f.rgb; }
	else if (f.r >= f.b && f.b > f.g) { s1 = ivec3(1,0,0); s2 = ivec3(1,0,1); w = f.rbg; }
	else if (f.b > f.r && f.r >= f.g) { s1 = ivec3(0,0,1); s2 = ivec3(1,0,1); w = f.brg; }
	else if (f.g > f.r && f.r >= f.b) { s1 = ivec3(0,1,0); s2 = ivec3(1,1,0); w = f.grb; }
	else if (f.g >= f.b && f.b > f.r) { s1 = ivec3(0,1,0); s2 = ivec3(0,1,1); w = f.gbr; }
	else { s1 = ivec3(0,0,1); s2 = ivec3(0,1,1); w = f.bgr; }
	vec3 c1 = texelFetch(t, i + s1, 0).rgb, c2 = texelFetch(t, i + s2, 0).rgb;
	return (1.0 - w.x) * c000 + (w.x - w.y) * c1 + (w.y - w.z) * c2 + w.z * c111;
}

// the ACEScct curve (S-2016-001), as game/film/color.js has it
float toCct(float l) { return l <= 0.0078125 ? 10.5402377416545 * l + 0.0729055341958355 : (log2(l) + 9.72) / 17.52; }
float fromCct(float c) { return c <= 0.155251141552511 ? (c - 0.0729055341958355) / 10.5402377416545 : exp2(c * 17.52 - 9.72); }
vec3 toCct3(vec3 v) { return vec3(toCct(v.r), toCct(v.g), toCct(v.b)); }
vec3 fromCct3(vec3 v) { return vec3(fromCct(v.r), fromCct(v.g), fromCct(v.b)); }

// the ASC CDL, as cdl() in color.js: slope, offset, power (negatives held at 0 before a power), then saturation
vec3 grade(vec3 x, int k) {
	vec3 y = x * uSlope[k] + uOffset[k];
	vec3 p = uPower[k];
	y = vec3(p.r == 1.0 ? y.r : pow(max(0.0, y.r), p.r), p.g == 1.0 ? y.g : pow(max(0.0, y.g), p.g), p.b == 1.0 ? y.b : pow(max(0.0, y.b), p.b));
	float l = dot(y, vec3(0.2126, 0.7152, 0.0722));
	return l + uSat[k] * (y - l);
}

// a camera's false colour: where each part of the frame sits on the exposure scale
vec3 falseColor(vec3 c) {
	float y = dot(clamp(c, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
	if (y < 0.025) return vec3(0.45, 0.1, 0.6);
	if (y < 0.10) return vec3(0.1, 0.35, 0.95);
	if (y < 0.38) return vec3(y * 0.9 + 0.1);
	if (y < 0.48) return vec3(0.2, 0.75, 0.3);
	if (y < 0.58) return vec3(y * 0.9 + 0.1);
	if (y < 0.70) return vec3(0.95, 0.55, 0.7);
	if (y < 0.85) return vec3(y * 0.9 + 0.08);
	if (y < 0.975) return vec3(0.98, 0.85, 0.15);
	return vec3(0.95, 0.12, 0.1);
}

void main() {
	vec2 st = uCrop.xy + vec2(uv.x, 1.0 - uv.y) * uCrop.zw;
	vec3 c = texture(uSrc, vec2(st.x, 1.0 - st.y)).rgb;
	if (uIdtMode == 1) c = lut3d(uIdt, uIdtSize, c);
	else if (uIdtMode == 2) c = toCct3(max(uToAp1 * pow(max(c, 0.0), vec3(2.4)), 0.0));
	if (uGrades > 0) c = grade(c, 0);
	if (uGrades > 1) c = grade(c, 1);
	if (uOdtMode == 1) c = lut3d(uOdt, uOdtSize, c);
	else if (uOdtMode == 2) c = pow(clamp(uFromAp1 * fromCct3(c), 0.0, 1.0), vec3(1.0 / 2.4));
	if (uFalse == 1) c = falseColor(c);
	outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** The inverse of a 3×3 (row-major), for AP1 → Rec.709. */
function invert(m: number[][]): number[][] {
	const [a, b, c] = m[0]!, [d, e, f] = m[1]!, [g, h, i] = m[2]!;
	const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
	const det = a! * A + b! * B + c! * C;
	return [
		[A / det, -(b! * i! - c! * h!) / det, (b! * f! - c! * e!) / det],
		[B / det, (a! * i! - c! * g!) / det, -(a! * f! - c! * d!) / det],
		[C / det, -(a! * h! - b! * g!) / det, (a! * e! - b! * d!) / det]
	];
}

export class ViewerGL {
	readonly gl: WebGL2RenderingContext;
	private prog: WebGLProgram;
	private src: WebGLTexture;
	private luts: Record<'idt' | 'odt', { tex: WebGLTexture; key: string | null; size: number }>;
	private u: Record<string, WebGLUniformLocation | null> = {};

	/** WebGL2 with float 3D textures: what the viewer needs. */
	static supported(): boolean {
		try {
			return !!document.createElement('canvas').getContext('webgl2');
		} catch {
			return false;
		}
	}

	constructor(readonly canvas: HTMLCanvasElement) {
		// preserveDrawingBuffer: the scopes read the frame back after it is shown
		const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false, preserveDrawingBuffer: true, antialias: false });
		if (!gl) throw new Error('WebGL2 is not available');
		this.gl = gl;
		const sh = (type: number, text: string) => {
			const s = gl.createShader(type)!;
			gl.shaderSource(s, text);
			gl.compileShader(s);
			if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
			return s;
		};
		const p = gl.createProgram()!;
		gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
		gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
		gl.linkProgram(p);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
		this.prog = p;
		gl.useProgram(p);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		const loc = gl.getAttribLocation(p, 'p');
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
		for (const n of ['uSrc', 'uIdt', 'uOdt', 'uIdtSize', 'uOdtSize', 'uIdtMode', 'uOdtMode', 'uGrades', 'uFalse', 'uSlope', 'uOffset', 'uPower', 'uSat', 'uToAp1', 'uFromAp1', 'uCrop'])
			this.u[n] = gl.getUniformLocation(p, n);
		gl.uniform1i(this.u.uSrc!, 0);
		gl.uniform1i(this.u.uIdt!, 1);
		gl.uniform1i(this.u.uOdt!, 2);
		gl.uniformMatrix3fv(this.u.uToAp1!, false, colMajor(REC709_TO_AP1));
		gl.uniformMatrix3fv(this.u.uFromAp1!, false, colMajor(invert(REC709_TO_AP1)));
		this.src = gl.createTexture()!;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.src);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		const lutTex = (unit: number) => {
			const t = gl.createTexture()!;
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_3D, t);
			gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			// a 2³ identity until a LUT comes, so the sampler is always complete
			gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, 2, 2, 2, 0, gl.RGBA, gl.FLOAT, new Float32Array(32));
			return { tex: t, key: null, size: 2 };
		};
		this.luts = { idt: lutTex(1), odt: lutTex(2) };
		// the pixels as they are in the file: no colour management by the browser, no premultiplication
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	}

	/** Puts a LUT on the GPU (only when it is another one than already there). */
	setLut(slot: 'idt' | 'odt', lut: Lut | null) {
		const s = this.luts[slot];
		const key = lut ? `${lut.name}:${lut.size}:${lut.hash ?? ''}` : null;
		if (!lut || s.key === key) return;
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + (slot === 'idt' ? 1 : 2));
		gl.bindTexture(gl.TEXTURE_3D, s.tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.FLOAT, lut.data);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		s.key = key;
		s.size = lut.size;
	}

	/** One frame: the source's current picture through the chain, onto the canvas. */
	draw(source: TexImageSource, o: DrawOpts) {
		const gl = this.gl, u = this.u;
		const w = this.canvas.width, h = this.canvas.height;
		gl.viewport(0, 0, w, h);
		gl.useProgram(this.prog);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.src);
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.uniform1i(u.uIdtMode!, o.idt);
		gl.uniform1i(u.uOdtMode!, o.odt);
		gl.uniform1i(u.uIdtSize!, this.luts.idt.size);
		gl.uniform1i(u.uOdtSize!, this.luts.odt.size);
		const g = o.grades.slice(0, 2);
		gl.uniform1i(u.uGrades!, g.length);
		const pad = [...g, ...g, { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1 }, { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1 }].slice(0, 2) as Cdl[];
		gl.uniform3fv(u.uSlope!, pad.flatMap((x) => x.slope));
		gl.uniform3fv(u.uOffset!, pad.flatMap((x) => x.offset));
		gl.uniform3fv(u.uPower!, pad.flatMap((x) => x.power));
		gl.uniform1fv(u.uSat!, pad.map((x) => x.sat));
		gl.uniform1i(u.uFalse!, o.falseColor ? 1 : 0);
		gl.uniform4fv(u.uCrop!, o.crop);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	/** Nothing to show: black. */
	clear() {
		const gl = this.gl;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(0.067, 0.067, 0.067, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	dispose() {
		this.gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}

const colMajor = (m: number[][]) => new Float32Array([0, 1, 2].flatMap((c) => [0, 1, 2].map((r) => m[r]![c]!)));

/**
 * The part of a picture a frame shows: it covers the frame (as the render crops it), then the clip's own framing for
 * that shape moves and zooms it within the room left over (x, y in −1…1; zoom ≥ 1).
 */
export function cover(srcAspect: number, frameAspect: number, f?: { x?: number; y?: number; zoom?: number }): [number, number, number, number] {
	let w = 1, h = 1;
	if (srcAspect > frameAspect) w = frameAspect / srcAspect;
	else h = srcAspect / frameAspect;
	const z = Math.max(1, f?.zoom ?? 1);
	w /= z;
	h /= z;
	const x = Math.max(-1, Math.min(1, f?.x ?? 0)), y = Math.max(-1, Math.min(1, f?.y ?? 0));
	return [(1 - w) / 2 + (x * (1 - w)) / 2, (1 - h) / 2 + (y * (1 - h)) / 2, w, h];
}
