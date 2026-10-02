/**
 * THE UNIVERSE — the one sky primitive every world is a view of.
 *
 * From far out (Sandbox 2's planet) it is space: deep blue-black, the stars and the Milky Way, the sun a blinding
 * star. Come down into the air and the atmosphere takes over — the sky turns blue and light by day (the Preetham
 * scattering model, three.js's Sky shader), deep blue in the blue hour, and the stars come out only once the sun is
 * far enough below the horizon. The islands and the domes are the same sky, zoomed all the way in: on the ground.
 *
 *   createUniverse()   the dome (space + atmosphere, in one shader) and the stars, drawn at the far plane round the
 *                      camera; set each frame where "up" is and how deep in the air the camera is
 *   horizonAt(...)     the colour of the sky at the horizon, for the fog: distant things melt into the real sky
 *   celestial(hour)    where the sun is for a planet (the point it stands over) and how far the stars have turned
 *
 * Everything is set from the hour and the camera alone (a fixed star catalogue from a fixed seed), so a film renders
 * the same pixels every time.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/** Where the worlds stand on their planet: the celestial pole stands this high in the north (+z on the ground). */
export const LATITUDE = 45;
/** The sun's declination, always: early summer, long days from five to eight, as the local sky has them. */
export const DECLINATION = 18;
/** The Preetham sky's air: clear, a little haze. */
const AIR = { turbidity: 3, rayleigh: 1.2, mieCoefficient: 0.004, mieDirectionalG: 0.8 };

const linear = (/** @type {string} */ hex) => new THREE.Color(hex);
/** deep space: never black, a bluish black, the dark blue of the universe */
const SPACE = linear('#070e25');
/** the night air: a deep blue-black overhead, bluer toward the horizon (airglow, the moon's light in the air) */
const NIGHT_ZENITH = linear('#070f27'), NIGHT_HORIZON = linear('#111d3d');
/** the twilight: the glow over where the sun went down, and the blue hour everywhere else */
const DUSK_GLOW = linear('#d9773f'), BLUE_HOUR = linear('#36508c');

const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/**
 * The sun's height above the horizon (radians) seen from where `up` points.
 * @param {THREE.Vector3} sun @param {THREE.Vector3} up
 */
const altitude = (sun, up) => Math.asin(Math.max(-1, Math.min(1, sun.dot(up))));

/** how strongly the twilight glows: from just before sunset down to the end of astronomical twilight (−18°) */
const twilightOf = (/** @type {number} */ alt) => smooth(-0.32, -0.03, alt) * (1 - smooth(-0.02, 0.1, alt));
/** how much of the stars shows through the air: none by day, coming out from nautical twilight, all by night */
const starsOf = (/** @type {number} */ alt) => smooth(-0.07, -0.27, alt);
/** how dark the night air is, 0 by day */
const nightOf = (/** @type {number} */ alt) => smooth(0.02, -0.2, alt);

/* ── the Preetham sky in JavaScript: three.js's Sky shader, line for line, for the colour at the horizon ── */
const RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
/** @param {number[]} d @param {number[]} s the direction and the sun, in a frame where up is +y */
function preetham(d, s) {
	const sunY = s[1];
	const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(Math.max(-1, Math.min(1, sunY)))) / 1.5)));
	const fade = 1 - Math.min(1, Math.max(0, 1 - Math.exp(sunY / 450000)));
	const betaR = RAYLEIGH.map((v) => v * (AIR.rayleigh - (1 - fade)));
	const betaM = MIE.map((v) => 0.434 * 0.2 * AIR.turbidity * 10e-18 * v * AIR.mieCoefficient);
	const zen = Math.acos(Math.max(0, d[1]));
	const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
	const cosT = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
	const g = AIR.mieDirectionalG, g2 = g * g;
	const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
	const mPhase = (1 / (4 * Math.PI)) * ((1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5));
	return [0, 1, 2].map((i) => {
		const fex = Math.exp(-(betaR[i] * 8.4e3 * inv + betaM[i] * 1.25e3 * inv));
		const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
		let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
		lin *= 1 + (Math.pow(sunE * ratio * fex, 0.5) - 1) * Math.min(1, Math.max(0, Math.pow(1 - sunY, 5)));
		return (lin + 0.1 * fex) * 0.04 + [0, 0.0003, 0.00075][i];
	});
}

