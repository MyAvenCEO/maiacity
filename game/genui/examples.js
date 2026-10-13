// @ts-nocheck — plain JS, kept loose on purpose
/**
 * The three first generated views (Samuel, 2026-10-13): a three.js scene and a d3 chart (both `html`, sandboxed
 * code) and a dome planner (`a2ui`, declarative JSON with its logic in QuickJS). The API keeps them as the first
 * views when it has none; an agent may change or delete them like any other.
 */

const scene = `<style>
  canvas { display: block; }
  html, body { margin: 0; height: 100%; background: #0d1512; overflow: hidden; font: 13px system-ui, sans-serif; color: #e8efe9; }
  #tip { position: absolute; left: 12px; bottom: 10px; opacity: .75; }
</style>
<div id="tip">Drag to orbit · click a dome</div>
<script type="module">
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1512);
  scene.fog = new THREE.Fog(0x0d1512, 260, 520);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
  camera.position.set(170, 130, 210);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.maxPolarAngle = Math.PI * 0.47;

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a3b22, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(-120, 200, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220 });
  scene.add(sun);

  // seven hexes: one village
  const R = 70, hexes = [[0, 0]];
  for (let i = 0; i < 6; i++) hexes.push([Math.cos(i * Math.PI / 3 + Math.PI / 6) * R * Math.sqrt(3), Math.sin(i * Math.PI / 3 + Math.PI / 6) * R * Math.sqrt(3)]);
  const hexGeo = new THREE.CylinderGeometry(R - 1.5, R - 1.5, 2, 6);
  const domes = [];
  hexes.forEach(([x, z], i) => {
    const ground = new THREE.Mesh(hexGeo, new THREE.MeshStandardMaterial({ color: i ? 0x355e2b : 0x4a6b3a, roughness: 1 }));
    ground.position.set(x, -1, z);
    ground.rotation.y = Math.PI / 6;
    ground.receiveShadow = true;
    scene.add(ground);
    const size = i ? 20 : 34;
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(size, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, transmission: 0.6, roughness: 0.15, thickness: 1, transparent: true, opacity: 0.55 })
    );
    const frame = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(size, 2)), new THREE.LineBasicMaterial({ color: 0xe9f4ec, transparent: true, opacity: 0.35 }));
    const clip = new THREE.Group();
    clip.add(shell, frame);
    shell.castShadow = true;
    clip.position.set(x, 0, z);
    scene.add(clip);
    // trees round each dome
    for (let t = 0; t < 14; t++) {
      const a = (t / 14) * Math.PI * 2 + i, r = size + 10 + (t % 3) * 7;
      const tree = new THREE.Mesh(new THREE.ConeGeometry(3 + (t % 4), 9 + (t % 5) * 2, 7), new THREE.MeshStandardMaterial({ color: 0x2f7a3b }));
      tree.position.set(x + Math.cos(a) * r, 5, z + Math.sin(a) * r);
      tree.castShadow = true;
      scene.add(tree);
    }
    domes.push({ mesh: shell, name: i ? 'Tribe ' + i : 'Village center' });
  });

  const ray = new THREE.Raycaster(), m = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (e) => {
    m.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(m, camera);
    const hit = ray.intersectObjects(domes.map((d) => d.mesh))[0];
    if (!hit) return;
    const d = domes.find((d) => d.mesh === hit.object);
    hit.object.material.color.setHex(0xffd27a);
    setTimeout(() => hit.object.material.color.setHex(0xbfe3ff), 600);
    // tell the host, as an MCP App does: JSON-RPC over postMessage
    parent.postMessage({ jsonrpc: '2.0', id: Date.now(), method: 'ui/update-model-context', params: { structuredContent: { clicked: d.name } } }, '*');
  });

  const fit = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', fit); fit();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
</script>`;

