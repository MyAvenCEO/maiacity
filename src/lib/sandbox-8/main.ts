import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createControls, createRenderer } from '$lib/render/core.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { scenarios, polyhedraOf, piecesOf, verticesOf, type Box, type Scenario } from './simulation';
import { shedScenario } from './shed';
import { brickHouseScenario } from './brick-house';
import { metalShedScenario } from './metal-shed';
import { domeScenario, DEFAULT_DOME_DIAMETER, MIN_DOME_DIAMETER, DEFAULT_DOME_SETTINGS, type DomeSettings } from './dome';
import { WIND_DIRECTIONS, type WindSettings, type WindLoad } from './wind';
import { WorkerClient, SimulationView, BuildView } from './worker-client';
import { industrialHallScenario } from './industrial-hall';
import { germanHouseScenario } from './german-house';
import {standScenario,STAND_HUBS,DEFAULT_STAND_SETTINGS,STAND_LAB_MIN_HEIGHT,STAND_LAB_MAX_HEIGHT,type StandSettings} from './stand-lab';
import {PartsGallery} from './parts-gallery';
import './style.css';

function partGeometry(spec: Box) {
  if (spec.taper) return new ConvexGeometry(verticesOf(spec).map(p => new THREE.Vector3(p.x, p.y, p.z)));
  if (spec.renderPieces) {
    // Display-only subdivision (bricks and mortar joints) of the same solid the physics uses.
    const parts = spec.renderPieces.map(piece => {
      const geometry = new THREE.BoxGeometry(...piece.size).applyQuaternion(new THREE.Quaternion().copy(piece.rotation ?? { x: 0, y: 0, z: 0, w: 1 })).translate(piece.offset.x, piece.offset.y, piece.offset.z);
      const c = new THREE.Color(piece.color), n = geometry.getAttribute('position').count;
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
      return geometry;
    });
    const merged = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return merged;
  }
  const polys=polyhedraOf(spec);
  const pieces:THREE.BufferGeometry[] = piecesOf(spec).map(piece => {
    const geometry=new THREE.BoxGeometry(...piece.size).applyQuaternion(new THREE.Quaternion().copy(piece.rotation??{x:0,y:0,z:0,w:1})).translate(piece.offset.x, piece.offset.y, piece.offset.z);
    if(!polys.length)return geometry;
    const plain=geometry.toNonIndexed();geometry.dispose();return plain;
  });
  for(const poly of polys) pieces.push(new ConvexGeometry(poly.vertices.map(p=>new THREE.Vector3(p.x,p.y,p.z))));
  if(polys.length) pieces.forEach(piece=>piece.deleteAttribute('uv'));
  const geometry = mergeGeometries(pieces)!;
  pieces.forEach(piece => piece.dispose());
  return geometry;
}