/**
 * The colour of the air at the horizon, all round: what the fog becomes, so what is far away melts into the sky that
 * is really there — pale by day, warm at sunset, blue in the blue hour, dark blue at night. Linear, before the lens.
 * @param {THREE.Vector3} sun where the sun is (unit) @param {THREE.Vector3} [up]
 * @returns {THREE.Color}
 */
export function horizonAt(sun, up = new THREE.Vector3(0, 1, 0)) {
	// into a frame where up is +y
	const q = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
	const s = sun.clone().applyQuaternion(q);
	const alt = Math.asin(Math.max(-1, Math.min(1, s.y)));
	const out = [0, 0, 0];
	const n = 16, el = 0.05;
	const sunAz = new THREE.Vector2(s.x, s.z).normalize();
	const tw = twilightOf(alt), night = nightOf(alt);
	for (let k = 0; k < n; k++) {
		const a = (k / n) * Math.PI * 2;
		const d = [Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a)];
		const p = preetham(d, [s.x, s.y, s.z]);
		const toward = Math.pow(Math.max(0, Math.cos(a) * sunAz.x + Math.sin(a) * sunAz.y), 3);
		for (let i = 0; i < 3; i++) {
			const c = /** @type {'r'|'g'|'b'} */ (['r', 'g', 'b'][i]);
			const dusk = (BLUE_HOUR[c] * (1 - toward) + DUSK_GLOW[c] * toward * 1.6) * tw * 0.9;
			out[i] += (p[i] + dusk + NIGHT_HORIZON[c] * night) / n;
		}
	}
	return new THREE.Color(out[0], out[1], out[2]);
}

/**
 * The sky in the sky: where the sun stands over a planet at an hour (the point it is overhead, in the planet's own
 * frame: north +y, longitude 0 toward +z, east +x), and how far the stars have turned. Noon at longitude 0 is half
 * past twelve, as the local sky has it.
 * @param {number} hour
 */
export function celestial(hour) {
	const turn = ((hour - 12.5) / 24) * Math.PI * 2;
	const lat = THREE.MathUtils.degToRad(DECLINATION), lon = -turn;
	return { sun: new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)), turn };
}

/** a seeded random generator: the same stars in every world, every frame, every film */
const seeded = (/** @type {number} */ seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** The galactic plane's pole in the stars' own frame (the celestial pole is +y): the Milky Way crosses the sky at 63°. */
const GALACTIC_POLE = new THREE.Vector3(Math.sin(1.1) * Math.cos(2.1), Math.cos(1.1), Math.sin(1.1) * Math.sin(2.1)).normalize();

/**
 * A star catalogue: as many faint stars as the eye sees on a dark night and a few bright ones, white, blue-white,
 * yellow and orange, and the Milky Way's band of faint ones.
 */
function catalogue() {
	const r = seeded(19700101);
	/** @type {number[]} */
	const pos = [];
	/** @type {number[]} */
	const col = [];
	/** @type {number[]} */
	const bright = [];
	const tints = [
		[0.7, 0.8, 1.0, 0.12], // blue-white (B, A)
		[0.95, 0.97, 1.0, 0.33], // white
		[1.0, 0.96, 0.86, 0.3], // yellow-white (F, G)
		[1.0, 0.85, 0.66, 0.17], // orange (K)
		[1.0, 0.72, 0.52, 0.08] // red-orange (M)
	];
	const tint = () => {
		let u = r();
		for (const t of tints) if ((u -= t[3]) <= 0) return t;
		return tints[1];
	};
	const add = (/** @type {THREE.Vector3} */ d, /** @type {number} */ m) => {
		pos.push(d.x, d.y, d.z);
		const t = tint();
		col.push(t[0], t[1], t[2]);
		// a magnitude's light: each step of 1 is 2.5 times fainter; a 6th-magnitude star is the faintest seen
		bright.push(Math.pow(10, -0.4 * (m - 6)));
	};
	// stars thin out as they brighten: ten times as many each 2.5 magnitudes fainter
	for (let i = 0; i < 2600; i++) {
		const y = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - y * y);
		add(new THREE.Vector3(Math.cos(a) * s, y, Math.sin(a) * s), Math.max(-1.2, 6.4 + 2.5 * Math.log10(Math.max(1e-4, r()))));
	}
	// the Milky Way: faint stars crowded along the galactic plane
	const e1 = new THREE.Vector3(1, 0, 0).cross(GALACTIC_POLE).normalize(), e2 = GALACTIC_POLE.clone().cross(e1);
	for (let i = 0; i < 3400; i++) {
		const a = r() * Math.PI * 2;
		const spread = (r() + r() + r() - 1.5) * 0.16;
		const d = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a)).addScaledVector(GALACTIC_POLE, spread).normalize();
		add(d, 5.6 + r() * 1.4);
	}
	return { pos: new Float32Array(pos), col: new Float32Array(col), bright: new Float32Array(bright) };
}

