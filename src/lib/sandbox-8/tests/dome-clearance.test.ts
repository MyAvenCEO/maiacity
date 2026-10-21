import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation,G,shapeVerticesOf,rotationOf,transform,type Box} from '../src/simulation';
import {domeDefinition as detailedDomeDefinition,domeScenario} from '../src/dome';
import {ShedBuild} from '../src/shed';
import {hull,sub,cross,dot,length,unit,v} from '../src/geometry';
beforeAll(initialize);

// Independent separating-axis check: convex face normals and edge cross products.
function components(box:Box){return shapeVerticesOf(box).map(vs=>{
 const points=vs.map(p=>transform(p,rotationOf(box),box.position)),poly=hull(points);
 const faces=poly.faces.map(f=>f.map(i=>points[i]));
 return {points,normals:faces.map(f=>unit(cross(sub(f[1],f[0]),sub(f.at(-1)!,f[0])))),edges:faces.flatMap(f=>f.map((p,i)=>sub(f[(i+1)%f.length],p)))};
});}
function overlaps(a:ReturnType<typeof components>[number],b:ReturnType<typeof components>[number]){
 const separates=(axis:ReturnType<typeof v>)=>{if(length(axis)<1e-8)return false;const n=unit(axis),ap=a.points.map(p=>dot(p,n)),bp=b.points.map(p=>dot(p,n));return Math.min(Math.max(...ap),Math.max(...bp))-Math.max(Math.min(...ap),Math.min(...bp))<=1e-6;};
 if([v(1,0,0),v(0,1,0),v(0,0,1),...a.normals,...b.normals].some(separates))return false;
 return !a.edges.some(e=>b.edges.some(f=>separates(cross(e,f))));
}

test.each([10,12,16])('permanent building parts do not intersect at %s m',diameter=>{
 const def=domeDefinition(diameter),parts=def.plan.filter(p=>!def.temporaryProps!.includes(p.box.id)).map(p=>({id:p.box.id,components:components(p.box)}));
 const collisions:string[]=[];
 for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++)if(parts[i].components.some(a=>parts[j].components.some(b=>overlaps(a,b))))collisions.push(`${parts[i].id}/${parts[j].id} pieces ${parts[i].components.flatMap((a,ai)=>parts[j].components.flatMap((b,bi)=>overlaps(a,b)?[`${ai}:${bi}`]:[]))}`);
 expect(collisions.slice(0,20)).toEqual([]);
});

// Retain the original seven-body stands as the detailed reference model.
function domeDefinition(diameter=8){return detailedDomeDefinition(diameter,{detailedShoring:true});}
