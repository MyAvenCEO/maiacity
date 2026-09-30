// THE FILM CAMERA'S DARKROOM — what happens to a frame of Sandbox 4 between the scene and the file, on the GPU:
//
//   scene ──► half-float target (MSAA)            scene-linear light, Rec.709 primaries: three.js applies no tone
//     │         × shutter samples                  mapping when it renders into a target, and keeps highlights > 1
//     ├──► accumulate (linear, 1/n each)          motion blur exposed as a real shutter does, in light, not in pixels
//     ├──► meter (log-average of the lower 60%)   exposure like a camera: that average lands on middle grey (18%)
//     └──► encode: filter down (oversampled) × 2^(ev + stops) → AP1 → ACEScct → 10 bits per channel,
//              packed as x2bgr10le (R bits 0–9, G 10–19, B 20–29) into an RGBA8 target, rows flipped top-first,
//              so readPixels gives exactly the bytes ffmpeg reads as `-pix_fmt x2bgr10le` — no JPEG, nothing lost
//     └──► view: the same 10-bit ACEScct frame → grade (ASC CDL, clip then look) → output transform (a 3D LUT given
//              as data, or a stand-in filmic curve) → the page's canvas: the Edit/Grade preview
//
// The colour maths is game/film/color.js's (the matrix, the ACEScct curve, the CDL), written again in GLSL.
import * as THREE from 'three';
import { REC709_TO_AP1 } from '../../../game/film/color.js';

/** @typedef {{ slope: number[], offset: number[], power: number[], sat: number }} Cdl */
/** @typedef {{ size: number, data: Float32Array | number[] }} Lut  RGB triples, red fastest (the .cube order) */