/** The stars' shader: round points, brighter ones bigger, dimmed by the air near the horizon and by daylight. */
const STARS = {
	vertexShader: /* glsl */ `
		attribute vec3 tint;
		attribute float bright;
		uniform float visible;
		uniform float through;
		uniform float atmosphere;
		uniform float limb;
		uniform float pixel;
		uniform vec3 up;
		varying vec3 vColor;
		void main() {
			vec4 world = modelMatrix * vec4( position, 1.0 );
			vec3 dir = normalize( world.xyz - cameraPosition );
			// through more air near the horizon a star dims and is gone (extinction); from space it never is
			float el = dot( dir, up );
			float air = mix( 1.0, smoothstep( -0.02, 0.35, el ), atmosphere );
			// and where the eye looks through lit air (by day, or over a planet's sunlit limb) it does not show at all:
			// the same air the dome draws there
			float upness = el + limb;
			float airy = mix( exp( -max( upness, 0.0 ) * 14.0 ) * smoothstep( 0.0, 0.25, atmosphere ), 1.0, atmosphere * atmosphere );
			float b = bright * visible * air * mix( 1.0, through, airy );
			vColor = tint * min( b, 1.6 ) * 0.9;
			gl_PointSize = pixel * clamp( 1.0 + log2( 1.0 + bright ) * 0.55, 1.0, 3.6 );
			gl_Position = projectionMatrix * viewMatrix * world;
			gl_Position.z = gl_Position.w * 0.99999;
		}`,
	fragmentShader: /* glsl */ `
		varying vec3 vColor;
		void main() {
			float d = length( gl_PointCoord - 0.5 );
			float a = smoothstep( 0.5, 0.0, d );
			gl_FragColor = vec4( vColor * a, 1.0 );
		}`
};

/**
 * three.js's Sky shader, taught three things: where up is (anywhere on a planet, not only +y), how deep in the air
 * the camera is (0 in space, 1 on the ground), and the universe behind the air — space, the Milky Way's glow, the
 * sun as a star, the moon, the blue hour and the night air.
 */
