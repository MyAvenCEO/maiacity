/*
 * THE ISAR'S WATER — the river's surface, flowing north (downstream, s rising) on the world's clock: its ripples carried
 * along the channel at the current's speed (fastest in the deep middle, slow at the banks), white where it runs fast
 * and shallow over the gravel, clear in the shallows so the pebbles show through and deepening to the Isar's green
 * over its pools. It reflects the sky that is there; the sun glitters on it.
 *
 * Its surface follows the river's fall (about a metre between the bridges), and runs on past both ends of the ground,
 * up and down the river, out to the horizon.
 */
import * as THREE from 'three';
import { DOWNSTREAM, waterAt, xOf, zOf } from './map';
import type { Ground } from './ground';
import { seeded } from '$lib/models/outdoor';

/** A tiling field of ripples, as a normal map: waves of whole numbers of cycles across the tile, so it has no seam. */
function rippleNormals(size = 256) {
	const r = seeded(1871);
	const waves = Array.from({ length: 48 }, () => {
		const k = 2 + Math.floor(r() * r() * 22);
		const a = r() * Math.PI * 2;
		return { kx: Math.round(Math.cos(a) * k), ky: Math.round(Math.sin(a) * k), amp: 1 / Math.pow(k, 1.3), ph: r() * Math.PI * 2 };
	}).filter((w) => w.kx || w.ky);
	const h = new Float32Array(size * size);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			let v = 0;
			for (const w of waves) v += w.amp * Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.ph);
			h[y * size + x] = v;
		}
	const data = new Uint8Array(size * size * 4);
	const k = 9;
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const dx = h[y * size + ((x + 1) % size)]! - h[y * size + ((x - 1 + size) % size)]!;
			const dy = h[((y + 1) % size) * size + x]! - h[((y - 1 + size) % size) * size + x]!;
			const nx = -dx * k, ny = -dy * k, len = Math.hypot(nx, ny, 1);
			const i = (y * size + x) * 4;
			data[i] = Math.round((nx / len) * 127.5 + 127.5);
			data[i + 1] = Math.round((ny / len) * 127.5 + 127.5);
			data[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
			data[i + 3] = 255;
		}
	const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.magFilter = THREE.LinearFilter;
	t.minFilter = THREE.LinearMipmapLinearFilter;
	t.generateMipmaps = true;
	t.needsUpdate = true;
	return t;
}

export type Water = { mesh: THREE.Mesh; time: { value: number }; light: (day: number) => void; dispose: () => void };