const chart = `<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #fbfaf6; font: 12px system-ui, sans-serif; color: #24302a; }
  svg { display: block; }
  .legend { display: flex; gap: 14px; padding: 10px 14px 0; flex-wrap: wrap; }
  .legend button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .legend i { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
  .legend .off { opacity: .35; }
  #tip { position: absolute; pointer-events: none; background: #fff; border: 1px solid #d9d6cc; border-radius: 8px; padding: 6px 9px; box-shadow: 0 4px 14px #0001; display: none; }
  .axis text { fill: #6b736d; } .axis path, .axis line { stroke: #cfccc2; }
</style>
<div class="legend" id="legend"></div>
<svg id="c"></svg>
<div id="tip"></div>
<script type="module">
  // an MCP App built with the official SDK: the host hands it its data as the tool result
  import { App } from '@modelcontextprotocol/ext-apps';
  const app = new App({ name: 'COOP chart', version: '1.0.0' }, {}, { autoResize: false }); // it fills its frame, so it asks for no size
  let coops = [], rows = [];
  app.ontoolresult = (r) => { ({ coops, rows } = r.structuredContent); for (const c of coops) on.add(c.key); drawLegend(); draw(); };
  const on = new Set();
  const svg = d3.select('#c'), tip = d3.select('#tip');
  const M = { t: 16, r: 54, b: 30, l: 54 };

  function draw() {
    const W = innerWidth, H = innerHeight - 34;
    svg.attr('width', W).attr('height', H).selectAll('*').remove();
    const keys = coops.filter((c) => on.has(c.key)).map((c) => c.key);
    const stack = d3.stack().keys(keys)(rows);
    const x = d3.scaleLinear().domain([1, 13]).range([M.l, W - M.r]);
    const y = d3.scaleLinear().domain([0, d3.max(stack.at(-1) ?? [[0, 1]], (d) => d[1]) || 1]).nice().range([H - M.b, M.t]);
    const y2 = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.hearts) * 1.1]).range([H - M.b, M.t]);
    svg.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + (H - M.b) + ')').call(d3.axisBottom(x).ticks(13).tickFormat((m) => 'M' + m));
    svg.append('g').attr('class', 'axis').attr('transform', 'translate(' + M.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('~s')));
    svg.append('g').attr('class', 'axis').attr('transform', 'translate(' + (W - M.r) + ',0)').call(d3.axisRight(y2).ticks(5).tickFormat(d3.format('~s')));
    svg.append('g').selectAll('line').data(y.ticks(5)).join('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', y).attr('y2', y).attr('stroke', '#0000000d');
    const area = d3.area().x((d) => x(d.data.month)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
    svg.append('g').selectAll('path').data(stack).join('path')
      .attr('fill', (s) => coops.find((c) => c.key === s.key).color).attr('fill-opacity', 0.78).attr('d', area);
    const line = d3.line().x((d) => x(d.month)).y((d) => y2(d.hearts)).curve(d3.curveMonotoneX);
    svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', '#d2453b').attr('stroke-width', 2).attr('stroke-dasharray', '5 4').attr('d', line);
    const cross = svg.append('line').attr('stroke', '#24302a').attr('stroke-opacity', 0.4).attr('y1', M.t).attr('y2', H - M.b).style('display', 'none');
    svg.append('rect').attr('x', M.l).attr('y', M.t).attr('width', W - M.l - M.r).attr('height', H - M.t - M.b).attr('fill', 'transparent')
      .on('mousemove', (e) => {
        const m = Math.round(x.invert(d3.pointer(e)[0])), r = rows[m - 1];
        cross.style('display', null).attr('x1', x(m)).attr('x2', x(m));
        tip.style('display', 'block').style('left', Math.min(e.clientX + 14, W - 170) + 'px').style('top', e.clientY + 'px')
          .html('<b>Month ' + m + '</b><br>' + coops.filter((c) => on.has(c.key)).map((c) => '<span style="color:' + c.color + '">■</span> ' + c.name + ': ' + d3.format(',.0f')(r[c.key])).join('<br>') + '<br><span style="color:#d2453b">- -</span> HEARTS minted: ' + d3.format(',.0f')(r.hearts));
      })
      .on('mouseleave', () => { cross.style('display', 'none'); tip.style('display', 'none'); })
      .on('click', (e) => app.updateModelContext({ structuredContent: { month: Math.round(x.invert(d3.pointer(e)[0])) } }));
  }

  function drawLegend() {
  const legend = d3.select('#legend');
  legend.selectAll('*').remove();
  for (const c of coops)
    legend.append('button').html('<i style="background:' + c.color + '"></i>' + c.name).on('click', function () {
      on.has(c.key) ? on.delete(c.key) : on.add(c.key);
      this.classList.toggle('off', !on.has(c.key));
      draw();
    });
  legend.append('span').html('<i style="background:#d2453b"></i> HEARTS minted (right axis)');
  }
  addEventListener('resize', () => rows.length && draw());
  await app.connect();
</script>`;

// a year of MaiaCity V1 on its 13-month calendar: MIND in each COOP's treasury (stacked) and HEARTS minted (line)
function year() {
	let seed = 7;
	const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const rows = [];
	let a = 900, b = 600, c = 400;
	for (let m = 1; m <= 13; m++) {
		a *= 1 + 0.05 + rnd() * 0.06;
		b *= 1 + 0.03 + rnd() * 0.1;
		c *= 1 + 0.08 + rnd() * 0.05;
		rows.push({ month: m, maia: Math.round(a), village: Math.round(b), tribe: Math.round(c), hearts: Math.round(1344 + rnd() * 300 + m * 40) });
	}
	return {
		coops: [
			{ key: 'maia', name: 'MaiaCity COOP', color: '#2f6f5e' },
			{ key: 'village', name: 'Village COOP', color: '#c98a2b' },
			{ key: 'tribe', name: 'Tribe COOP', color: '#7b5ea7' }
		],
		rows
	};
}