function universeShader() {
	const base = /** @type {{ uniforms: Record<string, THREE.IUniform>, vertexShader: string, fragmentShader: string }} */ (/** @type {unknown} */ (Sky.SkyShader));
	const patch = (/** @type {string} */ src, /** @type {[string, string][]} */ pairs) =>
		pairs.reduce((s, [a, b]) => {
			if (!s.includes(a)) throw new Error(`the sky shader has changed: no "${a.slice(0, 40)}"`);
			return s.split(a).join(b);
		}, src);
	const vertexShader = patch(base.vertexShader, [
		['uniform vec3 sunPosition;', 'uniform vec3 sunPosition;\n\t\tuniform vec3 up;'],
		['vSunE = sunIntensity( vSunDirection.y );', 'vSunE = sunIntensity( dot( vSunDirection, up ) );'],
		['exp( ( sunPosition.y / 450000.0 ) )', 'exp( ( dot( sunPosition, up ) / 450000.0 ) )']
	]);
	const fragmentShader = patch(base.fragmentShader, [
		[
			'uniform float time;',
			`uniform float time;
		uniform vec3 up;
		uniform float atmosphere;
		uniform float skyScale;
		uniform float limb;
		uniform float starsThrough;
		uniform float twilight;
		uniform float nightAir;
		uniform vec3 moonDirection;
		uniform float moonLight;
		uniform vec3 galacticPole;
		uniform vec3 space;
		uniform vec3 nightZenith;
		uniform vec3 nightHorizon;
		uniform vec3 duskGlow;
		uniform vec3 blueHour;`
		],
		['float zenithAngle = acos( max( 0.0, direction.y ) );', 'float upness = dot( direction, up ) + limb;\n\t\t\tfloat zenithAngle = acos( max( 0.0, upness ) );'],
		['clamp( pow( 1.0 - vSunDirection.y, 5.0 ), 0.0, 1.0 )', 'clamp( pow( 1.0 - dot( vSunDirection, up ), 5.0 ), 0.0, 1.0 )'],
		['float theta = acos( direction.y );', 'float theta = acos( upness );'],
		['if ( direction.y > 0.0 && cloudCoverage > 0.0 ) {', 'if ( upness > 0.0 && cloudCoverage > 0.0 && atmosphere > 0.99 ) {'],
		['float dayFactor = smoothstep( -0.08, 0.3, vSunDirection.y );', 'float dayFactor = smoothstep( -0.08, 0.3, dot( vSunDirection, up ) );'],
		[
			'gl_FragColor = vec4( texColor, 1.0 );',
			`// ── the universe behind the air ──
			// the Milky Way's soft glow along the galactic plane, uneven as it is
			float gb = dot( direction, galacticPole );
			float band = exp( -gb * gb * 55.0 ) * ( 0.65 + 0.35 * sin( atan( direction.z, direction.x ) * 3.0 + gb * 9.0 ) );
			vec3 universe = space + vec3( 0.55, 0.6, 0.8 ) * band * 0.012;
			// the sun as a star, out where there is no air to spread it: a disc and its corona
			float toSun = 1.0 - cosTheta;
			universe += vec3( 1.0, 0.96, 0.9 ) * ( smoothstep( 0.000018, 0.000012, toSun ) * 60.0 + exp( -toSun * 2500.0 ) * 1.5 + exp( -toSun * 90.0 ) * 0.06 ) * ( 1.0 - atmosphere );
			// the moon, full (it stands opposite the sun), its limb a little darker; a halo in the air round it
			float toMoon = 1.0 - dot( direction, moonDirection );
			float disc = smoothstep( 0.000045, 0.000035, toMoon );
			vec3 moon = vec3( 0.95, 0.94, 0.9 ) * disc * ( 0.75 + 0.25 * smoothstep( 0.000045, 0.0, toMoon ) ) * 2.2 * moonLight;
			moon += vec3( 0.55, 0.62, 0.8 ) * exp( -toMoon * 600.0 ) * 0.035 * moonLight * atmosphere;
			// ── the air ──
			float h = max( upness, 0.0 );
			// the night air: dark blue overhead, lighter toward the horizon
			vec3 air = mix( nightHorizon, nightZenith, pow( h, 0.45 ) ) * nightAir;
			// the twilight: a warm band over where the sun went down, the blue hour everywhere else, low in the sky
			vec3 across = direction - up * upness, sunAcross = vSunDirection - up * dot( vSunDirection, up );
			float toward = pow( max( dot( normalize( across + 1e-5 ), normalize( sunAcross + 1e-5 ) ), 0.0 ), 3.0 );
			float low = exp( -h * 5.0 );
			air += ( blueHour * ( 1.0 - toward ) * mix( 0.55, 1.0, low ) + duskGlow * toward * 1.6 * low ) * twilight * 0.9;
			// below the horizon on the ground: the land, dark (the world draws itself over it)
			float ground = atmosphere * smoothstep( 0.0, -0.08, upness );
			// how much air the eye looks through: all of the sky on the ground; from higher up only a band over the
			// planet's limb, thinning into space above it, wider the lower you come
			float airy = mix( exp( -max( upness, 0.0 ) * 14.0 ) * smoothstep( 0.0, 0.25, atmosphere ), 1.0, atmosphere * atmosphere );
			vec3 sky = ( texColor + air ) * airy * skyScale;
			vec3 color = sky + ( universe + moon ) * mix( 1.0, starsThrough, airy );
			gl_FragColor = vec4( mix( color, color * 0.35, ground ), 1.0 );`
		]
	]);
	return {
		uniforms: THREE.UniformsUtils.merge([
			THREE.UniformsUtils.clone(base.uniforms),
			{
				up: { value: new THREE.Vector3(0, 1, 0) },
				atmosphere: { value: 1 },
				skyScale: { value: 1 },
				limb: { value: 0 },
				starsThrough: { value: 0 },
				twilight: { value: 0 },
				nightAir: { value: 0 },
				moonDirection: { value: new THREE.Vector3(0, 1, 0) },
				moonLight: { value: 0 },
				galacticPole: { value: GALACTIC_POLE.clone() },
				space: { value: SPACE.clone() },
				nightZenith: { value: NIGHT_ZENITH.clone() },
				nightHorizon: { value: NIGHT_HORIZON.clone() },
				duskGlow: { value: DUSK_GLOW.clone() },
				blueHour: { value: BLUE_HOUR.clone() }
			}
		]),
		vertexShader,
		fragmentShader
	};
}