export function buildWater(ground: Ground, foamNoise: THREE.Texture): Water {
	const { gs, gn, h } = ground;
	const NS = gs.length, NN = gn.length;
	// the channel's middle line, column by column, and its slope: the way the water runs
	const mid = new Float64Array(NS);
	for (let i = 0; i < NS; i++) {
		const [w, e] = ground.banks(gs[i]!);
		mid[i] = (w + e) / 2;
	}
	const smooth = new Float64Array(NS);
	for (let i = 0; i < NS; i++) {
		let sum = 0, wsum = 0;
		for (let k = -12; k <= 12; k++) {
			const j = Math.min(NS - 1, Math.max(0, i + k));
			const wgt = 1 - Math.abs(k) / 13;
			sum += mid[j]! * wgt;
			wsum += wgt;
		}
		smooth[i] = sum / wsum;
	}
	const wet = (i: number, j: number) => h[j * NS + i]! < waterAt(gs[i]!) + 0.35;
	// the cells the water covers (and a little over the edge, so its line is where the ground rises out of it)
	const vIndex = new Int32Array(NS * NN).fill(-1);
	const pos: number[] = [], uv: number[] = [], depth: number[] = [], flow: number[] = [];
	const vertex = (i: number, j: number) => {
		const k = j * NS + i;
		if (vIndex[k]! >= 0) return vIndex[k]!;
		const s = gs[i]!, n = gn[j]!;
		const level = waterAt(s);
		const x = xOf(s, n), z = zOf(s, n);
		const d = level - h[k]!;
		// the current: along the channel, fast where it is deep, slow at the banks
		const i0 = Math.max(0, i - 1), i1 = Math.min(NS - 1, i + 1);
		const dn = (smooth[i1]! - smooth[i0]!) / (gs[i1]! - gs[i0]!);
		const len = Math.hypot(1, dn);
		const fs = 1 / len, fn = dn / len;
		const [w, e] = ground.banks(s);
		const edge = Math.min(n - w, e - n);
		const speed = Math.max(0.12, Math.min(1.75, 0.35 + 1.05 * Math.pow(Math.max(0, d) / 1.4, 0.6))) * Math.min(1, Math.max(0.25, edge / 7));
		vIndex[k] = pos.length / 3;
		pos.push(x, level, z);
		uv.push(x, -z);
		depth.push(d);
		flow.push(xOf(fs, fn), zOf(fs, fn), speed);
		return vIndex[k]!;
	};
	const index: number[] = [];
	for (let j = 0; j < NN - 1; j++)
		for (let i = 0; i < NS - 1; i++) {
			if (!(wet(i, j) || wet(i + 1, j) || wet(i, j + 1) || wet(i + 1, j + 1))) continue;
			const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i, j + 1), d = vertex(i + 1, j + 1);
			index.push(a, c, b, b, c, d);
		}
	// and on past both ends of the ground, up and down the river: the end column's water carried out 3 km
	for (const [i, out] of [[0, -3000], [NS - 1, 3000]] as const) {
		for (let j = 0; j < NN - 1; j++) {
			if (!(wet(i, j) || wet(i, j + 1))) continue;
			const a = vertex(i, j), c = vertex(i, j + 1);
			const far = (k: number) => {
				const at = pos.length / 3;
				const s = gs[i]! + out, n = gn[k]!;
				pos.push(xOf(s, n), waterAt(gs[i]!), zOf(s, n));
				uv.push(xOf(s, n), -zOf(s, n));
				depth.push(depth[vIndex[k * NS + i]!]!);
				const f = vIndex[k * NS + i]! * 3;
				flow.push(flow[f]!, flow[f + 1]!, flow[f + 2]!);
				return at;
			};
			const A = far(j), C = far(j + 1);
			if (out < 0) index.push(A, C, a, a, C, c);
			else index.push(a, c, A, A, c, C);
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
	geo.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 3));
	geo.setIndex(index);
	geo.computeBoundingSphere();

	const time = { value: 0 };
	/** the banks' trees as the water mirrors them: their green in the light of the hour */
	const bank = { value: new THREE.Color(0.03, 0.045, 0.024) };
	const normals = rippleNormals();
	const mat = new THREE.MeshPhysicalMaterial({
		color: '#ffffff',
		roughness: 0.06,
		metalness: 0,
		ior: 1.333,
		normalMap: normals,
		normalScale: new THREE.Vector2(0.55, 0.55),
		transparent: true,
		depthWrite: false,
		envMapIntensity: 1.0
	});
	// the water's own light over what shows through it: lit body and reflection added, the bed seen through the rest
	mat.blending = THREE.CustomBlending;
	mat.blendSrc = THREE.OneFactor;
	mat.blendDst = THREE.OneMinusSrcAlphaFactor;
	mat.blendEquation = THREE.AddEquation;
	mat.onBeforeCompile = (sh) => {
		sh.uniforms.time = time;
		sh.uniforms.foamNoise = { value: foamNoise };
		sh.uniforms.bank = bank;
		sh.uniforms.along = { value: new THREE.Vector2(DOWNSTREAM.x, DOWNSTREAM.z) };
		sh.vertexShader = sh.vertexShader
			.replace('#include <common>', '#include <common>\nattribute float depth;\nattribute vec3 flow;\nvarying float vDepth;\nvarying vec3 vFlow;\nvarying vec3 vWp;')
			.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvDepth = depth;\n\tvFlow = flow;\n\tvWp = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
		sh.fragmentShader = sh.fragmentShader
			.replace(
				'#include <common>',
				/* glsl */ `#include <common>
uniform float time;
uniform sampler2D foamNoise;
uniform vec3 bank;
uniform vec2 along;
varying float vDepth;
varying vec3 vFlow;
varying vec3 vWp;
float foam = 0.0;
// the ripples carried downstream: two copies of the field sliding with the current, each faded out as it starts over
vec3 flowing( sampler2D map, vec2 p, float size, float period, vec2 shift ) {
	vec2 f = vec2( vFlow.x, -vFlow.y ) * vFlow.z;
	float p0 = fract( time / period ), p1 = fract( time / period + 0.5 );
	vec3 a = texture2D( map, ( p - f * p0 * period ) / size + shift ).xyz * 2.0 - 1.0;
	vec3 b = texture2D( map, ( p - f * p1 * period ) / size + shift + 0.5 ).xyz * 2.0 - 1.0;
	return mix( a, b, abs( p0 - 0.5 ) * 2.0 );
}`
			)
			.replace(
				'#include <color_fragment>',
				/* glsl */ `#include <color_fragment>
	// the Isar's colours: clear over the shallow gravel, green and then deep teal over its pools
	float d = max( vDepth, 0.0 );
	vec3 body = mix( vec3( 0.15, 0.25, 0.12 ), vec3( 0.03, 0.17, 0.12 ), smoothstep( 0.15, 1.8, d ) );
	float a = mix( 0.16, 0.82, smoothstep( 0.04, 1.9, d ) );
	// white water: shallow and fast over the gravel, in streaks carried by the current
	vec2 fp = vec2( vWp.x, -vWp.z );
	vec2 fl = vec2( vFlow.x, -vFlow.y ) * vFlow.z;
	float q0 = fract( time / 3.0 ), q1 = fract( time / 3.0 + 0.5 );
	float n0 = texture2D( foamNoise, ( fp - fl * q0 * 3.0 ) * vec2( 0.55, 0.55 ) / 3.2 ).r;
	float n1 = texture2D( foamNoise, ( fp - fl * q1 * 3.0 ) * vec2( 0.55, 0.55 ) / 3.2 + 0.5 ).r;
	float streak = mix( n0, n1, abs( q0 - 0.5 ) * 2.0 );
	float riffle = smoothstep( 0.55, 1.25, vFlow.z ) * smoothstep( 0.75, 0.25, d ) * smoothstep( 0.02, 0.12, d );
	foam = smoothstep( 0.55, 0.78, streak + riffle * 0.45 ) * riffle;
	// and a thin line where the water laps the shore
	foam = max( foam, smoothstep( 0.05, 0.0, vDepth ) * smoothstep( -0.04, 0.0, vDepth ) * 0.35 * streak );
	diffuseColor.rgb = mix( body, vec3( 0.92, 0.95, 0.94 ), foam );
	diffuseColor.a = max( a, foam * 0.92 ) * smoothstep( -0.03, 0.02, vDepth );`
			)
			.replace(
				'#include <normal_fragment_maps>',
				/* glsl */ `
	vec2 wp = vec2( vWp.x, -vWp.z );
	vec3 big = flowing( normalMap, wp, 4.6, 4.0, vec2( 0.0 ) );
	vec3 small = flowing( normalMap, wp, 1.3, 2.0, vec2( 0.37, 0.11 ) );
	vec3 fine = flowing( normalMap, wp, 0.45, 1.0, vec2( 0.71, 0.53 ) );
	float calm = 0.45 + 0.55 * smoothstep( 0.1, 0.9, vFlow.z );
	vec3 mapN = normalize( vec3( ( big.xy * 0.32 + small.xy * 0.42 + fine.xy * 0.3 ) * normalScale * calm * ( 1.0 + foam ), 1.0 ) );
	normal = normalize( tbn * mapN );`
			)
			.replace('#include <roughnessmap_fragment>', '\tfloat roughnessFactor = mix( roughness, 0.55, foam );')
			.replace(
				'#include <opaque_fragment>',
				/* glsl */ `
	// how much the surface mirrors (Schlick, water's 2 %): the reflection is never hidden by the water being clear
	float facing = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
	float fresnel = 0.02 + 0.98 * pow( 1.0 - facing, 5.0 );
	float alpha = clamp( diffuseColor.a + ( 1.0 - diffuseColor.a ) * fresnel, 0.0, 1.0 ) * smoothstep( -0.03, 0.02, vDepth );
	// what it mirrors: the sky overhead, but low down the trees that line both banks, dark green
	vec3 nWorld = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
	vec3 rWorld = reflect( normalize( vWp - cameraPosition ), nWorld );
	// the trees stand some 18 m high at the banks: across the river they fill the mirror up high, along it only
	// low down, where the reflected look runs far before it meets them
	vec2 hor = normalize( rWorld.xz + 1e-5 );
	float across = abs( dot( hor, vec2( -along.y, along.x ) ) );
	float far = min( 600.0, 32.0 / max( across, 0.053 ) );
	float treeline = atan( 18.0, far );
	float open = smoothstep( treeline * 0.55, treeline * 1.35, asin( clamp( rWorld.y, -1.0, 1.0 ) ) );
	vec3 mirrored = reflectedLight.directSpecular + mix( bank * fresnel, reflectedLight.indirectSpecular, open );
	gl_FragColor = vec4( totalDiffuse * diffuseColor.a * 0.85 + mirrored * smoothstep( -0.03, 0.02, vDepth ), alpha );`
			)
			.replace(
				'#include <fog_fragment>',
				/* glsl */ `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	// over what shows through: the fog's colour as much as the water covers it
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor );
#endif`
			);
	};
	mat.customProgramCacheKey = () => 'isar-water';
	const mesh = new THREE.Mesh(geo, mat);
	mesh.receiveShadow = true;
	mesh.renderOrder = 1;
	mesh.name = 'the Isar';
	return {
		mesh,
		time,
		light: (day) => void bank.value.setRGB(0.004 + 0.05 * day, 0.006 + 0.075 * day, 0.004 + 0.038 * day),
		dispose() {
			geo.dispose();
			mat.dispose();
			normals.dispose();
		}
	};
}
