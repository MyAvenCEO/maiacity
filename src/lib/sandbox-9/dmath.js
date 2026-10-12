// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE SAME NUMBERS EVERYWHERE — exp, log and pow written out in plain arithmetic, so a world gives the
 * same numbers in node, in Chrome and in Safari.
 *
 * JavaScript's +, −, ×, ÷ and Math.sqrt are rounded the same way on every machine (IEEE 754), but Math.exp, Math.log,
 * Math.pow, Math.sin and Math.cos are not: each engine has its own library, and they differ in the last bit. The
 * reviewers hashed 20,000 samples and found Math.pow, `**`, sin and cos differ between Chrome 141 and node 22. A
 * world's thresholds (a seller sold out or not, a COOP short or not) turn a last-bit difference into a different
 * world, so the page could not reproduce the proof's numbers. The engine uses these instead.
 *
 * exp and log are fdlibm's (Sun Microsystems, 1993; the library V8 itself ports): argument reduction and a fixed
 * polynomial, nothing but +, −, ×, ÷ and exact bit moves. pow(a, b) = exp(b · log a) for a > 0 (a little less exact
 * than a correctly rounded pow, but the same everywhere). The engine draws normal numbers with Marsaglia's polar
 * method (log and sqrt only), so it needs no sin or cos.
 */

// the two 32-bit halves of a double, through one shared buffer (every browser and node in use is little-endian; the
// check below says so if not)
const F = new Float64Array(1);
const I = new Int32Array(F.buffer);
F[0] = 1;
const HI = I[1] === 0x3ff00000 ? 1 : 0;
const LO = 1 - HI;

const ln2HI = 6.93147180369123816490e-01, ln2LO = 1.90821492927058770002e-10;
const invln2 = 1.44269504088896338700e00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
const o_threshold = 7.09782712893383973096e02, u_threshold = -7.45133219101941108420e02;
const twom1000 = 9.33263618503218878990e-302;

/** e^x, fdlibm's __ieee754_exp */
export function exp(x) {
	if (x !== x) return x;
	F[0] = x;
	let hx = I[HI];
	const xsb = (hx >>> 31) & 1;
	hx &= 0x7fffffff;
	if (hx >= 0x40862e42) {
		if (hx >= 0x7ff00000) return xsb === 0 ? x : 0;
		if (x > o_threshold) return Infinity;
		if (x < u_threshold) return 0;
	}
	let hi = 0, lo = 0, k = 0;
	if (hx > 0x3fd62e42) {
		if (hx < 0x3ff0a2b2) {
			hi = xsb ? x + ln2HI : x - ln2HI;
			lo = xsb ? -ln2LO : ln2LO;
			k = 1 - xsb - xsb;
		} else {
			k = Math.trunc(invln2 * x + (xsb ? -0.5 : 0.5));
			const t = k;
			hi = x - t * ln2HI;
			lo = t * ln2LO;
		}
		x = hi - lo;
	} else if (hx < 0x3e300000) return 1 + x;
	const t = x * x;
	const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
	if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
	const y = 1 - (lo - (x * c) / (2.0 - c) - hi);
	F[0] = y;
	if (k >= -1021) {
		I[HI] += k << 20;
		return F[0];
	}
	I[HI] += (k + 1000) << 20;
	return F[0] * twom1000;
}

const two54 = 1.80143985094819840000e16;
const Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01, Lg4 = 2.222219843214978396e-01, Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;

/** ln x, fdlibm's __ieee754_log */
export function log(x) {
	F[0] = x;
	let hx = I[HI];
	const lx = I[LO];
	let k = 0;
	if (hx < 0x00100000) {
		if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
		if (hx < 0) return NaN;
		k -= 54;
		x *= two54;
		F[0] = x;
		hx = I[HI];
	}
	if (hx >= 0x7ff00000) return x + x;
	k += (hx >> 20) - 1023;
	hx &= 0x000fffff;
	const i0 = (hx + 0x95f64) & 0x100000;
	I[HI] = hx | (i0 ^ 0x3ff00000);
	x = F[0];
	k += i0 >> 20;
	const f = x - 1.0;
	if ((0x000fffff & (2 + hx)) < 3) {
		if (f === 0) {
			if (k === 0) return 0;
			return k * ln2HI + k * ln2LO;
		}
		const R = f * f * (0.5 - 0.33333333333333333 * f);
		if (k === 0) return f - R;
		return k * ln2HI - (R - k * ln2LO - f);
	}
	const s = f / (2.0 + f);
	const dk = k;
	const z = s * s;
	let i = hx - 0x6147a;
	const w = z * z;
	const j = 0x6b851 - hx;
	const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
	const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
	i |= j;
	const R = t2 + t1;
	if (i > 0) {
		const hfsq = 0.5 * f * f;
		if (k === 0) return f - (hfsq - s * (hfsq + R));
		return dk * ln2HI - (hfsq - (s * (hfsq + R) + dk * ln2LO) - f);
	}
	if (k === 0) return f - s * (f - R);
	return dk * ln2HI - (s * (f - R) - dk * ln2LO - f);
}

const LN2 = 0.6931471805599453;
/** log base 2 */
export const log2 = (x) => log(x) / LN2;

/** a^b, as exp(b · ln a) for a > 0 (the engine never raises a negative number to a power) */
export function pow(a, b) {
	if (b === 0) return 1;
	if (a > 0) return a === 1 ? 1 : exp(b * log(a));
	if (a === 0) return b > 0 ? 0 : Infinity;
	if (b === Math.trunc(b)) {
		const r = exp(b * log(-a));
		return b % 2 === 0 ? r : -r;
	}
	return NaN;
}
