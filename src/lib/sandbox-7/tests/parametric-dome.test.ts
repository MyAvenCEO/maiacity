// @ts-nocheck — run by bun test, not type-checked, as the app's other tests
import {expect,test} from 'vitest';
import {domeDefinition,domeDetail,domeMesh,domeScenario} from '../dome';
import {volumeOf} from '../simulation';

test('diameter is unbounded above; cell density follows a calculation, including non-preset subdivisions',()=>{
 for(const diameter of [16.1,32,64,100,1000])expect(()=>domeScenario(diameter)).not.toThrow();
 for(const diameter of [NaN,Infinity,-1,5.9])expect(()=>domeScenario(diameter)).toThrow();
 for(const n of [1,2,3,4,5,7]){
  const mesh=domeMesh(n);expect(mesh.faces).toHaveLength(40*n*n);
  expect(mesh.faces.filter((_,i)=>!mesh.entranceFlags[i])).toHaveLength(35*n*n);
  expect(mesh.entrancePerimeterEdges).toHaveLength(5*n);
  expect(mesh.faces.flat().every(i=>Number.isInteger(i)&&i>=0&&i<mesh.vertices.length)).toBe(true);
  const edges=new Map<string,number>();for(const face of mesh.faces)for(let i=0;i<3;i++){const key=[face[i],face[(i+1)%3]].sort((a,b)=>a-b).join('/');edges.set(key,(edges.get(key)??0)+1);}
  expect([...edges.values()].every(n=>n===1||n===2)).toBe(true);
  const boundary=[...edges].filter(([,n])=>n===1).map(([key])=>key.split('/').map(Number));
  expect(boundary).toHaveLength(10*n);
  expect(boundary.every(e=>e.every(i=>Math.abs(mesh.vertices[i].y)<1e-8))).toBe(true);
 }
 expect(domeDetail(64,2.5)).toBeGreaterThan(domeDetail(32,2.5));expect(domeDetail(32,5)).toBeLessThan(domeDetail(32,2.5));
});

test.each([24,32,64])('%s m recipe uses the supplied cell and timber settings without a size variant',diameter=>{
 const settings={targetCellSizeM:diameter/6,timberSectionsMm:[140,110,90] as [number,number,number]},def=domeDefinition(diameter,{settings});
 expect(def.parameters!.frequency).toBe(4);expect(def.parameters!.timberSectionsMm).toEqual(settings.timberSectionsMm);
 const struts=def.plan.filter(p=>p.box.id.startsWith('dome-strut-'));expect(new Set(struts.map(p=>Math.round(p.box.size[0]*1000)))).toEqual(new Set(settings.timberSectionsMm));
 const supplied=new Set<string>();for(const p of def.plan){expect(p.connectTo.every(id=>supplied.has(id))).toBe(true);expect(volumeOf(p.box)).toBeGreaterThan(0);supplied.add(p.box.id);}
 const stands=def.plan.filter(p=>p.box.telescopic);expect(new Set(stands.map(p=>p.box.telescopic!.segments)).size).toBe(1);
 expect(Math.max(...stands.map(p=>p.box.telescopic!.heightM))).toBeLessThan(stands[0].box.telescopic!.maxHeightM);
 expect(def.plan.filter(p=>p.box.mountPoint)).toHaveLength(stands.length);
},30000);
