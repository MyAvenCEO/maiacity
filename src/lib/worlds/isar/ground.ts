/*
 * THE ISAR'S GROUND — the real ground under the river, its banks and meadows: the survey's heights on the world's grid
 * (./map.ts), the riverbed shaped under the water, and what each place is made of painted from the map (the paths'
 * gravel, the river's pebbles, asphalt, the woods' floor; grass everywhere else), read by one shader that lays each
 * surface at its real size, darkens what is wet, takes the light away under water and lets the sun's caustics dance
 * on the shallow bed on the world's clock.
 */
import * as THREE from 'three';
import { MAP, inRing, loadHeights, points, sOf, nOf, waterAt, xOf, zOf, type Ring } from './map';
import { asphalt, gravel, grass, noise, pebbles, soil } from './surfaces';

export type Ground = {
	/** the grid's axes (s along the river, n across it) and its heights, s the fast axis */
	gs: Float64Array;
	gn: Float64Array;
	h: Float32Array;
	/** the ground's height at a world point, and in the river's frame (off the grid: its nearest edge) */
	at: (x: number, z: number) => number;
	atSN: (s: number, n: number) => number;
	/** the river's west and east edges at s, where its surface meets the ground */
	banks: (s: number) => [number, number];
	/** what the ground is made of at s, n, 0…1 each: gravel, stones, asphalt, the woods' floor */
	surface: (s: number, n: number) => [number, number, number, number];
	mesh: THREE.Mesh;
	/** the world's clock, for the caustics */
	time: { value: number };
	dispose: () => void;
};

/** where the fine painting of the ground reaches (the walk and all one sees close by), and how fine (m) */
const NEAR = { s0: -470, s1: 470, n0: -110, n1: 185, cell: 0.5 };
const FAR_CELL = 2;