/** A 3×3 matrix as GLSL (whose mat3 is column-major: its arguments go column by column). */
const glsl = (/** @type {number[][]} */ m) => `mat3(${[0, 1, 2].map((c) => [0, 1, 2].map((r) => m[r][c].toPrecision(10)).join(', ')).join(', ')})`;
/** The inverse of a 3×3 matrix. */
const inverse = (/** @type {number[][]} */ m) => {
	const [[a, b, c], [d, e, f], [g, h, i]] = m;
	const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
	return [
		[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
		[B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
		[C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
	];
};
const MAT = glsl(REC709_TO_AP1), INV = glsl(inverse(REC709_TO_AP1));

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
const mat3 TO_AP1 = ${MAT};
// linear AP1 -> ACEScct (S-2016-001), as game/film/color.js toCct
float toCct(float x) { return x <= 0.0078125 ? 10.5402377416545 * x + 0.0729055341958355 : (log2(x) + 9.72) / 17.52; }
vec3 toCct(vec3 v) { return vec3(toCct(v.r), toCct(v.g), toCct(v.b)); }
// the oversampled linear frame, filtered down to this output pixel (a box over its footprint, taps x taps bilinear)
uniform sampler2D src;
uniform vec2 outSize;
uniform int taps;
uniform bool flip;
vec3 linearAt(vec2 frag) {
	vec2 p = frag;
	if (flip) p.y = outSize.y - p.y;
	vec3 sum = vec3(0.0);
	for (int j = 0; j < taps; j++)
		for (int i = 0; i < taps; i++) {
			vec2 uv = (p - 0.5 + (vec2(float(i), float(j)) + 0.5) / float(taps)) / outSize;
			sum += texture(src, uv).rgb;
		}
	return sum / float(taps * taps);
}
uniform float gain;
// the 10-bit ACEScct code values (0-1023) of this pixel
ivec3 codesAt(vec2 frag) {
	vec3 lin = clamp(linearAt(frag) * gain, -65504.0, 65504.0);
	vec3 cct = toCct(TO_AP1 * lin);
	return ivec3(clamp(floor(cct * 1023.0 + 0.5), 0.0, 1023.0));
}
`;

const VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const ENCODE = /* glsl */ `${COMMON}
out vec4 fragColor;
void main() {
	ivec3 c = codesAt(gl_FragCoord.xy);
	// x2bgr10le, little-endian: byte 0 = R[7:0], byte 1 = R[9:8] | G[5:0] << 2, byte 2 = G[9:6] | B[3:0] << 4, byte 3 = B[9:4]
	int b0 = c.r & 255;
	int b1 = (c.r >> 8) | ((c.g & 63) << 2);
	int b2 = (c.g >> 6) | ((c.b & 15) << 4);
	int b3 = c.b >> 4;
	fragColor = vec4(float(b0), float(b1), float(b2), float(b3)) / 255.0;
}
`;

const VIEW = /* glsl */ `${COMMON}
precision highp sampler3D;
out vec4 fragColor;
uniform int grades;
uniform vec3 slope[2];
uniform vec3 offset[2];
uniform vec3 power[2];
uniform float sat[2];
uniform bool hasLut;
uniform sampler3D lut;
uniform float lutSize;
const mat3 FROM_AP1 = ${INV};
vec3 fromCct(vec3 c) {
	vec3 lin;
	for (int i = 0; i < 3; i++) lin[i] = c[i] <= 0.155251141552511 ? (c[i] - 0.0729055341958355) / 10.5402377416545 : exp2(c[i] * 17.52 - 9.72);
	return lin;
}
// a stand-in for the output transform until the real one is given as a LUT: ACEScct -> linear -> Rec.709 ->
// a filmic curve (Narkowicz's ACES fit) -> BT.1886 (gamma 2.4)
vec3 standIn(vec3 c) {
	vec3 x = max(FROM_AP1 * fromCct(c), 0.0) * 0.6;
	vec3 y = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
	return pow(y, vec3(1.0 / 2.4));
}
void main() {
	vec3 v = vec3(codesAt(gl_FragCoord.xy)) / 1023.0;
	for (int k = 0; k < 2; k++) {
		if (k >= grades) break;
		vec3 y = v * slope[k] + offset[k];
		v = vec3(power[k].r == 1.0 ? y.r : pow(max(y.r, 0.0), power[k].r), power[k].g == 1.0 ? y.g : pow(max(y.g, 0.0), power[k].g), power[k].b == 1.0 ? y.b : pow(max(y.b, 0.0), power[k].b));
		float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
		v = l + sat[k] * (v - l);
	}
	vec3 d = hasLut ? texture(lut, clamp(v, 0.0, 1.0) * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize).rgb : standIn(v);
	fragColor = vec4(d, 1.0);
}
`;

const ACCUMULATE = /* glsl */ `
precision highp float;
uniform sampler2D src;
uniform vec2 size;
uniform float weight;
out vec4 fragColor;
void main() { fragColor = vec4(texture(src, gl_FragCoord.xy / size).rgb * weight, 1.0); }
`;

const METER = /* glsl */ `
precision highp float;
uniform sampler2D src;
uniform vec2 cells;
uniform float top;
out vec4 fragColor;
// the log of the luminance, averaged over this cell's 4x4 points; the cells cover the lower part of the frame
void main() {
	float sum = 0.0;
	for (int j = 0; j < 4; j++)
		for (int i = 0; i < 4; i++) {
			vec2 uv = (floor(gl_FragCoord.xy) + (vec2(float(i), float(j)) + 0.5) / 4.0) / cells;
			uv.y *= top;
			vec3 c = texture(src, uv).rgb;
			sum += log(clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5, 1e4));
		}
	fragColor = vec4(sum / 16.0, 0.0, 0.0, 1.0);
}
`;

/**
 * The film camera's GPU passes for one renderer (Sandbox 4's own, so the scene's textures are shared).
 * @param {THREE.WebGLRenderer} renderer
 */
export function createPipeline(renderer) {
	const samples = Math.min(4, renderer.capabilities.maxSamples ?? 0);
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
	quad.frustumCulled = false;
	const qscene = new THREE.Scene();
	qscene.add(quad);
	const qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const material = (/** @type {string} */ frag, /** @type {Record<string, THREE.IUniform>} */ uniforms, /** @type {Partial<THREE.ShaderMaterialParameters>} */ extra = {}) =>
		new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
	const common = () => ({ src: { value: null }, outSize: { value: new THREE.Vector2() }, taps: { value: 1 }, flip: { value: false }, gain: { value: 1 } });
	const encode = material(ENCODE, common());
	const view = material(VIEW, {
		...common(),
		grades: { value: 0 },
		slope: { value: [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)] },
		offset: { value: [new THREE.Vector3(), new THREE.Vector3()] },
		power: { value: [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)] },
		sat: { value: [1, 1] },
		hasLut: { value: false },
		lut: { value: null },
		lutSize: { value: 2 }
	});
	const accumulate = material(ACCUMULATE, { src: { value: null }, size: { value: new THREE.Vector2() }, weight: { value: 1 } });
	const accumulateAdd = material(ACCUMULATE, accumulate.uniforms, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
	const METER_CELLS = new THREE.Vector2(32, 16);
	const meterMat = material(METER, { src: { value: null }, cells: { value: METER_CELLS }, top: { value: 0.6 } });
	const floatOk = renderer.extensions.has('EXT_color_buffer_float');
	const meterRT = new THREE.WebGLRenderTarget(METER_CELLS.x, METER_CELLS.y, { type: floatOk ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false });

	/** @type {Map<string, THREE.WebGLRenderTarget>} */
	const targets = new Map();
	const target = (/** @type {string} */ key, /** @type {number} */ w, /** @type {number} */ h, /** @type {THREE.RenderTargetOptions} */ opts) => {
		let rt = targets.get(key);
		if (rt && (rt.width !== w || rt.height !== h)) (rt.dispose(), (rt = undefined));
		if (!rt) {
			rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, ...opts });
			rt.texture.colorSpace = THREE.NoColorSpace;
			targets.set(key, rt);
		}
		return rt;
	};
	const pass = (/** @type {THREE.Material} */ m, /** @type {THREE.WebGLRenderTarget | null} */ rt, clear = true) => {
		quad.material = m;
		const auto = renderer.autoClear;
		renderer.autoClear = clear;
		renderer.setRenderTarget(rt);
		renderer.render(qscene, qcam);
		renderer.autoClear = auto;
	};

	/** @type {THREE.Data3DTexture | null} */
	let lutTex = null;
	/** @type {unknown} */
	let lutOf = null;

	return {
		samples,
		/**
		 * Draw the scene into the linear frame; with `of` > 1 the frame is one of `of` shutter samples, accumulated.
		 * @param {THREE.Scene} scene @param {THREE.Camera} camera @param {number} w @param {number} h @param {number} i @param {number} of
		 * @returns {THREE.Texture} the linear frame so far
		 */
		sample(scene, camera, w, h, i, of) {
			const rt = target('scene', w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true });
			renderer.setRenderTarget(rt);
			renderer.render(scene, camera);
			if (of <= 1) return rt.texture;
			const acc = target('acc', w, h, { type: THREE.HalfFloatType, depthBuffer: false });
			accumulate.uniforms.src.value = rt.texture;
			accumulate.uniforms.size.value.set(w, h);
			accumulate.uniforms.weight.value = 1 / of;
			pass(i === 0 ? accumulate : accumulateAdd, acc, i === 0);
			return acc.texture;
		},
		/**
		 * The log-average luminance of the lower 60% of a linear frame (before any exposure).
		 * @param {THREE.Texture} frame @returns {number}
		 */
		meter(frame) {
			meterMat.uniforms.src.value = frame;
			pass(meterMat, meterRT);
			const n = METER_CELLS.x * METER_CELLS.y;
			let sum = 0;
			if (floatOk) {
				const buf = new Float32Array(n * 4);
				renderer.readRenderTargetPixels(meterRT, 0, 0, METER_CELLS.x, METER_CELLS.y, buf);
				for (let k = 0; k < n; k++) sum += buf[k * 4];
			} else {
				const buf = new Uint16Array(n * 4);
				renderer.readRenderTargetPixels(meterRT, 0, 0, METER_CELLS.x, METER_CELLS.y, buf);
				for (let k = 0; k < n; k++) sum += THREE.DataUtils.fromHalfFloat(buf[k * 4]);
			}
			return Math.exp(sum / n);
		},
		/**
		 * The log frame: filtered down to w×h, exposed by `gain`, ACEScct, packed x2bgr10le, top row first.
		 * @param {THREE.Texture} frame @param {number} w @param {number} h @param {number} gain @param {number} taps
		 * @returns {Uint8Array} w·h·4 bytes
		 */
		encode(frame, w, h, gain, taps) {
			const rt = target('packed', w, h, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
			Object.assign(encode.uniforms.src, { value: frame });
			encode.uniforms.outSize.value.set(w, h);
			encode.uniforms.taps.value = taps;
			encode.uniforms.flip.value = true;
			encode.uniforms.gain.value = gain;
			pass(encode, rt);
			const out = new Uint8Array(w * h * 4);
			renderer.readRenderTargetPixels(rt, 0, 0, w, h, out);
			renderer.setRenderTarget(null);
			return out;
		},
		/**
		 * The same frame through the view: grades (clip, then the film's look) and the output transform, on the canvas.
		 * @param {THREE.Texture} frame @param {number} w @param {number} h @param {number} gain @param {number} taps
		 * @param {{ grade?: Cdl | Cdl[] | null, lut?: Lut | string | null }} [look]
		 */
		view(frame, w, h, gain, taps, look = {}) {
			const u = view.uniforms;
			u.src.value = frame;
			u.outSize.value.set(w, h);
			u.taps.value = taps;
			u.flip.value = false;
			u.gain.value = gain;
			const grades = (Array.isArray(look.grade) ? look.grade : look.grade ? [look.grade] : []).slice(0, 2);
			u.grades.value = grades.length;
			grades.forEach((g, k) => {
				u.slope.value[k].fromArray(g.slope ?? [1, 1, 1]);
				u.offset.value[k].fromArray(g.offset ?? [0, 0, 0]);
				u.power.value[k].fromArray(g.power ?? [1, 1, 1]);
				u.sat.value[k] = g.sat ?? 1;
			});
			if (look.lut && look.lut !== lutOf) {
				const l = typeof look.lut === 'string' ? parseCube(look.lut) : look.lut;
				lutTex?.dispose();
				lutTex = lutTexture(l);
				lutOf = look.lut;
				u.lutSize.value = l.size;
			}
			u.hasLut.value = !!look.lut && !!lutTex;
			u.lut.value = lutTex;
			renderer.setPixelRatio(1);
			renderer.setSize(w, h, false);
			renderer.setViewport(0, 0, w, h);
			pass(view, null);
		},
		dispose() {
			for (const rt of targets.values()) rt.dispose();
			meterRT.dispose();
			lutTex?.dispose();
		}
	};
}

/** A 3D LUT as a texture: half-float RGBA, trilinear. */
function lutTexture(/** @type {Lut} */ l) {
	// RGB triples (a .cube, or filmLut's) or RGBA texels (the Mac's LUTs, nativeLut in src/lib/studio/luts.js)
	const n = l.size, data = new Uint16Array(n * n * n * 4), stride = l.data.length === n * n * n * 4 ? 4 : 3;
	if (l.data.length !== n * n * n * stride) throw new Error(`a ${n}³ LUT has ${n * n * n} texels, not ${l.data.length / stride}`);
	for (let k = 0; k < n * n * n; k++) {
		for (let c = 0; c < 3; c++) data[k * 4 + c] = THREE.DataUtils.toHalfFloat(Number(l.data[k * stride + c]));
		data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
	}
	const t = new THREE.Data3DTexture(data, n, n, n);
	t.format = THREE.RGBAFormat;
	t.type = THREE.HalfFloatType;
	t.minFilter = t.magFilter = THREE.LinearFilter;
	t.wrapR = t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
	t.unpackAlignment = 1;
	t.colorSpace = THREE.NoColorSpace;
	t.needsUpdate = true;
	return t;
}

/**
 * A .cube file (Resolve/Adobe): LUT_3D_SIZE and N³ lines of "r g b", red fastest. Input domain 0–1 (the ACEScct
 * code values); anything else in the file is ignored.
 * @param {string} text @returns {Lut}
 */
export function parseCube(text) {
	let size = 0;
	/** @type {number[]} */
	const data = [];
	for (const line of text.split(/\r?\n/)) {
		const s = line.trim();
		if (!s || s.startsWith('#')) continue;
		const m = /^LUT_3D_SIZE\s+(\d+)/.exec(s);
		if (m) size = Number(m[1]);
		else if (/^[-\d.eE+]+\s+[-\d.eE+]+\s+[-\d.eE+]+$/.test(s)) data.push(...s.split(/\s+/).map(Number));
	}
	if (!size || data.length !== size * size * size * 3) throw new Error(`not a 3D .cube LUT (size ${size}, ${data.length / 3} entries)`);
	return { size, data: new Float32Array(data) };
}

/** A LUT that changes nothing (for tests): out = in. */
export function identityLut(size = 17) {
	const data = new Float32Array(size * size * size * 3);
	let k = 0;
	for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) (data[k++] = r / (size - 1)), (data[k++] = g / (size - 1)), (data[k++] = b / (size - 1));
	return { size, data };
}
