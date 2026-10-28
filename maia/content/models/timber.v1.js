import * as THREE from "three";
import { seeded } from "../assets/seeded.js";
/** @typedef {(width: number, height: number, depth: number, material: THREE.Material, x?: number, y?: number, z?: number, rotation?: number) => THREE.Mesh} Box */
/** @typedef {{ box: Box, timber: THREE.Material, oak: THREE.Material, dark: THREE.Material, steel: THREE.Material }} TimberKit */
/** @param {string} c @param {number} [rough] */
const col = (c, rough = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
const awnings = ["#c9623f", "#6f8f6a", "#e3cfa6", "#3f6f7a"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide }));
/** @param {TimberKit} k @param {number} seed */
function coop(k, seed) {
  const g = new THREE.Group;
  const r = seeded(seed);
  const roofMat = awnings[seed % 2 ? 0 : 1];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      g.add(k.box(0.1, 0.6, 0.1, k.timber, sx * 0.85, 0, -1.2 + sz * 0.6));
  g.add(k.box(1.9, 1, 1.4, k.oak, 0, 0.6, -1.2));
  for (const side of [-1, 1]) {
    const roof = k.box(2.2, 0.06, 1, roofMat, 0, 0, 0);
    roof.position.set(0, 1.85, -1.2 + side * 0.38);
    roof.rotation.x = side * 0.6;
    g.add(roof);
  }
  g.add(k.box(0.35, 0.4, 0.04, k.dark, 0.4, 0.75, -0.48));
  g.add(k.box(0.5, 0.45, 1.1, k.oak, 1.2, 0.8, -1.2));
  const ramp = k.box(0.35, 0.03, 1, k.timber, 0.4, 0, 0);
  ramp.position.set(0.4, 0.38, -0.05);
  ramp.rotation.x = 0.62;
  g.add(ramp);
  const mesh = new THREE.MeshStandardMaterial({ color: "#c9ccc4", transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6 });
  const w = 5, d = 4;
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]])
    g.add(k.box(0.08, 1.2, 0.08, k.timber, x, 0, z));
  for (const [x, z, len, rot] of [[0, d / 2, w, 0], [-w / 2, 0, d, Math.PI / 2], [w / 2, 0, d, Math.PI / 2]]) {
    g.add(k.box(len, 0.06, 0.06, k.timber, x, 1.2, z, rot));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2), mesh);
    net.position.set(x, 0.6, z);
    net.rotation.y = rot;
    g.add(net);
  }
  const straw = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), col("#d8c38a", 1));
  straw.rotation.x = -Math.PI / 2;
  straw.position.y = 0.035;
  g.add(straw);
  g.add(k.box(0.8, 0.15, 0.25, k.steel, -1.6, 0, 1.4));
  return { group: g, colliders: [{ x: 0, z: -1.2, r: 1.3 }, { x: -1.3, z: 0.8, r: 1.3 }, { x: 1.3, z: 0.8, r: 1.3 }] };
}
/** @param {TimberKit} k @param {number} seed */
function hutch(k, seed) {
  const g = new THREE.Group;
  const r = seeded(seed);
  const felt = col("#4a4a48", 0.95);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      g.add(k.box(0.1, 0.55, 0.1, k.timber, sx * 0.95, 0, -1.2 + sz * 0.45));
  g.add(k.box(2.1, 0.06, 1.05, k.oak, 0, 0.55, -1.2));
  g.add(k.box(2.1, 0.75, 0.06, k.oak, 0, 0.61, -1.7));
  for (const x of [-1.02, 0.3, 1.02])
    g.add(k.box(0.06, 0.75, 1.05, k.oak, x, 0.61, -1.2));
  g.add(k.box(0.7, 0.66, 0.05, k.oak, 0.66, 0.65, -0.68));
  g.add(k.box(0.04, 0.04, 0.04, k.steel, 0.4, 0.98, -0.65));
  const wire = new THREE.MeshStandardMaterial({ color: "#b9bcb4", transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, roughness: 0.6 });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.66), wire);
  front.position.set(-0.36, 0.98, -0.68);
  g.add(front);
  g.add(k.box(1.36, 0.05, 0.06, k.timber, -0.36, 1.33, -0.68), k.box(1.36, 0.05, 0.06, k.timber, -0.36, 0.62, -0.68));
  const roof = k.box(2.4, 0.05, 1.35, felt, 0, 0, 0);
  roof.position.set(0, 1.42, -1.2);
  roof.rotation.x = 0.16;
  g.add(roof);
  const ramp = k.box(0.35, 0.03, 0.9, k.timber, 0, 0, 0);
  ramp.position.set(-0.55, 0.32, -0.25);
  ramp.rotation.x = 0.62;
  g.add(ramp);
  const w = 5, d = 4, h = 0.9;
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]])
    g.add(k.box(0.08, h, 0.08, k.timber, x, 0, z));
  for (const [x, z, len, rot] of [[0, d / 2, w, 0], [-w / 2, 0, d, Math.PI / 2], [w / 2, 0, d, Math.PI / 2]]) {
    g.add(k.box(len, 0.06, 0.06, k.timber, x, h, z, rot));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wire);
    net.position.set(x, h / 2, z);
    net.rotation.y = rot;
    g.add(net);
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), wire);
  top.rotation.x = -Math.PI / 2;
  top.position.y = h + 0.03;
  g.add(top);
  for (const z of [-1, 0, 1])
    g.add(k.box(w, 0.04, 0.04, k.timber, 0, h + 0.03, z));
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), col("#7f9a52", 1));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.03;
  g.add(grass);
  g.add(k.box(0.6, 0.35, 0.18, k.timber, 1.4, 0.2, -1.55));
  g.add(k.box(0.52, 0.12, 0.14, col("#d8c38a", 1), 1.4, 0.48, -1.55));
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.07, 14), k.steel);
  bowl.position.set(-1.7, 0.035, 1.3);
  g.add(bowl);
  const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 14, 1, true), col("#7a5a3c", 0.95));
  tunnel.material.side = THREE.DoubleSide;
  tunnel.rotation.z = Math.PI / 2;
  tunnel.rotation.y = 0.5 + r() * 0.4;
  tunnel.position.set(1.2, 0.17, 1);
  g.add(tunnel);
  return { group: g, colliders: [{ x: 0, z: -1.2, r: 1.3 }, { x: -1.3, z: 0.8, r: 1.3 }, { x: 1.3, z: 0.8, r: 1.3 }] };
}
function plainKit() {
  /** @param {string} hex @param {number} [rough] */
  const c = (hex, rough = 0.8) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough });
  /** @type {Box} */
  const box = (w, h, d, mat, x = 0, y = 0, z = 0, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const none = () => new THREE.Group;
  return {
    box,
    table: none,
    sofa: none,
    lantern: none,
    oak: c("#a8774c", 0.82),
    lime: c("#d9d2c2", 0.9),
    stone: () => c("#a9a49a", 0.85),
    dark: c("#23262a", 0.5),
    steel: c("#2e3236", 0.4),
    counter: c("#f3f1ec", 0.3),
    timber: c("#9c6b3f", 0.6),
    linen: c("#f1ece2", 0.95),
    cushion: c("#c47a4a", 0.9),
    rug: c("#b9a589", 1),
    paper: c("#fff4e2", 0.9)
  };
}
export const timberCoop = () => coop(plainKit(), 3).group;
export const timberHutch = () => hutch(plainKit(), 4).group;
const wood = new THREE.MeshStandardMaterial({ color: "#b98a5a", roughness: 0.75 });
const darkWood = new THREE.MeshStandardMaterial({ color: "#8a6040", roughness: 0.8 });
const rope = new THREE.MeshStandardMaterial({ color: "#d8c8a0", roughness: 1 });
const sand = new THREE.MeshStandardMaterial({ color: "#e3cf9c", roughness: 1 });
/** @param {THREE.Group} g @param {THREE.Vector3} a @param {THREE.Vector3} b @param {number} r @param {THREE.Material} [mat] */
function log(g, a, b, r, mat = wood) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  g.add(m);
}
/** @param {number} x @param {number} y @param {number} z */
const v = (x, y, z) => new THREE.Vector3(x, y, z);
/** @param {number} seed */
export function playground(seed) {
  const r = seeded(seed);
  const g = new THREE.Group;
  const cs = [];
  const pit = new THREE.Mesh(new THREE.CircleGeometry(4.2, 40), sand);
  pit.rotation.x = -Math.PI / 2;
  pit.position.y = 0.03;
  g.add(pit);
  for (let i = 0;i < 18; i++) {
    const a = i / 18 * Math.PI * 2;
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.35 + r() * 0.25, 10), darkWood);
    stump.position.set(Math.sin(a) * 4.3, 0.2, Math.cos(a) * 4.3);
    g.add(stump);
  }
  const T = { x: -1.2, z: -0.8, h: 1.6 };
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    log(g, v(T.x + sx * 0.8, 0, T.z + sz * 0.8), v(T.x + sx * 0.8, T.h + 1.6, T.z + sz * 0.8), 0.09);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.1, 24), wood).translateX(T.x).translateY(T.h).translateZ(T.z));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1, 4), new THREE.MeshStandardMaterial({ color: "#c9623f", roughness: 0.9 }));
  roof.position.set(T.x, T.h + 2.1, T.z);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  for (let i = 0;i < 5; i++)
    log(g, v(T.x - 0.8, 0.3 + i * 0.3, T.z + 1.1), v(T.x + 0.8, 0.3 + i * 0.3, T.z + 1.1), 0.03);
  for (const sx of [-0.8, 0.8])
    log(g, v(T.x + sx, 0, T.z + 1.1), v(T.x + sx, T.h, T.z + 0.8), 0.05);
  const slidePath = new THREE.CatmullRomCurve3([v(T.x + 0.9, T.h, T.z), v(T.x + 2.2, T.h * 0.6, T.z - 0.3), v(T.x + 3.4, 0.25, T.z - 0.2)]);
  const chute = new THREE.Mesh(new THREE.TubeGeometry(slidePath, 20, 0.4, 10, false), new THREE.MeshStandardMaterial({ color: "#d9b36a", roughness: 0.4, side: THREE.DoubleSide }));
  chute.scale.y = 0.6;
  chute.position.y = 0.25;
  g.add(chute);
  cs.push({ x: T.x, z: T.z, r: 1.3 });
  const S = { x: 1.8, z: 2.2 };
  for (const sx of [-1.4, 1.4]) {
    log(g, v(S.x + sx, 0, S.z - 0.8), v(S.x + sx, 2.4, S.z), 0.08);
    log(g, v(S.x + sx, 0, S.z + 0.8), v(S.x + sx, 2.4, S.z), 0.08);
  }
  log(g, v(S.x - 1.5, 2.4, S.z), v(S.x + 1.5, 2.4, S.z), 0.09);
  for (const sx of [-0.6, 0.6]) {
    for (const dz of [-0.18, 0.18])
      log(g, v(S.x + sx + dz, 2.4, S.z), v(S.x + sx + dz, 0.55, S.z), 0.012, rope);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.22), wood).translateX(S.x + sx).translateY(0.53).translateZ(S.z));
  }
  cs.push({ x: S.x - 1.4, z: S.z, r: 0.6 }, { x: S.x + 1.4, z: S.z, r: 0.6 });
  for (let i = 0;i < 3; i++) {
    const a = 3.6 + i * 0.5;
    log(g, v(Math.sin(a) * 5.2, 0.25, Math.cos(a) * 5.2), v(Math.sin(a + 0.35) * 6.8, 0.25, Math.cos(a + 0.35) * 6.8), 0.15, darkWood);
  }
  for (let i = 0;i < 7; i++) {
    const a = 0.9 + i * 0.28;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.2 + i * 0.08, 12), wood);
    st.position.set(Math.sin(a) * 6.2, (0.2 + i * 0.08) / 2, Math.cos(a) * 6.2);
    g.add(st);
  }
  g.traverse((o) => /** @type {THREE.Mesh} */ (o).isMesh && (o.castShadow = true, o.receiveShadow = true));
  return { group: g, colliders: cs };
}

export { coop, hutch };
