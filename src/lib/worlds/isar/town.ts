/*
 * THE TOWN ROUND THE ISAR — what one sees over the trees: the houses of the Isarvorstadt on the west bank and of
 * Untergiesing and the Au on the east, each from its footprint and its height on the map (or its storeys), their
 * plastered fronts in Munich's pale colours with rows of windows, some lit at night, under red tile roofs; north,
 * beyond the Wittelsbacherbrücke, St. Maximilian's two towers; south, beyond the railway bridge, the Heizkraftwerk
 * Süd's chimneys (176, 130 and 90 m), its heat store and its halls. All far enough off to be shapes in the air.
 */
import * as THREE from 'three';
import { MAP, points, type Ring } from './map';
import { seeded } from '$lib/models/outdoor';

/** A front: four bays of windows by four storeys (12.8 × 13.2 m), the lit ones in a second sheet for the night. */
function facades() {
	const make = (lit: boolean) => {
		const c = document.createElement('canvas');
		c.width = c.height = 512;
		const x = c.getContext('2d')!;
		const r = seeded(lit ? 9 : 8);
		x.fillStyle = lit ? '#000' : '#f2efe8';
		x.fillRect(0, 0, 512, 512);
		const bw = 128, bh = 128;
		const lights = seeded(31);
		for (let i = 0; i < 4; i++)
			for (let j = 0; j < 4; j++) {
				const wx = i * bw + 40, wy = j * bh + 30, ww = 48, wh = 66;
				const on = lights() < 0.28;
				if (lit) {
					if (!on) continue;
					x.fillStyle = lights() < 0.5 ? '#ffcf8a' : '#ffe2b0';
					x.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
					continue;
				}
				// the window's surround, its sill, the glass in two casements
				x.fillStyle = 'rgba(0,0,0,0.12)';
				x.fillRect(wx - 6, wy - 6, ww + 12, wh + 14);
				x.fillStyle = '#e9e4da';
				x.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
				x.fillStyle = `rgb(${52 + r() * 25},${62 + r() * 25},${70 + r() * 25})`;
				x.fillRect(wx, wy, ww, wh);
				x.fillStyle = '#e9e4da';
				x.fillRect(wx + ww / 2 - 2, wy, 4, wh);
				x.fillRect(wx, wy + wh * 0.32, ww, 3);
				x.fillStyle = 'rgba(0,0,0,0.25)';
				x.fillRect(wx - 6, wy + wh + 4, ww + 12, 5);
			}
		// a cornice line under each storey's windows
		if (!lit) for (let j = 0; j < 4; j++) {
			x.fillStyle = 'rgba(0,0,0,0.06)';
			x.fillRect(0, j * bh + 118, 512, 4);
		}
		const t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.anisotropy = 4;
		return t;
	};
	return { day: make(false), night: make(true) };
}

const FRONTS = ['#d8ccb2', '#d4bf96', '#c7b8a2', '#dcd1bf', '#c4c4bc', '#d6bb9f', '#bfb6a2', '#ddd4c2', '#c9be95'];
const ROOFS = ['#9a4a33', '#8c4430', '#a65a3e', '#7f3f2c', '#94503a', '#5f6062'];

export type Town = { group: THREE.Group; light: (night: number) => void; dispose: () => void };