const planner = {
	root: 'page',
	data: { people: 120, dome: 'Medium' },
	logic: `// runs in QuickJS: no page, no network, no clock. Hands back the whole data model.
const DOMES = { Small: 12, Medium: 24, Large: 48 };
export function init(d) { return figure(d); }
export function on(event, d) {
  if (event.name === 'people') d.people = Math.max(12, Math.min(1500, Math.round(event.value)));
  if (event.name === 'dome' && DOMES[event.value]) d.dome = event.value;
  return figure(d);
}
function figure(d) {
  const per = DOMES[d.dome];
  const domes = Math.ceil(d.people / per);
  const forest = d.people * 1050 / 10000; // ha of food forest, ~1,050 m² a head
  const water = d.people * 0.15;           // m³ a day
  const fill = Math.round((d.people / (domes * per)) * 100);
  return { ...d, domes, perDome: per, forest: Math.round(forest * 10) / 10, water: Math.round(water * 10) / 10, fill,
    tone: fill > 85 ? 'good' : fill > 60 ? 'warn' : 'bad',
    beds: [{ label: 'Small', value: Math.ceil(d.people / 12) }, { label: 'Medium', value: Math.ceil(d.people / 24) }, { label: 'Large', value: Math.ceil(d.people / 48) }] };
}`,
	components: [
		{ id: 'page', type: 'Column', gap: 'm', children: ['head', 'controls', 'metrics', 'fillcard', 'bars'] },
		{ id: 'head', type: 'Card', title: 'Dome planner', subtitle: 'How many domes, and how much land, for a tribe', children: ['intro'] },
		{ id: 'intro', type: 'Text', text: 'Declarative: our own components draw this JSON, and its logic runs in QuickJS.', tone: 'muted', size: 's' },
		{ id: 'controls', type: 'Card', children: ['people', 'sizes'] },
		{ id: 'people', type: 'Slider', label: 'People', event: 'people', value: { $data: 'people' }, min: 12, max: 1500, step: 12 },
		{ id: 'sizes', type: 'Row', gap: 's', wrap: true, children: ['small', 'medium', 'large'] },
		{ id: 'small', type: 'Button', label: 'Small dome · 12', event: 'dome', value: 'Small' },
		{ id: 'medium', type: 'Button', label: 'Medium dome · 24', event: 'dome', value: 'Medium', tone: 'accent' },
		{ id: 'large', type: 'Button', label: 'Large dome · 48', event: 'dome', value: 'Large' },
		{ id: 'metrics', type: 'Grid', columns: 3, gap: 's', children: ['m1', 'm2', 'm3'] },
		{ id: 'm1', type: 'Metric', label: 'Domes', value: { $data: 'domes' }, unit: { $data: 'dome' }, tone: 'accent' },
		{ id: 'm2', type: 'Metric', label: 'Food forest', value: { $data: 'forest' }, unit: 'ha' },
		{ id: 'm3', type: 'Metric', label: 'Water a day', value: { $data: 'water' }, unit: 'm³' },
		{ id: 'fillcard', type: 'Card', children: ['fill'] },
		{ id: 'fill', type: 'Progress', label: 'Beds filled', value: { $data: 'fill' }, max: 100, tone: { $data: 'tone' } },
		{ id: 'bars', type: 'Bars', label: 'Domes needed by size', items: { $data: 'beds' } }
	]
};

export const EXAMPLES = [
	{ id: 'village-scene', title: 'A village in three.js', note: 'An MCP App in plain JS: seven hexes, a dome on each. Click a dome: it tells the page over JSON-RPC.', kind: 'html', spec: { libs: ['three'], height: 460, html: scene } },
	{ id: 'coop-chart', title: 'COOP treasuries over a year', note: 'An MCP App (built with the official SDK): a d3 stacked area of MIND per COOP and HEARTS minted, its numbers handed in as the tool result.', kind: 'html', spec: { libs: ['d3', 'mcp-apps'], height: 400, html: chart, data: year() } },
	{ id: 'dome-planner', title: 'Dome planner', note: 'Declarative JSON drawn by our components; its logic runs in QuickJS.', kind: 'a2ui', spec: planner }
];
