/*
 * Ported from AirSup's factory-skill (https://github.com/AirsupHQ/factory-skill, commit 9fde755, MIT licence:
 * Copyright (c) 2026 Air Supply Technologies Inc., .claude/skills/factory-skill/LICENSE) into maiaCITY as an ES module
 * (2026-10-15): their runtime/app.js, the page that boots everything (plan -> Sim -> Look -> World -> HUD), changed to
 * live inside a page of our app instead of owning the document: `boot(spec, host, opts)` mounts the canvas and the HUD
 * in `host` (sized by it, not by the window), takes the assets the line is built from (the pack by its ref), writes
 * "Stands here" in the inspector for a station whose machine stands in for one of ours, and gives back the app with a
 * `dispose()`. The HUD, the inspector, the what-ifs, the camera, the clocks and the film hook are theirs, line for line
 * where nothing had to change; `@ts-nocheck` so it stays theirs.
 *
 * URL options (theirs): ?intro=1 types the prompt and assembles the factory, ?speed=60, ?seed=3, ?release=takt,
 * ?select=<station>, ?film=1 (no clock: window.__film.step(dt) drives every frame), ?ui=0 hides the HUD, ?assemble=0.
 */
// @ts-nocheck
import { T } from './three.js'
import { plan as makePlan, Sim, forecast, fmt as fmt_ } from './des.js'
import { K } from './kit.js'
import { Look } from './look.js'
import { World } from './world.js'

const fmt = (v) => fmt_(v)
const $ = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstChild }
const COL = { busy: 'var(--fs-busy)', down: 'var(--fs-down)', blocked: 'var(--fs-block)', starved: 'var(--fs-starve)' }

function niceSpeed(v) {
  const S = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 3600]
  return S.reduce((a, b) => (Math.abs(Math.log(b / v)) < Math.abs(Math.log(a / v)) ? b : a))
}

/**
 * Boot a factory in `host` (a positioned element that fills the page): the plan, the simulation, the renderer, the
 * world and the HUD. `opts.assets` maps an asset ref to `{ geometry, material }` for a product stage drawn as one of
 * our assets (`stages.x = { shape: 'asset', ref }`); `opts.query` stands in for the page's URL options.
 * Returns the app (also `globalThis.factory`, as AirSup's page had it, for scripts and shots).
 * @returns {{ dispose: () => void, [k: string]: any }}
 */