export function buildTown(): Town {
	const group = new THREE.Group();
	group.name = 'the town';
	const r = seeded(1158);
	const wall: number[] = [], wallN: number[] = [], wallUV: number[] = [], wallC: number[] = [];
	const roof: number[] = [], roofN: number[] = [], roofC: number[] = [];
	const col = new THREE.Color();
	const tri = (arr: number[], nrm: number[], cols: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colour: THREE.Color) => {
		const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
		arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
		for (let k = 0; k < 3; k++) {
			nrm.push(n.x, n.y, n.z);
			cols.push(colour.r, colour.g, colour.b);
		}
	};
	/** a building's walls from its foot to its eaves, its front's windows in bays and storeys */
	const walls = (ring: [number, number][], y0: number, y1: number, front: THREE.Color) => {
		let area = 0;
		for (let i = 0; i < ring.length; i++) {
			const [x1, z1] = ring[i]!, [x2, z2] = ring[(i + 1) % ring.length]!;
			area += x1 * z2 - x2 * z1;
		}
		let along = 0;
		for (let i = 0; i < ring.length; i++) {
			const [x1, z1] = ring[i]!, [x2, z2] = ring[(i + 1) % ring.length]!;
			const len = Math.hypot(x2 - x1, z2 - z1);
			if (len < 0.05) continue;
			// outward: to the right of the edge for a ring turning one way, to its left for the other
			const out = area > 0 ? new THREE.Vector3(z2 - z1, 0, -(x2 - x1)) : new THREE.Vector3(-(z2 - z1), 0, x2 - x1);
			out.normalize();
			const A = new THREE.Vector3(x1, y0, z1), B = new THREE.Vector3(x2, y0, z2), C = new THREE.Vector3(x2, y1, z2), D = new THREE.Vector3(x1, y1, z1);
			const u0 = along / 12.8, u1 = (along + len) / 12.8, v0 = 0, v1 = (y1 - y0) / 13.2;
			const quad: [THREE.Vector3, number, number][] = [[A, u0, v0], [B, u1, v0], [C, u1, v1], [A, u0, v0], [C, u1, v1], [D, u0, v1]];
			const facing = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).dot(out) > 0;
			const order = facing ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
			for (const k of order) {
				const [p, u, v] = quad[k]!;
				wall.push(p.x, p.y, p.z);
				wallN.push(out.x, out.y, out.z);
				wallUV.push(u, v);
				wallC.push(front.r, front.g, front.b);
			}
			along += len;
		}
	};
	/** a roof: hipped (its eaves drawn in towards its middle and up) or flat */
	const roofOver = (ring: [number, number][], y: number, rise: number, colour: THREE.Color, hipped: boolean) => {
		const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
		const inner = ring.map(([x, z]) => {
			const d = Math.hypot(cx - x, cz - z) || 1;
			const k = hipped ? Math.min(d * 0.82, rise * 1.5) / d : 0;
			return [x + (cx - x) * k, z + (cz - z) * k] as [number, number];
		});
		const top = y + (hipped ? rise : 0);
		if (hipped)
			for (let i = 0; i < ring.length; i++) {
				const j = (i + 1) % ring.length;
				const a = new THREE.Vector3(ring[i]![0], y, ring[i]![1]), b = new THREE.Vector3(ring[j]![0], y, ring[j]![1]);
				const c = new THREE.Vector3(inner[j]![0], top, inner[j]![1]), d = new THREE.Vector3(inner[i]![0], top, inner[i]![1]);
				const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
				if (n.y >= 0) {
					tri(roof, roofN, roofC, a, b, c, colour);
					tri(roof, roofN, roofC, a, c, d, colour);
				} else {
					tri(roof, roofN, roofC, a, c, b, colour);
					tri(roof, roofN, roofC, a, d, c, colour);
				}
			}
		const flat = THREE.ShapeUtils.triangulateShape(inner.map(([x, z]) => new THREE.Vector2(x, z)), []);
		for (const [i, j, k] of flat) {
			const a = new THREE.Vector3(inner[i]![0], top, inner[i]![1]), b = new THREE.Vector3(inner[j]![0], top, inner[j]![1]), c = new THREE.Vector3(inner[k]![0], top, inner[k]![1]);
			const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
			if (n.y >= 0) tri(roof, roofN, roofC, a, b, c, colour);
			else tri(roof, roofN, roofC, a, c, b, colour);
		}
	};
	const ringOf = (pts: Ring) => {
		const p = points(pts);
		if (p.length > 2 && p[0]![0] === p[p.length - 1]![0] && p[0]![1] === p[p.length - 1]![1]) p.pop();
		return p;
	};

	for (const b of MAP.buildings) {
		const ring = ringOf(b.pts);
		if (ring.length < 3) continue;
		const rise = b.roof ? b.rh ?? 4 : 0;
		const eaves = b.y + Math.max(2.5, b.h - rise);
		const front = col.set(b.glass ? '#c8d2d4' : FRONTS[Math.floor(r() * FRONTS.length)]!).clone();
		walls(ring, b.y - 1.5, eaves, front);
		roofOver(ring, eaves, rise, new THREE.Color(b.glass ? '#b9c4c6' : b.roof ? ROOFS[Math.floor(r() * (ROOFS.length - 1))]! : '#77736c'), !!b.roof);
	}
	// the power station's halls
	for (const p of MAP.landmarks.plant ?? []) {
		const ring = ringOf(p.pts);
		if (ring.length < 3) continue;
		walls(ring, p.y - 1, p.y + p.h, new THREE.Color('#d9d9d4'));
		roofOver(ring, p.y + p.h, 0, new THREE.Color('#8c8e8c'), false);
	}

	const { day, night } = facades();
	const wallGeo = new THREE.BufferGeometry();
	wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
	wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wallN, 3));
	wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUV, 2));
	wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wallC, 3));
	const wallMat = new THREE.MeshStandardMaterial({ map: day, emissiveMap: night, emissive: '#ffffff', emissiveIntensity: 0, vertexColors: true, roughness: 0.9 });
	const walls3 = new THREE.Mesh(wallGeo, wallMat);
	walls3.castShadow = walls3.receiveShadow = true;
	walls3.name = 'the houses';
	group.add(walls3);
	const roofGeo = new THREE.BufferGeometry();
	roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roof, 3));
	roofGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roofN, 3));
	roofGeo.setAttribute('color', new THREE.Float32BufferAttribute(roofC, 3));
	const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
	const roofs = new THREE.Mesh(roofGeo, roofMat);
	roofs.castShadow = roofs.receiveShadow = true;
	roofs.name = 'the roofs';
	group.add(roofs);

	/* ── St. Maximilian: its nave along its footprint's length, the apse to the south-west, two towers to the north-east ── */
	const owned: { dispose: () => void }[] = [wallGeo, wallMat, roofGeo, roofMat, day, night];
	const stoneMat = new THREE.MeshStandardMaterial({ color: '#d6ccb4', roughness: 0.88 });
	const slateMat = new THREE.MeshStandardMaterial({ color: '#4e5356', roughness: 0.7 });
	owned.push(stoneMat, slateMat);
	const church = MAP.landmarks.maximilian;
	if (church) {
		const ring = ringOf(church.pts);
		// its long axis: the longest of the lines through its corners
		let best = 0, axis = new THREE.Vector2(1, 0);
		for (const a of ring)
			for (const b of ring) {
				const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
				if (d > best) (best = d), (axis = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize());
			}
		const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
		// the towers stand at its north-eastern end
		if (axis.x - axis.y < 0) axis.negate();
		const g = new THREE.Group();
		g.position.set(cx, church.y, cz);
		g.rotation.y = Math.atan2(-axis.y, axis.x);
		const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
			const mesh = new THREE.Mesh(geo, m);
			mesh.position.set(x, y, z);
			mesh.castShadow = mesh.receiveShadow = true;
			g.add(mesh);
			owned.push(geo);
			return mesh;
		};
		part(new THREE.BoxGeometry(62, 22, 26), stoneMat, -4, 11, 0);
		// the nave's steep roof, a gable along its length, and the transept's across it
		const gable = (w: number, h: number, len: number) => {
			const geo = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]), { depth: len, bevelEnabled: false });
			geo.translate(0, 0, -len / 2);
			return geo;
		};
		const naveRoof = gable(27.2, 12, 62);
		naveRoof.rotateY(Math.PI / 2);
		part(naveRoof, slateMat, -4, 22, 0);
		part(new THREE.BoxGeometry(14, 19, 40), stoneMat, 4, 9.5, 0);
		part(gable(14.8, 7, 40), slateMat, 4, 19, 0);
		const apse = part(new THREE.CylinderGeometry(11, 11, 17, 24, 1, false, 0, Math.PI), stoneMat, -35, 8.5, 0);
		apse.rotation.y = Math.PI;
		const apseRoof = part(new THREE.ConeGeometry(11.6, 7, 24, 1, false, 0, Math.PI), slateMat, -35, 20.5, 0);
		apseRoof.rotation.y = Math.PI;
		for (const side of [-1, 1]) {
			const tz = side * 10.5;
			part(new THREE.BoxGeometry(10, 46, 10), stoneMat, 30, 23, tz);
			part(new THREE.BoxGeometry(10.8, 1.2, 10.8), stoneMat, 30, 46.6, tz);
			// the belfry: its arched openings dark
			for (const [dx, dz] of [[5.02, 0], [-5.02, 0], [0, 5.02], [0, -5.02]] as const) {
				const open = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), new THREE.MeshBasicMaterial({ color: '#2a2a2a' }));
				open.position.set(30 + dx, 41, tz + dz);
				open.rotation.y = dx ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : dz > 0 ? 0 : Math.PI;
				g.add(open);
				owned.push(open.geometry, open.material as THREE.Material);
			}
			part(new THREE.BoxGeometry(9.2, 6, 9.2), stoneMat, 30, 50.2, tz);
			const cap = part(new THREE.ConeGeometry(7.2, 6.5, 4), slateMat, 30, 56.5, tz);
			cap.rotation.y = Math.PI / 4;
		}
		group.add(g);
	}

	/* ── the Heizkraftwerk Süd: its chimneys, white with a dark band at the top and red lights for the night, and its
	   heat store, a great steel drum ── */
	const chimneyMat = new THREE.MeshStandardMaterial({ color: '#e1e2df', roughness: 0.75 });
	const bandMat = new THREE.MeshStandardMaterial({ color: '#6a6c6c', roughness: 0.8 });
	const redMat = new THREE.MeshStandardMaterial({ color: '#601010', emissive: '#ff2a1a', emissiveIntensity: 0 });
	const tankMat = new THREE.MeshStandardMaterial({ color: '#b9bec1', roughness: 0.35, metalness: 0.8 });
	owned.push(chimneyMat, bandMat, redMat, tankMat);
	for (const c of MAP.landmarks.chimneys) {
		const body = new THREE.CylinderGeometry(c.r * 0.7, c.r, c.h, 24, 1);
		const m = new THREE.Mesh(body, chimneyMat);
		m.position.set(c.at[0], c.y + c.h / 2, c.at[1]);
		const band = new THREE.Mesh(new THREE.CylinderGeometry(c.r * 0.71, c.r * 0.72, c.h * 0.04, 24, 1), bandMat);
		band.position.set(c.at[0], c.y + c.h * 0.98, c.at[1]);
		const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), redMat);
		lamp.position.set(c.at[0], c.y + c.h + 0.6, c.at[1]);
		for (const o of [m, band, lamp]) {
			o.castShadow = true;
			group.add(o);
			owned.push(o.geometry);
		}
	}
	for (const t of MAP.landmarks.tanks) {
		const m = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, t.h, 40, 1), tankMat);
		m.position.set(t.at[0], t.y + t.h / 2, t.at[1]);
		m.castShadow = true;
		group.add(m);
		owned.push(m.geometry);
	}

	return {
		group,
		light(night) {
			wallMat.emissiveIntensity = 0.85 * night;
			redMat.emissiveIntensity = 0.2 + 3.5 * night;
		},
		dispose() {
			for (const o of owned) o.dispose();
		}
	};
}