/**
 * @typedef {object} UniverseView
 * @property {THREE.Vector3} sun where the sun is (unit, world)
 * @property {THREE.Vector3} moon where the moon is (unit, world)
 * @property {THREE.Vector3} up where up is for the camera (unit, world)
 * @property {number} atmosphere how deep in the air the camera is: 0 in space, 1 on the ground
 * @property {THREE.Quaternion} stars how the star sphere is turned (its own frame: the celestial pole is +y)
 * @property {number} [limb] how far below level the planet's true horizon lies, as a sine (0 on the ground: from higher
 *   up the horizon dips, and the air's band sits on it)
 * @property {number} [skyScale] the air's light against the world's lens (1 on the ground; less round a planet, whose
 *   lens is set for the planet lit in space)
 */

/**
 * The dome and the stars: one universe, seen from wherever the camera is.
 * @param {{ clouds?: number, mirror?: boolean }} [o] clouds: how much of the sky they cover (on the ground); mirror:
 *   the stars drawn mirrored north for south, for a real place's sky (./sky.js `map`) — the turn handed to `set` is
 *   then the mirrored sky's
 */
export function createUniverse(o = {}) {
	const shader = universeShader();
	const material = new THREE.ShaderMaterial({ name: 'UniverseSky', ...shader, side: THREE.BackSide, depthWrite: false });
	const u = material.uniforms;
	Object.entries(AIR).forEach(([k, v]) => (u[k].value = v));
	u.cloudCoverage.value = o.clouds ?? 0.4;
	const dome = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
	dome.frustumCulled = false;
	dome.renderOrder = -2;

	const cat = catalogue();
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(cat.pos, 3));
	geo.setAttribute('tint', new THREE.BufferAttribute(cat.col, 3));
	geo.setAttribute('bright', new THREE.BufferAttribute(cat.bright, 1));
	const starMat = new THREE.ShaderMaterial({
		name: 'Stars',
		uniforms: { visible: { value: 0 }, through: { value: 0 }, atmosphere: { value: 1 }, limb: { value: 0 }, pixel: { value: 1 }, up: { value: new THREE.Vector3(0, 1, 0) } },
		...STARS,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	});
	const stars = new THREE.Points(geo, starMat);
	if (o.mirror) stars.scale.z = -1;
	stars.frustumCulled = false;
	stars.renderOrder = -1;
	const turn = new THREE.Quaternion();
	// both are drawn round the camera, wherever it goes: at the distance of the sky
	dome.onBeforeRender = (renderer, _s, cam) => {
		dome.position.copy(cam.position);
		dome.scale.setScalar(/** @type {THREE.PerspectiveCamera} */ (cam).far * 0.5);
		dome.updateMatrixWorld();
	};
	stars.onBeforeRender = (renderer, _s, cam) => {
		stars.position.copy(cam.position);
		stars.quaternion.copy(turn);
		stars.updateMatrixWorld();
		starMat.uniforms.pixel.value = renderer.getPixelRatio();
	};

	return {
		dome,
		stars,
		material,
		/**
		 * Set the universe for a view.
		 * @param {UniverseView} v
		 */
		set(v) {
			u.sunPosition.value.copy(v.sun);
			u.up.value.copy(v.up);
			u.atmosphere.value = v.atmosphere;
			u.skyScale.value = v.skyScale ?? 1;
			u.limb.value = v.limb ?? 0;
			u.moonDirection.value.copy(v.moon);
			turn.copy(v.stars);
			// the Milky Way's glow lies along the stars as they are drawn, mirrored with them for a real place
			u.galacticPole.value.copy(GALACTIC_POLE);
			if (o.mirror) u.galacticPole.value.z = -u.galacticPole.value.z;
			u.galacticPole.value.applyQuaternion(turn);
			const alt = altitude(v.sun, v.up);
			const night = nightOf(alt);
			u.twilight.value = twilightOf(alt);
			u.nightAir.value = night;
			u.moonLight.value = Math.max(night, 1 - v.atmosphere);
			// from space the stars always show; in the air only as the sky darkens
			const through = starsOf(alt);
			u.starsThrough.value = through;
			starMat.uniforms.visible.value = 1;
			starMat.uniforms.through.value = through;
			starMat.uniforms.atmosphere.value = v.atmosphere;
			starMat.uniforms.limb.value = v.limb ?? 0;
			starMat.uniforms.up.value.copy(v.up);
		},
		dispose() {
			dome.geometry.dispose();
			material.dispose();
			geo.dispose();
			starMat.dispose();
		}
	};
}

