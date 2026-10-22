import { piecesOf, polyhedraOf, shapeVerticesOf, surfaceFacesOf, verticesOf, volumeOf, type Box, type V3 } from './simulation';
import { polyVolume, sub, cross, dot, length, unit, mean } from './geometry';
import type { BuildDefinition, BuildPart } from './shed';

export const mm = (value: number) => (value * 1000).toLocaleString('en-US', {maximumFractionDigits: 3});
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function boundsOf(box: Box) {
  const points = verticesOf(box);
  const min = {x: Infinity, y: Infinity, z: Infinity}, max = {x: -Infinity, y: -Infinity, z: -Infinity};
  for (const p of points) for (const axis of ['x','y','z'] as const) { min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]); }
  return {min, max, size: [max.x-min.x, max.y-min.y, max.z-min.z] as Box['size']};
}
export function massOf(box: Box) {
  if (!box.shapeDensities) return volumeOf(box) * box.density;
  const volumes = [...polyhedraOf(box).map(polyVolume), ...piecesOf(box).map(p => p.size[0]*p.size[1]*p.size[2])];
  return volumes.reduce((sum, volume, i) => sum + volume * (box.shapeDensities![i] ?? box.density), 0);
}
// Discard placement and floating point construction noise, never round to display precision.
const stable = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === 'number' ? Math.round(v*1e9)/1e9 : v);
function partKey(box: Box) {
  if (box.telescopic && box.prefab) return stable({model:box.telescopic.model, segments:box.telescopic.segments, length:box.telescopic.segmentLengthM,
    stock:box.prefab.components.map(p=>({size:p.size,material:p.material,density:p.density,pieces:p.pieces,polyhedron:p.polyhedron}))});
  if (!box.pieces && !box.polyhedron && !box.convexPieces && !box.taper) return stable({material:box.material,opacity:box.opacity??1,waterBarrier:box.waterBarrier??false,density:box.density,size:[...box.size].sort((a,b)=>a-b)});
  return stable({material:box.material, opacity:box.opacity??1, waterBarrier:box.waterBarrier??false, shapes:canonicalSolid(box).key});
}

const boxFaces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
/** Congruent convex-region geometry, independent of authoring axes and world pose.
 * Candidate frames use the largest solid's largest faces. Only proper rotations
 * are used, so a handed fitting cannot be merged with its mirror by reflection. */