/** the index of the grid line at or below v (axes are ascending) */
function locate(axis: Float64Array, v: number) {
	let lo = 0, hi = axis.length - 2;
	if (v <= axis[0]!) return 0;
	if (v >= axis[hi + 1]!) return hi;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (axis[mid]! <= v) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/**
 * Paint the map onto a raster in the river's frame: gravel (red), stones (green), asphalt (blue), the woods' floor
 * (alpha), each drawn with the canvas's own soft edges.
 */
function paint(rect: { s0: number; s1: number; n0: number; n1: number; cell: number }) {
	const W = Math.round((rect.s1 - rect.s0) / rect.cell), H = Math.round((rect.n1 - rect.n0) / rect.cell);
	const layer = (draw: (x: CanvasRenderingContext2D) => void) => {
		const c = document.createElement('canvas');
		c.width = W;
		c.height = H;
		const x = c.getContext('2d', { willReadFrequently: true })!;
		x.setTransform(1 / rect.cell, 0, 0, 1 / rect.cell, -rect.s0 / rect.cell, -rect.n0 / rect.cell);
		x.fillStyle = x.strokeStyle = '#fff';
		x.lineCap = x.lineJoin = 'round';
		draw(x);
		return x.getImageData(0, 0, W, H).data;
	};
	const trace = (x: CanvasRenderingContext2D, r: Ring) => {
		const p = points(r);
		x.moveTo(sOf(...p[0]!), nOf(...p[0]!));
		for (const q of p.slice(1)) x.lineTo(sOf(...q), nOf(...q));
	};
	const fill = (x: CanvasRenderingContext2D, rings: Ring[], alpha = 1) => {
		x.globalAlpha = alpha;
		x.beginPath();
		for (const r of rings) {
			trace(x, r);
			x.closePath();
		}
		x.fill('evenodd');
		x.globalAlpha = 1;
	};
	const stroke = (x: CanvasRenderingContext2D, kinds: string[], widen = 0) => {
		for (const p of MAP.paths) {
			if (!kinds.includes(p.k) || p.b) continue;
			x.lineWidth = p.w + widen;
			x.beginPath();
			trace(x, p.pts);
			x.stroke();
		}
	};
	const gravelL = layer((x) => {
		stroke(x, ['gravel']);
		x.globalAlpha = 0.75;
		stroke(x, ['dirt'], -0.8);
	});
	const stonesL = layer((x) => {
		fill(x, MAP.shingle);
		fill(x, MAP.islands);
	});
	const asphaltL = layer((x) => stroke(x, ['asphalt', 'steps']));
	const soilL = layer((x) => {
		fill(x, MAP.wood, 0.85);
		fill(x, MAP.scrub, 0.6);
	});
	const data = new Uint8Array(W * H * 4);
	for (let i = 0; i < W * H; i++) {
		data[i * 4] = gravelL[i * 4]!;
		data[i * 4 + 1] = stonesL[i * 4]!;
		data[i * 4 + 2] = asphaltL[i * 4]!;
		data[i * 4 + 3] = soilL[i * 4]!;
	}
	const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.needsUpdate = true;
	return { tex, data, W, H, rect };
}

const SHADER_HEAD = /* glsl */ `
uniform sampler2D splatNear;
uniform sampler2D splatFar;
uniform sampler2D tGrass;
uniform sampler2D tDry;
uniform sampler2D tGravel;
uniform sampler2D tPebbles;
uniform sampler2D tAsphalt;
uniform sampler2D tSoil;
uniform sampler2D tNoise;
uniform vec4 nearRect;
uniform vec4 farRect;
uniform vec2 uAlong;
uniform vec2 uAcross;
uniform float slope;
uniform float time;
varying vec3 vW;
// a surface at its real size, and again at a larger one, so its tiles do not repeat to the eye
vec3 surfaceOf( sampler2D t, vec2 p, float size ) {
	vec3 a = texture2D( t, p / size ).rgb;
	vec3 b = texture2D( t, p / ( size * 4.13 ) + vec2( 0.31, 0.77 ) ).rgb;
	return mix( a, b, 0.32 );
}
`;

export async function buildGround(): Promise<Ground> {
	const heights = await loadHeights();
	const gs = Float64Array.from(MAP.grid.s), gn = Float64Array.from(MAP.grid.n);
	const NS = gs.length, NN = gn.length;
	const atSN = (s: number, n: number) => {
		const i = locate(gs, s), j = locate(gn, n);
		const ti = Math.min(1, Math.max(0, (s - gs[i]!) / (gs[i + 1]! - gs[i]!)));
		const tj = Math.min(1, Math.max(0, (n - gn[j]!) / (gn[j + 1]! - gn[j]!)));
		const a = heights[j * NS + i]!, b = heights[j * NS + i + 1]!, c = heights[(j + 1) * NS + i]!, d = heights[(j + 1) * NS + i + 1]!;
		// the same diagonal the mesh's triangles have, so one stands on the ground one sees
		return ti + tj <= 1 ? a + (b - a) * ti + (c - a) * tj : d + (c - d) * (1 - ti) + (b - d) * (1 - tj);
	};
	const at = (x: number, z: number) => atSN(sOf(x, z), nOf(x, z));

	// the river's banks, column by column: the water round its deepest point, out to where the ground rises over it
	const westOf = new Float64Array(NS), eastOf = new Float64Array(NS);
	for (let i = 0; i < NS; i++) {
		const level = waterAt(gs[i]!);
		let deep = -1, low = Infinity;
		for (let j = 0; j < NN; j++) {
			const n = gn[j]!;
			if (n < -130 || n > 150) continue;
			const y = heights[j * NS + i]!;
			if (y < low) (low = y), (deep = j);
		}
		let w = deep, e = deep;
		while (w > 0 && heights[(w - 1) * NS + i]! < level) w--;
		while (e < NN - 1 && heights[(e + 1) * NS + i]! < level) e++;
		westOf[i] = gn[w]!;
		eastOf[i] = gn[e]!;
	}
	const banks = (s: number): [number, number] => {
		const i = locate(gs, s);
		const t = Math.min(1, Math.max(0, (s - gs[i]!) / (gs[i + 1]! - gs[i]!)));
		return [westOf[i]! + (westOf[i + 1]! - westOf[i]!) * t, eastOf[i]! + (eastOf[i + 1]! - eastOf[i]!) * t];
	};

	// what the ground is made of, finely where one walks, coarsely beyond
	const near = paint(NEAR);
	const far = paint({ s0: gs[0]!, s1: gs[NS - 1]!, n0: gn[0]!, n1: gn[NN - 1]!, cell: FAR_CELL });
	const surface = (s: number, n: number): [number, number, number, number] => {
		const r = s > NEAR.s0 && s < NEAR.s1 && n > NEAR.n0 && n < NEAR.n1 ? near : far;
		const i = Math.min(r.W - 1, Math.max(0, Math.floor((s - r.rect.s0) / r.rect.cell)));
		const j = Math.min(r.H - 1, Math.max(0, Math.floor((n - r.rect.n0) / r.rect.cell)));
		const k = (j * r.W + i) * 4;
		return [r.data[k]! / 255, r.data[k + 1]! / 255, r.data[k + 2]! / 255, r.data[k + 3]! / 255];
	};

	/* ── the mesh: the grid, and round it the ground running on out to the horizon ── */
	const pos: number[] = [];
	for (let j = 0; j < NN; j++)
		for (let i = 0; i < NS; i++) {
			const s = gs[i]!, n = gn[j]!;
			pos.push(xOf(s, n), heights[j * NS + i]!, zOf(s, n));
		}
	const index: number[] = [];
	for (let j = 0; j < NN - 1; j++)
		for (let i = 0; i < NS - 1; i++) {
			const a = j * NS + i, b = a + 1, c = a + NS, d = c + 1;
			index.push(a, c, b, b, c, d);
		}
	// the rim: each edge point carried 3 km straight out, at its own height
	const rim: number[] = [];
	for (let i = 0; i < NS; i++) rim.push(i);
	for (let j = 1; j < NN; j++) rim.push(j * NS + NS - 1);
	for (let i = NS - 2; i >= 0; i--) rim.push((NN - 1) * NS + i);
	for (let j = NN - 2; j > 0; j--) rim.push(j * NS);
	const outer: number[] = [];
	for (const k of rim) {
		const i = k % NS, j = Math.floor(k / NS);
		const s = gs[i]!, n = gn[j]!;
		const ds = i === 0 ? -1 : i === NS - 1 ? 1 : 0, dn = j === 0 ? -1 : j === NN - 1 ? 1 : 0;
		const len = Math.hypot(ds, dn) || 1;
		const S = s + (ds / len) * 3000, N = n + (dn / len) * 3000;
		outer.push(pos.length / 3);
		// up and down the river it runs on in its bed; across it, the town's ground
		pos.push(xOf(S, N), ds && !dn ? Math.max(heights[k]!, -1.5) : Math.max(heights[k]!, 3), zOf(S, N));
	}
	for (let r = 0; r < rim.length; r++) {
		const a = rim[r]!, b = rim[(r + 1) % rim.length]!, A = outer[r]!, B = outer[(r + 1) % rim.length]!;
		index.push(a, b, A, b, B, A);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setIndex(index);
	geo.computeVertexNormals();
	geo.computeBoundingSphere();

	const time = { value: 0 };
	const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
	const uniforms = {
		splatNear: { value: near.tex },
		splatFar: { value: far.tex },
		tGrass: { value: grass() },
		tDry: { value: grass(true) },
		tGravel: { value: gravel() },
		tPebbles: { value: pebbles() },
		tAsphalt: { value: asphalt() },
		tSoil: { value: soil() },
		tNoise: { value: noise() },
		nearRect: { value: new THREE.Vector4(NEAR.s0, NEAR.n0, 1 / (NEAR.s1 - NEAR.s0), 1 / (NEAR.n1 - NEAR.n0)) },
		farRect: { value: new THREE.Vector4(gs[0]!, gn[0]!, 1 / (gs[NS - 1]! - gs[0]!), 1 / (gn[NN - 1]! - gn[0]!)) },
		uAlong: { value: new THREE.Vector2(...MAP.frame.u) },
		uAcross: { value: new THREE.Vector2(...MAP.frame.v) },
		slope: { value: MAP.river.slope },
		time
	};
	mat.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, uniforms);
		sh.vertexShader = sh.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
			.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
		sh.fragmentShader = sh.fragmentShader
			.replace('#include <common>', `#include <common>\n${SHADER_HEAD}`)
			.replace(
				'#include <map_fragment>',
				/* glsl */ `
	vec2 sn = vec2( dot( vW.xz, uAlong ), dot( vW.xz, uAcross ) );
	vec2 uvNear = ( sn - nearRect.xy ) * nearRect.zw;
	vec4 sp = ( uvNear.x > 0.001 && uvNear.x < 0.999 && uvNear.y > 0.001 && uvNear.y < 0.999 )
		? texture2D( splatNear, uvNear ) : texture2D( splatFar, ( sn - farRect.xy ) * farRect.zw );
	float broad = texture2D( tNoise, vW.xz / 31.0 ).r;
	float fine = texture2D( tNoise, vW.xz / 3.7 ).r;
	float level = slope * sn.x;
	float depth = level - vW.y;
	// seen through the moving water the bed wavers
	vec2 drift = uAlong * time * 0.6;
	vec2 wob = vec2( texture2D( tNoise, ( vW.xz - drift ) / 1.4 ).r, texture2D( tNoise, ( vW.xz - drift ) / 1.4 + vec2( 0.5, 0.21 ) ).r ) - 0.5;
	wob *= 0.09 * smoothstep( 0.0, 0.4, depth );
	// how steep it is here: the west bank's slope is earth and stones under its trees, not grass
	vec3 wn = normalize( cross( dFdx( vW ), dFdy( vW ) ) );
	float steep = smoothstep( 0.28, 0.55, 1.0 - abs( wn.y ) );
	float wGravel = smoothstep( 0.3, 0.7, sp.r + ( fine - 0.5 ) * 0.4 );
	float wAsphalt = smoothstep( 0.35, 0.65, sp.b + ( fine - 0.5 ) * 0.2 );
	float wSoil = max( smoothstep( 0.3, 0.75, sp.a + ( broad - 0.5 ) * 0.5 ), steep * 0.55 );
	// below the water and just above it: the river's pebbles
	float wStones = max( smoothstep( 0.3, 0.7, sp.g + ( fine - 0.5 ) * 0.35 ), smoothstep( 0.3 + fine * 0.25, -0.02, -depth ) );
	wStones = max( wStones, steep * smoothstep( 1.6, 0.4, -depth ) );
	vec3 green = surfaceOf( tGrass, vW.xz, 2.3 );
	vec3 straw = surfaceOf( tDry, vW.xz, 2.6 );
	float dry = smoothstep( 0.4, 0.72, broad + ( fine - 0.5 ) * 0.25 );
	vec3 ground = mix( green, straw, dry * 0.9 );
	ground = mix( ground, surfaceOf( tSoil, vW.xz, 2.8 ), wSoil );
	ground = mix( ground, surfaceOf( tGravel, vW.xz, 1.7 ), wGravel * ( 1.0 - wStones * 0.6 ) );
	ground = mix( ground, surfaceOf( tAsphalt, vW.xz, 2.2 ), wAsphalt );
	ground = mix( ground, surfaceOf( tPebbles, vW.xz + wob, 2.4 ), wStones );
	// wet just over the water's edge and under it: darker
	float wet = smoothstep( -0.3, 0.02, depth );
	ground *= mix( 1.0, 0.6, wet );
	if ( depth > 0.0 ) {
		// the light lost on its way down to the bed and back, red first, and the water's own green gathering with depth:
		// golden over the shallow gravel, the Isar's teal over its pools
		ground *= exp( -depth * vec3( 0.95, 0.38, 0.42 ) );
		ground = mix( ground, vec3( 0.018, 0.075, 0.066 ), 1.0 - exp( -depth * 1.15 ) );
		// the sun's caustics on the shallow bed, drifting with the flow
		vec2 flow = uAlong * time * 0.55;
		float c1 = texture2D( tNoise, ( vW.xz - flow ) / 2.6 ).r;
		float c2 = texture2D( tNoise, ( vW.xz - flow * 0.8 ) / 1.9 + vec2( 0.41, 0.13 ) + time * 0.012 ).r;
		float caustic = pow( max( 0.0, 1.0 - abs( c1 - c2 ) * 3.2 ), 6.0 );
		ground *= 1.0 + caustic * 1.4 * smoothstep( 0.02, 0.25, depth ) * exp( -depth * 0.8 );
	}
	diffuseColor.rgb *= ground;`
			)
			.replace('#include <roughnessmap_fragment>', '\tfloat roughnessFactor = mix( roughness, 0.45, wet * ( 1.0 - step( 0.0, depth ) ) );');
	};
	mat.customProgramCacheKey = () => 'isar-ground';
	const mesh = new THREE.Mesh(geo, mat);
	mesh.receiveShadow = true;
	mesh.name = 'the ground';

	return {
		gs,
		gn,
		h: heights,
		at,
		atSN,
		banks,
		surface,
		mesh,
		time,
		dispose() {
			geo.dispose();
			mat.dispose();
			near.tex.dispose();
			far.tex.dispose();
		}
	};
}

/** Whether a world point is in any of the rings. */
export const inAny = (rings: Ring[], x: number, z: number) => rings.some((r) => inRing(r, x, z));