/**
 * The turn of the stars over a world on the ground at an hour: the celestial pole stands LATITUDE° up in the north
 * (+z), and the sky turns round it with the sun, a full turn a day.
 * @param {number} hour
 */
export function groundStars(hour) {
	const pole = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(LATITUDE)), Math.cos(THREE.MathUtils.degToRad(LATITUDE)));
	const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pole);
	const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -celestial(hour).turn);
	return tilt.multiply(spin);
}

/**
 * A planet's air seen from outside: a thin blue glow round its rim on the day side, warmer where the light grazes it
 * at the terminator, gone on the night side. Add it to the scene round a planet at the origin; set where the sun is.
 * @param {number} radius the planet's surface
 */
export function createAirShell(radius) {
	const material = new THREE.ShaderMaterial({
		name: 'AirShell',
		uniforms: { sun: { value: new THREE.Vector3(0, 0, 1) }, strength: { value: 1 } },
		vertexShader: /* glsl */ `
			varying vec3 vNormal;
			varying vec3 vWorld;
			void main() {
				vNormal = normalize( mat3( modelMatrix ) * normal );
				vec4 w = modelMatrix * vec4( position, 1.0 );
				vWorld = w.xyz;
				gl_Position = projectionMatrix * viewMatrix * w;
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 sun;
			uniform float strength;
			varying vec3 vNormal;
			varying vec3 vWorld;
			void main() {
				vec3 view = normalize( cameraPosition - vWorld );
				float rim = pow( 1.0 - max( dot( vNormal, view ), 0.0 ), 3.5 );
				float lit = dot( vNormal, sun );
				float day = smoothstep( -0.25, 0.35, lit );
				// sunlight grazing the air at the terminator reddens, as at sunset seen from the ground
				float graze = exp( -pow( lit * 4.0, 2.0 ) );
				vec3 color = mix( vec3( 0.32, 0.56, 1.0 ), vec3( 1.0, 0.55, 0.3 ), graze * 0.6 );
				gl_FragColor = vec4( color * rim * day * 0.9 * strength, 1.0 );
			}`,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	});
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.022, 96, 64), material);
	return {
		mesh,
		/** @param {THREE.Vector3} sun where the sun is (unit) @param {number} [strength] how much of it shows (less as you come down into it) */
		set(sun, strength = 1) {
			material.uniforms.sun.value.copy(sun);
			material.uniforms.strength.value = strength;
		},
		dispose() {
			mesh.geometry.dispose();
			material.dispose();
		}
	};
}