function canonicalSolid(box:Box) {
  const groups=shapeVerticesOf(box),polys=polyhedraOf(box);
  const volumes=[...polys.map(polyVolume),...piecesOf(box).map(p=>p.size[0]*p.size[1]*p.size[2])];
  const largest=volumes.indexOf(Math.max(...volumes));
  const faces=surfaceFacesOf(box).filter(f=>f.piece===largest).map(f=>({...f,area:f.vertices.slice(1,-1).reduce((sum,_,i)=>sum+length(cross(sub(f.vertices[i+1],f.vertices[0]),sub(f.vertices[i+2],f.vertices[0])))/2,0)}));
  const maxArea=Math.max(...faces.map(f=>f.area)),center=mean(groups.flat());
  let best='',bestGroups:V3[][]=groups;
  for(const face of faces.filter(f=>Math.abs(f.area-maxArea)<maxArea*1e-8)) {
    const z=unit(cross(sub(face.vertices[1],face.vertices[0]),sub(face.vertices.at(-1)!,face.vertices[0])));
    face.vertices.forEach((p,i)=>{
      const x=unit(sub(face.vertices[(i+1)%face.vertices.length],p)),y=cross(z,x);
      const transformed=groups.map(points=>points.map(v=>{const d=sub(v,center);return {x:dot(d,x),y:dot(d,y),z:dot(d,z)};}));
      const key=stable(transformed.map((vertices,j)=>({density:box.shapeDensities?.[j]??box.density,vertices:vertices.map(v=>[v.x,v.y,v.z].map(n=>Math.round(n*1e9)/1e9)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2])})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
      if(!best||key<best){best=key;bestGroups=transformed;}
    });
  }
  return {key:best,groups:bestGroups,faces:groups.map((_,i)=>polys[i]?.faces??boxFaces)};
}
const previewCache=new WeakMap<Box,Box>();
/** Display inclined solids in their own face frame; simulation specs are untouched. */
export function previewSpec(box:Box):Box {
  if(!polyhedraOf(box).length||box.telescopic||box.mountPoint)return box;
  let preview=previewCache.get(box);if(preview)return preview;
  const canonical=canonicalSolid(box);
  preview={...box,polyhedron:undefined,pieces:[],convexPieces:canonical.groups.map((vertices,i)=>({vertices,faces:canonical.faces[i]})),position:{x:0,y:0,z:0},rotation:undefined,angle:undefined};
  preview.size=boundsOf(preview).size;previewCache.set(box,preview);return preview;

}
export type PartGroup = {id:string; name:string; spec:Box; instances:BuildPart[]; temporary:boolean; reusable:boolean; quantity:number; massKg:number};
export function partsCatalog(plan: BuildPart[], definition?: BuildDefinition): PartGroup[] {
  const temporary = new Set(definition?.temporaryProps ?? []), groups: PartGroup[] = [], keyed = new Map<string, PartGroup>(), byId = new Map<string, PartGroup>();
  for (const entry of plan) {
    if (entry.box.fixed) continue;
    const isTemporary = temporary.has(entry.box.id), key = `${isTemporary}/${partKey(entry.box)}`;
    let group = keyed.get(key);
    if (!group) {
      group = {id:`P${String(groups.length+1).padStart(3,'0')}`,name:entry.box.telescopic?.model ?? entry.box.id.replaceAll('-',' '),spec:entry.box,
        instances:[],temporary:isTemporary,reusable:isTemporary&&!!entry.box.telescopic,quantity:0,massKg:massOf(entry.box)};
      groups.push(group); keyed.set(key, group);
    }
    group.instances.push(entry); if (!group.reusable) group.quantity++;
    byId.set(entry.box.id,group);
  }
  // Match recipe withdrawal order. A stand is acquired before that placement's releases.
  const active = new Set<string>();
  const release = (id:string) => { for (const member of definition?.temporarySupportGroups?.find(g=>g.includes(id)) ?? [id]) active.delete(member); };
  const rules = new Map<string,string[]>();
  for (const rule of definition?.shoringReleaseAfter ?? []) rules.set(rule.afterPart,[...(rules.get(rule.afterPart)??[]),...rule.parts]);
  plan.forEach((entry,i)=>{
    const group = byId.get(entry.box.id);
    if (group?.reusable) {
      active.add(entry.box.id);
      group.quantity = Math.max(group.quantity,group.instances.filter(p=>active.has(p.box.id)).length);
    }
    for (const id of rules.get(entry.box.id) ?? []) release(id);
    if (definition?.withdrawShoringAfterStage === entry.stage && plan[i+1]?.stage !== entry.stage) active.clear();
  });
  return groups;
}

/** All authored solid regions remain inspectable, including cutouts and compound fittings. */
export function geometryDetails(box: Box): string {
  const e=escapeHtml, xyz=(p:V3)=>[p.x,p.y,p.z].map(mm).join(' / ');
  const rows = piecesOf(box).map((p,i)=>`<tr><td>${i+1}</td><td>${p.size.map(mm).join(' × ')}</td><td>${xyz(p.offset)}</td><td>${p.rotation ? [p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w].map(n=>Number(n.toFixed(6))).join(' / ') : '0 / 0 / 0 / 1'}</td></tr>`).join('');
  let out=box.taper ? `<p>Taper height: ${mm(box.taper.backHeight)} → ${mm(box.taper.frontHeight)} mm (−Z → +Z). Slope ${(Math.atan2(box.taper.frontHeight-box.taper.backHeight,box.size[2])*180/Math.PI).toFixed(3)}°.</p>` : '';
  if (rows && !box.taper) out+=`<details><summary>Solid regions · dimensions and local positions</summary><p>Regions form one supplied part; they are not additional assembly items. Rotation is a local XYZW quaternion.</p><div class="table-scroll"><table><thead><tr><th>Region</th><th>X × Y × Z · mm</th><th>Center X / Y / Z · mm</th><th>Rotation</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  const polys=polyhedraOf(box);
  if (polys.length || box.taper) out+=`<details><summary>Outline vertices, edges and faces · mm</summary><p>Coordinates use the part's local origin. Face loops describe each solid region, including panel cutouts; shared internal edges may occur.</p>${(box.taper ? [{vertices:verticesOf(box),faces:[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]}] : polys).map((p,k)=>{
    const edges=new Map<string,[number,number]>();p.faces.forEach(face=>face.forEach((a,i)=>{const b=face[(i+1)%face.length];edges.set([a,b].sort((x,y)=>x-y).join('-'),[a,b]);}));
    return `<h4>Region ${k+1}</h4><div class="table-scroll"><table><tr><th>Vertex</th><th>X / Y / Z · mm</th></tr>${p.vertices.map((v,i)=>`<tr><td>V${i+1}</td><td>${xyz(v)}</td></tr>`).join('')}</table><table><tr><th>Edge</th><th>Length · mm</th></tr>${[...edges.values()].map(([a,b])=>`<tr><td>V${a+1}–V${b+1}</td><td>${mm(Math.hypot(p.vertices[a].x-p.vertices[b].x,p.vertices[a].y-p.vertices[b].y,p.vertices[a].z-p.vertices[b].z))}</td></tr>`).join('')}</table></div><p>Faces: ${p.faces.map(f=>f.map(i=>`V${i+1}`).join(' → ')).join('; ')}</p>`;
  }).join('')}</details>`;
  if(box.mountPoint)out+=`<p>${e(box.mountPoint.standard)}: ${box.mountPoint.faceSizeM.map(mm).join(' × ')} mm face; ${box.mountPoint.boltPatternM.map(mm).join(' × ')} mm bolt pattern. ${e(box.mountPoint.note)}</p>`;
  if(box.telescopic)out+=`<p>Height range ${mm(box.telescopic.minHeightM)}–${mm(box.telescopic.maxHeightM)} mm. ${box.telescopic.segments} sleeves, stock length ${mm(box.telescopic.segmentLengthM)} mm; current overlap ${mm(box.telescopic.overlapM)} mm.</p>`;
  return out;
}

/** Lossless authored solid regions in millimetres, suitable input for a later CAD/export stage.
 * This is deliberately not a claim of a manifold manufacturing mesh or a toolpath. */
export function partGeometryRecord(group:PartGroup, source:Box=group.spec) {
  const box=previewSpec(source),polys=polyhedraOf(box),bounds=boundsOf(box);
  const point=(p:V3)=>({x:p.x*1000,y:p.y*1000,z:p.z*1000});
  return {format:'physical-world-part',version:1,units:'mm',id:group.id,instanceId:source.id,name:group.name,
    quantity:group.quantity,placementCount:group.instances.length,temporary:group.temporary,reusable:group.reusable,
    material:box.material,massKg:massOf(source),bounds:{min:point(bounds.min),max:point(bounds.max)},
    coordinateFrame:'Part-local gallery frame; world placement is excluded from solid coordinates.',
    solids:shapeVerticesOf(box).map((vertices,i)=>({vertices:vertices.map(point),faces:polys[i]?.faces??boxFaces,densityKgPerM3:box.shapeDensities?.[i]??box.density})),
    assemblyInstances:group.instances.map(p=>({id:p.box.id,heightMm:p.box.telescopic?p.box.telescopic.heightM*1000:undefined})),
    sourceSpecMetres:structuredClone(source),
    fabricationStatus:'Reference geometry only. Solid regions may touch or overlap. Boolean union, mesh validation, manufacturing tolerances and any unmodeled holes or fasteners remain to be specified. No CNC toolpath or print-ready certification.'};
}
