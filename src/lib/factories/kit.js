/*
 * Ported from AirSup's factory-skill (https://github.com/AirsupHQ/factory-skill, commit 9fde755, MIT licence:
 * Copyright (c) 2026 Air Supply Technologies Inc., .claude/skills/factory-skill/LICENSE) into maiaCITY as an ES module
 * (2026-10-15). Only this head and the foot changed: the browser globals (FactorySkill, THREE) became imports and
 * exports; the body is theirs, line for line, under `@ts-nocheck` so it stays theirs. Our additions, where there are
 * any, sit at the end under "maiaCITY additions".
 */
// @ts-nocheck
import { T } from './three.js'
import { rng } from './des.js'
import { euroPallet, PH as PALLET_H } from '$lib/actors/pallet.js'
const FS = { rng }
/** AirSup's kit: materials, parts, machines, products, people and vehicles, at real scale (1 unit = 1 m) */
export const K = {}
/*
 * Factory Skill: the miniature kit.
 *
 * Procedural parts, machines, products, people and vehicles at real scale
 * (1 unit = 1 m). Every machine is a builder that returns
 *   { g, kind, w, d, h, work(i, p), entry, exit, anim(s) }
 *   kind 'side'   : stands beside the station's spine conveyor; its loading
 *                   face is local -z, parts hop from the spine to `entry`.
 *   kind 'inline' : the flow runs through it along local +x, from `entry`
 *                   (at -x) to `exit` (at +x); tunnel ovens, coaters, packers.
 *   work(i, p)    : local position of the i-th unit inside at progress p.
 *   anim(s)       : s = { state, p, t, dt, busy, down, n } every frame.
 * Static parts are merged per material by K.freeze, so a machine costs a few
 * draw calls; parts that move live under groups marked with K.live.
 */
  K.T = T
  const V = (x, y, z) => new T.Vector3(x, y, z)
  K.V = V
  const TAU = Math.PI * 2
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const ease = (x) => x * x * (3 - 2 * x)
  K.ease = ease

  /* ------------------------------------------------------------ palette */
  K.C = {
    cream: '#efe8d8', paper: '#f4efe4', bone: '#e2dccd', teal: '#2e7d83', sea: '#3f9a8f', orange: '#e2713a', blue: '#3e6ea6', navy: '#26405f',
    yellow: '#eab33b', green: '#5c9a63', red: '#c7473a', graphite: '#3a3d42', charcoal: '#25272b', steel: '#a8aeb4', alu: '#c9ced2',
    copper: '#c3743a', brass: '#c9a24a', rubber: '#1d1e20', wood: '#b88a5a', card: '#c49a63', floor: '#d8d2c4', safety: '#e9b52f',
    grass: '#8fa86b', asphalt: '#6c6e70', glass: '#bcd8e2', white: '#f7f5ef', mint: '#9cc9b4', sand: '#d9c7a1', plum: '#7a4b6b',
  }
  K.ACCENTS = ['#2e7d83', '#e2713a', '#3e6ea6', '#eab33b', '#5c9a63', '#c7473a', '#7a4b6b', '#3f9a8f', '#d98d3a', '#4a6b8a']

  /* ---------------------------------------------------------- materials */
  const mats = new Map()
  K.paint = (color, rough = 0.55, metal = 0.04) => cached(`p${color}${rough}${metal}`, () => new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal }))
  K.metal = (color = K.C.steel, rough = 0.32) => cached(`m${color}${rough}`, () => new T.MeshStandardMaterial({ color, roughness: rough, metalness: 0.85 }))
  K.glass = (color = K.C.glass, op = 0.28) => cached(`g${color}${op}`, () => new T.MeshPhysicalMaterial({ color, roughness: 0.06, metalness: 0, transparent: true, opacity: op, depthWrite: false, envMapIntensity: 1.4 }))
  K.emit = (color, k = 2.2) => cached(`e${color}${k}`, () => new T.MeshStandardMaterial({ color: '#111111', emissive: color, emissiveIntensity: k, roughness: 0.5 }))
  K.unique = (m) => m.clone()
  function cached(k, f) { if (!mats.has(k)) mats.set(k, f()); return mats.get(k) }
  K.M = () => ({
    body: K.paint(K.C.cream), dark: K.paint(K.C.graphite, 0.5), black: K.paint(K.C.charcoal, 0.6), steel: K.metal(K.C.steel), alu: K.metal(K.C.alu, 0.38),
    chrome: K.metal('#e6e8ea', 0.12), rubber: K.paint(K.C.rubber, 0.85), yellow: K.paint(K.C.safety, 0.5), glass: K.glass(), copper: K.metal(K.C.copper, 0.35),
    red: K.paint(K.C.red, 0.5), wood: K.paint(K.C.wood, 0.8), card: K.paint(K.C.card, 0.85), white: K.paint(K.C.white, 0.5),
  })

  /* --------------------------------------------------------- geometries */
  const geos = new Map()
  function gcache(k, f) { if (!geos.has(k)) geos.set(k, f()); return geos.get(k) }
  K.boxGeo = (w, h, d, r = 0.03) => gcache(`b${w},${h},${d},${r}`, () => {
    const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)
    return rr > 0.004 ? new T.RoundedBoxGeometry(w, h, d, 2, rr) : new T.BoxGeometry(w, h, d)
  })
  K.cylGeo = (r1, r2, h, seg = 24) => gcache(`c${r1},${r2},${h},${seg}`, () => new T.CylinderGeometry(r1, r2, h, seg))

  function mesh(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new T.Mesh(geo, mat)
    m.position.set(x, y, z)
    if (rx || ry || rz) m.rotation.set(rx, ry, rz)
    m.castShadow = true
    m.receiveShadow = true
    if (parent) parent.add(m)
    return m
  }
  K.mesh = mesh
  /** box with its BOTTOM at y */
  K.box = (p, w, h, d, mat, x = 0, y = 0, z = 0, o = {}) => mesh(p, K.boxGeo(w, h, d, o.r != null ? o.r : 0.03), mat, x, y + h / 2, z, o.rx || 0, o.ry || 0, o.rz || 0)
  /** cylinder; axis 'y' sits on y, axis 'x' or 'z' is centred at (x, y, z) */
  K.cyl = (p, r, h, mat, x = 0, y = 0, z = 0, o = {}) => {
    const g = K.cylGeo(r, o.r2 != null ? o.r2 : r, h, o.seg || 24)
    const ax = o.axis || 'y'
    if (ax === 'y') return mesh(p, g, mat, x, y + h / 2, z)
    return mesh(p, g, mat, x, y, z, ax === 'z' ? Math.PI / 2 : 0, 0, ax === 'x' ? Math.PI / 2 : 0)
  }
  K.sph = (p, r, mat, x, y, z, o = {}) => mesh(p, gcache(`s${r}${o.half}`, () => new T.SphereGeometry(r, 20, 12, 0, TAU, 0, o.half ? Math.PI / 2 : Math.PI)), mat, x, y, z)
  K.tor = (p, R, r, mat, x, y, z, o = {}) => mesh(p, gcache(`t${R},${r},${o.arc || 1}`, () => new T.TorusGeometry(R, r, 10, 28, TAU * (o.arc || 1))), mat, x, y, z, o.rx || 0, o.ry || 0, o.rz || 0)
  K.group = (p, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); if (p) p.add(g); return g }
  K.live = (g) => { g.userData.live = true; return g }

  /* -------------------------------------------- merge static parts */
  K.freeze = function freeze(root) {
    root.updateMatrixWorld(true)
    const inv = new T.Matrix4().copy(root.matrixWorld).invert()
    const buckets = new Map()
    const kill = []
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.keep) return
      for (let a = o; a && a !== root; a = a.parent) if (a.userData.live) return
      if (o.material.transparent) return
      const key = o.material.uuid + (o.castShadow ? 's' : '')
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
      if (!g.attributes.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
      g.applyMatrix4(new T.Matrix4().multiplyMatrices(inv, o.matrixWorld))
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [], cast: o.castShadow })
      buckets.get(key).geos.push(g)
      kill.push(o)
    })
    for (const o of kill) o.parent.remove(o)
    for (const b of buckets.values()) {
      const g = T.BufferGeometryUtils.mergeGeometries(b.geos, false)
      const m = new T.Mesh(g, b.mat)
      m.castShadow = b.cast
      m.receiveShadow = true
      m.userData.keep = true
      root.add(m)
    }
    return root
  }

  /* ----------------------------------------------- canvas textures */
  const screens = []
  /** small animated HMI screens; kind 'graph' | 'bars' | 'list' */
  K.screenMat = (kind = 'graph', tint = '#7fe3c4') => cached(`scr${kind}${tint}`, () => {
    const c = document.createElement('canvas')
    c.width = 128; c.height = 80
    const tex = new T.CanvasTexture(c)
    tex.colorSpace = T.SRGBColorSpace
    const m = new T.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1.25, roughness: 0.3, map: tex })
    screens.push({ c, tex, kind, tint, seed: screens.length * 17.3 })
    return m
  })
  K.tickScreens = (t) => {
    for (const s of screens) {
      const x = s.c.getContext('2d')
      x.fillStyle = '#0d1a1f'
      x.fillRect(0, 0, 128, 80)
      x.fillStyle = '#16303a'
      x.fillRect(0, 0, 128, 12)
      x.fillStyle = s.tint
      x.fillRect(4, 4, 30, 4)
      if (s.kind === 'graph') {
        x.strokeStyle = s.tint
        x.lineWidth = 2
        x.beginPath()
        for (let i = 0; i < 60; i++) {
          const y = 48 + Math.sin(i * 0.35 + t * 2 + s.seed) * 12 + Math.sin(i * 1.3 + t * 5) * 4
          i ? x.lineTo(4 + i * 2, y) : x.moveTo(4, y)
        }
        x.stroke()
      } else if (s.kind === 'bars') {
        for (let i = 0; i < 9; i++) {
          const h = 20 + 40 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.9 + s.seed))
          x.fillStyle = i % 3 ? s.tint : '#f2c14e'
          x.fillRect(6 + i * 13, 76 - h, 9, h)
        }
      } else {
        for (let i = 0; i < 6; i++) {
          x.fillStyle = (Math.floor(t * 2) + i) % 5 ? s.tint : '#f2c14e'
          x.fillRect(6, 18 + i * 10, 40 + ((i * 37 + s.seed * 3) % 70), 5)
        }
      }
      s.tex.needsUpdate = true
    }
  }

  /** a soft noise texture for floors and walls */
  K.noiseTex = (base, amp = 18, size = 256, rep = 1) => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const x = c.getContext('2d')
    x.fillStyle = base
    x.fillRect(0, 0, size, size)
    const img = x.getImageData(0, 0, size, size)
    const r = FS.rng(9)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * amp
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n
    }
    x.putImageData(img, 0, 0)
    // soft blotches
    for (let i = 0; i < 60; i++) {
      x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.015 + r() * 0.03})`
      x.beginPath()
      x.arc(r() * size, r() * size, 6 + r() * 40, 0, TAU)
      x.fill()
    }
    const t = new T.CanvasTexture(c)
    t.wrapS = t.wrapT = T.RepeatWrapping
    t.repeat.set(rep, rep)
    t.colorSpace = T.SRGBColorSpace
    t.anisotropy = 8
    return t
  }

  /** conveyor belt material whose texture offset is animated by K.tickBelts */
  const belts = []
  K.beltMat = () => cached('belt', () => {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 16
    const x = c.getContext('2d')
    x.fillStyle = '#2b2c2f'
    x.fillRect(0, 0, 64, 16)
    x.fillStyle = '#3a3b3f'
    for (let i = 0; i < 8; i++) x.fillRect(i * 8, 0, 3, 16)
    const t = new T.CanvasTexture(c)
    t.wrapS = t.wrapT = T.RepeatWrapping
    t.colorSpace = T.SRGBColorSpace
    const m = new T.MeshStandardMaterial({ map: t, roughness: 0.8 })
    belts.push(t)
    return m
  })
  K.tickBelts = (dt, speed = 1) => { for (const t of belts) t.offset.x -= dt * speed * 0.9 }

  /* -------------------------------------------------------- small parts */
  /** stack light: returns { set(state, t) } */
  K.stackLight = (p, x, y, z) => {
    const g = K.group(p, x, y, z)
    K.live(g)
    K.cyl(g, 0.018, 0.25, K.metal(), 0, 0, 0, { seg: 8 })
    const segs = ['#e8412f', '#f4b23a', '#3fcf6e'].map((c, i) => {
      const on = K.emit(c, 3.2), off = K.paint(c, 0.4)
      off.color.multiplyScalar(0.55)
      const m = K.cyl(g, 0.045, 0.07, off, 0, 0.25 + (2 - i) * 0.075, 0, { seg: 14 })
      m.castShadow = false
      return { m, on, off }
    })
    K.cyl(g, 0.05, 0.02, K.paint(K.C.charcoal), 0, 0.475, 0, { seg: 14 })
    let last = ''
    return {
      set(state, t) {
        const blink = Math.floor(t * 2.5) % 2 === 0
        const want = state === 'down' ? [blink, false, false] : state === 'busy' ? [false, false, true] : state === 'blocked' ? [false, true, true] : [false, true, false]
        const k = want.join()
        if (k === last) return
        last = k
        segs.forEach((s, i) => (s.m.material = want[i] ? s.on : s.off))
      },
    }
  }
  /** a control pendant with a screen */
  K.panel = (p, x, y, z, ry = 0, kind = 'graph') => {
    const g = K.group(p, x, y, z)
    g.rotation.y = ry
    const M = K.M()
    K.box(g, 0.04, 1.2, 0.04, M.dark, 0, 0, 0)
    K.box(g, 0.46, 0.34, 0.08, M.dark, 0, 1.15, 0.03, { r: 0.02 })
    const s = K.box(g, 0.38, 0.24, 0.01, K.screenMat(kind), 0, 1.2, 0.075, { r: 0 })
    s.castShadow = false
    for (let i = 0; i < 3; i++) K.cyl(g, 0.018, 0.015, i ? M.yellow : M.red, -0.12 + i * 0.08, 1.16, 0.075, { axis: 'z', seg: 10 })
    return g
  }
  /** a guard fence around a rectangle with an opening on side 'nz' (-z) */
  K.fence = (p, w, d, h = 1.6, open = 'nz', openW = 1.4) => {
    const g = K.group(p)
    const post = K.paint(K.C.safety, 0.5)
    const mesh_ = K.glass('#3a3d40', 0.22)
    const side = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 1.2))
      for (let i = 0; i <= n; i++) K.box(g, 0.06, h, 0.06, post, x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n, { r: 0.01 })
      const pm = K.box(g, x1 === x0 ? 0.01 : L, h - 0.15, z1 === z0 ? 0.01 : L, mesh_, (x0 + x1) / 2, 0.1, (z0 + z1) / 2, { r: 0 })
      pm.castShadow = false
      K.box(g, x1 === x0 ? 0.05 : L, 0.04, z1 === z0 ? 0.05 : L, post, (x0 + x1) / 2, h - 0.04, (z0 + z1) / 2, { r: 0.01 })
    }
    const hw = w / 2, hd = d / 2, o = openW / 2
    side(-hw, hd, hw, hd)
    side(-hw, -hd, -hw, hd)
    side(hw, -hd, hw, hd)
    if (open === 'nz') { side(-hw, -hd, -o, -hd); side(o, -hd, hw, -hd) } else side(-hw, -hd, hw, -hd)
    return g
  }
  /** levelling feet under a rectangle */
  K.feet = (p, w, d, mat) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.cyl(p, 0.06, 0.08, mat || K.paint(K.C.charcoal), sx * (w / 2 - 0.12), 0, sz * (d / 2 - 0.12), { seg: 10 }) }
  /** a stack of cartons, totes or crates */
  K.crates = (p, x, z, nx, nz, ny, mat, s = 0.5) => {
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) for (let k = 0; k < ny; k++) K.box(p, s * 0.94, s * 0.8, s * 0.94, mat, x + (i - (nx - 1) / 2) * s, k * s * 0.8, z + (j - (nz - 1) / 2) * s, { r: 0.02 })
  }
  K.pallet = (p, x, y, z, mat) => {
    const g = K.group(p, x, y, z)
    const w = mat || K.paint('#b9895a', 0.85)
    for (let i = -1; i <= 1; i++) K.box(g, 1.2, 0.1, 0.1, w, 0, 0, i * 0.45)
    for (let i = -3; i <= 3; i++) K.box(g, 0.13, 0.03, 1.0, w, i * 0.18, 0.1, 0, { r: 0.005 })
    return g
  }
  K.bin = (p, x, y, z, color = K.C.blue, s = 0.4) => {
    const m = K.paint(color, 0.6)
    K.box(p, s, s * 0.55, s * 1.3, m, x, y, z, { r: 0.03 })
  }
  K.spool = (p, x, y, z, r = 0.16, mat) => {
    const g = K.group(p, x, y, z)
    K.cyl(g, r, 0.05, K.paint(K.C.charcoal), 0, 0, 0, { seg: 20 })
    K.cyl(g, r * 0.8, 0.22, mat || K.metal(K.C.copper, 0.3), 0, 0.05, 0, { seg: 20 })
    K.cyl(g, r, 0.05, K.paint(K.C.charcoal), 0, 0.27, 0, { seg: 20 })
    return g
  }
  /** tiny bolts on a face (x/z plane at height y) */
  K.bolts = (p, pts, y, mat) => { for (const [x, z] of pts) K.cyl(p, 0.025, 0.015, mat || K.metal('#8b9196'), x, y, z, { seg: 8 }) }

  /* ---------------------------------------------------------- 6 axis arm */
  /** an industrial arm; returns { g, pose(a0..a5), tip } in metres, reach ~1.6 */
  K.arm = (p, x, y, z, color = K.C.orange, s = 1) => {
    const M = K.M()
    const paint = K.paint(color, 0.45)
    const base = K.group(p, x, y, z)
    base.scale.setScalar(s)
    K.cyl(base, 0.3, 0.12, M.dark, 0, 0, 0, { seg: 28 })
    const j0 = K.live(K.group(base, 0, 0.12, 0))
    K.cyl(j0, 0.24, 0.32, paint, 0, 0, 0, { seg: 28 })
    K.cyl(j0, 0.17, 0.3, M.dark, 0, 0.34, 0, { axis: 'z', seg: 22 })
    const j1 = K.group(j0, 0, 0.34, 0)
    K.box(j1, 0.2, 0.86, 0.22, paint, 0, 0, 0, { r: 0.07 })
    K.cyl(j1, 0.13, 0.32, M.dark, 0, 0.86, 0, { axis: 'z', seg: 20 })
    const j2 = K.group(j1, 0, 0.86, 0)
    K.box(j2, 0.17, 0.17, 0.72, paint, 0, -0.08, 0.32, { r: 0.06, rx: 0 })
    K.cyl(j2, 0.12, 0.1, M.dark, 0, 0, 0.0, { axis: 'z', seg: 18 })
    const j3 = K.group(j2, 0, 0, 0.7)
    K.cyl(j3, 0.07, 0.16, M.dark, 0, 0, 0.06, { axis: 'z', seg: 16 })
    const j4 = K.group(j3, 0, 0, 0.14)
    K.box(j4, 0.12, 0.12, 0.12, paint, 0, -0.06, 0, { r: 0.03 })
    const j5 = K.group(j4, 0, -0.08, 0)
    K.cyl(j5, 0.05, 0.08, M.steel, 0, -0.08, 0, { seg: 14 })
    K.box(j5, 0.2, 0.05, 0.08, M.dark, 0, -0.13, 0)
    const fa = K.box(j5, 0.03, 0.12, 0.05, M.steel, -0.07, -0.25, 0)
    const fb = K.box(j5, 0.03, 0.12, 0.05, M.steel, 0.07, -0.25, 0)
    const tip = K.group(j5, 0, -0.26, 0)
    return {
      g: base, tip,
      pose(a0, a1, a2, a3 = 0, a4 = 0, grip = 0) {
        j0.rotation.y = a0
        j1.rotation.x = a1
        j2.rotation.x = a2
        j3.rotation.z = a3
        j4.rotation.x = a4
        fa.position.x = -0.07 + grip * 0.035
        fb.position.x = 0.07 - grip * 0.035
      },
    }
  }

  /* ---------------------------------------------------------------- people */
  const SKIN = ['#e9c4a2', '#c99a74', '#8d5f3f', '#f1d2b6', '#b07c56']
  /** a person 1.75 m tall; pose(kind, t) with kind 'walk' | 'work' | 'stand' | 'carry' */
  K.person = (p, o = {}) => {
    const r = FS.rng(o.seed || 1)
    const g = K.group(p)
    const suit = K.paint(o.suit || ['#2f4e78', '#4a5560', '#33506e', '#5b6b52'][Math.floor(r() * 4)], 0.8)
    const vest = K.paint(o.vest || (r() < 0.5 ? '#f08a2a' : '#e6d23a'), 0.7)
    const skin = K.paint(SKIN[Math.floor(r() * SKIN.length)], 0.7)
    const hat = K.paint(o.hat || (r() < 0.7 ? '#f7f3ea' : '#f2c230'), 0.4)
    const legs = [-1, 1].map((s) => {
      const hip = K.group(g, s * 0.1, 0.86, 0)
      K.box(hip, 0.14, 0.82, 0.16, suit, 0, -0.82, 0, { r: 0.05 })
      K.box(hip, 0.15, 0.08, 0.26, K.paint('#222', 0.7), 0, -0.86, 0.04, { r: 0.03 })
      return hip
    })
    const torso = K.group(g, 0, 0.86, 0)
    K.box(torso, 0.4, 0.58, 0.24, suit, 0, 0, 0, { r: 0.09 })
    if (!o.suitOnly) K.box(torso, 0.42, 0.42, 0.26, vest, 0, 0.12, 0, { r: 0.09 })
    K.sph(torso, 0.115, skin, 0, 0.78, 0)
    K.sph(torso, 0.13, hat, 0, 0.82, 0, { half: true })
    if (o.mask) K.box(torso, 0.16, 0.08, 0.04, K.paint('#e8eef2', 0.6), 0, 0.73, 0.1, { r: 0.02 })
    const arms = [-1, 1].map((s) => {
      const sh = K.group(torso, s * 0.24, 0.5, 0)
      K.box(sh, 0.11, 0.6, 0.12, o.suitOnly ? suit : vest, 0, -0.6, 0, { r: 0.05 })
      K.sph(sh, 0.06, skin, 0, -0.64, 0)
      return sh
    })
    g.traverse((m) => (m.castShadow = true))
    return {
      g,
      pose(kind, t, k = 1) {
        if (kind === 'walk') {
          const a = Math.sin(t * 7) * 0.55 * k
          legs[0].rotation.x = a; legs[1].rotation.x = -a
          arms[0].rotation.x = -a * 0.8; arms[1].rotation.x = a * 0.8
          torso.position.y = 0.86 + Math.abs(Math.cos(t * 7)) * 0.03
          torso.rotation.x = 0.04
        } else if (kind === 'work') {
          legs[0].rotation.x = legs[1].rotation.x = 0
          arms[0].rotation.x = -1.05 + Math.sin(t * 3.1) * 0.25
          arms[1].rotation.x = -1.15 + Math.sin(t * 2.3 + 1) * 0.3
          torso.rotation.x = 0.16
          torso.position.y = 0.86
        } else if (kind === 'carry') {
          const a = Math.sin(t * 6) * 0.4
          legs[0].rotation.x = a; legs[1].rotation.x = -a
          arms[0].rotation.x = arms[1].rotation.x = -1.2
          torso.rotation.x = 0
        } else {
          legs[0].rotation.x = legs[1].rotation.x = 0
          arms[0].rotation.x = Math.sin(t * 0.7) * 0.05
          arms[1].rotation.x = -0.1 + Math.sin(t * 0.6 + 2) * 0.05
          torso.rotation.x = 0.02
          torso.position.y = 0.86
        }
      },
    }
  }

  /* -------------------------------------------------------------- vehicles */
  K.forklift = (p, color = K.C.orange) => {
    const g = K.group(p)
    const M = K.M(), paint = K.paint(color, 0.45)
    K.box(g, 1.9, 0.55, 1.05, paint, 0, 0.18, 0, { r: 0.08 })
    K.box(g, 0.6, 0.5, 1.0, M.dark, -0.6, 0.72, 0, { r: 0.08 })
    for (const sx of [-1, 1]) K.box(g, 0.05, 1.5, 0.05, M.dark, 0.1, 0.72, sx * 0.45)
    K.box(g, 1.1, 0.06, 1.05, M.dark, 0.05, 2.2, 0)
    K.box(g, 0.08, 1.9, 0.08, M.dark, 1.0, 0.1, -0.3)
    K.box(g, 0.08, 1.9, 0.08, M.dark, 1.0, 0.1, 0.3)
    const fork = K.live(K.group(g, 1.05, 0.1, 0))
    for (const sz of [-0.28, 0.28]) K.box(fork, 1.0, 0.04, 0.1, M.steel, 0.5, 0, sz)
    for (const [x, z] of [[-0.6, 0.5], [0.6, 0.5], [-0.6, -0.5], [0.6, -0.5]]) K.cyl(g, 0.2, 0.18, M.rubber, x, 0.2, z, { axis: 'z', seg: 16 })
    const d = K.person(g, { seed: 41 })
    d.g.position.set(-0.05, 0.25, 0)
    d.g.rotation.y = Math.PI / 2
    d.g.scale.setScalar(0.92)
    d.pose('stand', 0)
    const load = K.live(K.group(fork, 0.55, 0.04, 0))
    K.pallet(load, 0, 0, 0)
    K.crates(load, 0, 0, 2, 2, 2, K.paint(K.C.card, 0.85), 0.48)
    load.position.y = 0.0
    return { g, fork, load }
  }
  K.amr = (p, color = K.C.white) => {
    const g = K.group(p)
    const M = K.M()
    K.box(g, 1.0, 0.28, 0.7, K.paint(color, 0.45), 0, 0.04, 0, { r: 0.08 })
    K.box(g, 1.02, 0.04, 0.72, M.dark, 0, 0.14, 0, { r: 0.01 })
    const l = K.box(g, 0.02, 0.04, 0.4, K.emit('#61d6ff', 2.5), 0.51, 0.16, 0, { r: 0 })
    l.castShadow = false
    K.box(g, 0.9, 0.04, 0.62, M.steel, 0, 0.32, 0, { r: 0.01 })
    const top = K.live(K.group(g, 0, 0.36, 0))
    return { g, top }
  }
  K.truck = (p, color = K.C.blue, trailer = '#f2efe8') => {
    const g = K.group(p)
    const M = K.M()
    const cab = K.paint(color, 0.4)
    K.box(g, 2.4, 2.2, 2.5, cab, 0, 0.9, 0, { r: 0.2 })
    K.box(g, 0.05, 0.9, 2.1, K.glass('#223', 0.75), 1.21, 2.0, 0, { r: 0 })
    K.box(g, 2.6, 0.6, 2.4, M.dark, -0.1, 0.5, 0, { r: 0.1 })
    K.box(g, 11, 2.7, 2.5, K.paint(trailer, 0.55), -6.9, 1.2, 0, { r: 0.08 })
    K.box(g, 11, 0.2, 2.4, M.dark, -6.9, 1.0, 0)
    for (const x of [0.6, -1.6, -9.5, -10.7]) for (const z of [-1.05, 1.05]) K.cyl(g, 0.5, 0.35, M.rubber, x, 0.5, z, { axis: 'z', seg: 18 })
    return g
  }
  K.car = (p, color) => {
    const g = K.group(p)
    const paint = K.paint(color, 0.45, 0.1)
    K.box(g, 4.2, 0.75, 1.8, paint, 0, 0.3, 0, { r: 0.25 })
    K.box(g, 2.2, 0.6, 1.6, paint, -0.2, 0.95, 0, { r: 0.25 })
    K.box(g, 2.25, 0.42, 1.62, K.glass('#2a3440', 0.8), -0.2, 1.0, 0, { r: 0.18 })
    for (const x of [1.35, -1.35]) for (const z of [-0.85, 0.85]) K.cyl(g, 0.33, 0.24, K.paint('#1b1b1b', 0.8), x, 0.33, z, { axis: 'z', seg: 16 })
    return g
  }
  K.tree = (p, x, z, s = 1, kind = 0) => {
    const g = K.group(p, x, 0, z)
    g.scale.setScalar(s)
    K.cyl(g, 0.12, 1.4, K.paint('#6b4f36', 0.9), 0, 0, 0, { r2: 0.16, seg: 8 })
    const greens = ['#6f9a52', '#5d8a48', '#83a85d', '#4f7c43']
    const leaf = K.paint(greens[kind % 4], 0.85)
    if (kind % 2 === 0) {
      K.sph(g, 1.25, leaf, 0, 2.5, 0)
      K.sph(g, 0.9, leaf, 0.6, 3.1, 0.3)
      K.sph(g, 0.8, leaf, -0.5, 3.0, -0.4)
    } else {
      mesh(g, gcache('cone', () => new T.ConeGeometry(1.1, 3.4, 12)), leaf, 0, 3.0, 0)
    }
    return g
  }
  K.rack = (p, x, z, w, d, levels = 4, h = 1.3, fill = 0.7, seed = 3) => {
    const g = K.group(p, x, 0, z)
    const r = FS.rng(seed)
    const up = K.paint('#2f5e8f', 0.5), beam = K.paint('#e47d2c', 0.5)
    const nb = Math.max(1, Math.round(w / 2.7))
    for (let i = 0; i <= nb; i++) for (const sz of [-1, 1]) K.box(g, 0.08, levels * h + 0.2, 0.08, up, -w / 2 + (w * i) / nb, 0, (sz * d) / 2)
    for (let l = 1; l <= levels; l++) for (const sz of [-1, 1]) K.box(g, w, 0.1, 0.06, beam, 0, l * h - 0.1, (sz * d) / 2)
    for (let l = 0; l < levels; l++) for (let i = 0; i < nb * 2; i++) {
      if (r() > fill) continue
      const px = -w / 2 + (w / (nb * 2)) * (i + 0.5)
      K.pallet(g, px, l * h + (l ? 0.0 : 0.02), 0)
      const cols = [K.C.card, '#d7c29a', '#9fb7c9', '#c9d1b0']
      K.box(g, 1.0, 0.5 + r() * 0.5, Math.min(d - 0.1, 0.95), K.paint(cols[Math.floor(r() * 4)], 0.85), px, l * h + 0.14, 0, { r: 0.03 })
    }
    return g
  }

  /* ------------------------------------------------------------- conveyor */
  /** roller/belt conveyor along a polyline of {x,z}; returns the group */
  K.conveyor = (p, pts, o = {}) => {
    const g = K.group(p)
    const y = o.y || 0.82, w = o.w || 0.7
    const frame = K.paint(o.color || '#4f5d66', 0.45), leg = K.paint('#3a3f44', 0.6), belt = K.beltMat()
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const L = Math.hypot(b.x - a.x, b.z - a.z)
      if (L < 0.01) continue
      const ang = Math.atan2(-(b.z - a.z), b.x - a.x)
      const s = K.group(g, (a.x + b.x) / 2, 0, (a.z + b.z) / 2)
      s.rotation.y = ang
      const ext = i < pts.length - 2 ? w / 2 : 0, ext0 = i > 0 ? w / 2 : 0
      const LL = L + ext + ext0, off = (ext - ext0) / 2
      const bm = K.mesh(s, new T.BoxGeometry(LL, 0.05, w), belt, off, y, 0)
      // uv along length so the texture scrolls with the flow
      const uv = bm.geometry.attributes.uv
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * LL * 1.4)
      bm.userData.keep = true
      for (const sz of [-1, 1]) K.box(s, LL, 0.14, 0.05, frame, off, y - 0.1, (sz * (w + 0.05)) / 2, { r: 0.01 })
      const nl = Math.max(1, Math.round(L / 1.6))
      for (let k = 0; k <= nl; k++) {
        const lx = -L / 2 + (L * k) / nl
        for (const sz of [-1, 1]) K.box(s, 0.05, y - 0.1, 0.05, leg, lx, 0, (sz * w) / 2.3, { r: 0.008 })
        K.box(s, 0.04, 0.04, w, leg, lx, 0.18, 0, { r: 0.005 })
      }
    }
    return g
  }

  /* --------------------------------------------------------------- products */
  /** geometry with vertex colours for a product stage { shape, color, scale } */
  const prodGeo = new Map()
  K.product = (def) => {
    const key = JSON.stringify(def)
    if (prodGeo.has(key)) return prodGeo.get(key)
    const parts = []
    const c0 = new T.Color(def.color || '#c9cdd1')
    const add = (geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      let g = geo.index ? geo.toNonIndexed() : geo.clone()
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
      const m = new T.Matrix4().compose(V(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), V(sx, sy, sz))
      g.applyMatrix4(m)
      const col = new T.Color(color)
      const a = new Float32Array(g.attributes.position.count * 3)
      for (let i = 0; i < a.length; i += 3) { a[i] = col.r; a[i + 1] = col.g; a[i + 2] = col.b }
      g.setAttribute('color', new T.BufferAttribute(a, 3))
      parts.push(g)
    }
    const C = (r, h, s = 24) => new T.CylinderGeometry(r, r, h, s)
    const B = (w, h, d, r = 0.02) => new T.RoundedBoxGeometry(w, h, d, 2, r)
    const dark = '#2b2d31', steel = '#b9bfc4', copper = '#c27a3a'
    const shape = def.shape || 'box'
    if (K.shapes[shape]) { // maiaCITY: one of our own shapes, at its real size (no 1.2 scale; "maiaCITY additions" below)
      K.shapes[shape](add, def, { C, B, c0 })
      const geo = T.BufferGeometryUtils.mergeGeometries(parts, false)
      const s = def.scale || 1
      geo.scale(s, s, s)
      geo.computeBoundingSphere()
      prodGeo.set(key, geo)
      return geo
    }
    switch (shape) {
      case 'ring': add(new T.TorusGeometry(0.16, 0.07, 10, 24), c0, 0, 0.07, 0, Math.PI / 2); add(C(0.11, 0.13), c0, 0, 0.065); break
      case 'wound': add(C(0.2, 0.14), c0, 0, 0.07); add(C(0.11, 0.15), steel, 0, 0.075); for (let i = 0; i < 12; i++) add(B(0.05, 0.16, 0.05), copper, Math.cos((i / 12) * TAU) * 0.2, 0.08, Math.sin((i / 12) * TAU) * 0.2); break
      case 'rotor': add(C(0.22, 0.1), c0, 0, 0.05); for (let i = 0; i < 14; i++) add(B(0.06, 0.08, 0.02, 0.005), i % 2 ? '#8a8f96' : '#5b6068', Math.cos((i / 14) * TAU) * 0.2, 0.06, Math.sin((i / 14) * TAU) * 0.2, 0, -(i / 14) * TAU); break
      case 'hub': add(C(0.24, 0.16), c0, 0, 0.08); add(C(0.27, 0.03), c0, 0, 0.02); add(C(0.27, 0.03), c0, 0, 0.14); add(C(0.03, 0.42), steel, 0, 0.08); for (let i = 0; i < 18; i++) add(B(0.012, 0.012, 0.012, 0.003), steel, Math.cos((i / 18) * TAU) * 0.255, 0.155, Math.sin((i / 18) * TAU) * 0.255); break
      case 'disc': add(C(0.22, 0.1), c0, 0, 0.05); break
      case 'coil': add(C(0.3, 0.22, 28), c0, 0, 0.11); add(C(0.12, 0.23), '#6b7178', 0, 0.115); break
      case 'box': add(B(0.48, 0.36, 0.48), c0, 0, 0.18); add(B(0.49, 0.03, 0.12, 0.005), '#d9c9a5', 0, 0.36); break
      case 'crate': add(B(0.5, 0.36, 0.5), c0, 0, 0.18); break
      case 'tote': add(B(0.6, 0.3, 0.4), c0, 0, 0.15); add(B(0.5, 0.05, 0.3), '#2b2d31', 0, 0.29); break
      case 'croissant': {
        const g = new T.TorusGeometry(0.11, 0.055, 10, 18, Math.PI * 1.15)
        add(g, c0, 0, 0.06, 0, Math.PI / 2, 0, 0, 1, 1, 1.25)
        for (let i = 0; i < 4; i++) add(new T.TorusGeometry(0.11, 0.058, 6, 6, 0.12), new T.Color(c0).multiplyScalar(0.82), 0, 0.06, 0, Math.PI / 2, 0, 0.35 + i * 0.75, 1, 1, 1.25)
        break
      }
      case 'tray': {
        add(B(0.66, 0.03, 0.46, 0.01), '#9aa0a6', 0, 0.015)
        const it = def.item || 'croissant'
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          if (it === 'dough') add(B(0.16, 0.05, 0.16, 0.02), c0, -0.21 + i * 0.21, 0.055, -0.1 + j * 0.2)
          else { add(new T.TorusGeometry(0.06, 0.03, 8, 12, Math.PI * 1.15), c0, -0.21 + i * 0.21, 0.065, -0.1 + j * 0.2, Math.PI / 2, 0, 0, 1, 1, 1.2) }
        }
        break
      }
      case 'dough': add(B(0.6, 0.08, 0.42, 0.04), c0, 0, 0.04); break
      case 'can': add(C(0.08, 0.24, 18), c0, 0, 0.12); add(C(0.07, 0.02, 18), steel, 0, 0.25); break
      case 'sixpack': for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { add(C(0.07, 0.24, 14), c0, -0.15 + i * 0.15, 0.12, -0.075 + j * 0.15); add(C(0.06, 0.02, 14), steel, -0.15 + i * 0.15, 0.25, -0.075 + j * 0.15) } break
      case 'bottle': add(C(0.08, 0.26, 16), c0, 0, 0.13); add(new T.CylinderGeometry(0.03, 0.08, 0.1, 16), c0, 0, 0.31); add(C(0.032, 0.04, 12), '#c8a24a', 0, 0.38); break
      case 'cell': add(C(0.1, 0.36, 18), c0, 0, 0.18); add(C(0.1, 0.03, 18), steel, 0, 0.37); add(C(0.03, 0.02, 10), steel, 0, 0.39); break
      case 'pouch': add(B(0.42, 0.04, 0.3, 0.01), c0, 0, 0.02); add(B(0.08, 0.01, 0.05, 0.003), steel, -0.14, 0.04, -0.17); add(B(0.08, 0.01, 0.05, 0.003), copper, 0.14, 0.04, -0.17); break
      case 'roll': add(C(0.24, 0.3, 26), c0, 0, 0.24, Math.PI / 2); add(C(0.06, 0.32, 12), steel, 0, 0.24, Math.PI / 2); break
      case 'sheet': add(B(0.6, 0.02, 0.42, 0.005), c0, 0, 0.01); add(B(0.55, 0.005, 0.38, 0.002), '#2b2d31', 0, 0.022); break
      case 'module': add(B(0.6, 0.18, 0.4), c0, 0, 0.09); for (let i = 0; i < 6; i++) add(C(0.03, 0.02, 10), steel, -0.22 + i * 0.09, 0.19, 0); add(B(0.62, 0.02, 0.06, 0.005), copper, 0, 0.19, 0.16); break
      case 'pack': add(B(0.7, 0.26, 0.48), c0, 0, 0.13); add(B(0.72, 0.03, 0.5, 0.01), '#2b2d31', 0, 0.26); add(B(0.12, 0.06, 0.1, 0.01), '#e2713a', 0.25, 0.29, 0); break
      case 'pcb': add(B(0.4, 0.025, 0.4, 0.005), '#2f6b3d', 0, 0.012); add(B(0.1, 0.03, 0.1, 0.005), dark, 0, 0.035); for (let i = 0; i < 6; i++) add(B(0.04, 0.02, 0.03, 0.003), '#c9cdd1', -0.15 + i * 0.06, 0.03, 0.14); break
      case 'frame': case 'drone': {
        const arm = def.shape === 'drone' ? c0 : new T.Color(c0)
        add(B(0.22, 0.05, 0.22), arm, 0, 0.08)
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + Math.PI / 4
          add(B(0.34, 0.03, 0.04, 0.01), arm, Math.cos(a) * 0.19, 0.08, Math.sin(a) * 0.19, 0, -a)
          if (def.shape === 'drone' || def.motors) { add(C(0.04, 0.06, 12), dark, Math.cos(a) * 0.36, 0.11, Math.sin(a) * 0.36); if (def.props !== false && def.shape === 'drone') add(B(0.32, 0.006, 0.03, 0.003), '#e6e8ea', Math.cos(a) * 0.36, 0.145, Math.sin(a) * 0.36, 0, a) }
        }
        add(B(0.04, 0.12, 0.04, 0.01), dark, 0.14, 0.02, 0.14); add(B(0.04, 0.12, 0.04, 0.01), dark, -0.14, 0.02, -0.14)
        if (def.shape === 'drone') { add(B(0.14, 0.06, 0.1, 0.02), '#2f6b3d', 0, 0.13); add(B(0.1, 0.05, 0.16, 0.02), def.battery || '#e2713a', 0, 0.03) }
        break
      }
      case 'satellite': add(B(0.7, 0.12, 0.42), c0, 0, 0.06); add(B(0.68, 0.015, 0.4, 0.004), '#1c2b4a', 0, 0.125); add(B(0.2, 0.08, 0.2, 0.01), '#c9a24a', 0.2, 0.17, 0); break
      case 'bus': add(B(0.55, 0.4, 0.55), c0, 0, 0.2); add(B(0.56, 0.06, 0.56, 0.01), '#c9a24a', 0, 0.2); add(C(0.06, 0.1, 12), steel, 0, 0.45); break
      case 'sneaker': add(B(0.42, 0.06, 0.16, 0.03), '#f2f2ee', 0, 0.03); add(B(0.36, 0.13, 0.15, 0.06), c0, -0.02, 0.1); break
      case 'bag': add(B(0.48, 0.12, 0.34, 0.06), c0, 0, 0.06); break
      case 'puck': default: add(C(0.2, 0.12), c0, 0, 0.06)
    }
    let geo = T.BufferGeometryUtils.mergeGeometries(parts, false)
    const s = (def.scale || 1) * 1.2
    geo.scale(s, s, s)
    geo.computeBoundingSphere()
    prodGeo.set(key, geo)
    return geo
  }

  /* --------------------------------------------------------------- machines */
  const MACH = (K.machines = {})
  /** register a machine builder: K.def(name, fn, { kind, w, d }) */
  K.def = (name, fn) => (MACH[name] = fn)

  /** shared scaffolding for side machines */
  function sideBase(o, w, d) {
    const g = new T.Group()
    const M = K.M()
    const body = K.paint(o.color || K.C.cream, 0.5)
    const acc = K.paint(o.accent || K.C.teal, 0.45)
    return { g, M, body, acc, w, d }
  }
  function finish(m, o, lightAt) {
    const sl = lightAt ? K.stackLight(m.g, ...lightAt) : null
    const anim = m.anim
    m.anim = (s) => { if (sl) sl.set(s.state, s.t); if (anim) anim(s) }
    K.freeze(m.g)
    return m
  }
  const workFixed = (x, y, z) => () => V(x, y, z)
  K.finish = finish
  K.sideBase = sideBase
  K.workFixed = workFixed

  // ---- CNC machining centre / lathe
  K.def('cnc', (o) => {
    const w = 2.6, d = 2.2
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, w, 0.35, d, M.dark, 0, 0, 0, { r: 0.05 })
    K.box(g, w, 1.9, d - 0.2, body, 0, 0.35, 0.1, { r: 0.08 })
    K.box(g, w + 0.02, 0.22, d - 0.18, acc, 0, 2.0, 0.1, { r: 0.05 })
    // window on the loading face (-z)
    const win = K.box(g, 1.3, 0.85, 0.04, K.glass('#cfe3ea', 0.35), -0.15, 0.95, -d / 2 + 0.06, { r: 0.01 })
    win.castShadow = false
    K.box(g, 1.42, 0.06, 0.06, M.dark, -0.15, 1.82, -d / 2 + 0.06)
    K.box(g, 1.42, 0.06, 0.06, M.dark, -0.15, 0.9, -d / 2 + 0.06)
    // interior: lit chamber, table, spindle
    const lit = K.box(g, 1.25, 0.04, 1.2, K.emit('#fff2d0', 0.6), -0.15, 1.72, 0.0, { r: 0 })
    lit.castShadow = false
    K.box(g, 1.2, 0.08, 0.9, M.steel, -0.15, 0.82, 0.0)
    const head = K.live(K.group(g, -0.15, 1.2, 0))
    K.box(head, 0.32, 0.45, 0.32, M.dark, 0, 0.15, 0, { r: 0.04 })
    const spindle = K.cyl(head, 0.05, 0.25, M.chrome, 0, -0.12, 0, { seg: 10 })
    // control and chip conveyor
    K.panel(g, w / 2 + 0.2, 0, -0.6, -Math.PI / 2 + 0.4, 'graph')
    K.box(g, 0.5, 0.9, 0.5, M.dark, w / 2 + 0.25, 0, 0.6, { r: 0.03 })
    K.box(g, 0.6, 0.35, 0.6, K.paint('#5b6168', 0.6), w / 2 + 0.25, 0, 0.6)
    K.box(g, 0.3, 0.8, 0.3, K.paint(K.C.green, 0.5), -w / 2 - 0.2, 0, 0.7, { r: 0.04 })
    K.bolts(g, [[-1.1, -0.9], [1.1, -0.9], [-1.1, 1.0], [1.1, 1.0]], 0.35)
    for (let i = 0; i < 5; i++) K.box(g, 0.04, 0.6, 0.02, M.dark, 0.9 + i * 0.06, 0.9, -d / 2 + 0.06)
    return finish({
      g, kind: 'side', w, d, h: 2.4, entry: V(-0.15, 0.9, -d / 2 - 0.1), work: workFixed(-0.15, 0.9, 0),
      anim(s) {
        const busy = s.state === 'busy'
        head.position.x = -0.15 + (busy ? Math.sin(s.t * 1.3 + s.k) * 0.35 : 0)
        head.position.z = busy ? Math.cos(s.t * 0.9 + s.k) * 0.2 : 0
        head.position.y = 1.2 + (busy ? -0.1 + Math.sin(s.t * 4) * 0.05 : 0.15)
        if (busy) spindle.rotation.y += s.dt * 60
      },
    }, o, [w / 2 - 0.25, 2.22, -d / 2 + 0.3])
  })

  // ---- press (and magnetizer variant)
  K.def('press', (o) => {
    const w = 2.0, d = 2.0
    const { g, M, body, acc } = sideBase(o, w, d)
    if (o.variant === 'magnetizer') {
      K.box(g, 1.6, 1.0, 1.4, body, 0, 0, 0.2, { r: 0.06 })
      K.box(g, 1.2, 1.6, 0.6, acc, 0, 0, 0.7, { r: 0.06 })
      K.cyl(g, 0.38, 0.3, M.copper, 0, 1.0, 0.0, { seg: 28 })
      const glow = K.live(K.group(g, 0, 1.33, 0))
      const gm = K.unique(K.emit('#6fb8ff', 0))
      const ring = K.tor(glow, 0.3, 0.04, gm, 0, 0, 0, { rx: Math.PI / 2 })
      ring.castShadow = false
      K.panel(g, -1.0, 0, -0.5, 0.3, 'bars')
      return finish({ g, kind: 'side', w, d, h: 1.6, entry: V(0, 1.3, -1.1), work: workFixed(0, 1.31, 0), anim(s) { gm.emissiveIntensity = s.state === 'busy' ? Math.max(0, Math.sin(s.p * Math.PI)) * 6 : 0 } }, o, [0.5, 1.6, 0.9])
    }
    K.box(g, 1.8, 0.7, 1.4, M.dark, 0, 0, 0.1, { r: 0.05 })
    for (const sx of [-1, 1]) K.box(g, 0.32, 2.6, 0.5, body, sx * 0.65, 0.7, 0.35, { r: 0.05 })
    K.box(g, 1.8, 0.7, 1.0, body, 0, 3.2, 0.25, { r: 0.06 })
    K.box(g, 1.82, 0.16, 1.02, acc, 0, 3.55, 0.25, { r: 0.04 })
    const fly = K.live(K.group(g, 0.95, 3.55, 0.3))
    K.cyl(fly, 0.55, 0.18, M.dark, 0, 0, 0, { axis: 'x', seg: 28 })
    K.box(fly, 0.2, 0.2, 1.0, M.steel, 0, 0, 0)
    K.box(g, 1.0, 0.12, 0.9, M.steel, 0, 0.7, 0.0)
    const ram = K.live(K.group(g, 0, 2.6, 0.05))
    K.box(ram, 1.0, 0.45, 0.8, M.steel, 0, -0.45, 0, { r: 0.03 })
    K.box(ram, 0.7, 0.2, 0.6, M.dark, 0, -0.65, 0)
    // light curtain posts and coil feeder
    for (const sx of [-1, 1]) K.box(g, 0.06, 1.6, 0.06, M.yellow, sx * 0.62, 0, -0.75)
    const coil = K.live(K.group(g, -1.55, 0.8, 0))
    K.cyl(coil, 0.6, 0.35, M.steel, 0, 0, 0, { axis: 'z', seg: 30 })
    K.cyl(coil, 0.22, 0.4, M.dark, 0, 0, 0, { axis: 'z', seg: 16 })
    K.box(g, 0.3, 0.6, 0.6, M.dark, -1.55, 0, 0)
    K.panel(g, 1.1, 0, -0.8, -0.5, 'bars')
    return finish({
      g, kind: 'side', w, d, h: 3.6, entry: V(0, 0.9, -1.1), work: workFixed(0, 0.83, 0),
      anim(s) {
        const run = s.state === 'busy'
        if (run || s.state === 'blocked') fly.rotation.x += s.dt * 6
        const ph = run ? (s.t * 1.6 + s.k * 0.3) % 1 : 0
        ram.position.y = 2.6 - (run ? Math.pow(Math.max(0, Math.sin(ph * Math.PI)), 3) * 0.95 : 0)
        if (run) coil.rotation.z += s.dt * 0.6
      },
    }, o, [-0.75, 3.9, -0.1])
  })

  // ---- needle winder
  K.def('winder', (o) => {
    const w = 1.8, d = 1.7
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, 1.7, 0.95, 1.5, body, 0, 0, 0.05, { r: 0.06 })
    K.box(g, 1.72, 0.08, 1.52, acc, 0, 0.95, 0.05, { r: 0.02 })
    const table = K.live(K.group(g, 0, 1.03, -0.15))
    K.cyl(table, 0.36, 0.08, M.steel, 0, 0, 0, { seg: 28 })
    for (let i = 0; i < 3; i++) K.box(table, 0.1, 0.12, 0.1, M.dark, Math.cos((i / 3) * TAU) * 0.27, 0.08, Math.sin((i / 3) * TAU) * 0.27)
    K.box(g, 0.25, 1.4, 0.25, M.dark, 0, 0.95, 0.55, { r: 0.03 })
    K.box(g, 0.9, 0.22, 0.28, body, 0, 2.15, 0.45, { r: 0.04 })
    const nozzle = K.live(K.group(g, 0, 1.75, 0.0))
    K.box(nozzle, 0.14, 0.4, 0.14, M.chrome, 0, -0.2, 0, { r: 0.02 })
    for (let i = -1; i <= 1; i++) K.cyl(nozzle, 0.012, 0.18, M.copper, i * 0.05, -0.38, 0, { seg: 6 })
    const spools = K.live(K.group(g, 0, 2.37, 0.45))
    for (let i = -1; i <= 1; i++) K.spool(spools, i * 0.3, 0, 0, 0.11)
    const glass = K.box(g, 1.3, 0.9, 1.0, K.glass('#d9eef2', 0.18), 0, 1.03, -0.15, { r: 0.02 })
    glass.castShadow = false
    K.panel(g, -1.05, 0, -0.4, 0.5, 'graph')
    return finish({
      g, kind: 'side', w, d, h: 2.5, entry: V(0, 1.1, -0.95), work: workFixed(0, 1.11, -0.15),
      anim(s) {
        const run = s.state === 'busy'
        if (run) { table.rotation.y += s.dt * 9; spools.rotation.y += s.dt * 2 }
        nozzle.position.y = 1.75 + (run ? Math.sin(s.t * 18) * 0.06 : 0.1)
      },
    }, o, [0.7, 2.37, 0.6])
  })

  // ---- robot cell (pick, process, place); variant 'weld' adds sparks
  K.def('robot', (o) => {
    const w = 3.0, d = 2.8
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, w, 0.04, d, K.paint('#9aa0a6', 0.7), 0, 0, 0, { r: 0.01 })
    K.fence(g, w, d, 1.7, 'nz', 1.6)
    K.box(g, 1.0, 0.8, 0.8, M.dark, -0.5, 0, -0.55, { r: 0.04 })
    K.box(g, 0.9, 0.05, 0.7, M.steel, -0.5, 0.8, -0.55)
    K.box(g, 0.8, 0.85, 0.8, body, 0.7, 0, 0.6, { r: 0.04 })
    const arm = K.arm(g, 0.6, 0, -0.25 + 0.2, o.accent || K.C.orange, 0.95)
    K.live(arm.g)
    const weld = o.variant === 'weld'
    let sparks = null, arc = null
    if (weld) {
      const sm = K.emit('#ffd27a', 5)
      sparks = K.live(K.group(g, -0.5, 0.95, -0.55))
      for (let i = 0; i < 14; i++) { const m = K.box(sparks, 0.02, 0.02, 0.02, sm, 0, 0, 0, { r: 0 }); m.castShadow = false }
      arc = K.unique(K.emit('#9fd0ff', 0))
      const am = K.sph(g, 0.06, arc, -0.5, 0.92, -0.55)
      am.castShadow = false
      K.live(am)
      K.cyl(g, 0.15, 1.6, M.yellow, 1.25, 0, -1.1, { seg: 12 })
    }
    K.panel(g, 1.65, 0, -0.9, -0.6, weld ? 'bars' : 'graph')
    const keys = [[-0.6, -0.5, 1.3], [-0.9, -0.9, 1.7], [-1.0, -1.0, 1.9], [-0.9, -0.6, 1.5]]
    return finish({
      g, kind: 'side', w, d, h: 2.0, entry: V(-0.5, 0.9, -d / 2 - 0.1), work: workFixed(-0.5, 0.86, -0.55),
      anim(s) {
        const run = s.state === 'busy'
        const t = run ? s.t * 1.4 + s.k : 0
        const a0 = -1.0 + Math.sin(t * 0.8) * 0.5
        arm.pose(a0, run ? 0.5 + Math.sin(t) * 0.25 : 0.2, run ? 1.4 + Math.sin(t * 1.3) * 0.3 : 1.9, 0, run ? 0.9 + Math.sin(t * 2) * 0.2 : 1.2, run ? 0.6 : 0)
        if (weld) {
          const on = run && Math.sin(s.t * 9) > -0.3
          arc.emissiveIntensity = on ? 4 + Math.random() * 6 : 0
          sparks.visible = on
          if (on) sparks.children.forEach((m, i) => { const a = (i * 2.4 + s.t * 30) % 1; m.position.set(Math.sin(i * 7.1) * a * 0.4, Math.max(0, 0.2 * a - a * a * 0.5), Math.cos(i * 3.3) * a * 0.4) })
        }
      },
    }, o, [-1.4, 1.75, -1.3])
  })

  // ---- assembly bench with an operator
  K.def('bench', (o) => {
    const w = 2.2, d = 1.8
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, 1.8, 0.06, 0.9, K.paint('#d9cfb8', 0.8), 0, 0.88, -0.35, { r: 0.01 })
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(g, 0.05, 0.88, 0.05, M.dark, sx * 0.85, 0, -0.35 + sz * 0.4)
    K.box(g, 1.7, 0.04, 0.8, M.dark, 0, 0.3, -0.35)
    // overhead frame, lamp and tool balancer
    for (const sx of [-1, 1]) K.box(g, 0.05, 2.2, 0.05, M.dark, sx * 0.85, 0, 0.12)
    K.box(g, 1.75, 0.06, 0.06, M.dark, 0, 2.2, 0.12)
    const lamp = K.box(g, 1.4, 0.05, 0.16, K.emit('#fff4dc', 1.4), 0, 2.1, -0.05, { r: 0.01 })
    lamp.castShadow = false
    const tool = K.live(K.group(g, 0.25, 2.15, -0.25))
    K.cyl(tool, 0.006, 0.8, M.dark, 0, -0.8, 0, { seg: 4 })
    K.box(tool, 0.06, 0.22, 0.06, M.yellow, 0, -1.02, 0, { r: 0.015 })
    // parts bins on a rail
    const cols = [K.C.blue, K.C.red, K.C.yellow, K.C.blue, K.C.green]
    for (let i = 0; i < 5; i++) K.bin(g, -0.7 + i * 0.35, 1.25, 0.08, cols[i], 0.26)
    K.box(g, 1.75, 0.04, 0.3, M.steel, 0, 1.22, 0.08)
    K.box(g, 0.5, 0.06, 0.4, M.steel, 0, 0.94, -0.4, { r: 0.01 })
    K.box(g, 0.3, 0.2, 0.25, K.screenMat('list', '#9be7ff'), -0.65, 0.94, -0.2, { r: 0.01 }).castShadow = false
    const op = K.person(g, { seed: o.seed || 3 })
    K.live(op.g)
    op.g.position.set(0, 0, 0.55)
    op.g.rotation.y = Math.PI
    return finish({
      g, kind: 'side', w, d, h: 2.3, entry: V(-0.3, 0.95, -d / 2 - 0.1), work: workFixed(0, 0.94, -0.4),
      anim(s) {
        const run = s.state === 'busy'
        op.pose(run ? 'work' : 'stand', s.t + s.k)
        tool.position.y = 2.15 + (run ? Math.sin(s.t * 2.2 + s.k) * 0.12 - 0.1 : 0)
      },
    }, o, null)
  })

  // ---- test station
  K.def('tester', (o) => {
    const w = 2.2, d = 1.8
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, 1.3, 0.9, 1.0, body, -0.4, 0, -0.25, { r: 0.05 })
    K.box(g, 1.32, 0.06, 1.02, acc, -0.4, 0.9, -0.25, { r: 0.02 })
    K.box(g, 0.75, 2.0, 0.8, M.dark, 0.65, 0, 0.3, { r: 0.04 })
    for (let i = 0; i < 4; i++) K.box(g, 0.6, 0.3, 0.02, i % 2 ? K.screenMat('graph', '#7fe3c4') : K.screenMat('bars', '#f2c14e'), 0.65, 0.35 + i * 0.4, -0.11, { r: 0 }).castShadow = false
    for (let i = 0; i < 2; i++) K.box(g, 0.05, 1.3, 0.05, M.steel, -0.75 + i * 0.7, 0.96, -0.1)
    K.box(g, 0.85, 0.12, 0.3, M.steel, -0.4, 2.2, -0.1)
    const clamp_ = K.live(K.group(g, -0.4, 1.7, -0.3))
    K.box(clamp_, 0.36, 0.3, 0.36, M.dark, 0, 0, 0, { r: 0.03 })
    K.cyl(clamp_, 0.04, 0.5, M.chrome, 0, 0.3, 0, { seg: 10 })
    const res = K.live(K.group(g, -0.4, 0.97, 0.15))
    const okM = K.unique(K.emit('#47d77a', 0))
    K.box(res, 0.5, 0.04, 0.1, okM, 0, 0, 0, { r: 0.01 }).castShadow = false
    const cable = K.tor(g, 0.4, 0.02, M.black, 0.1, 1.2, -0.3, { arc: 0.5, rz: Math.PI })
    return finish({
      g, kind: 'side', w, d, h: 2.4, entry: V(-0.4, 1.0, -d / 2 - 0.1), work: workFixed(-0.4, 0.97, -0.3),
      anim(s) {
        const run = s.state === 'busy'
        clamp_.position.y = 1.7 - (run ? ease(clamp(s.p * 6, 0, 1)) * (1 - ease(clamp((s.p - 0.85) * 7, 0, 1))) * 0.42 : 0)
        okM.emissiveIntensity = run && s.p > 0.85 ? 3.5 : s.state === 'blocked' ? 2 : 0.0
      },
    }, o, [0.95, 2.0, 0.6])
  })

  // ---- packer: box erector + case sealer, inline
  K.def('packer', (o) => {
    const L = 4.2, d = 1.6
    const g = new T.Group(), M = K.M(), body = K.paint(o.color || K.C.cream, 0.5), acc = K.paint(o.accent || K.C.blue, 0.45)
    K.box(g, L, 0.8, 1.1, body, 0, 0, 0, { r: 0.05 })
    const belt = K.mesh(g, new T.BoxGeometry(L, 0.04, 0.6), K.beltMat(), 0, 0.84, 0)
    belt.userData.keep = true
    K.box(g, 1.6, 1.0, 1.25, K.glass('#d9eef2', 0.2), 0.6, 0.86, 0, { r: 0.02 }).castShadow = false
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(g, 0.06, 1.0, 0.06, acc, 0.6 + sx * 0.8, 0.86, sz * 0.62)
    K.box(g, 1.7, 0.12, 1.3, acc, 0.6, 1.86, 0, { r: 0.03 })
    const head = K.live(K.group(g, 0.6, 1.7, 0))
    K.box(head, 0.5, 0.25, 0.5, M.dark, 0, 0, 0, { r: 0.03 })
    K.cyl(head, 0.04, 0.35, M.chrome, 0, -0.35, 0, { seg: 8 })
    // flat carton magazine
    K.box(g, 0.9, 1.1, 0.5, M.dark, -1.2, 0.0, 0.85)
    for (let i = 0; i < 8; i++) K.box(g, 0.8, 0.02, 0.45, M.card, -1.2, 1.12 + i * 0.03, 0.85, { r: 0 })
    const tape = K.live(K.group(g, 1.65, 1.2, 0))
    K.cyl(tape, 0.12, 0.08, K.paint('#d9c9a5', 0.5), 0, 0, 0, { axis: 'z', seg: 18 })
    K.panel(g, -1.6, 0, -0.95, 0.2, 'list')
    return finish({
      g, kind: 'inline', w: L, d, h: 2.0, entry: V(-L / 2, 0.86, 0), exit: V(L / 2, 0.86, 0),
      work: (i, p) => V(-L / 2 + 0.3 + p * (L - 0.6), 0.86, 0),
      anim(s) { const run = s.state === 'busy'; head.position.y = 1.7 - (run ? Math.max(0, Math.sin(s.t * 5)) * 0.3 : 0); if (run) tape.rotation.z -= s.dt * 4 },
    }, o, [-1.9, 0.8, -0.45])
  })

  // ---- batch chamber oven (curing, drying, proofing, ageing) holding many units on carts
  K.def('oven', (o) => {
    const n = Math.max(1, o.batch || 1)
    const cols = Math.ceil(Math.sqrt(n * 1.6)), rows = Math.ceil(n / cols)
    const sp = 0.42
    const W = Math.max(2.8, cols * sp + 1.2), D = Math.max(2.4, rows * sp + 1.0), H = o.variant === 'proofer' ? 2.6 : 2.8
    const g = new T.Group(), M = K.M()
    const body = K.paint(o.color || (o.variant === 'proofer' ? '#e4e2da' : '#c9ced2'), o.variant === 'proofer' ? 0.5 : 0.4, o.variant === 'proofer' ? 0 : 0.35)
    const acc = K.paint(o.accent || K.C.orange, 0.45)
    K.box(g, W, 0.2, D, M.dark, 0, 0, 0, { r: 0.03 })
    // walls, roof; the front (-z) is glass so the load reads
    K.box(g, W, H, 0.15, body, 0, 0.2, D / 2 - 0.075, { r: 0.03 })
    for (const sx of [-1, 1]) K.box(g, 0.15, H, D, body, sx * (W / 2 - 0.075), 0.2, 0, { r: 0.03 })
    K.box(g, W, 0.2, D, body, 0, H + 0.2, 0, { r: 0.04 })
    K.box(g, W + 0.04, 0.16, 0.1, acc, 0, H + 0.24, -D / 2 - 0.02, { r: 0.03 })
    for (let i = 0; i < Math.floor(W / 1.2); i++) K.box(g, 0.5, 0.08, D - 0.6, K.paint('#aab0b5', 0.5, 0.3), -W / 2 + 0.8 + i * 1.2, H + 0.4, 0, { r: 0.02 })
    const glow = K.unique(K.emit(o.variant === 'proofer' ? '#ffd9a0' : '#ff8a3a', 0.2))
    const gl = K.box(g, W - 0.4, 0.05, D - 0.4, glow, 0, H + 0.12, 0, { r: 0 })
    gl.castShadow = false
    K.live(gl)
    const doorG = K.box(g, W - 0.3, H - 0.1, 0.05, K.glass(o.variant === 'proofer' ? '#e8f4f6' : '#ffd2a8', 0.25), 0, 0.25, -D / 2 + 0.05, { r: 0.01 })
    doorG.castShadow = false
    for (const sx of [-1, 1]) K.box(g, 0.08, H, 0.08, M.dark, sx * (W / 2 - 0.2), 0.2, -D / 2 + 0.05)
    // racks inside
    for (let r = 0; r < rows; r++) K.box(g, cols * sp, 0.03, 0.34, M.steel, 0, 0.75, -D / 2 + 0.6 + r * sp, { r: 0 })
    // chimney, burner box, panel
    K.cyl(g, 0.16, 1.2, M.steel, W / 2 - 0.5, H + 0.5, D / 2 - 0.5, { seg: 14 })
    K.box(g, 0.8, 1.3, 0.7, acc, W / 2 + 0.45, 0, D / 2 - 0.5, { r: 0.04 })
    K.panel(g, -W / 2 - 0.3, 0, -D / 2 + 0.4, 0.3, 'graph')
    return finish({
      g, kind: 'side', w: W, d: D, h: H + 0.5, entry: V(0, 0.8, -D / 2 - 0.15),
      work: (i) => V(-((cols - 1) * sp) / 2 + (i % cols) * sp, 0.79, -D / 2 + 0.6 + Math.floor(i / cols) * sp),
      anim(s) { glow.emissiveIntensity = s.state === 'busy' ? 1.0 + Math.sin(s.t * 3) * 0.15 : 0.1 },
    }, o, [-W / 2 + 0.3, H + 0.52, -D / 2 + 0.3])
  })

  // ---- tunnel (continuous) oven, pasteuriser, dryer: units ride through on a belt
  K.def('tunnel', (o) => {
    const L = o.length || 9, d = 1.8, H = 1.7
    const g = new T.Group(), M = K.M()
    const steam = o.variant === 'pasteurizer' || o.variant === 'washer'
    const body = K.paint(o.color || (steam ? '#c9d4da' : '#c4c9cd'), 0.35, 0.4)
    const acc = K.paint(o.accent || (steam ? K.C.blue : K.C.orange), 0.45)
    const belt = K.mesh(g, new T.BoxGeometry(L + 2, 0.05, 1.0), K.beltMat(), 0, 0.82, 0)
    belt.userData.keep = true
    for (let i = 0; i <= 6; i++) for (const sz of [-1, 1]) K.box(g, 0.08, 0.82, 0.08, M.dark, -L / 2 - 1 + ((L + 2) * i) / 6, 0, sz * 0.5)
    // hood in sections, each with a gauge and a window
    const nsec = Math.max(3, Math.round(L / 2.2))
    const winM = K.unique(K.emit(steam ? '#9fd6ff' : '#ff7a2a', 0.2))
    for (let i = 0; i < nsec; i++) {
      const x = -L / 2 + (L / nsec) * (i + 0.5), sw = L / nsec - 0.06
      K.box(g, sw, H - 0.9, d, body, x, 0.88, 0, { r: 0.05 })
      K.box(g, sw + 0.02, 0.1, 0.08, acc, x, H - 0.12, -d / 2 - 0.02, { r: 0.02 })
      K.box(g, sw - 0.3, 0.06, d - 0.5, K.paint('#9aa1a7', 0.4, 0.4), x, H - 0.02, 0, { r: 0.02 })
      const wm = K.box(g, sw * 0.6, 0.18, 0.02, winM, x, 1.2, -d / 2 - 0.005, { r: 0 })
      wm.castShadow = false
      K.cyl(g, 0.07, 0.04, M.white, x + sw * 0.38, 1.3, -d / 2 - 0.01, { axis: 'z', seg: 14 })
      if (i % 2 === 0) K.cyl(g, 0.12, 0.6, M.steel, x, H + 0.08, 0.3, { seg: 12 })
    }
    const burners = []
    for (let i = 0; i < 3; i++) burners.push(K.box(g, 0.6, 0.7, 0.5, acc, -L / 2 + 1 + i * (L / 3), 0, d / 2 + 0.35, { r: 0.04 }))
    K.panel(g, -L / 2 - 0.4, 0, -d / 2 - 0.3, 0.2, 'graph')
    let puffs = null
    if (steam) {
      puffs = K.live(K.group(g, 0, H + 0.1, 0))
      const pm = new T.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, roughness: 1, depthWrite: false })
      for (let i = 0; i < 8; i++) K.sph(puffs, 0.22, pm, 0, 0, 0).castShadow = false
    }
    return finish({
      g, kind: 'inline', w: L + 2, d, h: H + 0.6, entry: V(-L / 2 - 1, 0.85, 0), exit: V(L / 2 + 1, 0.85, 0),
      work: (i, p) => V(-L / 2 - 0.6 + p * (L + 1.2), 0.85, ((i % 3) - 1) * 0.28),
      anim(s) {
        winM.emissiveIntensity = s.busy ? 2.2 + Math.sin(s.t * 2) * 0.2 : 0.2
        if (puffs) puffs.children.forEach((m, i) => { const a = (s.t * 0.25 + i / 8) % 1; m.position.set(-L / 2 + (i / 8) * L, a * 1.6, 0.3); m.scale.setScalar(0.5 + a * 1.2); m.material.opacity = s.busy ? 0.35 * (1 - a) : 0 })
      },
    }, o, [-L / 2 + 0.3, H + 0.1, -d / 2 + 0.2])
  })

  // ---- spiral (cooling / freezing / proofing tower), inline
  K.def('spiral', (o) => {
    const R = 1.9, H = 3.4, turns = 5
    const g = new T.Group(), M = K.M()
    const acc = K.paint(o.accent || K.C.teal, 0.45)
    K.cyl(g, 0.5, H + 0.4, M.steel, 0, 0, 0, { seg: 20 })
    const drum = K.live(K.group(g))
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; K.box(drum, 0.06, H + 0.2, 0.06, M.steel, Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9, { r: 0.01 }) }
    // helical belt as stepped segments
    const segN = turns * 24
    const beltM = K.paint('#d6dade', 0.45, 0.3)
    for (let i = 0; i < segN; i++) {
      const a = (i / 24) * TAU, y = 0.5 + (i / segN) * H
      const m = K.box(g, 1.1, 0.04, 0.55, beltM, Math.cos(a) * (R - 0.3), y, Math.sin(a) * (R - 0.3), { r: 0, ry: -a })
      m.castShadow = i % 3 === 0
    }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; K.box(g, 0.08, H + 0.8, 0.08, acc, Math.cos(a) * (R + 0.1), 0, Math.sin(a) * (R + 0.1), { r: 0.01 }) }
    K.tor(g, R + 0.1, 0.05, acc, 0, H + 0.8, 0, { rx: Math.PI / 2 })
    K.tor(g, R + 0.1, 0.05, acc, 0, 0.3, 0, { rx: Math.PI / 2 })
    const fan = K.live(K.group(g, 0, H + 0.95, 0))
    K.cyl(fan, 0.7, 0.2, K.paint('#d4d8dc', 0.4), 0, 0, 0, { seg: 24 })
    for (let i = 0; i < 4; i++) K.box(fan, 1.1, 0.02, 0.14, M.dark, 0, 0.22, 0, { ry: (i * Math.PI) / 4, r: 0 })
    // infeed and outfeed
    const inf = K.mesh(g, new T.BoxGeometry(1.6, 0.05, 0.55), K.beltMat(), -R - 0.6, 0.5, -R + 0.3)
    inf.userData.keep = true
    const outf = K.mesh(g, new T.BoxGeometry(1.6, 0.05, 0.55), K.beltMat(), R + 0.6, H + 0.5, -R + 0.3)
    outf.userData.keep = true
    K.box(g, 0.08, H + 0.5, 0.08, M.dark, R + 1.3, 0, -R + 0.3)
    const at = (p) => {
      const a = -Math.PI / 2 + p * turns * TAU
      return V(Math.cos(a) * (R - 0.3), 0.55 + p * H, Math.sin(a) * (R - 0.3))
    }
    return finish({
      g, kind: 'inline', w: 2 * R + 2.6, d: 2 * R + 0.4, h: H + 1.2, entry: V(-R - 1.3, 0.55, -R + 0.3), exit: V(R + 1.3, H + 0.55, -R + 0.3),
      work: (i, p) => at(p),
      anim(s) { if (s.busy) { drum.rotation.y += s.dt * 0.6; fan.rotation.y += s.dt * 8 } },
    }, o, [R + 0.2, H + 0.8, R * 0.7])
  })

  // ---- mixer (spiral dough mixer, slurry mixer with variant 'planetary')
  K.def('mixer', (o) => {
    const w = 2.4, d = 2.2
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, 1.2, 1.0, 1.6, body, 0.45, 0, 0.2, { r: 0.08 })
    K.box(g, 1.2, 0.7, 1.7, body, 0.1, 1.55, 0.15, { r: 0.1 })
    K.box(g, 1.22, 0.1, 1.72, acc, 0.1, 2.2, 0.15, { r: 0.03 })
    K.box(g, 0.5, 0.6, 0.5, body, 0.45, 1.0, 0.65, { r: 0.05 })
    const bowl = K.live(K.group(g, -0.25, 0.55, -0.25))
    K.cyl(bowl, 0.62, 0.7, M.chrome, 0, 0, 0, { r2: 0.5, seg: 32 })
    K.cyl(bowl, 0.56, 0.02, K.paint(o.fill || '#ead9b4', 0.9), 0, 0.55, 0, { seg: 28 })
    K.cyl(g, 0.5, 0.55, M.dark, -0.25, 0, -0.25, { seg: 24 })
    const hook = K.live(K.group(g, -0.25, 1.55, -0.25))
    K.cyl(hook, 0.05, 0.6, M.chrome, 0.15, -0.6, 0, { seg: 8 })
    K.tor(hook, 0.15, 0.03, M.chrome, 0.0, -0.55, 0, { arc: 0.6, rx: Math.PI / 2 })
    K.panel(g, 1.25, 0, -0.6, -0.4, 'bars')
    for (let i = 0; i < 3; i++) K.box(g, 0.6, 0.25, 0.4, K.paint('#efe9da', 0.9), -0.8, i * 0.25, 0.75, { r: 0.08 })
    return finish({
      g, kind: 'side', w, d, h: 2.4, entry: V(-0.25, 1.15, -d / 2 - 0.1), work: workFixed(-0.25, 1.12, -0.25),
      anim(s) { if (s.state === 'busy') { bowl.rotation.y += s.dt * 2; hook.rotation.y -= s.dt * 7 } },
    }, o, [0.9, 2.3, 0.8])
  })

  // ---- sheeter / laminator / slitter / calender: rolls over a belt, inline
  K.def('rollers', (o) => {
    const L = o.length || 5, d = 1.8
    const g = new T.Group(), M = K.M()
    const body = K.paint(o.color || K.C.cream, 0.5), acc = K.paint(o.accent || K.C.blue, 0.45)
    const big = o.variant === 'calender'
    K.box(g, L, 0.75, 1.3, body, 0, 0, 0, { r: 0.05 })
    const belt = K.mesh(g, new T.BoxGeometry(L, 0.05, 0.95), K.beltMat(), 0, 0.78, 0)
    belt.userData.keep = true
    const rolls = K.live(K.group(g))
    const n = big ? 1 : 3
    for (let i = 0; i < n; i++) {
      const x = big ? 0 : -L / 2 + (L * (i + 1)) / (n + 1)
      const r = big ? 0.42 : 0.16
      for (const sz of [-1, 1]) K.box(g, 0.22, big ? 2.4 : 1.2, 0.22, acc, x, 0.75, sz * 0.72, { r: 0.03 })
      K.cyl(rolls, r, 1.3, M.chrome, x, 0.8 + r + 0.02, 0, { axis: 'z', seg: 28 })
      if (big) K.cyl(rolls, r, 1.3, M.chrome, x, 0.8 + r * 3 + 0.08, 0, { axis: 'z', seg: 28 })
      K.box(g, 0.3, 0.2, 1.66, acc, x, big ? 3.1 : 1.95, 0, { r: 0.03 })
    }
    if (o.variant === 'slitter') for (let i = 0; i < 5; i++) K.cyl(g, 0.12, 0.02, M.chrome, L * 0.3, 0.95, -0.4 + i * 0.2, { axis: 'z', seg: 18 })
    const sheet = K.box(g, L * 0.9, 0.02, 0.8, K.paint(o.web || '#e8d6a8', 0.8), 0, 0.81, 0, { r: 0 })
    K.panel(g, -L / 2 - 0.3, 0, -0.9, 0.3, 'graph')
    return finish({
      g, kind: 'inline', w: L, d, h: big ? 3.3 : 2.2, entry: V(-L / 2, 0.84, 0), exit: V(L / 2, 0.84, 0),
      work: (i, p) => V(-L / 2 + 0.3 + p * (L - 0.6), 0.84, 0),
      anim(s) { if (s.busy) rolls.children.forEach((m) => (m.rotation.y += s.dt * 5)) },
    }, o, [L / 2 - 0.3, 0.75, 0.55])
  })

  // ---- roll to roll coater with a long drying oven, inline
  K.def('coater', (o) => {
    const L = o.length || 14, d = 2.4
    const g = new T.Group(), M = K.M()
    const body = K.paint(o.color || '#e7e4dc', 0.45), acc = K.paint(o.accent || K.C.teal, 0.45)
    const unw = K.live(K.group(g, -L / 2 + 0.8, 1.3, 0))
    K.cyl(unw, 0.6, 1.4, M.copper, 0, 0, 0, { axis: 'z', seg: 30 })
    K.cyl(unw, 0.12, 1.7, M.steel, 0, 0, 0, { axis: 'z', seg: 12 })
    for (const sz of [-1, 1]) K.box(g, 0.3, 1.5, 0.2, acc, -L / 2 + 0.8, 0, sz * 0.95, { r: 0.03 })
    K.box(g, 1.2, 1.9, 1.8, body, -L / 2 + 2.6, 0, 0, { r: 0.06 })
    K.box(g, 1.22, 0.12, 1.82, acc, -L / 2 + 2.6, 1.9, 0, { r: 0.03 })
    const ovL = L - 6.2
    const nsec = Math.max(3, Math.round(ovL / 2.4))
    for (let i = 0; i < nsec; i++) {
      const x = -L / 2 + 3.6 + (ovL / nsec) * (i + 0.5)
      K.box(g, ovL / nsec - 0.06, 1.6, 1.6, body, x, 0.4, 0, { r: 0.05 })
      K.box(g, ovL / nsec - 0.04, 0.12, 1.62, acc, x, 2.0, 0, { r: 0.02 })
      K.cyl(g, 0.15, 0.7, M.steel, x, 2.1, 0.4, { seg: 12 })
      K.box(g, 0.4, 0.25, 0.02, K.screenMat('bars', '#7fe3c4'), x, 1.4, -0.81, { r: 0 }).castShadow = false
    }
    const web = K.box(g, L - 1.6, 0.01, 1.2, K.paint('#3a3c40', 0.5, 0.3), 0, 1.3, 0, { r: 0 })
    const rew = K.live(K.group(g, L / 2 - 0.8, 1.3, 0))
    K.cyl(rew, 0.45, 1.3, K.paint('#2c2e33', 0.4, 0.4), 0, 0, 0, { axis: 'z', seg: 30 })
    K.cyl(rew, 0.12, 1.7, M.steel, 0, 0, 0, { axis: 'z', seg: 12 })
    for (const sz of [-1, 1]) K.box(g, 0.3, 1.5, 0.2, acc, L / 2 - 0.8, 0, sz * 0.95, { r: 0.03 })
    K.panel(g, -L / 2 + 2.6, 0, -1.4, 0.2, 'graph')
    return finish({
      g, kind: 'inline', w: L, d, h: 2.3, entry: V(-L / 2, 1.3, 0), exit: V(L / 2, 1.3, 0),
      work: (i, p) => V(-L / 2 + 0.8 + p * (L - 1.6), 1.32, 0),
      anim(s) { if (s.busy) { unw.rotation.z -= s.dt * 1.2; rew.rotation.z -= s.dt * 1.5 } },
    }, o, [-L / 2 + 3.1, 2.0, -0.7])
  })

  // ---- rotary filler / seamer / capper (in a dry-room glass box for 'electrolyte')
  K.def('filler', (o) => {
    const w = 2.6, d = 2.4
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, 2.0, 0.9, 1.8, body, 0, 0, 0, { r: 0.06 })
    K.box(g, 2.02, 0.08, 1.82, acc, 0, 0.9, 0, { r: 0.02 })
    const star = K.live(K.group(g, 0, 0.98, -0.1))
    K.cyl(star, 0.7, 0.08, M.steel, 0, 0, 0, { seg: 32 })
    const nz = []
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU
      const n = K.group(star, Math.cos(a) * 0.58, 0.6, Math.sin(a) * 0.58)
      K.cyl(n, 0.035, 0.45, M.chrome, 0, 0, 0, { seg: 8 })
      nz.push(n)
    }
    K.cyl(g, 0.12, 1.5, M.steel, 0, 0.98, -0.1, { seg: 14 })
    K.cyl(g, 0.55, 0.35, M.chrome, 0, 2.3, -0.1, { seg: 28 })
    const box = K.box(g, 2.1, 1.7, 1.9, K.glass('#e2f2f4', 0.16), 0, 0.92, 0, { r: 0.03 })
    box.castShadow = false
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(g, 0.05, 1.7, 0.05, M.alu, sx * 1.05, 0.92, sz * 0.95)
    K.box(g, 2.12, 0.08, 1.92, M.alu, 0, 2.6, 0)
    K.panel(g, 1.4, 0, -0.8, -0.5, 'list')
    return finish({
      g, kind: 'side', w, d, h: 2.7, entry: V(-0.4, 1.06, -d / 2 - 0.1), work: workFixed(0.0, 1.06, -0.68),
      anim(s) {
        const run = s.state === 'busy'
        if (run) star.rotation.y += s.dt * 1.5
        nz.forEach((n, i) => (n.position.y = 0.6 - (run ? Math.max(0, Math.sin(s.t * 3 + i)) * 0.18 : 0)))
      },
    }, o, [0.9, 2.65, 0.8])
  })

  // ---- formation / ageing / burn-in racks: big batch, rows of blinking channels
  K.def('formation', (o) => {
    const n = Math.max(1, o.batch || 1)
    const cols = Math.min(10, Math.ceil(Math.sqrt(n * 2))), rows = Math.ceil(n / cols)
    const W = cols * 0.5 + 1.0, D = 2.2
    const g = new T.Group(), M = K.M()
    const body = K.paint(o.color || '#dfe2e4', 0.45), acc = K.paint(o.accent || K.C.green, 0.45)
    const lv = Math.min(5, rows)
    K.box(g, W, 0.2, D, M.dark, 0, 0, 0, { r: 0.02 })
    for (let i = 0; i <= cols; i += 2) for (const sz of [-1, 1]) K.box(g, 0.08, 2.6, 0.08, body, -W / 2 + 0.5 + i * 0.5 - 0.25, 0.2, sz * 0.75)
    for (let l = 0; l < lv; l++) K.box(g, W - 0.8, 0.05, 1.6, M.steel, 0, 0.5 + l * 0.48, 0, { r: 0 })
    K.box(g, W - 0.6, 0.15, 1.7, acc, 0, 2.8, 0, { r: 0.03 })
    const leds = []
    const ledOn = K.emit('#59f08c', 3), ledWarm = K.emit('#f2c14e', 3), ledOff = K.paint('#2a3a2e', 0.5)
    for (let l = 0; l < lv; l++) for (let i = 0; i < cols * 2; i++) {
      const m = K.box(g, 0.05, 0.03, 0.02, ledOff, -W / 2 + 0.5 + i * 0.25, 0.85 + l * 0.48, -0.82, { r: 0 })
      m.castShadow = false
      K.live(m)
      leds.push(m)
    }
    K.box(g, 0.9, 2.2, 0.9, M.dark, W / 2 + 0.5, 0, 0.3, { r: 0.04 })
    for (let i = 0; i < 3; i++) K.box(g, 0.6, 0.2, 0.02, K.screenMat('bars', '#59f08c'), W / 2 + 0.5, 0.6 + i * 0.5, -0.16, { r: 0 }).castShadow = false
    const per = Math.ceil(n / lv)
    return finish({
      g, kind: 'side', w: W + 1.0, d: D, h: 3.0, entry: V(0, 0.6, -D / 2 - 0.15),
      work: (i) => { const l = Math.floor(i / per) % lv, k = i % per; return V(-((Math.min(per, cols * 2) - 1) * 0.25) / 2 + (k % (cols * 2)) * 0.25, 0.53 + l * 0.48, -0.35 + Math.floor(k / (cols * 2)) * 0.3) },
      anim(s) {
        const run = s.busy
        leds.forEach((m, i) => (m.material = run ? ((Math.floor(s.t * 1.5 + i * 0.37) % 7) ? ledOn : ledWarm) : ledOff))
      },
    }, o, [-W / 2 + 0.3, 2.95, -0.7])
  })

  // ---- process tank / fermenter / reactor with agitator; side machine
  K.def('tank', (o) => {
    const R = o.radius || 1.1, H = o.height || 3.2
    const w = 2 * R + 1.0, d = 2 * R + 1.0
    const g = new T.Group(), M = K.M()
    const shell = K.metal(o.color || '#d8dcdf', 0.22)
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Math.PI / 4; K.cyl(g, 0.07, 1.0, M.steel, Math.cos(a) * R * 0.8, 0, Math.sin(a) * R * 0.8, { seg: 10 }) }
    K.cyl(g, R, 0.4, shell, 0, 0.8, 0, { r2: R * 0.4, seg: 36 }).rotation.x = Math.PI
    K.cyl(g, R, H, shell, 0, 1.2, 0, { seg: 36 })
    K.sph(g, R, shell, 0, 1.2 + H, 0, { half: true }).scale.y = 0.4
    for (let i = 1; i < 4; i++) K.tor(g, R + 0.01, 0.025, M.steel, 0, 1.2 + (H * i) / 4, 0, { rx: Math.PI / 2 })
    K.box(g, 0.4, 0.5, 0.4, K.paint(o.accent || K.C.blue, 0.45), 0, 1.2 + H + R * 0.35, 0, { r: 0.05 })
    const ag = K.live(K.group(g, 0, 1.2 + H + R * 0.4 + 0.5, 0))
    K.cyl(ag, 0.18, 0.12, M.dark, 0, 0, 0, { seg: 16 })
    K.box(ag, 0.5, 0.02, 0.08, M.steel, 0, 0.1, 0, { r: 0 })
    // manway, gauge, piping and ladder
    K.cyl(g, 0.25, 0.08, M.steel, 0, 1.9, -R - 0.02, { axis: 'z', seg: 20 })
    K.cyl(g, 0.08, 0.03, M.white, 0.5, 2.6, -R + 0.05, { axis: 'z', seg: 14 })
    K.cyl(g, 0.05, H, M.steel, R + 0.15, 0.6, 0.3, { seg: 8 })
    K.cyl(g, 0.05, 0.6, M.steel, R * 0.6 + 0.3, 0.6 + H, 0.3, { axis: 'x', seg: 8 })
    for (const sx of [-1, 1]) K.box(g, 0.04, H + 1.2, 0.04, M.yellow, -R - 0.2, 0, sx * 0.2)
    for (let i = 0; i < 10; i++) K.box(g, 0.04, 0.03, 0.4, M.yellow, -R - 0.2, 0.3 + (i * (H + 0.8)) / 10, 0)
    const sight = K.unique(K.emit(o.glow || '#f2c14e', 0.2))
    K.box(g, 0.14, 0.4, 0.02, sight, -0.5, 1.6, -R + 0.08, { r: 0 }).castShadow = false
    return finish({
      g, kind: 'side', w, d, h: H + 2, entry: V(0, 1.3, -R - 0.4), work: workFixed(0, 1.3 + H * 0.4, 0),
      anim(s) { if (s.busy) ag.rotation.y += s.dt * 3; sight.emissiveIntensity = s.busy ? 1.6 : 0.2 },
    }, o, [R * 0.7, 1.2 + H + 0.3, -R * 0.5])
  })

  // ---- vision / inspection arch over a short belt, inline
  K.def('vision', (o) => {
    const L = 2.6, d = 1.6
    const g = new T.Group(), M = K.M()
    const body = K.paint(o.color || K.C.cream, 0.5), acc = K.paint(o.accent || K.C.navy, 0.45)
    K.box(g, L, 0.78, 1.0, body, 0, 0, 0, { r: 0.05 })
    const belt = K.mesh(g, new T.BoxGeometry(L, 0.05, 0.7), K.beltMat(), 0, 0.8, 0)
    belt.userData.keep = true
    for (const sz of [-1, 1]) K.box(g, 0.2, 1.4, 0.2, acc, 0, 0.78, sz * 0.62, { r: 0.04 })
    K.box(g, 0.5, 0.3, 1.45, acc, 0, 2.15, 0, { r: 0.05 })
    const ring = K.unique(K.emit('#e9f6ff', 1.2))
    K.tor(g, 0.3, 0.035, ring, 0, 2.08, 0, { rx: Math.PI / 2 }).castShadow = false
    K.cyl(g, 0.08, 0.2, M.dark, 0, 1.92, 0, { seg: 14 })
    const rej = K.live(K.group(g, 0.8, 0.86, 0.5))
    K.box(rej, 0.1, 0.08, 0.3, M.steel, 0, 0, 0)
    K.box(g, 0.6, 0.5, 0.5, M.red, 0.8, 0, 0.9, { r: 0.04 })
    K.panel(g, -L / 2 - 0.3, 0, -0.85, 0.3, 'list')
    return finish({
      g, kind: 'inline', w: L, d, h: 2.5, entry: V(-L / 2, 0.85, 0), exit: V(L / 2, 0.85, 0),
      work: (i, p) => V(-L / 2 + 0.3 + p * (L - 0.6), 0.85, 0),
      anim(s) { ring.emissiveIntensity = s.busy ? (Math.sin(s.t * 20) > 0.6 ? 6 : 1.4) : 0.6; rej.position.z = 0.5 - (s.busy ? Math.max(0, Math.sin(s.t * 3)) * 0.05 : 0) },
    }, o, [L / 2 - 0.3, 0.78, 0.4])
  })

  // ---- laser cell (marking, cutting, welding) with a glowing window
  K.def('laser', (o) => {
    const w = 2.4, d = 2.0
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, w, 2.0, d - 0.2, body, 0, 0, 0.1, { r: 0.08 })
    K.box(g, w + 0.02, 0.18, d - 0.18, acc, 0, 2.0, 0.1, { r: 0.04 })
    const winM = K.unique(K.emit('#ff9a3c', 0.1))
    K.box(g, 1.3, 0.7, 0.03, K.glass('#3b2a1a', 0.7), -0.2, 1.0, -d / 2 + 0.08, { r: 0 }).castShadow = false
    const wm = K.box(g, 1.26, 0.66, 0.01, winM, -0.2, 1.02, -d / 2 + 0.1, { r: 0 })
    wm.castShadow = false
    K.live(wm)
    K.box(g, 0.6, 1.4, 0.6, M.dark, w / 2 + 0.35, 0, 0.4, { r: 0.04 })
    K.cyl(g, 0.12, 0.8, M.steel, w / 2 + 0.35, 1.4, 0.4, { seg: 12 })
    K.panel(g, -w / 2 - 0.25, 0, -0.6, 0.4, 'graph')
    return finish({
      g, kind: 'side', w, d, h: 2.3, entry: V(-0.2, 0.95, -d / 2 - 0.1), work: workFixed(-0.2, 0.95, 0),
      anim(s) { winM.emissiveIntensity = s.state === 'busy' ? 1.5 + Math.abs(Math.sin(s.t * 23)) * 3 : 0.05 },
    }, o, [w / 2 - 0.25, 2.2, -d / 2 + 0.35])
  })

  // ---- SMT line: printer + pick and place + reflow, inline
  K.def('smt', (o) => {
    const L = o.length || 7, d = 1.8
    const g = new T.Group(), M = K.M()
    const body = K.paint(o.color || '#ecebe6', 0.45), acc = K.paint(o.accent || K.C.navy, 0.45)
    const secs = [1.4, 2.2, L - 3.6 - 0.2]
    let x = -L / 2
    const heads = []
    secs.forEach((sw, i) => {
      const cx = x + sw / 2
      K.box(g, sw - 0.06, 1.2, 1.4, i === 2 ? K.paint('#c9ced2', 0.35, 0.4) : body, cx, 0, 0, { r: 0.06 })
      K.box(g, sw - 0.04, 0.12, 1.42, acc, cx, 1.2, 0, { r: 0.02 })
      if (i < 2) {
        K.box(g, sw - 0.3, 0.5, 1.2, K.glass('#dfeff3', 0.2), cx, 1.32, 0, { r: 0.02 }).castShadow = false
        const h = K.live(K.group(g, cx, 1.55, 0))
        K.box(h, 0.25, 0.2, 0.25, M.dark, 0, 0, 0, { r: 0.03 })
        heads.push({ h, cx, sw })
        for (let k = 0; k < (i ? 8 : 0); k++) K.box(g, 0.08, 0.35, 0.25, K.paint(['#e2713a', '#3e6ea6', '#eab33b'][k % 3], 0.6), cx - sw / 2 + 0.2 + k * 0.22, 0.85, 0.85, { r: 0.01 })
      } else {
        for (let k = 0; k < 4; k++) K.box(g, 0.3, 0.15, 0.02, K.unique(K.emit('#ff8a3a', 1.2)), cx - sw / 2 + 0.5 + k * (sw - 1) / 3, 0.6, -0.71, { r: 0 }).castShadow = false
      }
      x += sw
    })
    const belt = K.mesh(g, new T.BoxGeometry(L, 0.03, 0.4), K.beltMat(), 0, 0.95, -0.8)
    belt.userData.keep = true
    K.panel(g, -L / 2 - 0.3, 0, -0.9, 0.3, 'graph')
    return finish({
      g, kind: 'inline', w: L, d, h: 1.9, entry: V(-L / 2, 1.0, 0), exit: V(L / 2, 1.0, 0),
      work: (i, p) => V(-L / 2 + 0.3 + p * (L - 0.6), 1.22, 0),
      anim(s) { heads.forEach((h, i) => { h.h.position.x = h.cx + (s.busy ? Math.sin(s.t * (5 + i * 3)) * h.sw * 0.3 : 0); h.h.position.z = s.busy ? Math.cos(s.t * (7 + i)) * 0.35 : 0 }) },
    }, o, [-L / 2 + 0.4, 1.32, 0.55])
  })

  // ---- calibration turntable
  K.def('turntable', (o) => {
    const w = 2.2, d = 2.2
    const { g, M, body, acc } = sideBase(o, w, d)
    K.cyl(g, 0.8, 0.5, body, 0, 0, -0.1, { seg: 36 })
    K.tor(g, 0.8, 0.03, acc, 0, 0.5, -0.1, { rx: Math.PI / 2 })
    const top = K.live(K.group(g, 0, 0.52, -0.1))
    K.cyl(top, 0.65, 0.04, M.steel, 0, 0, 0, { seg: 36 })
    K.box(top, 0.1, 0.03, 0.5, acc, 0, 0.04, 0.3)
    for (const a of [0.4, 2.4]) {
      const tg = K.group(g, Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0 + 0.3)
      for (let i = 0; i < 3; i++) K.cyl(tg, 0.015, 1.4, M.dark, Math.cos((i / 3) * TAU) * 0.15, 0, Math.sin((i / 3) * TAU) * 0.15, { seg: 6 })
      K.box(tg, 0.18, 0.12, 0.12, M.dark, 0, 1.4, 0, { r: 0.02 })
    }
    K.box(g, 0.8, 0.75, 0.5, M.dark, 0.8, 0, 0.75, { r: 0.03 })
    K.box(g, 0.5, 0.32, 0.02, K.screenMat('graph', '#9be7ff'), 0.8, 0.85, 0.5, { r: 0 }).castShadow = false
    return finish({
      g, kind: 'side', w, d, h: 1.6, entry: V(0, 0.6, -d / 2 - 0.1), work: workFixed(0, 0.56, -0.1),
      anim(s) { if (s.state === 'busy') top.rotation.y += s.dt * (1.2 + Math.sin(s.t) * 0.6) },
    }, o, [-0.9, 0.0, 0.8])
  })

  // ---- flight / function test cage: the unit lifts and hovers while busy
  K.def('cage', (o) => {
    const w = 3.0, d = 3.0, H = 2.8
    const g = new T.Group(), M = K.M()
    const net = K.glass('#2b2f33', 0.12)
    K.box(g, w, 0.04, d, K.paint('#7d9a6e', 0.9), 0, 0, 0, { r: 0 })
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(g, 0.07, H, 0.07, K.paint(o.accent || K.C.safety, 0.5), sx * w / 2, 0, sz * d / 2)
    for (const [x, z, ww, dd] of [[0, d / 2, w, 0.01], [0, -d / 2, w, 0.01], [w / 2, 0, 0.01, d], [-w / 2, 0, 0.01, d]]) K.box(g, ww, H, dd, net, x, 0, z, { r: 0 }).castShadow = false
    K.box(g, w, 0.01, d, net, 0, H, 0, { r: 0 }).castShadow = false
    for (let i = 0; i <= 4; i++) { K.box(g, w, 0.02, 0.02, M.dark, 0, (H * i) / 4, d / 2); K.box(g, 0.02, 0.02, d, M.dark, w / 2, (H * i) / 4, 0) }
    K.box(g, 0.9, 0.05, 0.9, M.dark, 0, 0.05, 0, { r: 0 })
    K.box(g, 0.7, 0.75, 0.45, M.dark, w / 2 + 0.5, 0, -0.6, { r: 0.03 })
    K.box(g, 0.5, 0.32, 0.02, K.screenMat('graph', '#f2c14e'), w / 2 + 0.5, 0.85, -0.84, { r: 0 }).castShadow = false
    return finish({
      g, kind: 'side', w: w + 1.0, d, h: H, entry: V(0, 0.15, -d / 2 - 0.15),
      work: (i, p) => V(Math.sin(p * 9) * 0.3, 0.12 + Math.sin(Math.min(1, p * 1.2) * Math.PI) * 1.4, Math.cos(p * 7) * 0.3),
      anim() {},
    }, o, [-w / 2 - 0.1, H, -d / 2 - 0.1])
  })

  // ---- integration bay: a big fixture, a gantry crane and two technicians (cleanroom option)
  K.def('bay', (o) => {
    const w = 5.0, d = 4.4
    const g = new T.Group(), M = K.M()
    const clean = o.variant === 'cleanroom'
    K.box(g, w, 0.03, d, K.paint(clean ? '#eef1f3' : '#cfd3d6', 0.6), 0, 0, 0, { r: 0 })
    if (clean) for (const [x, z, ww, dd] of [[0, d / 2, w, 0.02], [w / 2, 0, 0.02, d], [-w / 2, 0, 0.02, d]]) K.box(g, ww, 2.6, dd, K.glass('#e6f3f6', 0.16), x, 0, z, { r: 0 }).castShadow = false
    const acc = K.paint(o.accent || K.C.yellow, 0.45)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(g, 0.18, 4.0, 0.18, acc, sx * (w / 2 - 0.2), 0, sz * (d / 2 - 0.2))
    for (const sz of [-1, 1]) K.box(g, w - 0.2, 0.25, 0.2, acc, 0, 4.0, sz * (d / 2 - 0.2), { r: 0.02 })
    const bridge = K.live(K.group(g, 0, 4.1, 0))
    K.box(bridge, 0.3, 0.3, d - 0.4, acc, 0, 0, 0, { r: 0.02 })
    const hoist = K.group(bridge, 0, -0.1, 0)
    K.box(hoist, 0.45, 0.35, 0.45, M.dark, 0, -0.3, 0, { r: 0.04 })
    const cable = K.cyl(hoist, 0.012, 1.4, M.dark, 0, -1.75, 0, { seg: 4 })
    K.box(g, 1.6, 0.9, 1.4, K.paint('#7a8288', 0.5), 0, 0, 0, { r: 0.04 })
    K.cyl(g, 0.5, 0.25, M.steel, 0, 0.9, 0, { axis: 'x', seg: 24 })
    K.box(g, 1.4, 0.06, 1.2, M.steel, 0, 1.2, 0, { r: 0 })
    const techs = [0, 1].map((i) => { const p = K.person(g, { seed: 70 + i, suit: clean ? '#f2f4f6' : undefined, vest: clean ? '#f2f4f6' : undefined, hat: clean ? '#dfe7ee' : undefined, suitOnly: clean, mask: clean }); K.live(p.g); p.g.position.set(i ? 1.3 : -1.3, 0, i ? 0.4 : -0.3); p.g.rotation.y = i ? -Math.PI / 2 : Math.PI / 2; return p })
    K.box(g, 1.0, 0.85, 0.5, M.dark, -w / 2 + 0.9, 0, d / 2 - 0.6, { r: 0.03 })
    K.box(g, 0.6, 0.35, 0.02, K.screenMat('list', '#9be7ff'), -w / 2 + 0.9, 0.95, d / 2 - 0.86, { r: 0 }).castShadow = false
    for (let i = 0; i < 4; i++) K.bin(g, w / 2 - 0.7, 0, -d / 2 + 0.7 + i * 0.5, [K.C.blue, K.C.red, K.C.yellow, K.C.blue][i], 0.4)
    return finish({
      g, kind: 'side', w, d, h: 4.4, entry: V(0, 1.3, -d / 2 - 0.1), work: workFixed(0, 1.24, 0),
      anim(s) {
        const run = s.state === 'busy'
        bridge.position.x = run ? Math.sin(s.t * 0.4 + s.k) * 1.2 : 0
        cable.scale.y = 1 + (run ? Math.sin(s.t * 0.7) * 0.3 : 0)
        techs.forEach((t, i) => t.pose(run ? 'work' : 'stand', s.t + i))
      },
    }, o, [w / 2 - 0.2, 4.25, -d / 2 + 0.2])
  })

  // ---- thermal vacuum / autoclave chamber: horizontal vessel with a round door; batch
  K.def('chamber', (o) => {
    const R = o.radius || 1.4, L = o.length || 4.2
    const w = L + 1.6, d = 2 * R + 1.2
    const g = new T.Group(), M = K.M()
    const shell = K.metal(o.color || '#cfd4d8', 0.25)
    for (const x of [-L / 3, L / 3]) K.box(g, 0.3, R, 2 * R * 0.8, M.dark, x, 0, 0, { r: 0.03 })
    K.cyl(g, R, L, shell, 0, R + 0.3, 0, { axis: 'x', seg: 40 })
    for (let i = 0; i < 6; i++) K.tor(g, R + 0.02, 0.04, M.steel, -L / 2 + 0.3 + (i * (L - 0.6)) / 5, R + 0.3, 0, { ry: Math.PI / 2 })
    const door = K.live(K.group(g, -L / 2 - 0.05, R + 0.3, 0))
    K.cyl(door, R * 1.02, 0.18, shell, 0, 0, 0, { axis: 'x', seg: 40 })
    K.tor(door, R * 0.7, 0.05, M.steel, -0.1, 0, 0, { ry: Math.PI / 2 })
    const port = K.unique(K.emit('#9fc8ff', 0.2))
    K.cyl(door, 0.18, 0.04, port, -0.1, 0.4, 0, { axis: 'x', seg: 18 }).castShadow = false
    K.sph(g, R, shell, L / 2, R + 0.3, 0).scale.set(0.35, 1, 1)
    for (let i = 0; i < 4; i++) K.cyl(g, 0.08, 1.2, M.steel, -L / 2 + 0.8 + i * 0.9, 0, R + 0.25, { seg: 10 })
    K.box(g, 1.0, 1.8, 0.8, M.dark, L / 2 + 0.3, 0, R + 0.2, { r: 0.04 })
    K.box(g, 0.6, 0.3, 0.02, K.screenMat('graph', '#9be7ff'), L / 2 + 0.3, 1.2, R - 0.21, { r: 0 }).castShadow = false
    const n = Math.max(1, o.batch || 1)
    return finish({
      g, kind: 'side', w, d, h: 2 * R + 0.6, entry: V(-L / 2 - 0.6, R + 0.3, -R - 0.3),
      work: (i) => V(-L / 2 + 0.6 + ((i % 6) * (L - 1.2)) / 5, 0.5 + Math.floor(i / 6) * 0.5, 0),
      anim(s) { door.rotation.y = s.busy ? 0 : -0.9; port.emissiveIntensity = s.busy ? 2.5 : 0.1 },
    }, o, [L / 2 + 0.1, 2 * R + 0.4, -R * 0.5])
  })

  // ---- kitting / picking shelves with a picker
  K.def('kitting', (o) => {
    const w = 3.0, d = 1.8
    const { g, M, body, acc } = sideBase(o, w, d)
    for (let i = 0; i < 2; i++) {
      const x = -0.75 + i * 1.5
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(g, 0.05, 2.0, 0.05, M.dark, x + sx * 0.65, 0, 0.35 + sz * 0.3)
      for (let l = 0; l < 4; l++) {
        K.box(g, 1.35, 0.03, 0.65, M.steel, x, 0.3 + l * 0.5, 0.35, { r: 0 })
        for (let b = 0; b < 4; b++) K.bin(g, x - 0.48 + b * 0.32, 0.33 + l * 0.5, 0.35, [K.C.blue, K.C.yellow, K.C.red, K.C.green][(b + l + i) % 4], 0.26)
      }
      const lt = K.box(g, 1.3, 0.03, 0.02, K.emit('#9be7ff', 1.2), x, 2.0, 0.03, { r: 0 })
      lt.castShadow = false
    }
    K.box(g, 1.2, 0.9, 0.6, body, 0, 0, -0.55, { r: 0.04 })
    K.box(g, 1.22, 0.05, 0.62, acc, 0, 0.9, -0.55, { r: 0.01 })
    const op = K.person(g, { seed: o.seed || 9 })
    K.live(op.g)
    op.g.position.set(0, 0, -0.05)
    return finish({
      g, kind: 'side', w, d, h: 2.1, entry: V(0, 0.95, -d / 2 - 0.1), work: workFixed(0, 0.96, -0.55),
      anim(s) { const run = s.state === 'busy'; op.g.position.x = run ? Math.sin(s.t * 0.9 + s.k) * 0.9 : 0; op.g.rotation.y = run ? (Math.cos(s.t * 0.9 + s.k) > 0 ? 0 : Math.PI) : Math.PI; op.pose(run ? 'walk' : 'stand', s.t) },
    }, o, null)
  })

  // ---- stacker: high speed z-fold stacking / winding head over a table
  K.def('stacker', (o) => {
    const w = 2.6, d = 2.2
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, 2.4, 0.95, 1.8, body, 0, 0, 0.1, { r: 0.06 })
    K.box(g, 2.42, 0.08, 1.82, acc, 0, 0.95, 0.1, { r: 0.02 })
    for (const sx of [-1, 1]) K.box(g, 0.12, 1.3, 0.12, M.dark, sx * 1.05, 1.03, 0.6)
    K.box(g, 2.3, 0.18, 0.2, M.dark, 0, 2.3, 0.6, { r: 0.02 })
    const head = K.live(K.group(g, 0, 2.0, 0.6))
    K.box(head, 0.3, 0.4, 0.3, M.chrome, 0, -0.1, -0.1, { r: 0.03 })
    for (const sx of [-1, 1]) {
      const roll = K.cyl(g, 0.3, 0.25, sx < 0 ? K.paint('#2c2e33', 0.4) : M.copper, sx * 0.85, 1.4, 0.65, { axis: 'z', seg: 24 })
      K.live(roll)
    }
    K.cyl(g, 0.25, 0.25, K.paint('#eef0f0', 0.5), 0, 1.4, 0.65, { axis: 'z', seg: 24 })
    K.box(g, 0.6, 0.12, 0.5, M.steel, 0, 1.03, -0.3)
    K.box(g, 2.0, 1.0, 1.4, K.glass('#e1f1f4', 0.15), 0, 1.03, -0.05, { r: 0.02 }).castShadow = false
    K.panel(g, -1.5, 0, -0.6, 0.4, 'graph')
    return finish({
      g, kind: 'side', w, d, h: 2.5, entry: V(0, 1.1, -d / 2 - 0.1), work: workFixed(0, 1.15, -0.3),
      anim(s) { const run = s.state === 'busy'; head.position.x = run ? Math.sin(s.t * 9) * 0.5 : 0; head.position.y = 2.0 - (run ? Math.abs(Math.cos(s.t * 9)) * 0.35 : 0) },
    }, o, [1.1, 2.4, 0.9])
  })

  // ---- generic process cell for anything else: enclosure, window, screen, light
  K.def('cell', (o) => {
    const w = o.w || 2.4, d = o.d || 2.0, h = o.h || 2.1
    const { g, M, body, acc } = sideBase(o, w, d)
    K.box(g, w, h, d - 0.2, body, 0, 0, 0.1, { r: 0.08 })
    K.box(g, w + 0.02, 0.16, d - 0.18, acc, 0, h, 0.1, { r: 0.04 })
    const lit = K.unique(K.emit(o.glow || '#fff1d6', 0.3))
    K.box(g, w * 0.55, h * 0.4, 0.03, K.glass('#d9eef2', 0.4), -w * 0.12, h * 0.42, -d / 2 + 0.08, { r: 0 }).castShadow = false
    K.box(g, w * 0.5, h * 0.36, 0.01, lit, -w * 0.12, h * 0.44, -d / 2 + 0.11, { r: 0 }).castShadow = false
    K.box(g, 0.36, 0.24, 0.02, K.screenMat('graph'), w * 0.32, h * 0.58, -d / 2 + 0.07, { r: 0 }).castShadow = false
    for (let i = 0; i < 6; i++) K.box(g, 0.03, 0.4, 0.02, M.dark, w * 0.25 + i * 0.05, 0.25, -d / 2 + 0.08)
    K.box(g, 0.5, 0.8, 0.5, M.dark, w / 2 + 0.3, 0, 0.5, { r: 0.04 })
    return finish({
      g, kind: 'side', w: w + 0.6, d, h: h + 0.3, entry: V(-w * 0.12, 0.95, -d / 2 - 0.1), work: workFixed(-w * 0.12, h * 0.3, 0),
      anim(s) { lit.emissiveIntensity = s.state === 'busy' ? 1.8 : 0.25 },
    }, o, [w / 2 - 0.25, h + 0.16, -d / 2 + 0.3])
  })

  // aliases so specs can use the words people use
  const alias = {
    lathe: 'cnc', mill: 'cnc', machining: 'cnc', stamping: 'press', magnetizer: 'press', winding: 'winder',
    weld: 'robot', welder: 'robot', assembly: 'bench', workstation: 'bench', test: 'tester', eol: 'tester',
    pack: 'packer', boxing: 'packer', cure: 'oven', proofer: 'oven', ageing: 'formation', aging: 'formation', burnin: 'formation',
    tunneloven: 'tunnel', pasteurizer: 'tunnel', dryer: 'tunnel', washer: 'tunnel', cooler: 'spiral', freezer: 'spiral',
    sheeter: 'rollers', laminator: 'rollers', calender: 'rollers', slitter: 'rollers', press_roll: 'rollers',
    seamer: 'filler', capper: 'filler', fermenter: 'tank', reactor: 'tank', brewhouse: 'tank', inspection: 'vision', camera: 'vision',
    marking: 'laser', cutting: 'laser', pickplace: 'smt', reflow: 'smt', calibration: 'turntable', flighttest: 'cage', integration: 'bay',
    tvac: 'chamber', autoclave: 'chamber', picking: 'kitting', stacking: 'stacker',
  }
  /** build machine `name` (or alias, or the generic cell) with options o */
  K.build = (name, o = {}) => {
    const key = MACH[name] ? name : alias[name] || 'cell'
    const variant = o.variant || (alias[name] && name !== key ? name : undefined)
    return MACH[key](Object.assign({}, o, { variant }))
  }
  K.has = (name) => !!(MACH[name] || alias[name])
  K.inlineNames = new Set(['packer', 'tunnel', 'spiral', 'rollers', 'coater', 'vision', 'smt'])
  K.isInline = (name) => K.inlineNames.has(MACH[name] ? name : alias[name] || 'cell')

  /* ================================================================ maiaCITY additions (2026-10-15) */
  // Product shapes of our own, at their real size in metres (AirSup's shapes are readable tokens, not measured ones):
  // what the BatteryPack line carries between its stations. `K.product` builds them through the hook above, with the
  // same `add` (a geometry, its colour, where it goes) and the same cache. A stage drawn as one of our whole assets
  // (`shape: 'asset'`, its ref) is the world's: it takes the asset's geometry from the page ($lib/factories/assets.js).
  K.shapes = {}
  /** a tray of 21700 cells (420 × 300 mm): 7 × 5 of the 280 shown standing in it at 55 mm, blue wrap, steel caps;
   *  `sorted` makes the tray the lighter one of the sorter's output */
  K.shapes.celltray = (add, def, { C }) => {
    add(new T.RoundedBoxGeometry(0.42, 0.03, 0.3, 2, 0.005), def.sorted ? '#c9ced2' : '#9aa0a6', 0, 0.015, 0)
    for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) {
      const x = -0.165 + i * 0.055, z = -0.11 + j * 0.055
      add(C(0.0105, 0.07, 8), def.color || '#2f6fb5', x, 0.065, z)
      add(C(0.0105, 0.002, 8), '#c9ccce', x, 0.101, z)
    }
  }
  /** the pack's L-shaped service drawer (460 × 480 mm: a 3 mm base plate and the 100 mm front plate that is the
   *  pack's face), and what it carries down the line: `cells` the bottom holder with the 280 cells standing in it,
   *  `plates` the top holder, the 15 copper contact plates and the clamp bar over them, `bms` the BMS board in the
   *  front bay (src/lib/actors/batterypack.js) */
  K.shapes.ldrawer = (add, def, { B, C }) => {
    add(B(0.46, 0.003, 0.45, 0.001), def.color || '#b9bfc4', 0, 0.0015, -0.015)
    add(B(0.46, 0.1, 0.004, 0.001), '#2b2f33', 0, 0.05, 0.228)
    if (def.cells) {
      add(B(0.446, 0.016, 0.314, 0.002), '#1b1d1f', 0, 0.011, -0.055)
      for (let i = 0; i < 14; i++) for (let j = 0; j < 20; j++) add(C(0.0105, 0.07, 6), '#2f6fb5', (j - 9.5) * 0.022, 0.054, -0.055 + (i - 6.5) * 0.022)
    }
    if (def.plates) {
      add(B(0.446, 0.016, 0.314, 0.002), '#1b1d1f', 0, 0.097, -0.055)
      for (let i = 0; i <= 14; i++) add(B(0.44, 0.002, 0.012, 0.0005), '#c27a43', 0, 0.106, -0.055 + (i - 7) * 0.022)
      add(B(0.44, 0.012, 0.03, 0.002), '#2b2f33', 0, 0.108, -0.055)
    }
    if (def.bms) {
      add(B(0.4, 0.0016, 0.08, 0.0005), '#2c7a4a', 0, 0.004, 0.16)
      add(B(0.03, 0.004, 0.03, 0.001), '#1a1b1d', -0.08, 0.0068, 0.16)
      add(B(0.06, 0.03, 0.03, 0.002), '#1a1b1d', 0, 0.015, -0.225)
    }
  }
  /** a 14S BMS board (200 × 140 mm, 1.6 mm FR4); `parts` once it is placed and reflowed: the MCU, 14 balancing FETs,
   *  the sense-lead connector, a few capacitors */
  K.shapes.bmsboard = (add, def, { B }) => {
    add(B(0.2, 0.0016, 0.14, 0.0005), def.color || '#2c7a4a', 0, 0.0008, 0)
    if (def.parts) {
      add(B(0.03, 0.004, 0.03, 0.001), '#1a1b1d', -0.03, 0.0036, 0)
      for (let i = 0; i < 14; i++) add(B(0.008, 0.005, 0.012, 0.001), '#1a1b1d', -0.09 + i * 0.013, 0.004, -0.05)
      add(B(0.06, 0.008, 0.012, 0.001), '#e9e4d8', 0.06, 0.0056, 0.055)
      for (let i = 0; i < 6; i++) add(B(0.006, 0.006, 0.006, 0.001), '#8b9196', 0.02 + i * 0.012, 0.0046, 0.02)
    }
  }
  /** our Euro pallet (EPAL 1200 × 800 × 144 mm, $lib/actors/pallet.js, the Things' and the machines' own), lying
   *  along x, standing at (x, y, z); in place of AirSup's K.pallet where product is stacked */
  K.PALLET_H = PALLET_H
  K.europallet = (p, x, y, z) => {
    const g = K.group(p, x, y, z)
    euroPallet((geo, color, bone, mat) => { if (!mat) K.mesh(g, geo, K.paint(color, 0.85), 0, 0, 0) }, [0, 0, 0], 0, 'x', { stack: 0 })
    return g
  }
  /** how a product stacks on a pallet: `nx` by `nz` a layer at pitches `dx`, `dz`, `ny` layers `dy` apart, drawn at
   *  `s`. AirSup's kit shapes keep their 2 × 2 × 2 at 0.8; ours stack at their real size, a shape's own or the spec's
   *  (`pallet` on the stage) */
  const STACKS = {
    celltray: { nx: 2, nz: 2, dx: 0.5, dz: 0.34, dy: 0.105, ny: 4 },
    ldrawer: { nx: 2, nz: 1, dx: 0.5, dz: 0, dy: 0.11, ny: 4 },
    bmsboard: { nx: 2, nz: 2, dx: 0.3, dz: 0.24, dy: 0.012, ny: 8 },
  }
  K.stackOf = (def) => Object.assign({ s: 1 }, def.pallet || STACKS[def.shape] || (K.shapes[def.shape] || def.shape === 'asset' ? { nx: 2, nz: 2, dx: 0.56, dz: 0.56, dy: 0.2, ny: 3 } : { nx: 2, nz: 2, dx: 0.56, dz: 0.56, dy: 0.4, ny: 2, s: 0.8 }))
  /** the stack as the shipping pallets fill: how many a pallet takes, and where the k-th one sits on it */
  K.palletLayout = (def) => {
    if (!def.pallet && !K.shapes[def.shape] && def.shape !== 'asset') return { per: 12, at: (k) => [-0.3 + (k % 2) * 0.6, 0.14 + Math.floor(k / 4) * 0.42, -0.33 + (Math.floor(k / 2) % 2) * 0.66, 0.85] }
    const S = K.stackOf(def), layer = S.nx * S.nz
    return { per: layer * S.ny, at: (k) => { const i = k % layer, l = Math.floor(k / layer); return [-S.dx * (S.nx - 1) / 2 + (i % S.nx) * S.dx, PALLET_H + l * S.dy, -S.dz * (S.nz - 1) / 2 + Math.floor(i / S.nx) * S.dz, S.s] } }
  }
