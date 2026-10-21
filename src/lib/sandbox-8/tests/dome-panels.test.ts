import RAPIER from '@dimforge/rapier3d-compat';
import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation,volumeOf,transform,rotationOf} from '../src/simulation';
import {domeDefinition as detailedDomeDefinition,domeScenario,domeMesh} from '../src/dome';
import {ShedBuild} from '../src/shed';
import {Wind} from '../src/wind';
import {v,sub,cross,length,unit,mul,add} from '../src/geometry';
beforeAll(initialize);

test('pentagonal entrance has actual missing material and a clear doorway through the whole frame',()=>{
 const def=domeDefinition(),panel=def.plan.find(p=>p.box.id==='dome-entrance-pentagon')!.box;
 expect(panel.convexPieces).toHaveLength(3);expect(def.plan.some(p=>p.box.id==='dome-hub-11')).toBe(false);
 expect(def.plan.filter(p=>p.box.id.startsWith('dome-strut-')&&p.box.id.split('-').slice(2).includes('11'))).toHaveLength(0);
 const sim=new Simulation(domeScenario()),build=new ShedBuild(sim,def);
 try{
  while(!build.complete)build.placeNext();sim.world.propagateModifiedBodyPositionsToColliders();
  for(const x of [-.45,0,.45])for(const y of [.55,1.4,2.3]){
   const ray=new RAPIER.Ray(v(x,y,4.4),v(0,0,-1));
   const hits=[...sim.parts.values()].filter(p=>p.colliders.some(c=>c.castRay(ray,1.8,true)>=0)).map(p=>p.spec.id);
   expect(hits,`doorway x=${x}, y=${y}`).toEqual([]);
  }
  const solidHit=new RAPIER.Ray(v(1,1.4,4.4),v(0,0,-1));
  expect(sim.parts.get(panel.id)!.colliders.some(c=>c.castRay(solidHit,2,true)>=0)).toBe(true);
  expect(sim.body(panel.id).mass()).toBeCloseTo(volumeOf(panel)*600,3);
 }finally{sim.dispose();}
 // Independent area: inset regular pentagon minus the rectangular cutout.
 const mesh=domeMesh(),node=10,neighbors=[...new Set(mesh.faces.filter(f=>f.includes(node)).flat())].filter(i=>i!==node);
 const normal=mesh.vertices[node],up=unit(cross(normal,v(1,0,0)));
 const points=neighbors.map(i=>({x:mesh.vertices[i].x*4,y:mesh.vertices[i].y*4/up.y}));
 const cy=points.reduce((s,p)=>s+p.y,0)/5;points.sort((a,b)=>Math.atan2(a.y-cy,a.x)-Math.atan2(b.y-cy,b.x));
 const area=Math.abs(points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%5].y-p.y*points[(i+1)%5].x,0))/2*.994**2;
 const holeHeight=2.1/up.y-cy*.006;
 expect(volumeOf(panel)).toBeCloseTo((area-holeHeight)*.024,8);
});

test('transparent windows remain solid material and take the same wind load as opaque panels',()=>{
 const windows=domeDefinition().plan.filter(p=>p.box.opacity!==undefined);expect(windows).toHaveLength(12);
 const spec=windows[0].box,poly=spec.polyhedron!,[a,b,c]=[poly.vertices[0],poly.vertices[2],poly.vertices[4]],area=length(cross(sub(b,a),sub(c,a)))/2;
 expect(volumeOf(spec)).toBeCloseTo(area*.006,8);
 const normal=unit(cross(sub(b,a),sub(c,a))),point=transform(mul(add(add(a,b),c),1/3),rotationOf(spec),spec.position);
 const readings=[];
 for(const opacity of [spec.opacity,undefined]){
  const sim=new Simulation({id:'window',title:'Window',question:'',boxes:[{...spec,opacity}]});
  try{
   sim.world.propagateModifiedBodyPositionsToColliders();
   const ray=new RAPIER.Ray(add(point,mul(normal,.5)),mul(normal,-1));
   expect(sim.parts.get(spec.id)!.colliders.some(c=>c.castRay(ray,1,true)>=0)).toBe(true);
   const wind=new Wind(sim);wind.configure({enabled:true,speed:10,from:'left'});wind.measure();
   readings.push({mass:sim.mass,load:wind.loads.get(spec.id)});
  }finally{sim.dispose();}
 }
 expect(readings[0]).toEqual(readings[1]);expect(length(readings[0].load!.force)).toBeGreaterThan(1);
});

// Retain the original seven-body stands as the detailed reference model.
function domeDefinition(diameter=8){return detailedDomeDefinition(diameter,{detailedShoring:true});}