export function boot(spec, host, opts = {}) {
  const Q = new URLSearchParams(opts.query != null ? opts.query : globalThis.location ? globalThis.location.search : '')
  spec = Object.assign({}, spec)
  if (Q.get('seed')) spec.seed = Number(Q.get('seed'))
  if (Q.get('release')) spec.release = Q.get('release')
  const plan = makePlan(spec)
  const sim = new Sim(plan)
  const film = Q.get('film') === '1'
  host.classList.add('fs-root')
  if (film) host.classList.add('fs-film')
  const canvas = document.createElement('canvas')
  canvas.className = 'fs-canvas'
  host.appendChild(canvas)
  const clean = Q.get('clean') === '1'
  const look = new Look(canvas, {
    background: clean ? '#f6f5f2' : undefined, preserve: film || Q.get('preserve') === '1', pixelRatio: Number(Q.get('pr')) || undefined, maxPixelRatio: film ? 1 : 2, ao: Q.get('ao') !== '0', bloom: Q.get('bloom') !== '0', tilt: Q.get('tilt') !== '0', grade: Q.get('grade') !== '0' })
  look.setTilt(Object.assign({ focusY: 0.46, band: 0.075, amount: 20, tilt: -0.04 }, spec.look && spec.look.tilt || {}))
  if (clean) { look.tableColor = '#eeebe5'; look.scene.fog.near = 400; look.grade.uniforms.vig.value = 0.1; look.grade.uniforms.grain.value = 0.008 }
  const world = new World(look, plan, sim, { assets: opts.assets || {} })

  // warm the line up so it opens running: 3 production hours
  const warm = Q.get('warm') != null ? Number(Q.get('warm')) : Math.max(3, (plan.pathCT * 2.5) / 3600)
  sim.runUntil(Math.min(2, warm * 0.6) * 3600)
  sim.resetWindow()
  sim.runUntil(warm * 3600)

  const base = niceSpeed(plan.taktToken * 1.6)
  const app = {
    plan, sim, look, world, spec, film, host,
    speed: Number(Q.get('speed')) || base, speeds: [1, base, niceSpeed(base * 5), niceSpeed(base * 25)].filter((v, i, a) => a.indexOf(v) === i),
    paused: false, sel: Q.get('select') || null, t: 0, assembleT: 0, assembleLen: Q.get('build') ? Number(Q.get('build')) : Q.get('assemble') === '0' ? 0.001 : Q.get('intro') === '1' ? 5.5 : 2.6, introLen: Q.get('intro') === '1' ? 3.4 : 0,
    bn: null, bnStable: null, forecastRes: null, lastChangeT: -1e9,
  }
  globalThis.factory = app

  /* ---- camera */
  const cam = look.camera
  const lb = world.lineBounds
  const ctr = new T.Vector3((lb.x0 + lb.x1) / 2, 0, (lb.z0 + lb.z1) / 2 + 1.5)
  const span = Math.max(lb.x1 - lb.x0, (lb.z1 - lb.z0) * 1.75) * 0.66
  const view = Object.assign({ az: 0.68, el: 0.72, dist: span / (2 * Math.tan((cam.fov * Math.PI) / 360)) * 0.98 + 6 }, spec.look && spec.look.camera || {})
  const controls = new T.OrbitControls(cam, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = 1.2
  controls.minPolarAngle = 0.25
  controls.minDistance = 12
  controls.maxDistance = span * 5
  controls.target.copy(ctr)
  const setView = (v, target = ctr) => {
    cam.position.set(target.x + Math.sin(v.az) * Math.cos(v.el) * v.dist, target.y + Math.sin(v.el) * v.dist, target.z + Math.cos(v.az) * Math.cos(v.el) * v.dist)
    controls.target.copy(target)
    cam.lookAt(target)
  }
  setView(view)
  app.home = { ...view, target: ctr.clone() }
  app.view = setView
  let camAnim = null
  /** glide the camera to {az, el, dist, target} over dur seconds */
  app.camTo = (v, dur = 2) => {
    const from = { pos: cam.position.clone(), tgt: controls.target.clone() }
    const tgt = v.target ? new T.Vector3().copy(v.target) : controls.target.clone()
    const to = new T.Vector3(tgt.x + Math.sin(v.az) * Math.cos(v.el) * v.dist, tgt.y + Math.sin(v.el) * v.dist, tgt.z + Math.cos(v.az) * Math.cos(v.el) * v.dist)
    camAnim = { from, to, tgt, t: 0, dur }
  }
  app.stationCenter = (id) => { const S = world.st[id]; return new T.Vector3(S.g.position.x, 0.8, S.g.position.z) }

  /* ---- HUD */
  const ui = Q.get('ui') !== '0' && !clean
  const uiMin = Q.get('ui') === 'min'
  const unit = spec.product.unit || 'units'
  const frame = $(`<div class="fs-frame"><div class="fs-corner tl"><b>${esc(spec.fig || 'Factory skill')}</b> &nbsp;·&nbsp; ${esc(spec.kicker || 'live discrete event simulation')}</div><div class="fs-corner tr">${esc(spec.title)}</div><div class="fs-corner bl">click a station to change it &nbsp;·&nbsp; drag to orbit</div><div class="fs-corner br" id="fs-readout"></div></div>`)
  const prompt = $(`<div class="fs-prompt"><span class="chev">&gt;</span><span class="q"></span><span class="caret"></span><span class="send">&#8593;</span></div>`)
  const panel = $(`<div class="fs-panel">
    <div class="fs-card fs-fade" id="fs-kpi">
      <div class="fs-row"><span class="fs-lab">Throughput</span><span class="fs-lab" id="fs-pct"></span></div>
      <div class="fs-row" style="margin-top:8px"><span class="fs-big" id="fs-tp">0<small>${esc(unit)} / day</small></span></div>
      <div class="fs-target"><i id="fs-tbar"></i><u id="fs-ttick"></u></div>
      <div class="fs-row" style="margin-top:7px"><span class="fs-lab">target ${fmt(plan.perDay)} / day</span><span class="fs-lab" id="fs-win"></span></div>
      <canvas class="fs-spark" id="fs-spark" width="600" height="68"></canvas>
      <div class="fs-kpis">
        <div class="fs-kpi"><span class="fs-lab">Takt</span><b>${fmt(plan.takt)}<small>s</small></b></div>
        <div class="fs-kpi"><span class="fs-lab">WIP</span><b id="fs-wip">0</b></div>
        <div class="fs-kpi"><span class="fs-lab">Lead time</span><b id="fs-lead">0</b></div>
      </div>
    </div>
    <div class="fs-card fs-fade" id="fs-bncard"><div class="fs-lab" style="margin-bottom:9px">Bottleneck</div><div class="fs-bn"><div class="fs-pulse"></div><div><div class="name" id="fs-bn">measuring</div><div class="sub" id="fs-bnsub"></div></div></div></div>
    <div class="fs-card fs-insp fs-fade" id="fs-insp"></div>
    <div class="fs-card fs-list fs-fade" id="fs-list"></div>
  </div>`)
  const speedBar = $(`<div class="fs-speed">${app.speeds.map((s) => `<button class="fs-btn" data-s="${s}">${s}x</button>`).join('')}<button class="fs-btn" data-s="0">||</button><span class="fs-clock" id="fs-clock"></span></div>`)
  if (ui) { if (uiMin) host.append(frame, prompt); else host.append(frame, prompt, panel, speedBar) }
  const el = (id) => host.querySelector('#' + id)
  prompt.querySelector('.q').textContent = app.introLen ? '' : spec.prompt
  speedBar.addEventListener('click', (e) => {
    const s = e.target.dataset && e.target.dataset.s
    if (s == null) return
    if (s === '0') app.paused = !app.paused
    else { app.speed = Number(s); app.paused = false }
    paintSpeed()
  })
  const paintSpeed = () => speedBar.querySelectorAll('.fs-btn').forEach((b) => b.classList.toggle('on', b.dataset.s === '0' ? app.paused : !app.paused && Number(b.dataset.s) === app.speed))
  paintSpeed()

  // station rows
  const list = el('fs-list')
  if (list) {
    list.innerHTML = `<div class="fs-legend"><span style="--c:var(--fs-busy)">busy</span><span style="--c:var(--fs-block)">blocked</span><span style="--c:var(--fs-starve)">starved</span><span style="--c:var(--fs-down)">down</span></div>` +
      plan.stations.map((s) => `<div class="fs-st" data-id="${s.id}"><span class="n">${esc(s.name)}</span><span class="x" data-x></span><span class="u" data-u></span><div class="bar"><i data-k="busy" style="background:${COL.busy}"></i><i data-k="blocked" style="background:${COL.blocked}"></i><i data-k="starved" style="background:${COL.starved}"></i><i data-k="down" style="background:${COL.down}"></i></div></div>`).join('')
    list.addEventListener('click', (e) => { const r = e.target.closest('.fs-st'); if (r) select(r.dataset.id) })
  }

  function select(id) {
    app.sel = id && app.sel === id ? null : id
    paintInspector()
    if (list) list.querySelectorAll('.fs-st').forEach((r) => r.classList.toggle('sel', r.dataset.id === app.sel))
  }
  app.select = (id) => { app.sel = null; select(id) }

  /** what stands at a station: AirSup's kit machine, standing in for one of ours until that is built (maiaCITY) */
  const standsHere = (d) => d.standIn ? `<div class="fs-standin">Stands here: AirSup's <b>${esc(d.standIn.kit)}</b> kit machine, standing in for our <b>${esc(d.standIn.label || d.standIn.for)}</b> (${esc(d.standIn.for)}, not built yet)</div>` : ''

  function paintInspector() {
    const box = el('fs-insp')
    if (!box) return
    if (!app.sel) { box.classList.remove('on'); return }
    const d = plan.byId[app.sel], s = sim.st[app.sel], S = world.st[app.sel]
    const live = s.servers.filter((x) => !x.retire).length
    const maxM = S.I.Pmax
    const nPhys = Math.ceil(live / S.I.pm)
    const capDay = (nPhys * S.I.pm * d.batch * d.A * plan.daySec / s.ct) * plan.perToken
    box.classList.add('on')
    box.innerHTML = `<button class="fs-close" data-a="close">close</button><div class="fs-lab">${esc(d.machine)}${d.batch > 1 ? ` · batch ${d.batch}` : ''}${S.I.pm > 1 ? ` · ${S.I.pm} units inside each` : ''}</div>
      <h3>${esc(d.name)}</h3><div class="note">${esc(d.note || '')}</div>${standsHere(d)}
      <div class="fs-ctl"><label>Machines</label><div class="fs-step"><button data-a="m-">&minus;</button><b>${nPhys}</b><button data-a="m+" ${nPhys >= maxM ? 'disabled title="no more floor space"' : ''}>+</button></div><output>${fmt(capDay)}/d</output></div>
      <div class="fs-ctl"><label>Cycle time</label><input class="fs-range" type="range" data-a="ct" min="${(d.ct * 0.4).toFixed(2)}" max="${(d.ct * 1.6).toFixed(2)}" step="${(d.ct / 100).toFixed(3)}" value="${s.ct}"><output data-o="ct">${fmt(s.ct)} s</output></div>
      <div class="fs-ctl"><label>Buffer</label><input class="fs-range" type="range" data-a="buf" min="1" max="${Math.max(20, d.buffer * 3)}" step="1" value="${s.cap}"><output data-o="buf">${s.cap}</output></div>
      <div class="fs-formula">${esc(d.sizing)}${d.mtbf ? `<br>MTBF ${fmt(d.mtbf / 3600)} h · MTTR ${fmt(d.mttr / 60)} min · failures so far ${s.failures}` : ''}${d.yield < 1 ? `<br>yield ${(d.yield * 100).toFixed(1)} % · scrapped ${s.scrap}` : ''}</div>
      <div class="fs-fc" id="fs-fc"></div>`
    paintForecast()
  }
  panel.addEventListener('click', (e) => {
    const a = e.target.dataset && e.target.dataset.a
    if (!a || !app.sel) return
    const id = app.sel, s = sim.st[id], S = world.st[id]
    if (a === 'close') return select(null)
    const live = s.servers.filter((x) => !x.retire).length
    if (a === 'm+') app.setMachines(id, Math.ceil(live / S.I.pm) + 1)
    if (a === 'm-') app.setMachines(id, Math.ceil(live / S.I.pm) - 1)
  })
  panel.addEventListener('input', (e) => {
    const a = e.target.dataset && e.target.dataset.a
    if (!a || !app.sel) return
    const v = Number(e.target.value)
    if (a === 'ct') { app.setCT(app.sel, v); e.target.parentNode.querySelector('[data-o="ct"]').textContent = fmt(v) + ' s' }
    if (a === 'buf') { app.setBuffer(app.sel, v); e.target.parentNode.querySelector('[data-o="buf"]').textContent = v }
  })

  /* ---- what-if API (also used by the film) */
  app.setMachines = (id, n) => {
    const S = world.st[id]
    n = Math.max(1, Math.min(S.I.Pmax, n))
    sim.setServers(id, n * S.I.pm)
    world.syncMachines(id)
    changed()
    paintInspector()
  }
  app.setCT = (id, ct) => { sim.setCT(id, ct); changed(true) }
  app.setBuffer = (id, v) => { sim.setBuffer(id, v); changed(true) }
  let fcTimer = null
  function changed(quiet) {
    app.lastChangeT = sim.t
    sim.resetWindow()
    app.forecastRes = null
    clearTimeout(fcTimer)
    fcTimer = setTimeout(runForecast, quiet ? 250 : 30)
    paintForecast()
  }
  function runForecast() {
    app.forecastRes = forecast(plan, sim.overrides(), { days: 3, warm: 0.4, release: sim.release })
    paintForecast()
  }
  app.forecast = () => { runForecast(); return app.forecastRes }
  function paintForecast() {
    const f = el('fs-fc')
    if (!f) return
    const r = app.forecastRes
    f.innerHTML = r ? `Forecast, 3 production days, same engine: <b>${fmt(r.perDay)}</b> ${esc(unit)}/day, bottleneck <b>${esc(plan.byId[r.bottleneck].name)}</b>` : app.lastChangeT > -1e8 ? 'Forecasting…' : ''
  }

  /* ---- picking stations in 3D */
  const ray = new T.Raycaster(), ptr = new T.Vector2()
  let down = null
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY] })
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return
    const r = canvas.getBoundingClientRect()
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ptr, cam)
    const hits = ray.intersectObjects(Object.values(world.st).map((S) => S.hit), false)
    select(hits.length ? hits[0].object.userData.station : null)
  })

  /* ---- the frame loop */
  let hudT = 0
  function frameStep(dt) {
    app.t += dt
    // intro: type the prompt, then the factory assembles itself
    if (app.introLen && app.t < app.introLen + 0.3) {
      const n = Math.floor(Math.min(1, app.t / (app.introLen - 0.6)) * spec.prompt.length)
      prompt.querySelector('.q').textContent = spec.prompt.slice(0, n)
      prompt.querySelector('.send').classList.toggle('hit', app.t > app.introLen - 0.4 && app.t < app.introLen)
    }
    const at = Math.max(0, app.t - app.introLen)
    const af = Math.min(1, at / app.assembleLen)
    world.assemble(af)
    const running = af >= 1
    if (running && app.hudAuto) { app.hudAuto = false; setTimeout(() => app.showHud(true), 0) }
    for (const im of Object.values(world.stageMesh)) im.visible = running
    if (running && !app.paused) sim.step(dt * app.speed)
    if (camAnim) {
      camAnim.t += dt
      const k = K.ease(Math.min(1, camAnim.t / camAnim.dur))
      cam.position.lerpVectors(camAnim.from.pos, camAnim.to, k)
      controls.target.lerpVectors(camAnim.from.tgt, camAnim.tgt, k)
      if (camAnim.t >= camAnim.dur) camAnim = null
    }
    if (app.drift) { // slow film orbit
      const v = controls.target.clone(), off = cam.position.clone().sub(v)
      off.applyAxisAngle(new T.Vector3(0, 1, 0), app.drift * dt)
      cam.position.copy(v).add(off)
    }
    controls.update()
    world.update(dt, running ? (app.paused ? 0 : app.speed) : 0)
    world.animateLife(dt)
    // bottleneck over the window (or since the last change, once there is enough data)
    const span = sim.t - (sim.snaps[0] ? sim.snaps[0].t : 0)
    if (span > 1200) { app.bn = sim.bottleneck(); app.bnStable = app.bn.id }
    world.highlight(running ? app.bnStable : null, app.sel, app.t)
    hudT -= dt
    if (hudT <= 0 && ui) { hudT = film ? 0 : 0.25; paintHud(span) }
    look.render(dt)
  }

  function paintHud(span) {
    if (uiMin) { el('fs-readout').textContent = ''; return }
    const perDay = sim.perDay()
    const c = sim.clock()
    el('fs-readout').textContent = `day ${c.day} · ${String(c.hh).padStart(2, '0')}:${String(c.mm).padStart(2, '0')} · shift ${c.shift}`
    el('fs-clock').textContent = `${String(c.hh).padStart(2, '0')}:${String(c.mm).padStart(2, '0')} · ${app.paused ? 'paused' : app.speed + 'x'}`
    if (span > 1800) {
      el('fs-tp').firstChild.nodeValue = fmt(perDay)
      const pct = perDay / plan.perDay
      el('fs-pct').textContent = `${Math.round(pct * 100)} % of target`
      const bar = el('fs-tbar')
      const scale = Math.max(1.25, pct * 1.05)
      bar.style.width = Math.min(100, (pct / scale) * 100) + '%'
      bar.style.background = pct >= 0.995 ? 'var(--fs-busy)' : pct > 0.9 ? 'var(--fs-block)' : 'var(--fs-down)'
      el('fs-ttick').style.left = (1 / scale) * 100 + '%'
    }
    el('fs-win').textContent = span < 3 * 3600 ? `last ${fmt(span / 60)} min` : 'last 4 h'
    el('fs-wip').textContent = sim.wip()
    el('fs-lead').innerHTML = `${fmt(sim.leadEw / 60)}<small>min</small>`
    // sparkline of shipments per production hour
    const sn = sim.snaps
    const cv = el('fs-spark'), x = cv.getContext('2d')
    x.clearRect(0, 0, cv.width, cv.height)
    const pts = []
    const step = 3600 / sim.snapEvery
    for (let i = sn.length - 1; i - step >= 0 && pts.length < 20; i -= 1) pts.unshift(((sn[i].shipped - sn[i - step].shipped) / 3600) * plan.daySec * plan.perToken)
    if (pts.length > 1) {
      const mx = Math.max(plan.perDay * 1.3, ...pts)
      const ty = cv.height - (plan.perDay / mx) * cv.height
      x.strokeStyle = 'rgba(36,38,42,0.35)'
      x.setLineDash([6, 6])
      x.beginPath(); x.moveTo(0, ty); x.lineTo(cv.width, ty); x.stroke()
      x.setLineDash([])
      x.strokeStyle = '#24262a'
      x.lineWidth = 3
      x.beginPath()
      pts.forEach((v, i) => { const px = (i / (pts.length - 1)) * cv.width, py = cv.height - (v / mx) * (cv.height - 6) - 3; i ? x.lineTo(px, py) : x.moveTo(px, py) })
      x.stroke()
    }
    // bottleneck card
    if (app.bnStable) {
      const w = app.bn.win.st[app.bnStable]
      el('fs-bn').textContent = plan.byId[app.bnStable].name
      el('fs-bnsub').textContent = `${Math.round(w.busy * 100)} % busy · ${Math.round(w.down * 100)} % down · ${Math.ceil(sim.st[app.bnStable].servers.length / world.st[app.bnStable].I.pm)} ${Math.ceil(sim.st[app.bnStable].servers.length / world.st[app.bnStable].I.pm) > 1 ? 'machines' : 'machine'}`
    }
    // station rows
    if (list && app.bn) {
      for (const r of list.querySelectorAll('.fs-st')) {
        const id = r.dataset.id, w = app.bn.win.st[id], s = sim.st[id], S = world.st[id]
        r.classList.toggle('hot', id === app.bnStable)
        r.querySelector('[data-x]').textContent = '×' + Math.ceil(s.servers.length / S.I.pm)
        r.querySelector('[data-u]').textContent = Math.round(w.active * 100) + '%'
        for (const i of r.querySelectorAll('i')) i.style.width = (w[i.dataset.k] * 100).toFixed(1) + '%'
      }
    }
  }

  /* ---- clocks: real time, or stepped by a recorder; the canvas the size of its host, not the window */
  function resize() {
    const w = host.clientWidth || globalThis.innerWidth, h = host.clientHeight || globalThis.innerHeight
    look.setSize(w, h)
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
  if (ro) ro.observe(host)
  globalThis.addEventListener('resize', resize)
  resize()
  if (app.sel) setTimeout(() => app.select(app.sel), 50)
  let raf = 0, gone = false
  if (film) {
    globalThis.__film = { ready: true, step(dt, draw = true) { frameStep(dt) }, app }
  } else {
    let last = 0
    const loop = (now) => {
      if (gone) return
      // maiaCITY: the first frame's stamp is the frame's start, which can lie before a long build (a software renderer
      // takes seconds to its first frame), so the clock never steps back; and never more than 50 ms a frame
      const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0
      last = now
      if (!document.hidden) frameStep(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  }
  // fade the HUD in after the factory has assembled
  for (const c of host.querySelectorAll('.fs-card.fs-fade')) c.classList.add('fs-hidden')
  app.hudAuto = true
  app.showHud = (on) => host.querySelectorAll('.fs-card.fs-fade').forEach((c) => c.classList.toggle('fs-hidden', !on))
  /** leave the page: stop the clock, free the renderer, take the HUD down */
  app.dispose = () => {
    gone = true
    cancelAnimationFrame(raf)
    clearTimeout(fcTimer)
    if (ro) ro.disconnect()
    globalThis.removeEventListener('resize', resize)
    controls.dispose()
    look.composer.dispose()
    look.renderer.dispose()
    for (const c of [frame, prompt, panel, speedBar, canvas]) c.remove()
    host.classList.remove('fs-root', 'fs-film')
    if (globalThis.factory === app) delete globalThis.factory
    if (globalThis.__film && globalThis.__film.app === app) delete globalThis.__film
  }
  return app
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) }