/** Mounts the laboratory into `root` (Sandbox 7, src/routes/app/games/sandbox-8); resolves to what takes it down again. */
export async function mountLab(root: HTMLElement): Promise<() => void> {
  const presets = [...scenarios(), shedScenario(), brickHouseScenario(), metalShedScenario(), domeScenario(), standScenario(), industrialHallScenario(), germanHouseScenario()];
  root.classList.add('physical-lab');
  root.innerHTML = `
    <header><div><small>PHYSICAL WORLD / ASSEMBLY SANDBOX</small><h1>From parts to buildings</h1></div><span class="tag">RIGID BODY LABORATORY</span></header>
    <div class="layout"><aside class="left"><h2>Choose an experiment</h2><nav id="scenario-list" aria-label="Experiments"></nav><section id="dome-controls" hidden aria-label="Dome dimensions"><h2>Dome size</h2>
      <form id="dome-size-form"><label for="dome-diameter">Frame diameter · m</label><input id="dome-diameter" type="number" min="${MIN_DOME_DIAMETER}" step="any" value="${DEFAULT_DOME_DIAMETER}" required>
      <label for="dome-cell-size">Target cell size · m</label><input id="dome-cell-size" type="number" min="0.1" step="any" value="2.5" required>
      <label for="dome-timber-lower">Lower timber · mm</label><input id="dome-timber-lower" type="number" min="1" step="any" value="120" required>
      <label for="dome-timber-middle">Middle timber · mm</label><input id="dome-timber-middle" type="number" min="1" step="any" value="100" required>
      <label for="dome-timber-upper">Upper timber · mm</label><input id="dome-timber-upper" type="number" min="1" step="any" value="80" required>
      <p id="dome-size-status" aria-live="polite"></p><button type="submit">Apply size & reset</button><p class="note">No upper diameter limit. Mesh density is calculated from target cell size; projection makes actual spans vary. Timber uses your lower / middle / upper sizes. Resets construction. Doorway stays 1 × 2.1 m. Strength is not scaled up automatically; large designs may fail or run slowly.</p><p id="dome-size-error" class="error" role="alert"></p></form></section><section id="stand-controls" hidden aria-label="Stand test controls"><h2>Stand test</h2>
      <form id="stand-form"><label for="stand-hub">Mounted hub</label><select id="stand-hub">${Object.entries(STAND_HUBS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select><label for="stand-height">Height · m</label><input id="stand-height" type="number" min="${STAND_LAB_MIN_HEIGHT}" max="${STAND_LAB_MAX_HEIGHT}" step="any" value="2" required>
      <input id="stand-extension" aria-label="Stand extension" type="range" min="${STAND_LAB_MIN_HEIGHT}" max="${STAND_LAB_MAX_HEIGHT}" step="0.01" value="2">
      <label for="stand-load">Loose top load · kg</label><input id="stand-load" type="number" min="0" step="any" value="0" required>
      <label for="stand-friction">Foot friction</label><input id="stand-friction" type="number" min="0" max="2" step="any" value="0.65" required>
      <button type="submit">Set extension & reset trial</button><p id="stand-error" class="error" role="alert"></p></form>
      <label for="stand-push">Sideways impulse · N·s</label><input id="stand-push" type="number" min="0" step="any" value="20">
      <button id="stand-push-x">Push across head (+X)</button><button id="stand-push-z">Push toward head (+Z)</button>
      <p id="stand-readout" aria-live="polite"></p><p class="note">Same 11 sleeves and mass at every extension. Foot contact and head-bolt failure are simulated. Mast bending, buckling and lock failure are not. No load rating is established.</p></section><section id="wind-controls" aria-label="Wind controls"><h2>Wind</h2>
      <label class="wind-toggle"><input id="wind-enabled" type="checkbox"> Enable wind</label>
      <label for="wind-speed">Speed · m/s</label><input id="wind-speed" type="number" min="0" step="1" value="10">
      <label for="wind-direction">Blowing from</label><select id="wind-direction"><option value="front">Doorway → back (−Z)</option><option value="back">Back → doorway (+Z)</option><option value="left">Left → right (+X)</option><option value="right">Right → left (−X)</option></select>
      <p id="wind-status" aria-live="polite">Wind off</p><p class="note">Steady drag on exposed surfaces, with sampled sheltering. Cyan arrows show airflow. No turbulence or roof suction. Pause stops wind acting too.</p></section><p class="note">Start with contact.<br>Observe the load path.<br>Change one condition.</p><p class="note">Every supplied part is a separate body. Roof grips, sheet fixings and dome connections can fail. Some lower-frame and masonry connections remain ideal rigid restraints. Only ground and the test incline are fixed.</p></aside>
    <main><div class="scene-heading"><div><h2 id="scene-title"></h2><p id="question"></p></div><div class="view-buttons"><button id="orbit">Orbit</button><button id="side">Side</button><button id="top">Top</button></div></div>
      <section id="construction" hidden aria-label="Step by step construction">
        <div class="build-heading"><div><small>STEP BY STEP CONSTRUCTION</small><h3 id="build-stage"></h3></div><strong id="build-count"></strong></div>
        <div id="build-stages"></div><progress id="build-progress" max="1" value="0" aria-label="Construction progress"></progress>
        <p id="next-part"></p><p id="support-status" class="note"></p><div class="build-actions"><button id="place-part" class="primary">Place next part</button><button id="build-stage-button">Build next stage</button><button id="build-all">Build whole shed</button></div>
        <div class="build-options"><label><input id="show-plan" type="checkbox"> Show remaining plan</label><label><input id="frame-view" type="checkbox"> Show structure only</label></div>
        <p id="build-note" class="note">Roof: 5° fall to the back on tapered timber supports, then boards and roofing felt. Felt is a continuous barrier by assumption; rain and leakage are not simulated. Doorway posts sit in steel shoes anchored to the bottom frame. Roof grips can lose their hold in the wood; red dots mark failed points. Lower framing remains ideal rigid. Capacities are experimental, not rated fastener strengths.</p>
      </section>
      <div class="scene-tabs" role="tablist" aria-label="Scene view"><button id="assembly-tab" role="tab" aria-selected="true" aria-controls="viewport">Assembly</button><button id="parts-tab" role="tab" aria-selected="false" aria-controls="viewport">Parts gallery</button></div>
      <section id="gallery-header" hidden><p id="gallery-summary"></p><label>Find a part <input id="gallery-search" type="search" placeholder="Brick, board, hub, material or ID"></label><button id="gallery-fit">Show all parts</button><p class="note">One preview per part type, individually fitted for visibility. Counts cover the full recipe. Select a part for dimensions; orbit and zoom to inspect. Assembly time is held while browsing.</p></section>
      <div id="viewport" role="tabpanel" aria-labelledby="assembly-tab"><div class="legend"><span>●</span> Centers of mass &nbsp; <span>▪</span> Contact points · grid 1 m</div></div>
      <section id="gallery-list" aria-label="Parts catalogue" hidden></section>
      <div class="toolbar"><button class="primary" id="run">Run</button><button id="step">Step</button><button id="reset">Reset</button><label>Speed <select id="speed"><option value="0.25">¼×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label><span id="clock">0.000 s</span></div>
      <p id="worker-status" role="status">Starting physics worker…</p><div class="metrics"><div class="metric"><small>MOVABLE MASS</small><strong id="mass"></strong></div><div class="metric"><small>CONTACT PAIRS</small><strong id="pair-count">0</strong></div><div class="metric"><small>PHYSICS STEP</small><strong>1 / 120 s</strong></div></div>
      <p class="footer-note">Rigid materials: no bending, cracking, fracture or moisture. Contact force estimates are solver measurements, not structural safety ratings.</p>
    </main><aside class="right"><section id="gallery-detail" hidden></section><section id="assembly-inspector"><h2>Inspect a part</h2><select id="part" aria-label="Selected part"></select><dl id="inspector"></dl><h2 id="contact-heading">Contact network</h2><div id="contacts"></div><section id="joint-panel" hidden><h2>Installed connections</h2><div id="joints"></div><button id="release-joints">Release selected part</button><p class="note">Removes its connections. Contact may still support it. Reset before continuing construction.</p></section><button id="export">Export setup + current state</button></section>
    <details id="setup-details"><summary>Setup / start a new run</summary><p class="note">Edits apply to the selected part. Dimensions and density determine mass. Applying resets all bodies and time.</p><form id="setup-form">
      <label>Dimensions X Y Z (m)<input id="dimensions" required></label><label>Position X Y Z (m)<input id="position" required></label><label>Rotation about Z (degrees)<input id="angle" type="number" step="any" required></label><label>Density (kg/m³)<input id="density" type="number" min="1" max="30000" step="any" required></label><label>Friction coefficient<input id="friction" type="number" min="0" max="2" step="any" required></label><button type="submit">Apply and reset</button><p id="setup-error" class="error" role="alert"></p></form><p class="note">Setup is a laboratory fixture. Overlapping starting boxes are rejected. These controls do not represent a person's ability to move a part.</p></details></aside></div>`;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const shedNote = el('build-note').textContent!;
  const viewport = el('viewport');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x20372b);
  scene.fog = new THREE.Fog(0x20372b, 18, 42);
  const camera = new THREE.PerspectiveCamera(42, 1, .05, 100);
  const renderer = createRenderer({ antialias: true, maxPixelRatio: 2, shadows: 'pcf', colorSpace: THREE.SRGBColorSpace });
  viewport.prepend(renderer.domElement);
  const controls = createControls(camera, renderer.domElement, { maxDistance: 30, minDistance: .5 });
  scene.add(new THREE.HemisphereLight(0xf6f0d3, 0x4c6850, 2));
  const light = new THREE.DirectionalLight(0xffe4b2, 3); light.position.set(-3, 8, 5); light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048); Object.assign(light.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); light.shadow.bias = -.0003; scene.add(light);
  const grid = new THREE.GridHelper(30, 30, 0x8c9f7c, 0x536e55); grid.position.y = .003; scene.add(grid);
  let galleryActive = false, galleryDirty = true;
  const gallery = new PartsGallery(renderer.domElement,el('gallery-list'),el('gallery-detail'),el('gallery-summary'),partGeometry);
  let matchingParts = new Set<string>();
  gallery.onSelect = ids => { matchingParts = new Set(ids); poseSelection = ''; };
  function showGallery(active:boolean) {
    if(!sim)return;
    gallery.resize(viewport.clientWidth,viewport.clientHeight);
    if(active&&galleryDirty){gallery.setPlan(build?.plan ?? config.boxes.filter(b=>!b.fixed).map(box=>({box,stage:0,connectTo:[]})),build?.definition);galleryDirty=false;}
    galleryActive=active;gallery.setActive(active);controls.enabled=!active;
    root.querySelector('main')!.classList.toggle('parts-view',active);
    for(const id of ['gallery-header','gallery-list','gallery-detail'])el(id).hidden=!active;
    el('assembly-inspector').hidden=active;el('setup-details').hidden=active||!!build;
    el('construction').hidden=active||!build||config.id==='stand-lab';
    el('assembly-tab').setAttribute('aria-selected',String(!active));el('parts-tab').setAttribute('aria-selected',String(active));
    viewport.setAttribute('aria-labelledby',active?'parts-tab':'assembly-tab');
    gallery.resize(viewport.clientWidth,viewport.clientHeight);
  }
  el('assembly-tab').onclick=()=>showGallery(false);el('parts-tab').onclick=()=>showGallery(true);
  for(const [id,other] of [['assembly-tab','parts-tab'],['parts-tab','assembly-tab']])el(id).onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?'assembly-tab':event.key==='End'?'parts-tab':other;el(target).click();el(target).focus();}};
  el('gallery-search').oninput=()=>gallery.applyFilter(el<HTMLInputElement>('gallery-search').value);
  el('gallery-fit').onclick=()=>{el<HTMLInputElement>('gallery-search').value='';gallery.applyFilter('');};
  const objects = new THREE.Group(), markers = new THREE.Group(), ghosts = new THREE.Group(); scene.add(objects, markers, ghosts);
  const meshes = new Map<string, THREE.Mesh>();
  const dots = new Map<string, THREE.Mesh>();
  const contactGeometry = new THREE.BufferGeometry();
  const contactPoints = new THREE.Points(contactGeometry, new THREE.PointsMaterial({ color: 0xffdf8a, size: 7, sizeAttenuation: false, depthTest: false }));
  contactPoints.renderOrder = 5; scene.add(contactPoints);
  let config: Scenario, sim: SimulationView, build: BuildView | undefined, selected = 'board';
  const playback = {running:false,speed:1};
  let wind = {settings:{enabled:false,speed:10,from:'front'} as WindSettings, total:{x:0,y:0,z:0}, loads:new Map<string,WindLoad>()};
  const client = new WorkerClient();
  function send(command: Parameters<WorkerClient['send']>[0]) { return client.send(command).catch(error=>{if(error.message!=='Superseded')el('worker-status').textContent=error.message;}); }
  client.onError = error => { playback.running=false;el('worker-status').textContent=error.message; };
  client.onSnapshot = snapshot => {
    if(snapshot.initial){config=snapshot.initial.scenario;sim=new SimulationView();build=snapshot.initial.plan?new BuildView(sim,snapshot.initial.plan,snapshot.initial.stages!,snapshot.initial.definition):undefined;}
    sim.apply(snapshot); if(snapshot.build)build!.apply(snapshot.build);
    selected=snapshot.selected;Object.assign(playback,{running:snapshot.running,speed:snapshot.speed});
    wind={settings:snapshot.wind.settings,total:snapshot.wind.total,loads:new Map(snapshot.wind.selected?[[selected,snapshot.wind.selected]]:[])};
    if(snapshot.initial)setupScene();
    el('run').textContent=playback.running?'Pause':'Run';el<HTMLButtonElement>('step').disabled=playback.running;
    el('worker-status').textContent=playback.running?'Physics running in background':'Physics paused · camera remains interactive';
  };
  let reframeNext = false;
  let standSettings:StandSettings={...DEFAULT_STAND_SETTINGS};
  let domeSettings:DomeSettings=structuredClone(DEFAULT_DOME_SETTINGS);
  let domeDiameter = DEFAULT_DOME_DIAMETER;
  let arrowScale = 1;
  const windArrows = [-1.8, 0, 1.8].map(() => { const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1.3, 0x8bd9df, .3, .16); scene.add(arrow); return arrow; });
  let displayedCount = -1;
  const ghostMeshes = new Map<string, THREE.Mesh>();
  const damageDots: THREE.Mesh[] = [];
  const damageMaterial = new THREE.MeshBasicMaterial({ color: 0xff654f, depthTest: false });
  const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xffd480, depthTest: false });
  let poseWorld: SimulationView | undefined, poseTick = -1, poseCount = -1, poseSelection = '';
  function clearMeshes() {
    objects.children.forEach(child => { const mesh = child as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
    markers.children.forEach(child => (child as THREE.Mesh).geometry.dispose());
    objects.clear(); markers.clear(); meshes.clear(); dots.clear();
  }
  function syncMeshes() {
    if (meshes.size === sim.parts.size && [...meshes.keys()].every(id=>sim.parts.has(id))) return;
    for(const [id,mesh] of meshes) if(!sim.parts.has(id)) {
      objects.remove(mesh);mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();meshes.delete(id);
      const dot=dots.get(id);if(dot){markers.remove(dot);dot.geometry.dispose();dots.delete(id);}
    }
    for (const [id, { spec }] of sim.parts) {
      if (meshes.has(id)) continue;
      const mesh = new THREE.Mesh(partGeometry(spec), new THREE.MeshStandardMaterial({ color: spec.renderPieces ? 0xffffff : spec.color, vertexColors: !!spec.renderPieces, roughness: spec.opacity ? .18 : .83, transparent: spec.opacity !== undefined, opacity: spec.opacity ?? 1, depthWrite: spec.opacity === undefined }));
      mesh.castShadow = !spec.fixed && spec.opacity === undefined; mesh.receiveShadow = true; mesh.userData.id = id; objects.add(mesh); meshes.set(id, mesh);
      if (!spec.fixed) { const dot = new THREE.Mesh(new THREE.SphereGeometry(.022, 10, 8), pointMaterial); dot.renderOrder = 6; markers.add(dot); dots.set(id, dot); }
    }
    el<HTMLSelectElement>('part').innerHTML = [...sim.parts.keys()].map(id => `<option>${id}</option>`).join('');
    el<HTMLSelectElement>('part').value = selected;
  }
  function syncTransforms() {
    if (poseWorld === sim && poseTick === sim.ticks && poseCount === sim.parts.size && poseSelection === selected) return;
    for (const [id, { body }] of sim.parts) {
      const mesh = meshes.get(id)!;
      mesh.position.copy(body.translation()); mesh.quaternion.copy(body.rotation());
      const dot = dots.get(id);
      if (dot) {
        dot.visible = !build || id === selected;
        if (dot.visible) dot.position.copy(body.worldCom());
      }
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(matchingParts.has(id) ? 0x403413 : id === selected ? 0x33250e : 0);
    }
    poseWorld = sim; poseTick = sim.ticks; poseCount = sim.parts.size; poseSelection = selected;
  }
  function refreshBuild() {
    if (!build) return;
    el('build-stage').textContent = build.altered ? (build.failures.length ? 'Connection damage' : 'Connections released') : build.complete ? `${build.definition?.name ?? 'Shed'} assembled` : build.stages[build.next.stage];
    el('build-count').textContent = `${build.count} / ${build.plan.length} placements`;
    el<HTMLProgressElement>('build-progress').max = build.plan.length; el<HTMLProgressElement>('build-progress').value = build.count;
    if (displayedCount !== build.count) {
      el('build-stages').innerHTML = build.stages.map((name, stage) => `<span class="${build!.complete || (build!.next && stage < build!.next.stage) ? 'done' : build!.next?.stage === stage ? 'current' : ''}">${stage + 1}. ${name}</span>`).join('');
      displayedCount = build.count;
    }
    el('next-part').textContent = build.altered ? (build.failures.length ? `${build.failures.length} failed grip points · ${build.failedConnections.size} connections separated · Reset to rebuild.` : 'The remaining parts stay outside the world. Reset to rebuild.') : build.complete ? `${build.connectionCount} installed connections · ${build.suppliedMass.toFixed(1)} kg cumulative material inflow` : build.nextPlacementIds.length>1 && config.id==='industrial-hall' ? `Next: rafter pair, bolted together at the apex on the ground · ${build.nextPlacementIds.length} rafters · lift as one unit` : build.nextPlacementIds.length>1 ? `Next: prefabricated support stand · ${build.nextPlacementIds.length} connected components · place as one unit` : build.next.box.telescopic ? `Next: set stand height to ${build.next.box.telescopic.heightM.toFixed(2)} m, lock & place (reuse available equipment)` : `Next: ${build.next.box.id.replaceAll('-', ' ')} · ${build.next.connectTo.length} connections`;
    el<HTMLButtonElement>('place-part').disabled = build.complete || build.altered || build.automatic;
    el<HTMLButtonElement>('build-stage-button').disabled = build.complete || build.altered || build.automatic;
    el<HTMLButtonElement>('build-all').disabled = build.complete || build.altered;
    el('build-all').textContent = build.automatic ? 'Stop assembly' : config.id === 'dome' ? 'Build whole dome' : config.id === 'brick-house' || config.id === 'german-house' ? 'Build whole house' : config.id === 'industrial-hall' ? 'Build whole hall' : 'Build whole shed';
    const temporary=build.definition?.temporaryProps??[];
    el('place-part').textContent=build.next?.box.telescopic?'Set height & place stand':'Place next part';
    el('support-status').textContent=temporary.length?`Temporary stands: ${temporary.filter(id=>sim.parts.has(id)).length} active · ${build.withdrawnParts.length} withdrawn · ${build.withdrawnMass.toFixed(1)} kg cumulative return${build.standInventory.length?` · ${build.standInventory.length} reusable stands acquired · ${build.standInventory.filter(a=>a.available).length} available`:""}`:'';
    const framingOnly = el<HTMLInputElement>('frame-view').checked;
    const showPlan = el<HTMLInputElement>('show-plan').checked;
    const nextIds = new Set(build.complete ? [] : build.nextPlacementIds);
    const placedIds=new Set(build.plan.slice(0,build.count).map(p=>p.box.id));
    for (const entry of build.plan) {
      const installed = sim.parts.has(entry.box.id), frame = entry.structural ?? [0, 2, 4, 5].includes(entry.stage);
      const mesh = meshes.get(entry.box.id); if (mesh) mesh.visible = !framingOnly || frame;
      const ghost = ghostMeshes.get(entry.box.id)!;
      ghost.visible = !placedIds.has(entry.box.id) && !build.altered && (!framingOnly || frame) && (showPlan || nextIds.has(entry.box.id));
      if (!ghost.visible) continue;
      const pose = build.placement(entry.box); ghost.position.copy(pose.position); ghost.quaternion.copy(pose.rotation);
      (ghost.material as THREE.MeshBasicMaterial).opacity = nextIds.has(entry.box.id) ? .6 : .08;
    }
    const joints = [...build.connections.values()].filter(c => c.a === selected || c.b === selected);
    el('joints').innerHTML = joints.length ? joints.map(c => `<div class="contact">↔ ${c.a === selected ? c.b : c.a}<br>${c.grip ? `${c.grip.profile.name}: ${c.grip.intact}/${c.grip.points.length} points holding · ${Math.round(Math.max(0, ...c.grip.points.filter(p => !p.failed).map(p => p.reading.utilization)) * 100)}% peak use<br>Per point: ${c.grip.profile.withdrawalN} N withdrawal / ${c.grip.profile.shearN} N shear (experimental)` : c.fastening === 'assembly-clamp' ? 'Temporary assembly clamp (ideal; withdrawn at completion)' : c.fastening === 'post-to-rail-screw-group' ? 'Post → rail screw group (rigid approximation)' : c.fastening === 'shoe-to-frame-screw-group' ? 'Shoe → frame screws (rigid approximation)' : c.fastening === 'post-to-shoe-bolt-group' ? 'Post → shoe bolts (rigid approximation)' : c.fastening === 'mortar-bond' ? 'Cured mortar bond (unlimited rigid approximation)' : c.fastening === 'masonry-anchor' ? 'Steel strap anchors / screws (rigid approximation)' : c.fastening === 'felt-bond' ? 'Felt adhesive bond (rigid approximation)' : 'Ideal rigid fastening'}</div>`).join('') : '<p class="note">No installed connections on this part.</p>';
    if(config.id==='stand-lab'){const q=sim.body('test-stand').rotation(),tilt=Math.acos(Math.min(1,Math.max(-1,1-2*(q.x*q.x+q.z*q.z))))*180/Math.PI;el('stand-readout').textContent=`Tilt ${tilt.toFixed(2)}° · stand ${sim.body('test-stand').mass().toFixed(1)} kg · ${build.failedConnections.size?'head connection separated':`${build.failures.length} failed bolt points`}`;}
    const prefab=sim.parts.get(selected)?.spec.prefab;
    const telescope=sim.parts.get(selected)?.spec.telescopic,mount=sim.parts.get(selected)?.spec.mountPoint;
    if(telescope)el('joints').innerHTML+=`<div class="contact"><strong>${telescope.model} · ${telescope.assetId??'planned'}</strong><p>Height ${telescope.heightM.toFixed(3)} m · range ${telescope.minHeightM.toFixed(2)}–${telescope.maxHeightM.toFixed(2)} m<br>${telescope.segments} sleeves · overlap ${telescope.overlapM.toFixed(3)} m<br>${telescope.operation}</p></div>`;
    if(mount)el('joints').innerHTML+=`<div class="contact"><strong>${mount.standard}</strong><p>80 × 80 mm bearing face · 48 × 48 mm four-bolt pattern. Reusable for ${mount.uses.join(', ')}.</p><p>${mount.note}</p></div>`;
    if(prefab)el('joints').innerHTML+=`<div class="contact"><strong>Prefabricated stand · ${prefab.components.length} workshop components</strong><p>One rigid assembly in this simulation; internal fastener failure is omitted. The foot can slide or tip and the hub attachment can fail.</p><p>${prefab.components.map(p=>`${p.material}: ${p.size.map(n=>n.toFixed(3)).join(' × ')} m`).join('<br>')}</p><p>${prefab.fastenings.map(f=>`${f.a} → ${f.b}: ${f.description}`).join('<br>')}</p></div>`;
    const failures = build.failures.filter(f => f.a === selected || f.b === selected);
    el('joints').innerHTML += failures.map(f => `<div class="contact failure">${f.material} failed: ${f.reading.mode}<br>${f.a} ↔ ${f.b}<br>Point ${f.point + 1} · ${f.reading.withdrawalN.toFixed(0)} N withdrawal / ${f.reading.shearN.toFixed(0)} N shear · ${(f.tick * sim.dt).toFixed(3)} s</div>`).join('');
    el<HTMLButtonElement>('release-joints').disabled = !joints.length;
    for (let i = damageDots.length; i < build.failures.length; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(.026, 8, 6), damageMaterial); dot.renderOrder = 7; scene.add(dot); damageDots.push(dot);
    }
    build.markers.forEach((point,i)=>damageDots[i].position.copy(point));
  }

  async function reset(next: Scenario = config, reframe = false, validate = false) {
    reframeNext=reframe;el('worker-status').textContent='Preparing simulation…';
    await client.send({type:'reset',scenario:next,diameter:domeDiameter,domeSettings,standSettings,validate});
    await client.send({type:'speed',speed:Number(el<HTMLSelectElement>('speed').value)});
  }
  function setupScene() {
    displayedCount=-1;
    el<HTMLInputElement>('wind-enabled').checked = false; el<HTMLInputElement>('wind-speed').value = '10'; el<HTMLSelectElement>('wind-direction').value = 'front';
    playback.speed = Number(el<HTMLSelectElement>('speed').value);
    clearMeshes();
    damageDots.splice(0).forEach(dot => { scene.remove(dot); dot.geometry.dispose(); });
    ghosts.children.forEach(child => { const m = child as THREE.Mesh; m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
    ghosts.clear(); ghostMeshes.clear();
    if (build) for (const entry of build.plan) {
      const mesh = new THREE.Mesh(partGeometry(entry.box), new THREE.MeshBasicMaterial({ color: 0xbedcac, transparent: true, opacity: .08, wireframe: true, depthWrite: false }));
      ghosts.add(mesh); ghostMeshes.set(entry.box.id, mesh);
    }
    el('build-note').textContent = build?.definition?.note ?? shedNote;
    el('stand-controls').hidden=config.id!=='stand-lab';
    el('dome-controls').hidden = config.id !== 'dome';
    el<HTMLInputElement>('dome-diameter').value = String(domeDiameter);
    el<HTMLInputElement>('dome-cell-size').value=String(domeSettings.targetCellSizeM);
    ['lower','middle','upper'].forEach((level,i)=>el<HTMLInputElement>(`dome-timber-${level}`).value=String(domeSettings.timberSectionsMm[i]));
    el('dome-size-status').textContent = `${domeDiameter} m diameter · ${domeDiameter/2} m frame rise · ${build?.definition?.parameters?.frequency??2}V cells · ${domeSettings.timberSectionsMm.join(" / ")} mm timber`;
    el('dome-size-error').textContent = '';
    const viewScale = config.id === 'dome' ? Math.max(1,domeDiameter/8) : config.id==='stand-lab'?Math.max(1,standSettings.heightM/4):config.id==='industrial-hall'?2.4:config.id==='german-house'?1.8:1;
    arrowScale = config.id==='industrial-hall' ? 3 : config.id==='german-house' ? 2.2 : 1;
    camera.far=Math.max(100,100*viewScale);camera.updateProjectionMatrix();
    controls.maxDistance = 30*viewScale;
    scene.fog = new THREE.Fog(0x20372b,18*viewScale,42*viewScale);
    Object.assign(light.shadow.camera,{left:-8*viewScale,right:8*viewScale,top:8*viewScale,bottom:-8*viewScale});light.shadow.camera.updateProjectionMatrix();
    light.position.set(-3*viewScale,8*viewScale,5*viewScale);
    el('construction').hidden = !build||config.id==='stand-lab'; el('joint-panel').hidden = !build; el('setup-details').hidden = !!build;
    selected = config.id==='stand-lab'?'test-stand':build ? 'ground' : (sim.parts.has(selected) ? selected : 'board');
    syncMeshes();
    el('scene-title').textContent = config.title; el('question').textContent = config.question;
    el('mass').textContent = `${sim.mass.toFixed(2)} kg`; el('run').textContent = 'Run'; el<HTMLButtonElement>('step').disabled = false;
    document.querySelectorAll<HTMLButtonElement>('#scenario-list button').forEach(button => button.classList.toggle('active', button.dataset.id === config.id));
    grid.position.y = config.id.startsWith('incline') ? -1.997 : .003;
    galleryDirty=true;matchingParts.clear();
    el<HTMLInputElement>('gallery-search').value='';showGallery(galleryActive);
    fillSetup(); if (reframeNext) setView('orbit'); update();
  }
  function setView(view: string) {
    if(galleryActive){gallery.setView(view);return;}
    const h = config.id==='industrial-hall'?3.2:config.id==='german-house'?4.2:config.id==='stand-lab'?standSettings.heightM/2+.2:config.id === 'dome' ? .34 + (1.8-.34)*domeDiameter/8 : build ? 1.25 : config.id === 'freefall' ? 2 : config.id.startsWith('incline') ? 1.7 : .6;
    controls.target.set(0, h, 0);
    camera.position.set(...(view === 'side' ? [0, h + .15, 7.5] : view === 'top' ? [0, h + 8, .001] : (build ? [5.3, h + 3.5, 6.7] : [4.4, h + 3, 5.4])) as [number, number, number]);
    if (config.id === 'dome') camera.position.sub(controls.target).multiplyScalar(1.7*domeDiameter/8).add(controls.target);
    if(config.id==='stand-lab')camera.position.sub(controls.target).multiplyScalar(Math.max(1,standSettings.heightM/4)).add(controls.target);
    if(config.id==='industrial-hall')camera.position.sub(controls.target).multiplyScalar(view==='orbit'?2.9:3).add(controls.target);
    if(config.id==='german-house')camera.position.sub(controls.target).multiplyScalar(1.9).add(controls.target);
    controls.update();
  }
  for (const preset of presets) {
    const button = document.createElement('button'); button.textContent = preset.title; button.dataset.id = preset.id;
    button.onclick = () => { void reset(preset.id === 'dome' ? domeScenario(domeDiameter) : preset, true).catch(error=>el('worker-status').textContent=error.message); }; el('scenario-list').append(button);
  }
  for (const view of ['orbit', 'side', 'top']) el(view).onclick = () => setView(view);
  el('run').onclick = () => { void send({type:'run',running:!playback.running}); };
  el('step').onclick = () => { if(!playback.running)void send({type:'step'}); };
  el('place-part').onclick = () => { void send({type:'place'}); };
  el('build-stage-button').onclick = () => { void send({type:'start',mode:'stage'}); };
  el('build-all').onclick = () => { void send(build?.automatic?{type:'stop'}:{type:'start',mode:'all'}); };
  el('show-plan').onchange = () => update(); el('frame-view').onchange = () => update();
  el('release-joints').onclick = () => { void send({type:'release',id:selected}); };
  for (const id of ['wind-enabled', 'wind-speed', 'wind-direction']) el(id).onchange = () => {
    const speed = el<HTMLInputElement>('wind-speed');
    speed.value = String(Number.isFinite(speed.valueAsNumber) ? Math.max(0, speed.valueAsNumber) : 0);
    void send({type:'wind',settings:{ enabled: el<HTMLInputElement>('wind-enabled').checked, speed: Number(speed.value), from: el<HTMLSelectElement>('wind-direction').value as WindSettings['from'] }});
  };
  el('reset').onclick = () => { void reset().catch(error=>el('worker-status').textContent=error.message); };
  el<HTMLFormElement>('dome-size-form').onsubmit = async event => {
    event.preventDefault();
    const diameter=Number(el<HTMLInputElement>('dome-diameter').value),previousDiameter=domeDiameter,previousSettings=domeSettings;
    try {
      const next=domeScenario(diameter);
      domeSettings={targetCellSizeM:Number(el<HTMLInputElement>('dome-cell-size').value),timberSectionsMm:['lower','middle','upper'].map(level=>Number(el<HTMLInputElement>(`dome-timber-${level}`).value)) as [number,number,number]};
      domeDiameter=diameter;await reset(next,true);
    } catch(error) {domeDiameter=previousDiameter;domeSettings=previousSettings;el('dome-size-error').textContent=(error as Error).message;}
  };
  el<HTMLInputElement>('stand-extension').oninput=()=>{el<HTMLInputElement>('stand-height').value=el<HTMLInputElement>('stand-extension').value;};
  el<HTMLInputElement>('stand-height').oninput=()=>{el<HTMLInputElement>('stand-extension').value=el<HTMLInputElement>('stand-height').value;};
  el<HTMLFormElement>('stand-form').onsubmit=async event=>{
    event.preventDefault();const previous=standSettings;
    standSettings={heightM:Number(el<HTMLInputElement>('stand-height').value),loadKg:Number(el<HTMLInputElement>('stand-load').value),friction:Number(el<HTMLInputElement>('stand-friction').value),hub:el<HTMLSelectElement>('stand-hub').value as keyof typeof STAND_HUBS};
    try{await reset(standScenario(),true);el('stand-error').textContent='';}catch(error){standSettings=previous;el('stand-error').textContent=(error as Error).message;}
  };
  for(const direction of ['x','z'] as const)el(`stand-push-${direction}`).onclick=()=>{
    const impulse=Number(el<HTMLInputElement>('stand-push').value);if(Number.isFinite(impulse)&&impulse>=0)void send({type:'push-stand',impulseNs:impulse,direction});
  };
  el('speed').onchange = () => { void send({type:'speed',speed:Number(el<HTMLSelectElement>('speed').value)}); };
  el('part').onchange = () => { selected = el<HTMLSelectElement>('part').value; if(!galleryDirty)gallery.selectInstance(selected); fillSetup(); void send({type:'select',id:selected}); };
  function fillSetup() {
    const spec = sim.parts.get(selected)!.spec;
    el<HTMLInputElement>('dimensions').value = spec.size.join(' ');
    el<HTMLInputElement>('position').value = [spec.position.x, spec.position.y, spec.position.z].join(' ');
    el<HTMLInputElement>('angle').value = String((spec.angle ?? 0) * 180 / Math.PI);
    el<HTMLInputElement>('density').value = String(spec.density); el<HTMLInputElement>('friction').value = String(spec.friction);
    el('setup-error').textContent = '';
  }
  el('setup-form').onsubmit = async event => {
    event.preventDefault();
    try {
      const triple = (id: string) => { const values = el<HTMLInputElement>(id).value.trim().split(/[ ,]+/).map(Number); if (values.length !== 3 || values.some(n => !Number.isFinite(n))) throw Error('Enter three finite numbers separated by spaces.'); return values as [number, number, number]; };
      const size = triple('dimensions'), pos = triple('position');
      if (size.some(n => n < .02 || n > 30) || pos.some(n => Math.abs(n) > 30)) throw Error('Dimensions must be 0.02–30 m and positions within ±30 m.');
      const next = structuredClone(config), spec = next.boxes.find(b => b.id === selected)!;
      spec.size = size; spec.position = { x: pos[0], y: pos[1], z: pos[2] }; spec.density = Number(el<HTMLInputElement>('density').value);
      spec.angle = Number(el<HTMLInputElement>('angle').value) * Math.PI / 180; spec.friction = Number(el<HTMLInputElement>('friction').value);
      if (![spec.density, spec.angle, spec.friction].every(Number.isFinite)) throw Error('All parameters must be finite.');
      next.title = presets.find(p => p.id === config.id)!.title + ' · custom';
      next.question = 'What changes when this custom setup is released under gravity?';
      spec.material = spec.material.replace(' · custom parameters', '') + ' · custom parameters';
      await reset(next,false,true);
    } catch (error) { el('setup-error').textContent = (error as Error).message; }
  };
  const fmt = (v: { x: number; y: number; z: number }) => `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`;
  function update() {
    syncMeshes();
    syncTransforms();
    el('mass').textContent = `${sim.mass.toFixed(2)} kg`;
    const windDirection = new THREE.Vector3().copy(WIND_DIRECTIONS[wind.settings.from]);
    windArrows.forEach((arrow, i) => {
      arrow.visible = wind.settings.enabled && wind.settings.speed > 0;
      arrow.setDirection(windDirection);
      arrow.position.copy(windDirection).multiplyScalar(-4 * arrowScale).add(new THREE.Vector3(windDirection.z, 0, -windDirection.x).multiplyScalar((i - 1) * 1.8 * arrowScale)); arrow.position.y = 1.5 * arrowScale; arrow.setLength(1.3 * arrowScale, .3 * arrowScale, .16 * arrowScale);
    });
    const windTotal = new THREE.Vector3().copy(wind.total);
    el('wind-status').textContent = wind.settings.enabled ? `${wind.settings.speed} m/s · ${(wind.settings.speed * 3.6).toFixed(0)} km/h · ${windTotal.length().toFixed(1)} N net drag` : 'Wind off';
    const { spec, body } = sim.parts.get(selected)!;
    const q = body.rotation(); const inertia = body.principalInertia();
    el('inspector').innerHTML = `<dt>Material</dt><dd>${spec.material}</dd><dt>Dimensions · m</dt><dd>${spec.size.map(n => Number(n.toFixed(4))).join(' × ')}</dd>${spec.taper ? `<dt>Taper · back → front · m</dt><dd>${spec.taper.backHeight.toFixed(3)} → ${spec.taper.frontHeight.toFixed(3)}</dd>` : ''}${spec.waterBarrier ? '<dt>Water barrier</dt><dd>Continuous sheet (assumed); leakage untested</dd>' : ''}<dt>Mass · kg</dt><dd>${spec.fixed ? 'Fixed boundary (external)' : body.mass().toFixed(3)}</dd><dt>Part origin · m</dt><dd>${fmt(body.translation())}</dd><dt>Center of mass · m</dt><dd>${fmt(body.worldCom())}</dd><dt>Orientation · quaternion XYZW</dt><dd>${fmt(q)}, ${q.w.toFixed(3)}</dd><dt>Velocity · m/s</dt><dd>${fmt(body.linvel())}</dd><dt>Angular velocity · rad/s</dt><dd>${fmt(body.angvel())}</dd><dt>Principal inertia · kg m²</dt><dd>${fmt(inertia)}</dd><dt>Friction / restitution</dt><dd>${spec.friction.toFixed(2)} / 0</dd>`;
    const load = wind.loads.get(selected);
    el('inspector').innerHTML += `<dt>Wind force XYZ · N</dt><dd>${load ? fmt(load.force) : '0.000, 0.000, 0.000'}</dd>${load ? `<dt>Wind torque XYZ · N m</dt><dd>${fmt(load.torque)}</dd><dt>Exposed / sheltered projected area · m²</dt><dd>${load.exposedArea.toFixed(3)} / ${load.shelteredArea.toFixed(3)}</dd>` : ''}`;
    const allContacts = sim.contacts();
    const contacts = build ? allContacts.filter(c => c.a === selected || c.b === selected) : allContacts;
    el('contact-heading').textContent = build ? 'Contacts on selected part' : 'Contact network';
    contactGeometry.setAttribute('position', new THREE.Float32BufferAttribute(contacts.flatMap(c => [c.point.x, c.point.y, c.point.z]), 3)); contactGeometry.computeBoundingSphere();
    const pairs = new Map<string, number>();
    contacts.forEach(c => { const key = `${c.a} ↔ ${c.b}`; pairs.set(key, (pairs.get(key) ?? 0) + c.force); });
    el('pair-count').textContent = String(new Set(allContacts.map(c => `${c.a}/${c.b}`)).size);
    el('contacts').innerHTML = pairs.size ? [...pairs].map(([pair, force]) => `<div class="contact">${pair}<br><span>${force.toFixed(1)} N</span>normal force</div>`).join('') : '<p class="note">No measured contacts yet. Step or run to evaluate contact.</p>';
    el('clock').textContent = `${sim.time.toFixed(3)} s`;
    refreshBuild();
  }
  el('export').onclick = async () => {
    const response=await send({type:'export'});if(!response)return;
    const record=JSON.stringify(response.record,null,2);
    const url = URL.createObjectURL(new Blob([record], { type: 'application/json' }));
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<h2>Experiment record</h2><p class="note">Save this JSON or select and copy it directly.</p><textarea readonly aria-label="Experiment JSON"></textarea><div class="export-actions"><a>Save JSON file</a><button>Close</button></div>';
    dialog.querySelector('textarea')!.value = record;
    const anchor = dialog.querySelector('a')!; anchor.href = url; anchor.download = `physical-world-${config.id}-${sim.ticks}.json`;
    dialog.querySelector('button')!.onclick = () => dialog.close();
    dialog.onclose = () => { URL.revokeObjectURL(url); dialog.remove(); };
    root.append(dialog); dialog.showModal();
  };
  const raycaster = new THREE.Raycaster(); let down = { x: 0, y: 0 };
  renderer.domElement.onpointerdown = e => { down = { x: e.clientX, y: e.clientY }; };
  renderer.domElement.addEventListener('pointerup', e => {
    if(galleryActive)return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...meshes.values()].filter(mesh => mesh.visible))[0];
    if (hit) { selected = hit.object.userData.id; if(!galleryDirty)gallery.selectInstance(selected); el<HTMLSelectElement>('part').value = selected; fillSetup(); void send({type:'select',id:selected}); }
  });
  const resizing = new ResizeObserver(() => { const w = viewport.clientWidth, h = viewport.clientHeight; renderer.setSize(w, h); gallery.resize(w,h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resizing.observe(viewport);
  await reset(presets[presets.length - 1], true);
  let last = performance.now(), lastDisplay = 0;
  const resume = () => { last = performance.now(); };
  document.addEventListener('visibilitychange', resume);
  renderer.setAnimationLoop((now: number) => {
    const elapsed = (now - last) / 1000; last = now;
    if (!document.hidden && !galleryActive && playback.running) client.advance(elapsed);
    syncMeshes();
    // Render transforms every frame; expensive text measurements at 10 Hz.
    syncTransforms();
    if (now - lastDisplay > 100) { update(); lastDisplay = now; }
    if(galleryActive)gallery.render(renderer);else {controls.update(); renderer.render(scene, camera);}
  });
  return () => {
    renderer.setAnimationLoop(null); resizing.disconnect(); document.removeEventListener('visibilitychange', resume);
    client.dispose(); controls.dispose(); gallery.controls.dispose();
    scene.traverse(object => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); for (const m of [mesh.material].flat()) (m as THREE.Material | undefined)?.dispose(); });
    renderer.dispose(); root.innerHTML = ''; root.classList.remove('physical-lab');
  };
}
