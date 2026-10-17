/*
 * Ported from AirSup's factory-skill (https://github.com/AirsupHQ/factory-skill, commit 9fde755, MIT licence:
 * Copyright (c) 2026 Air Supply Technologies Inc., .claude/skills/factory-skill/LICENSE) into maiaCITY as an ES module
 * (2026-10-15). Only this head and the foot changed: the browser globals (FactorySkill, THREE) became imports and
 * exports; the body is theirs, line for line, under `@ts-nocheck` so it stays theirs. Our additions, where there are
 * any, sit at the end under "maiaCITY additions".
 */
// @ts-nocheck
import { T } from './three.js'
import { K } from './kit.js'
import { fmt, rng } from './des.js'
const FS = { fmt, rng, Kit: K }
/*
 * Factory Skill: the world. Lays the stations out on a floor, builds the hall,
 * the yard and the diorama base, the conveyors between stations, and every
 * frame places each token (one unit or one tray/batch of units) exactly where
 * the simulation says it is: queued on a buffer conveyor, inside a machine at
 * its cycle progress, or waiting blocked at the machine exit.
 */
  const V = (x, y, z) => new T.Vector3(x, y, z)
  const BELT_Y = 0.86

  /* ---------------------------------------------------------- polyline route */
  class Route {
    constructor(pts) {
      this.p = pts.filter((q, i) => i === 0 || q.distanceToSquared(pts[i - 1]) > 1e-8)
      if (!this.p.length) this.p = [pts[0] || V(0, 0, 0)]
      this.c = [0]
      for (let i = 1; i < this.p.length; i++) this.c.push(this.c[i - 1] + this.p[i].distanceTo(this.p[i - 1]))
      this.len = this.c[this.c.length - 1]
    }
    at(d, out = V(0, 0, 0)) {
      if (this.p.length === 1 || d <= 0) return out.copy(this.p[0])
      if (d >= this.len) return out.copy(this.p[this.p.length - 1])
      let i = 1
      while (this.c[i] < d) i++
      const a = this.p[i - 1], b = this.p[i], f = (d - this.c[i - 1]) / Math.max(1e-9, this.c[i] - this.c[i - 1])
      return out.copy(a).lerp(b, f)
    }
    dirAt(d) {
      let i = 1
      while (i < this.p.length - 1 && this.c[i] < d) i++
      if (this.p.length < 2) return 0
      const a = this.p[i - 1], b = this.p[i]
      return Math.atan2(-(b.z - a.z), b.x - a.x)
    }
  }
  export { Route }

  /* --------------------------------------------------------------- layout */
  function layout(plan, sim) {
    const spec = plan.spec
    const st = plan.stations
    const byId = plan.byId
    // height above the sink -> column (right aligned), lanes by depth first search from the sink
    const height = {}
    const h = (s) => (height[s.id] != null ? height[s.id] : (height[s.id] = s.succ ? 1 + h(byId[s.succ]) : 0))
    st.forEach(h)
    const H = Math.max(...st.map((s) => height[s.id]))
    const lane = {}
    let nextLane = 0
    const walk = (s, l) => {
      lane[s.id] = l
      const preds = s.after.map((p) => byId[p]).sort((a, b) => height[b.id] - height[a.id] || chainLen(b) - chainLen(a))
      preds.forEach((p, i) => walk(p, i === 0 ? l : ++nextLane))
    }
    const chainLen = (s) => 1 + (s.after.length ? Math.max(...s.after.map((p) => chainLen(byId[p]))) : 0)
    walk(byId[plan.sink], 0)

    // footprints from a prototype of each machine; room is left for `reserve` more machines
    const info = {}
    for (const s of st) {
      const pm = Math.max(1, s.perMachine || 1)
      const P = Math.max(1, Math.ceil(s.servers / pm))
      const Pmax = P + (s.reserve != null ? s.reserve : P >= 6 ? 2 : P >= 2 ? 2 : 1)
      const proto = K.build(s.machine, mopts(s, 0))
      const inline = proto.kind === 'inline'
      let W, D
      if (inline) { W = proto.w + 2.4; D = Pmax * proto.d + (Pmax - 1) * 0.5 }
      else if (Pmax <= 2 && !s.twoSided) { W = Math.max(Pmax * (proto.w + 0.7) + 1.8, 3.2); D = proto.d + 2.0 }
      else { const c = Math.ceil(Pmax / 2); W = c * (proto.w + 0.7) + 1.8; D = 2 * proto.d + 2.6 }
      info[s.id] = { s, P, Pmax, pm, inline, mw: proto.w, md: proto.d, W, D, oneSided: !inline && Pmax <= 2 && !s.twoSided }
    }
    // manual grid if the spec gives `at: [col, row]`
    const manual = st.some((s) => Array.isArray(s.at))
    const maxCols = spec.layout && spec.layout.maxCols || 6
    const cols = H + 1
    const fold = !manual && cols > maxCols ? Math.ceil(cols / 2) : 0
    for (const s of st) {
      const I = info[s.id]
      if (manual && s.at) { I.col = s.at[0]; I.row = s.at[1]; I.dir = s.at[2] === -1 ? -1 : 1; continue }
      const c = H - height[s.id]
      if (fold && c >= fold) { I.col = cols - 1 - c; I.dir = -1; I.row = 100 + lane[s.id] }
      else { I.col = c; I.dir = 1; I.row = -lane[s.id] }
    }
    // column widths and row depths
    const colW = {}, rowD = {}
    for (const I of Object.values(info)) {
      colW[I.col] = Math.max(colW[I.col] || 0, I.W + 2.8)
      rowD[I.row] = Math.max(rowD[I.row] || 0, I.D + 2.6)
    }
    const colKeys = Object.keys(colW).map(Number).sort((a, b) => a - b)
    const colX = {}
    let x = 0
    for (const c of colKeys) { colX[c] = x + colW[c] / 2; x += colW[c] }
    // rows: manual rows ascend toward the camera (+z); auto: branches behind (more negative), folded row in front
    const rowKeys = Object.keys(rowD).map(Number).sort((a, b) => a - b)
    const rowZ = {}
    let z = 0
    for (const r of rowKeys) { rowZ[r] = z + rowD[r] / 2; z += rowD[r] }
    for (const I of Object.values(info)) { I.x = colX[I.col]; I.z = rowZ[I.row] }
    // centre on the origin
    const xs = Object.values(info).flatMap((I) => [I.x - I.W / 2, I.x + I.W / 2])
    const zs = Object.values(info).flatMap((I) => [I.z - I.D / 2, I.z + I.D / 2])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
    for (const I of Object.values(info)) { I.x -= cx; I.z -= cz }
    return info
  }

  function mopts(s, k) {
    return Object.assign({}, s.look || {}, {
      color: s.color, accent: s.accent, variant: s.variant, batch: (s.batch || 1) * Math.max(1, s.perMachine || 1), length: s.length, seed: 13 + k * 7 + s.index * 31,
      radius: s.radius, height: s.height, fill: s.fill, web: s.web, glow: s.glow,
    })
  }

  /* ---------------------------------------------------------------- world */
  export class World {
    constructor(look, plan, sim, opts = {}) {
      this.look = look
      this.plan = plan
      this.sim = sim
      this.scene = look.scene
      this.root = K.group(this.scene)
      this.t = 0
      this.vis = new Map()
      this.edges = {}
      this.st = {}
      // maiaCITY: a product stage drawn as one of our assets by its ref ({ ref: { geometry, material } }), our Euro
      // pallet's pieces (under K.PALLET), and the one material of AirSup's product tokens (made here, since the
      // shipping pallets are built before the tokens)
      this.assets = opts.assets || {}
      this.tokMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 })
      this.build()
    }
    /** the geometry and material a product stage is drawn with: our asset's where the spec names one, else AirSup's shape (maiaCITY) */
    _stageGeo(def) {
      if (def.shape === 'asset') {
        const a = this.assets[def.ref]
        if (!a) throw new Error(`stage ${def.ref}: the page gave the world no such asset`)
        return { geo: a.geometry, mat: a.material }
      }
      return { geo: K.product(def), mat: this.tokMat }
    }
    /** our Euro pallet's pieces, as the page built them (maiaCITY) */
    _pallet() {
      const a = this.assets[K.PALLET]
      if (!a) throw new Error(`${K.PALLET}: the page gave the world no Euro pallet`)
      return a
    }

    build() {
      const plan = this.plan
      const info = (this.info = layout(plan, this.sim))
      const accents = K.ACCENTS
      let ai = 0
      // stations
      for (const s of plan.stations) {
        const I = info[s.id]
        if (!s.accent) s.accent = accents[ai++ % accents.length]
        const g = K.group(this.root, I.x, 0, I.z)
        g.rotation.y = I.dir === -1 ? Math.PI : 0
        const S = { id: s.id, def: s, I, g, machines: [], ports: {}, dir: I.dir, appear: 0 }
        this.st[s.id] = S
        this._buildStation(S)
      }
      // edges between stations
      for (const s of plan.stations) for (const p of s.after) this._edge(p, s.id)
      // raw material feeders for branch heads
      for (const s of plan.stations) if (!s.after.length) this._feeder(s.id)
      this._hall()
      this._props()
      this._tokens()
      this._people()
    }

    /* ---- one station: machines, spine, ports, floor zone, hit box */
    _buildStation(S) {
      const s = S.def, I = S.I
      const g = S.g
      const W = I.W, D = I.D
      const sl = K.group(g)
      S.local = sl
      // floor zone
      const zone = K.group(g)
      const tape = K.paint('#e3b23c', 0.6)
      for (const [x, z, w, d] of [[0, -D / 2, W, 0.09], [0, D / 2, W, 0.09], [-W / 2, 0, 0.09, D], [W / 2, 0, 0.09, D]]) K.box(zone, w, 0.012, d, tape, x, 0.002, z, { r: 0 })
      const zf = K.box(zone, W - 0.1, 0.006, D - 0.1, K.paint(s.floor || '#aeb0a8', 0.85), 0, 0.001, 0, { r: 0 })
      zf.castShadow = false
      // machine slots: inline lanes stacked in z; side machines both sides of a spine along x
      const slots = []
      if (I.inline) {
        for (let k = 0; k < I.Pmax; k++) slots.push({ x: 0, z: -D / 2 + I.md / 2 + k * (I.md + 0.5), rot: 0, side: 0 })
        S.zs = I.Pmax === 1 ? slots[0].z : slots[Math.floor((I.Pmax - 1) / 2)].z + (I.Pmax % 2 ? 0 : (I.md + 0.5) / 2)
        if (I.Pmax > 1) S.zs = (slots[0].z + slots[I.Pmax - 1].z) / 2
      } else if (I.oneSided) {
        const mz = -D / 2 + I.md / 2 + 0.3
        for (let k = 0; k < I.Pmax; k++) slots.push({ x: -W / 2 + 1.2 + (I.mw + 0.7) * (k + 0.5), z: mz, rot: Math.PI, side: -1 })
        S.zs = mz + I.md / 2 + 0.85
      } else {
        for (let k = 0; k < I.Pmax; k++) {
          const side = k % 2 === 0 ? -1 : 1, ci = Math.floor(k / 2)
          slots.push({ x: -W / 2 + 1.2 + (I.mw + 0.7) * (ci + 0.5), z: side * (I.md / 2 + 1.1), rot: side < 0 ? Math.PI : 0, side })
        }
        S.zs = 0
      }
      S.slots = slots
      S.machines = []
      for (let k = 0; k < I.P; k++) this._addMachine(S, k, false)
      // reserved floor for more machines: dashed outline
      const dash = K.paint('#bfb7a6', 0.8)
      slots.forEach((sl_, k) => {
        if (k < I.P) return
        const w = I.inline ? I.mw : I.mw, d = I.md
        for (let i = 0; i < 6; i++) {
          K.box(zone, w / 8, 0.01, 0.06, dash, sl_.x - w / 2 + (w / 6) * (i + 0.5), 0.004, sl_.z - d / 2, { r: 0 })
          K.box(zone, w / 8, 0.01, 0.06, dash, sl_.x - w / 2 + (w / 6) * (i + 0.5), 0.004, sl_.z + d / 2, { r: 0 })
        }
      })
      // ports (station local) and the spine
      const y = BELT_Y
      S.inPort = V(-W / 2, y, S.zs)
      S.outPort = V(W / 2, y, S.zs)
      const conv = K.group(g)
      if (!I.inline) K.conveyor(conv, [V(-W / 2, 0, S.zs), V(W / 2, 0, S.zs)], { y, color: '#5a6a73' })
      // join stations: one inlet per input, spread along z
      const ins = s.after.length ? s.after : ['$src']
      ins.forEach((p, i) => {
        const dz = ins.length > 1 ? (i - (ins.length - 1) / 2) * 1.4 : 0
        const port = V(-W / 2 - 0.0, y, S.zs + dz)
        S.ports[p] = port
        if (dz) K.conveyor(conv, [V(-W / 2 - 0.0, 0, S.zs + dz), V(-W / 2 + 0.6, 0, S.zs + dz), V(-W / 2 + 0.6, 0, S.zs)], { y })
      })
      // scrap bin for stations that reject
      if (s.yield < 1) {
        const bx = W / 2 - 0.8, bz = S.zs + (I.inline ? 1.2 : 0.95)
        K.box(g, 0.7, 0.6, 0.6, K.paint('#c7473a', 0.55), bx, 0, bz, { r: 0.05 })
        S.scrapAt = V(bx, 0.6, bz)
      }
      // label plate on a post (one tiny engraved label per station)
      S.label = this._plate(g, s.name, -W / 2 + 0.6, D / 2 - 0.4, s.accent)
      K.freeze(zone)
      K.freeze(conv)
      // hit box
      const hit = new T.Mesh(new T.BoxGeometry(W, 4, D), new T.MeshBasicMaterial({ visible: false }))
      hit.position.y = 2
      hit.userData.station = s.id
      g.add(hit)
      S.hit = hit
      // outline for selection and bottleneck
      S.ring = this._ring(g, W + 0.5, D + 0.5)
    }
    /** build the machine for slot k (with its lane conveyors or transfer table) */
    _addMachine(S, k, pop) {
      const s = S.def, I = S.I, sl = S.slots[k], y = BELT_Y, W = I.W
      const wrap = K.group(S.local)
      const m = K.build(s.machine, mopts(s, k))
      m.g.position.set(sl.x, 0, sl.z)
      m.g.rotation.y = sl.rot
      m.side = sl.side
      m.zLane = sl.z
      wrap.add(m.g)
      const conv = K.group(wrap)
      if (I.inline) {
        const ent = V(sl.x + m.entry.x, y, sl.z), exi = V(sl.x + m.exit.x, y, sl.z)
        if (Math.abs(sl.z - S.zs) > 0.01) {
          K.conveyor(conv, [V(-W / 2, 0, S.zs), V(-W / 2 + 0.7, 0, S.zs), V(-W / 2 + 0.7, 0, sl.z), V(ent.x, 0, sl.z)], { y })
          K.conveyor(conv, [V(exi.x, 0, sl.z), V(W / 2 - 0.7, 0, sl.z), V(W / 2 - 0.7, 0, S.zs), V(W / 2, 0, S.zs)], { y })
        } else {
          K.conveyor(conv, [V(-W / 2, 0, S.zs), V(ent.x, 0, S.zs)], { y })
          K.conveyor(conv, [V(exi.x, 0, S.zs), V(W / 2, 0, S.zs)], { y })
        }
      } else {
        const ent = this._entryLocal(m)
        K.box(conv, 0.5, 0.05, Math.abs(ent.z - S.zs), K.paint('#8b949b', 0.5, 0.3), ent.x, y - 0.05, (ent.z + S.zs) / 2, { r: 0.01 })
        for (const sz of [0.3, 0.7]) K.box(conv, 0.05, y - 0.05, 0.05, K.paint('#3a3f44', 0.6), ent.x, 0, S.zs + (ent.z - S.zs) * sz, { r: 0 })
      }
      K.freeze(conv)
      m.wrap = wrap
      m.pop = pop ? 0 : 1
      S.machines[k] = m
      return m
    }
    /** match the number of physical machines to the sim (after a what-if) */
    syncMachines(id) {
      const S = this.st[id]
      const want = Math.min(S.I.Pmax, Math.max(1, Math.ceil(this.sim.st[id].servers.filter((x) => !x.retire).length / S.I.pm)))
      while (S.machines.length < want) this._addMachine(S, S.machines.length, true)
      while (S.machines.length > want) { const m = S.machines.pop(); S.local.remove(m.wrap) }
    }
    _entryLocal(m) {
      // machine entry in station-local coordinates
      const e = m.entry.clone().applyAxisAngle(V(0, 1, 0), m.g.rotation.y).add(m.g.position)
      return e
    }
    _plate(g, text, x, z, color) {
      const c = document.createElement('canvas')
      c.width = 512; c.height = 96
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#f4efe4'
      ctx.fillRect(0, 0, 512, 96)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 14, 96)
      ctx.fillStyle = '#26282b'
      ctx.font = '600 40px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textBaseline = 'middle'
      ctx.fillText(text.toUpperCase().slice(0, 20), 34, 50)
      const tex = new T.CanvasTexture(c)
      tex.colorSpace = T.SRGBColorSpace
      tex.anisotropy = 8
      const p = K.group(g, x, 0, z)
      K.box(p, 0.05, 1.3, 0.05, K.paint('#3a3d42', 0.5), 0, 0, 0)
      const m = new T.Mesh(new T.PlaneGeometry(1.6, 0.3), new T.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
      m.position.set(0, 1.42, 0.03)
      m.castShadow = true
      p.add(m)
      return p
    }
    _ring(g, w, d) {
      const grp = K.group(g)
      const mat = new T.MeshBasicMaterial({ color: '#ff5a36', transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
      const t = 0.16
      for (const [x, z, ww, dd] of [[0, -d / 2, w + t, t], [0, d / 2, w + t, t], [-w / 2, 0, t, d], [w / 2, 0, t, d]]) {
        const m = new T.Mesh(new T.BoxGeometry(ww, 0.03, dd), mat)
        m.position.set(x, 0.03, z)
        grp.add(m)
      }
      // soft glow under the zone
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const x = c.getContext('2d')
      const gr = x.createRadialGradient(32, 32, 4, 32, 32, 32)
      gr.addColorStop(0, 'rgba(255,255,255,0.9)')
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = gr
      x.fillRect(0, 0, 64, 64)
      const glowMat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), color: '#ff6a3d', transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })
      const glow = new T.Mesh(new T.PlaneGeometry(w * 1.25, d * 1.25), glowMat)
      glow.rotation.x = -Math.PI / 2
      glow.position.y = 0.02
      grp.add(glow)
      return { grp, mat, glowMat }
    }

    /* ---- station-local helpers to world space */
    _w(S, v) { return v.clone().applyAxisAngle(V(0, 1, 0), S.g.rotation.y).add(S.g.position) }
    _mw(S, m, v) { return this._w(S, v.clone().applyAxisAngle(V(0, 1, 0), m.g.rotation.y).add(m.g.position)) }

    /* ---- buffer conveyor from station a to station b */
    _edge(a, b) {
      const A = this.st[a], B = this.st[b]
      const p0 = this._w(A, A.outPort), p4 = this._w(B, B.ports[a])
      const dA = A.dir, dB = B.dir
      const p1 = p0.clone().add(V(1.2 * dA, 0, 0)), p3 = p4.clone().add(V(-1.2 * dB, 0, 0))
      let pts
      if (dA === dB) {
        const mx = (p1.x + p3.x) / 2
        pts = Math.abs(p1.z - p3.z) < 0.05 ? [p0, p4] : [p0, p1, V(mx, BELT_Y, p1.z), V(mx, BELT_Y, p3.z), p3, p4]
        if (Math.abs(p1.z - p3.z) >= 0.05 && (p3.x - p1.x) * dA < 0.5) pts = [p0, p1, V(p1.x, BELT_Y, p3.z), p3, p4]
      } else {
        const ex = dA > 0 ? Math.max(p1.x, p3.x) : Math.min(p1.x, p3.x)
        pts = [p0, V(ex, BELT_Y, p0.z), V(ex, BELT_Y, p4.z), p4]
      }
      const route = new Route(pts)
      const g = K.conveyor(this.root, pts.map((p) => V(p.x, 0, p.z)), { y: BELT_Y, color: '#4f5d66' })
      K.freeze(g)
      const cap = this.plan.byId[b].buffer
      this.edges[a + '>' + b] = { route, g, cap, from: a, to: b, sp: Math.min(0.95, Math.max(0.45, route.len / Math.max(1, Math.min(cap, 14)))) }
    }
    _feeder(id) {
      const S = this.st[id]
      const p4 = this._w(S, S.ports.$src)
      const p0 = p4.clone().add(V(-3.2 * S.dir, 0, 0))
      const route = new Route([p0, p4])
      const g = K.group(this.root)
      // a pallet of raw material at the start of the feeder (maiaCITY: our Euro pallet, the product stacked at its real size)
      const pal = K.group(g, p0.x - 0.8 * S.dir, 0, p0.z)
      K.europallet(pal, 0, 0, 0, this._pallet())
      const st = this.plan.byId[id]
      const def = this.plan.spec.stages && this.plan.spec.stages[st.input] || { shape: 'crate', color: '#c49a63' }
      const geo = K.product(def)
      const m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 })
      const stack = K.stackOf(def)
      for (let i = 0; i < stack.nx * stack.nz; i++) for (let k = 0; k < stack.ny; k++) { const pm = new T.Mesh(geo, m); pm.position.set(-stack.dx * (stack.nx - 1) / 2 + (i % stack.nx) * stack.dx, K.PALLET_H + k * stack.dy, -stack.dz * (stack.nz - 1) / 2 + Math.floor(i / stack.nx) * stack.dz); pm.scale.setScalar(stack.s); pm.castShadow = true; pal.add(pm) }
      K.conveyor(g, [V(p0.x, 0, p0.z), V(p4.x, 0, p4.z)], { y: BELT_Y })
      K.freeze(g)
      this.edges['$src>' + id] = { route, g, cap: 99, from: '$src', to: id, sp: 0.8, feeder: true }
      S.rawAt = V(pal.position.x, 0, pal.position.z)
    }

    /* ---- hall, yard, diorama base */
    _hall() {
      const xs = [], zs = []
      for (const S of Object.values(this.st)) {
        const I = S.I
        xs.push(I.x - I.W / 2, I.x + I.W / 2)
        zs.push(I.z - I.D / 2, I.z + I.D / 2)
      }
      for (const e of Object.values(this.edges)) for (const p of e.route.p) { xs.push(p.x); zs.push(p.z) }
      this.lineBounds = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }
      const pad = 3
      const b = (this.bounds = { x0: Math.min(...xs) - pad - 3.5, x1: Math.max(...xs) + pad + 3, z0: Math.min(...zs) - pad - 1, z1: Math.max(...zs) + pad + 2.6 })
      const W = b.x1 - b.x0, D = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2
      const g = (this.hall = K.group(this.root))
      const wallH = 7.5
      // floor
      const floorTex = K.noiseTex('#959a96', 20, 256, 1)
      floorTex.repeat.set(W / 9, D / 9)
      const fm = new T.MeshStandardMaterial({ map: floorTex, roughness: 0.62, metalness: 0.02 })
      const floor = new T.Mesh(new T.BoxGeometry(W, 0.3, D), fm)
      floor.position.set(cx, -0.15, cz)
      floor.receiveShadow = true
      g.add(floor)
      // expansion joints every 6 m
      const joint = K.paint('#bdb6a6', 0.9)
      for (let x = b.x0 + 6; x < b.x1; x += 6) K.box(g, 0.03, 0.004, D, joint, x, 0, cz, { r: 0 })
      for (let z = b.z0 + 6; z < b.z1; z += 6) K.box(g, W, 0.004, 0.03, joint, cx, 0, z, { r: 0 })
      // green walkway along the front and painted aisle arrows
      const walk = K.paint('#6f9c72', 0.8)
      K.box(g, W - 2, 0.008, 1.4, walk, cx, 0.003, b.z1 - 1.6, { r: 0 })
      const tape = K.paint('#e3b23c', 0.6)
      K.box(g, W - 2, 0.01, 0.1, tape, cx, 0.004, b.z1 - 2.4, { r: 0 })
      K.box(g, W - 2, 0.01, 0.1, tape, cx, 0.004, b.z1 - 0.8, { r: 0 })
      // walls: back and left full height with windows; right and front cut low (section)
      const wallM = K.paint('#ece5d6', 0.75)
      const cutM = K.paint('#b65f3c', 0.7)
      const trim = K.paint('#3d4a52', 0.5)
      const winM = new T.MeshStandardMaterial({ color: '#b9d3dd', roughness: 0.08, metalness: 0.2, emissive: '#cfe6ef', emissiveIntensity: 0.25 })
      const t = 0.35
      // back wall with a ribbon of windows and two dock doors at the left
      K.box(g, W, wallH, t, wallM, cx, 0, b.z0 - t / 2, { r: 0.02 })
      for (let x = b.x0 + 2; x < b.x1 - 2.5; x += 3.2) K.box(g, 2.4, 1.3, 0.06, winM, x + 1.2, 4.6, b.z0 + 0.02, { r: 0 }).castShadow = false
      K.box(g, W, 0.25, t + 0.06, trim, cx, wallH, b.z0 - t / 2, { r: 0.02 })
      for (let x = b.x0 + 3; x < b.x1; x += 9) {
        K.box(g, 0.45, wallH, 0.45, K.paint('#4a5862', 0.5), x, 0, b.z0 + 0.25, { r: 0.02 })
        K.box(g, 0.6, 0.5, 0.2, K.paint('#d2cdc0', 0.6), x, 0, b.z0 + 0.35, { r: 0.02 })
      }
      // left wall
      K.box(g, t, wallH, D + t, wallM, b.x0 - t / 2, 0, cz - t / 2, { r: 0.02 })
      K.box(g, t + 0.06, 0.25, D + t, trim, b.x0 - t / 2, wallH, cz - t / 2, { r: 0.02 })
      for (let z = b.z0 + 3; z < b.z1 - 3; z += 5) {
        // roller doors on the left wall: receiving
        K.box(g, 0.08, 3.8, 3.4, K.paint('#9aa4ab', 0.45, 0.3), b.x0 + 0.05, 0, z + 1.6, { r: 0.02 })
        for (let k = 0; k < 12; k++) K.box(g, 0.1, 0.03, 3.3, K.paint('#7d878e', 0.5, 0.3), b.x0 + 0.06, 0.3 + k * 0.3, z + 1.6, { r: 0 })
        K.box(g, 0.2, 0.2, 3.7, K.paint(K.C.safety, 0.5), b.x0 + 0.1, 3.8, z + 1.6, { r: 0.02 })
        break
      }
      // cut walls (front and right): wall stub with the cut face coloured like an architect's section
      const cutH = 1.1
      K.box(g, W + t, cutH, t, wallM, cx + t / 2, 0, b.z1 + t / 2, { r: 0.02 })
      K.box(g, W + t, 0.02, t, cutM, cx + t / 2, cutH, b.z1 + t / 2, { r: 0 })
      K.box(g, t, cutH, D, wallM, b.x1 + t / 2, 0, cz, { r: 0.02 })
      K.box(g, t, 0.02, D, cutM, b.x1 + t / 2, cutH, cz, { r: 0 })
      // columns cut at the same height along the front and right
      for (let x = b.x0 + 3; x < b.x1; x += 9) K.box(g, 0.45, cutH + 0.25, 0.45, K.paint('#4a5862', 0.5), x, 0, b.z1 + 0.1, { r: 0.02 })
      // shipping dock opening on the right: gap in the stub wall and dock levellers
      // receiving racks along the left wall, shipping lanes along the right
      K.rack(g, b.x0 + 1.8, cz - D * 0.18, 2.6, 1.1, 3, 1.35, 0.8, 4).rotation.y = Math.PI / 2
      K.rack(g, b.x0 + 1.8, cz + D * 0.18, 2.6, 1.1, 3, 1.35, 0.75, 5).rotation.y = Math.PI / 2
      // shipping: pallets that fill as units ship
      const sink = this.st[this.plan.sink]
      const so = this._w(sink, sink.outPort)
      const shipX = Math.min(b.x1 - 2.4, so.x + 3.2 * sink.dir), shipZ = so.z
      const ship = K.group(this.root, shipX, 0, shipZ)
      this.shipAt = V(shipX, 0.3, shipZ)
      K.conveyor(this.root, [V(so.x, 0, so.z), V(shipX - 0.9 * Math.sign(shipX - so.x || 1), 0, so.z)], { y: BELT_Y })
      this.shipPallets = []
      for (let i = 0; i < 3; i++) {
        const p = K.group(ship, 0.4 * Math.sign(shipX - so.x || 1), 0, (i - 1) * 1.5)
        K.europallet(p, 0, 0, 0, this._pallet()) // maiaCITY: our Euro pallet
        this.shipPallets.push(p)
      }
      // maiaCITY: the finished product as the spec draws it (our own asset by its ref, at its real size, where it says so), stacked as a pallet of it is
      const sinkDef = this.plan.spec.stages && this.plan.spec.stages[this.plan.byId[this.plan.sink].stage] || { shape: 'box', color: '#c49a63' }
      const sg = this._stageGeo(sinkDef)
      this.shipBoxGeo = sg.geo
      this.shipBoxMat = sg.mat === this.tokMat ? new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) : sg.mat
      this.shipLayout = K.palletLayout(sinkDef)
      this.shipFill = new T.InstancedMesh(this.shipBoxGeo, this.shipBoxMat, 3 * this.shipLayout.per)
      this.shipFill.castShadow = true
      this.shipFill.count = 0
      ship.add(this.shipFill)
      // office corner at the back right: glass box, desks, people
      const ox = b.x1 - 4.2, oz = b.z0 + 2.6
      const office = K.group(g, ox, 0, oz)
      K.box(office, 6.2, 0.15, 3.8, K.paint('#cfc6b4', 0.8), 0, 0, 0, { r: 0.02 })
      K.box(office, 6.2, 2.8, 0.05, K.glass('#cfe3ea', 0.3), 0, 0.15, 1.9, { r: 0 }).castShadow = false
      K.box(office, 0.05, 2.8, 3.8, K.glass('#cfe3ea', 0.3), -3.1, 0.15, 0, { r: 0 }).castShadow = false
      K.box(office, 6.3, 0.12, 3.9, trim, 0, 2.95, 0, { r: 0.02 })
      for (let i = 0; i < 3; i++) {
        K.box(office, 1.4, 0.05, 0.7, K.paint('#efe9dc', 0.6), -1.9 + i * 1.9, 0.9, 0.2, { r: 0.01 })
        K.box(office, 0.5, 0.32, 0.03, K.screenMat(i % 2 ? 'bars' : 'graph', '#9be7ff'), -1.9 + i * 1.9, 0.95, -0.05, { r: 0.005 }).castShadow = false
        const p = K.person(office, { seed: 90 + i, vest: '#5d7fa6' })
        p.g.position.set(-1.9 + i * 1.9, 0.15, 0.85)
        p.g.rotation.y = Math.PI
        p.pose('stand', 0)
        this._officePeople = (this._officePeople || []).concat(p)
      }
      // yard, grass, base
      const yardM = K.paint('#7b7d7f', 0.9)
      const grassTex = K.noiseTex('#93aa6e', 26, 128, 1)
      grassTex.repeat.set(12, 12)
      const grassM = new T.MeshStandardMaterial({ map: grassTex, roughness: 0.95 })
      const m = 18
      const bx0 = b.x0 - m, bx1 = b.x1 + m + 16, bz0 = b.z0 - m * 0.8, bz1 = b.z1 + m + 6
      const base = new T.Mesh(new T.BoxGeometry(bx1 - bx0, 1.6, bz1 - bz0), grassM)
      base.position.set((bx0 + bx1) / 2, -0.81, (bz0 + bz1) / 2)
      base.receiveShadow = true
      g.add(base)
      const sideM = K.paint('#5f4b3a', 0.9)
      const plinth = K.box(g, bx1 - bx0 + 0.6, 2.2, bz1 - bz0 + 0.6, sideM, (bx0 + bx1) / 2, -3.81, (bz0 + bz1) / 2, { r: 0.4 })
      plinth.receiveShadow = true
      K.box(g, bx1 - bx0 + 1.6, 0.8, bz1 - bz0 + 1.6, K.paint('#2c2a28', 0.6), (bx0 + bx1) / 2, -4.6, (bz0 + bz1) / 2, { r: 0.3 })
      // asphalt: truck yard right, parking front
      K.box(g, 16, 0.04, D + 4, yardM, b.x1 + 9, 0, cz, { r: 0 })
      K.box(g, W * 0.55, 0.04, 11, yardM, b.x0 + W * 0.3, 0, b.z1 + 8, { r: 0 })
      K.box(g, 3, 0.04, 11, yardM, b.x0 + W * 0.62, 0, b.z1 + 8, { r: 0 })
      const line = K.paint('#f3efe4', 0.6)
      for (let i = 0; i < Math.floor(W * 0.55 / 2.8); i++) K.box(g, 0.08, 0.01, 4.6, line, b.x0 + 1.5 + i * 2.8, 0.04, b.z1 + 5.6, { r: 0 })
      for (let i = 0; i < 4; i++) K.box(g, 3.0, 0.01, 0.1, line, b.x1 + 9, 0.04, b.z0 + 3 + i * 4.2, { r: 0 })
      // trucks at the shipping doors, cars in the lot
      const r = FS.rng(5)
      const trucks = Math.max(1, Math.min(3, Math.floor(D / 9)))
      for (let i = 0; i < trucks; i++) {
        const tr = K.truck(g, ['#3e6ea6', '#c7473a', '#2e7d83'][i % 3], ['#f2efe8', '#e7e2d6', '#dfe5e8'][i % 3])
        tr.rotation.y = Math.PI
        tr.position.set(b.x1 + 2.5 + 12.2, 0, b.z0 + 4.5 + i * 5.2)
        tr.scale.setScalar(1)
      }
      const carCols = ['#c7473a', '#3e6ea6', '#e9e4d8', '#2b2e33', '#eab33b', '#6f8f7a', '#a7adb3']
      for (let i = 0; i < Math.floor(W * 0.55 / 2.8); i++) {
        if (r() < 0.3) continue
        const c = K.car(g, carCols[Math.floor(r() * carCols.length)])
        c.rotation.y = Math.PI / 2
        c.position.set(b.x0 + 2.9 + i * 2.8, 0, b.z1 + 5.6 + (r() - 0.5) * 0.2)
      }
      // trees along the front and the left, and a hedge line
      for (let i = 0; i < 14; i++) {
        const tx = bx0 + 3 + ((bx1 - bx0 - 6) * i) / 13 + (r() - 0.5) * 2
        if (tx > b.x0 + W * 0.02 && tx < b.x0 + W * 0.66) K.tree(g, tx, bz1 - 3 - r() * 2, 0.8 + r() * 0.5, Math.floor(r() * 4))
        else K.tree(g, tx, b.z1 + 4 + r() * 6, 0.8 + r() * 0.5, Math.floor(r() * 4))
      }
      for (let i = 0; i < 7; i++) K.tree(g, bx0 + 3 + r() * 6, b.z0 + (D * i) / 6 + r() * 2, 0.9 + r() * 0.5, Math.floor(r() * 4))
      for (let i = 0; i < 6; i++) K.tree(g, b.x0 + (W * i) / 5 + r() * 3, bz0 + 4 + r() * 3, 0.9 + r() * 0.6, Math.floor(r() * 4))
      // a sign by the entrance with the factory name
      const sc = document.createElement('canvas')
      sc.width = 1024; sc.height = 256
      const sx = sc.getContext('2d')
      sx.fillStyle = '#26282b'
      sx.fillRect(0, 0, 1024, 256)
      sx.fillStyle = '#f4efe4'
      sx.font = '700 92px ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif'
      sx.textBaseline = 'middle'
      sx.fillText((this.plan.spec.sign || this.plan.spec.title || 'Factory').toUpperCase().slice(0, 18), 40, 110)
      sx.font = '500 44px ui-monospace, Menlo, monospace'
      sx.fillStyle = '#e3b23c'
      sx.fillText((this.plan.spec.signSub || FS.fmt(this.plan.perDay) + ' ' + (this.plan.spec.product.unit || 'units') + ' / day').toUpperCase(), 44, 200)
      const st = new T.CanvasTexture(sc)
      st.colorSpace = T.SRGBColorSpace
      st.anisotropy = 8
      const sign = K.group(g, b.x0 + W * 0.7, 0, b.z1 + 3.2)
      K.box(sign, 0.15, 1.2, 0.15, trim, -2.2, 0, 0)
      K.box(sign, 0.15, 1.2, 0.15, trim, 2.2, 0, 0)
      const sm = new T.Mesh(new T.BoxGeometry(5.2, 1.3, 0.2), [trim, trim, trim, trim, new T.MeshStandardMaterial({ map: st, roughness: 0.5 }), trim])
      sm.position.set(0, 1.85, 0)
      sm.castShadow = true
      sign.add(sm)
      K.freeze(g)
      // the table under the diorama
      const table = new T.Mesh(new T.PlaneGeometry(2000, 2000), new T.MeshStandardMaterial({ color: this.look.tableColor || '#d9d1c2', roughness: 0.92 }))
      table.rotation.x = -Math.PI / 2
      table.position.y = -5.0
      table.receiveShadow = true
      this.scene.add(table)
      this.look.fitSun({ x0: bx0, x1: bx1, z0: bz0, z1: bz1 }, [-0.62, 0.78, -0.38])
      this.base = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 }
    }

    /* ---- clutter that makes a hall read as a working floor: pallets, racks, carts, drums */
    _props() {
      const b = this.bounds
      const occ = []
      for (const S of Object.values(this.st)) occ.push([S.I.x - S.I.W / 2 - 1.2, S.I.x + S.I.W / 2 + 1.2, S.I.z - S.I.D / 2 - 1.2, S.I.z + S.I.D / 2 + 1.2])
      for (const E of Object.values(this.edges)) for (let i = 1; i < E.route.p.length; i++) { const a = E.route.p[i - 1], c = E.route.p[i]; occ.push([Math.min(a.x, c.x) - 1.5, Math.max(a.x, c.x) + 1.5, Math.min(a.z, c.z) - 1.5, Math.max(a.z, c.z) + 1.5]) }
      occ.push([b.x1 - 7.6, b.x1, b.z0, b.z0 + 5]) // office
      occ.push([b.x0, b.x0 + 3.4, b.z0, b.z1]) // receiving racks
      occ.push([b.x0, b.x1, b.z1 - 4.2, b.z1]) // walkway + AMR loop
      if (this.shipAt) occ.push([this.shipAt.x - 2.5, this.shipAt.x + 2.5, this.shipAt.z - 3, this.shipAt.z + 3])
      const free = (x0, x1, z0, z1) => !occ.some((o) => x1 > o[0] && x0 < o[1] && z1 > o[2] && z0 < o[3])
      const g = K.group(this.root)
      const r = FS.rng(77)
      const cols = [K.C.card, '#d7c29a', '#9fb7c9', '#c9d1b0', '#e2713a', '#3e6ea6']
      const C = 3.2
      // racking along the back wall where it is free
      for (let x = b.x0 + 4; x < b.x1 - 8; x += 3.0) if (free(x - 1.4, x + 1.4, b.z0 + 0.2, b.z0 + 1.6)) { K.rack(g, x, b.z0 + 0.9, 2.7, 1.1, 4, 1.35, 0.75, Math.floor(r() * 99)); occ.push([x - 1.4, x + 1.4, b.z0, b.z0 + 2.4]) }
      for (let x = b.x0 + 3.6; x < b.x1 - 2; x += C) for (let z = b.z0 + 2.6; z < b.z1 - 4.5; z += C) {
        // keep clutter to the edges of the hall, like a real floor: storage along the walls, the middle stays clear
        const edge = Math.min(x - b.x0, b.x1 - x, z - b.z0)
        if (edge > 7.5 || !free(x - 1.3, x + 1.3, z - 1.3, z + 1.3) || r() > 0.55) continue
        const k = Math.floor(r() * 7), p = K.group(g, x + (r() - 0.5) * 0.6, 0, z + (r() - 0.5) * 0.6)
        p.rotation.y = Math.floor(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.15
        if (k <= 2) { K.pallet(p, 0, 0, 0); K.crates(p, 0, 0, 2, 2, 1 + Math.floor(r() * 3), K.paint(cols[Math.floor(r() * 4)], 0.85), 0.52) }
        else if (k === 3) { K.pallet(p, 0, 0, 0); K.box(p, 1.15, 1.1 + r() * 0.5, 0.95, K.glass('#f4f6f6', 0.55), 0, 0.14, 0, { r: 0.06 }); K.crates(p, 0, 0, 2, 2, 2, K.paint(K.C.card, 0.85), 0.5) }
        else if (k === 4) { // rolling cart with totes
          K.box(p, 1.3, 0.04, 0.7, K.metal(), 0, 0.3, 0); K.box(p, 1.3, 0.04, 0.7, K.metal(), 0, 0.9, 0)
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) { K.box(p, 0.04, 1.0, 0.04, K.metal(), sx * 0.62, 0.1, sz * 0.32); K.cyl(p, 0.06, 0.04, K.paint('#222', 0.8), sx * 0.6, 0.0, sz * 0.3, { axis: 'z', seg: 10 }) }
          for (let i = 0; i < 3; i++) { K.bin(p, -0.42 + i * 0.42, 0.34, 0, cols[3 + (i % 3)], 0.36); K.bin(p, -0.42 + i * 0.42, 0.94, 0, cols[3 + ((i + 1) % 3)], 0.36) }
        } else if (k === 5) { // drums
          for (let i = 0; i < 3; i++) K.cyl(p, 0.3, 0.9, K.paint(['#2f6fae', '#c7473a', '#3a7d4f'][Math.floor(r() * 3)], 0.5, 0.2), (i % 2) * 0.62 - 0.3, 0, Math.floor(i / 2) * 0.62 - 0.3, { seg: 18 })
        } else { // tool chest and a bench
          K.box(p, 0.8, 1.0, 0.5, K.paint('#c7473a', 0.45), -0.5, 0, 0, { r: 0.04 }); for (let i = 0; i < 4; i++) K.box(p, 0.7, 0.02, 0.02, K.metal(), -0.5, 0.2 + i * 0.2, 0.26, { r: 0 })
          K.box(p, 1.2, 0.05, 0.6, K.paint('#b88a5a', 0.8), 0.6, 0.85, 0, { r: 0.01 }); for (const sx of [-1, 1]) K.box(p, 0.05, 0.85, 0.5, K.paint('#3a3d42', 0.6), 0.6 + sx * 0.55, 0, 0)
        }
      }
      // fire points on the columns line and floor arrows on the main aisle
      for (let x = b.x0 + 3; x < b.x1; x += 9) { K.box(g, 0.22, 0.6, 0.22, K.paint('#c7473a', 0.4), x + 0.4, 0, b.z0 + 0.6, { r: 0.06 }) }
      K.freeze(g)
    }

    /* ---- tokens: one instanced mesh per product stage */
    _tokens() {
      const stages = Object.assign({}, this.plan.spec.stages || {})
      this.stageMesh = {}
      const keys = new Set(['__raw'])
      for (const s of this.plan.stations) { if (s.stage) keys.add(s.stage); if (s.input) keys.add(s.input) }
      for (const k of keys) {
        const def = stages[k] || { shape: 'crate', color: '#c49a63' }
        const sg = this._stageGeo(def) // maiaCITY: our asset's geometry and material for a stage that names one
        const im = new T.InstancedMesh(sg.geo, sg.mat, 4096)
        im.castShadow = true
        im.receiveShadow = true
        im.count = 0
        im.frustumCulled = false
        this.root.add(im)
        this.stageMesh[k] = im
      }
      this._m = new T.Matrix4()
      this._q = new T.Quaternion()
      this._e = new T.Euler()
      this._s = V(1, 1, 1)
    }

    /* ---- people and vehicles moving about */
    _people() {
      const b = this.bounds
      this.walkers = []
      const r = FS.rng(21)
      // operators beside side machines, one per two machines
      for (const S of Object.values(this.st)) {
        if (S.I.inline || /bench|kitting|bay/.test(S.def.machine)) continue
        const n = S.def.operators != null ? S.def.operators : Math.max(1, Math.round(S.machines.length / 2))
        for (let i = 0; i < n; i++) {
          const p = K.person(this.root, { seed: 100 + Object.keys(this.st).indexOf(S.id) * 9 + i })
          const m = S.machines[Math.min(S.machines.length - 1, i * 2)]
          const e = this._entryLocal(m)
          const side = m.side || -1
          const lp = V(e.x + 0.9, 0, S.zs + side * -0.0 + (side < 0 ? 0.9 : -0.9))
          p.g.position.copy(this._w(S, lp))
          p.g.rotation.y = S.g.rotation.y + (side < 0 ? Math.PI : 0)
          this.walkers.push({ p, kind: 'operator', S, m, base: p.g.position.clone(), seed: r() * 10 })
        }
      }
      // walkers on the front walkway
      for (let i = 0; i < 4; i++) {
        const p = K.person(this.root, { seed: 300 + i })
        this.walkers.push({ p, kind: 'walk', z: b.z1 - 1.6 + (r() - 0.5) * 0.5, x0: b.x0 + 2, x1: b.x1 - 2, u: r(), v: 0.035 + r() * 0.02, dir: r() < 0.5 ? 1 : -1 })
      }
      // forklifts between the receiving racks and the raw feeders
      this.lifts = []
      const srcs = Object.values(this.st).filter((S) => S.rawAt)
      for (let i = 0; i < Math.min(2, srcs.length + 1); i++) {
        const f = K.forklift(this.root, i ? K.C.yellow : K.C.orange)
        const S = srcs[i % srcs.length]
        this.lifts.push({ f, a: V(b.x0 + 4.2, 0, S ? S.rawAt.z + (i ? 1.5 : -1.5) : 0), b: S ? S.rawAt.clone().add(V(-1.8, 0, i ? 1.6 : -1.6)) : V(0, 0, 0), u: i * 0.5 })
      }
      // AMRs on a loop around the line
      this.amrs = []
      const loop = new Route([V(b.x0 + 4, 0, b.z1 - 3.3), V(b.x1 - 4, 0, b.z1 - 3.3), V(b.x1 - 4, 0, b.z0 + 2.4), V(b.x0 + 4, 0, b.z0 + 2.4), V(b.x0 + 4, 0, b.z1 - 3.3)])
      this.amrLoop = loop
      for (let i = 0; i < 3; i++) {
        const a = K.amr(this.root)
        K.bin(a.top, 0, 0, 0, [K.C.blue, K.C.yellow, K.C.red][i], 0.5)
        this.amrs.push({ a, d: (loop.len * i) / 3 })
      }
    }

    /* ---------------------------------------------------------- per frame */
    update(dt, speed) {
      this.t += dt
      const sim = this.sim, t = this.t
      K.tickBelts(dt, Math.min(3, 0.6 + Math.sqrt(speed) * 0.15))
      if (Math.floor(t * 8) !== this._scrT) { this._scrT = Math.floor(t * 8); K.tickScreens(t) }
      // machines
      for (const S of Object.values(this.st)) {
        const s = sim.st[S.id]
        const pm = S.I.pm
        S.machines.forEach((m, k) => {
          const svs = s.servers.slice(k * pm, k * pm + pm)
          let state = 'idle', p = 0, busy = false
          if (svs.some((x) => x.state === 'down')) state = 'down'
          else if (svs.some((x) => x.state === 'busy')) state = 'busy'
          else if (svs.some((x) => x.state === 'blocked')) state = 'blocked'
          busy = svs.some((x) => x.state === 'busy')
          if (svs[0]) p = sim.progress(svs[0])
          if (!svs.length) state = 'off'
          m.anim({ state, p, t, dt, busy, k, n: svs.length })
          if (m.pop < 1) { m.pop = Math.min(1, m.pop + dt * 1.6); const e = 1 - Math.pow(1 - m.pop, 3) * Math.cos(m.pop * 5); m.wrap.scale.set(1, Math.max(0.001, e), 1); m.wrap.position.y = (1 - Math.min(1, m.pop * 1.4)) * 6 }
        })
      }
      this._placeTokens(dt, speed)
      this._move(dt)
    }

    _placeTokens(dt, speed) {
      const sim = this.sim
      const seen = new Set()
      const vspeed = Math.min(14, 2.2 + Math.sqrt(speed) * 0.55)
      const put = (job, loc) => {
        seen.add(job.id)
        let v = this.vis.get(job.id)
        if (!v) {
          v = { id: job.id, pos: null, route: null, d: 0, goal: 0, key: '', stage: null, born: this.t, scale: 0, dying: 0, yaw: Math.random() * 0.4 - 0.2 }
          this.vis.set(job.id, v)
        }
        v.stage = job.stage ? this.plan.byId[job.stage].stage || null : null
        v.last = loc
        this._target(v, loc, vspeed)
      }
      for (const s of sim.list) {
        for (const k in s.inputs) {
          const q = s.inputs[k]
          for (let i = 0; i < q.length; i++) put(q[i], { type: 'q', edge: k + '>' + s.id, i, st: s.id, input: k })
        }
        const pm = this.st[s.id].I.pm
        s.servers.forEach((sv, i) => {
          const p = sim.progress(sv)
          sv.jobs.forEach((j, b) => put(j, { type: 'w', st: s.id, sv: i, slot: (i % pm) * s.batch + b, m: Math.floor(i / pm), p }))
          sv.out.forEach((j, b) => put(j, { type: 'o', st: s.id, sv: i, slot: (i % pm) * s.batch + b, m: Math.floor(i / pm), p: 1 }))
        })
      }
      // tokens the sim no longer holds: shipped, scrapped or consumed by an assembly
      for (const v of this.vis.values()) {
        if (seen.has(v.id) || v.dying) continue
        v.dying = 1
        const L = v.last || {}
        const S = this.st[L.st]
        let to = null
        if (L.type === 'w' || L.type === 'o') to = L.st === this.plan.sink ? this.shipAt : S && S.scrapAt ? this._w(S, S.scrapAt) : null
        else if (S) { const m = S.machines[0]; to = this._mw(S, m, m.entry.clone()) }
        v.route = new Route([v.pos.clone(), ...(to ? [to] : [])])
        v.d = 0
        v.goal = v.route.len
        if (L.st === this.plan.sink && (L.type === 'w' || L.type === 'o')) this._shipped = (this._shipped || 0) + 1
      }
    }

    /** decide where a token should go for its sim location */
    _target(v, loc, vspeed) {
      const key = loc.type === 'q' ? 'q' + loc.edge : loc.type + loc.st + ':' + loc.sv + ':' + loc.slot
      const S = this.st[loc.st]
      v.speed = vspeed
      if (loc.type === 'q') {
        const E = this.edges[loc.edge]
        const per = Math.max(1, Math.floor(E.route.len / E.sp))
        const lane = Math.floor(loc.i / per), k = loc.i % per
        const dist = Math.max(0, E.route.len - 0.35 - k * E.sp)
        if (v.key !== key || !v.route) {
          const from = v.pos ? [v.pos.clone()] : []
          const pre = []
          // leaving a machine: out over the spine to the station out port
          if (v.pos && v.last0 && (v.last0.type === 'w' || v.last0.type === 'o')) pre.push(...this._outPath(this.st[v.last0.st], v.last0))
          if (!v.pos) { v.pos = E.route.p[0].clone(); from.push(v.pos.clone()) }
          v.route = new Route([...from, ...pre, ...E.route.p])
          v.base = v.route.len - E.route.len
          v.key = key
          v.d = 0
        }
        v.goal = v.base + dist
        v.lane = lane
        v.fixed = null
      } else {
        const m = S.machines[loc.m] || S.machines[0]
        if (v.key !== key) {
          if (!v.pos) v.pos = this._mw(S, m, m.entry.clone())
          const pts = [v.pos.clone()]
          if (v.last0 && v.last0.type === 'q') pts.push(...this._inPath(S, m))
          pts.push(this._workPos(S, m, loc.slot, loc.type === 'o' ? 1 : loc.p, loc))
          v.route = new Route(pts)
          v.d = 0
          v.key = key
        }
        v.goal = v.route.len
        v.lane = 0
        v.fixed = { S, m, slot: loc.slot, loc }
      }
      v.last0 = loc
    }
    _workPos(S, m, slot, p) {
      return this._mw(S, m, m.work(slot, p))
    }
    _inPath(S, m) {
      if (S.I.inline) {
        const pts = [this._w(S, S.inPort)]
        if (Math.abs(m.zLane - S.zs) > 0.01) pts.push(this._w(S, V(-S.I.W / 2 + 0.7, BELT_Y, S.zs)), this._w(S, V(-S.I.W / 2 + 0.7, BELT_Y, m.zLane)))
        pts.push(this._mw(S, m, m.entry.clone()))
        return pts
      }
      const e = this._entryLocal(m)
      return [this._w(S, S.inPort), this._w(S, V(e.x, BELT_Y, S.zs)), this._w(S, V(e.x, BELT_Y, e.z))]
    }
    _outPath(S, loc) {
      const m = S.machines[loc.m] || S.machines[0]
      if (S.I.inline) {
        const pts = [this._mw(S, m, m.exit.clone())]
        if (Math.abs(m.zLane - S.zs) > 0.01) pts.push(this._w(S, V(S.I.W / 2 - 0.7, BELT_Y, m.zLane)), this._w(S, V(S.I.W / 2 - 0.7, BELT_Y, S.zs)))
        pts.push(this._w(S, S.outPort))
        return pts
      }
      const e = this._entryLocal(m)
      return [this._w(S, V(e.x, BELT_Y, e.z)), this._w(S, V(e.x + 0.3, BELT_Y, S.zs)), this._w(S, S.outPort)]
    }

    _move(dt) {
      for (const im of Object.values(this.stageMesh)) im.count = 0
      const tmp = V(0, 0, 0)
      const dead = []
      for (const v of this.vis.values()) {
        if (v.route) {
          v.d = Math.min(v.goal, v.d + v.speed * dt)
          if (v.d < v.goal - 8) v.d = v.goal - 8 // never lag far behind the sim
          v.route.at(v.d, tmp)
          v.pos = (v.pos || V(0, 0, 0)).copy(tmp)
          // follow the machine while inside it
          if (v.fixed && v.d >= v.goal - 1e-3) {
            const f = v.fixed
            v.pos.copy(this._workPos(f.S, f.m, f.slot, f.loc.type === 'o' ? 1 : this.sim.progress(this.sim.st[f.S.id].servers[f.loc.sv] || {})))
          }
        }
        if (v.dying) {
          if (v.d >= v.goal - 1e-3) v.dying += dt * 5
          if (v.dying > 2) { dead.push(v.id); continue }
        }
        v.scale = v.dying ? Math.max(0, 1 - (v.dying - 1)) : Math.min(1, v.scale + dt * 5)
        const im = this.stageMesh[v.stage || this._inputStage(v)] || this.stageMesh.__raw
        if (im.count >= im.instanceMatrix.count) continue
        const yaw = v.route ? v.route.dirAt(v.d) + v.yaw : v.yaw
        this._e.set(0, yaw, 0)
        this._q.setFromEuler(this._e)
        this._s.setScalar(Math.max(0.001, v.scale))
        tmp.copy(v.pos)
        if (v.lane && v.d >= v.goal - 0.05) tmp.y += Math.min(4, v.lane) * 0.4
        this._m.compose(tmp, this._q, this._s)
        im.setMatrixAt(im.count++, this._m)
      }
      for (const id of dead) this.vis.delete(id)
      for (const im of Object.values(this.stageMesh)) im.instanceMatrix.needsUpdate = true
      // shipping pallets fill up and get taken away
      const shipped = this._shipped || 0
      const per = this.shipLayout.per
      const n = shipped % (per * 3)
      this.shipFill.count = n
      for (let i = 0; i < n; i++) {
        const pi = Math.floor(i / per), k = i % per
        const p = this.shipPallets[pi]
        const [lx, ly, lz, ls] = this.shipLayout.at(k) // maiaCITY: where the k-th product sits on its pallet
        this._m.compose(V(p.position.x + lx, ly, p.position.z + lz), this._q.identity(), this._s.setScalar(ls))
        this.shipFill.setMatrixAt(i, this._m)
      }
      this.shipFill.instanceMatrix.needsUpdate = true
    }
    _inputStage(v) {
      const L = v.last
      if (!L) return '__raw'
      const st = this.plan.byId[L.st]
      return st && st.input ? st.input : '__raw'
    }

    /** people, forklifts and robots that move on their own clocks */
    animateLife(dt) {
      const t = this.t
      for (const w of this.walkers) {
        if (w.kind === 'operator') {
          w.p.g.visible = w.S.g.visible && w.S.g.scale.y > 0.97 && w.S.g.position.y < 0.05
          const s = this.sim.st[w.S.id]
          const busy = s.servers.some((x) => x.state === 'busy')
          w.p.pose(busy ? 'work' : 'stand', t + w.seed)
        } else {
          w.u += dt * w.v * w.dir
          if (w.u > 1) { w.u = 1; w.dir = -1 }
          if (w.u < 0) { w.u = 0; w.dir = 1 }
          w.p.g.position.set(w.x0 + (w.x1 - w.x0) * w.u, 0, w.z)
          w.p.g.rotation.y = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2
          w.p.pose('walk', t * 1.0 + w.x0)
        }
      }
      for (const L of this.lifts) {
        L.u += dt * 0.06
        const ph = L.u % 1
        const f = ph < 0.5 ? K.ease(Math.min(1, ph * 2.4)) : K.ease(Math.min(1, (1 - ph) * 2.4))
        L.f.g.position.lerpVectors(L.a, L.b, f)
        L.f.g.rotation.y = ph < 0.5 ? Math.atan2(-(L.b.z - L.a.z), L.b.x - L.a.x) : Math.atan2(-(L.a.z - L.b.z), L.a.x - L.b.x) + Math.PI
        L.f.load.visible = ph < 0.5
        L.f.fork.position.y = 0.1 + (ph < 0.5 ? 0.15 : 0.02)
      }
      for (const a of this.amrs) {
        a.d = (a.d + dt * 1.2) % this.amrLoop.len
        this.amrLoop.at(a.d, a.a.g.position)
        a.a.g.rotation.y = this.amrLoop.dirAt(a.d)
      }
      if (this._officePeople) this._officePeople.forEach((p, i) => p.pose('work', t * 0.4 + i))
    }

    /** highlight: bottleneck (red, pulsing) and selection (white) */
    highlight(bnId, selId, t) {
      for (const S of Object.values(this.st)) {
        const isB = S.id === bnId, isS = S.id === selId
        const r = S.ring
        if (isB) {
          const k = 0.55 + 0.45 * Math.sin(t * 4)
          r.mat.color.set('#ff4a2a')
          r.mat.opacity = 0.65 + 0.35 * k
          r.glowMat.opacity = 0.22 + 0.25 * k
        } else if (isS) {
          r.mat.color.set('#ffffff')
          r.mat.opacity = 0.95
          r.glowMat.opacity = 0
        } else { r.mat.opacity = 0; r.glowMat.opacity = 0 }
      }
    }

    /** the assembly animation: stations rise along the flow and their machines drop in one by one; f in 0..1 */
    assemble(f) {
      const list = this.plan.stations
      const n = list.length
      let placed = 0, total = 0, building = null
      list.forEach((s, i) => {
        const S = this.st[s.id]
        const a = Math.max(0, Math.min(1, (f * (n + 2) - i) / 2.2))
        S.g.visible = a > 0
        S.g.position.y = 0
        S.g.scale.set(1, Math.max(0.001, Math.min(1, a * 4)), 1)
        const k = S.machines.length
        S.machines.forEach((m, j) => {
          const on = a > (j + 1) / (k + 1.5)
          if (on && !m.wrap.visible) m.pop = 0
          if (!on) m.pop = 1
          m.wrap.visible = on
          if (!on) { m.wrap.scale.set(1, 1, 1); m.wrap.position.y = 0 }
          if (on) placed++
          if (on && m.pop < 1) building = s
        })
        total += k
        if (a > 0 && a < 1 && !building) building = s
      })
      for (const E of Object.values(this.edges)) {
        const ia = list.findIndex((s) => s.id === E.to)
        const a = Math.max(0, Math.min(1, (f * (n + 2) - ia - 1.5) / 1.5))
        E.g.visible = a > 0
        E.g.scale.set(1, Math.max(0.001, a), 1)
      }
      this.hall.visible = true
      this.built = { placed, total, building: building ? building.name : null }
      return this.built
    }
  }
