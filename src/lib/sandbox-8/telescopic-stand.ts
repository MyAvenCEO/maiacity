import {prefabricatedStand} from './prefab';
import {v,add,sub,mul,unit,frameRotation,dot,cross,hull} from './geometry';
import {verticesOf,shapeVerticesOf,transform,rotationOf,inverseRotation,multiplyRotations,type Box,type V3} from './simulation';
import type {BuildPart} from './shed';

export const STAND_MODEL='TS telescopic shoring stand';
export const MIN_OVERLAP=.10;
/** Same stock at every height: nested hollow steel tubes and a fixed offset head.
 * Adjustment is a lab operation; the locked assembly has one rigid body. */
export function telescopicStand(hub:Box, center:V3, id:string, stage:number, segments:number, segmentLength:number, originalStemTop:number):BuildPart {
 const out=unit(v(center.x,0,center.z||1e-12)),tangent=v(out.z,0,-out.x),yaw=frameRotation(tangent,v(0,1,0),out);
 // Clip existing hub faces to the original clear stem footprint. Retain only
 // the upper socket shoulder; the stand adapter ends below all hub geometry.
 const clippedFaces=shapeVerticesOf(hub).flatMap(points=>{
  const world=points.map(p=>transform(p,rotationOf(hub),hub.position));return hull(world).faces.map(f=>f.map(j=>world[j]));
 }).map(face=>{
  let polygon=face;
  for(const axis of [tangent,out])for(const sign of [-1,1]){
   const dist=(p:V3)=>.04-sign*dot(sub(p,center),axis);
   polygon=polygon.flatMap((p,i)=>{const q=polygon[(i+1)%polygon.length],a=dist(p),b=dist(q),result:V3[]=[];
    if(a>=-1e-10)result.push(p);if((a>=0)!==(b>=0))result.push(add(p,mul(sub(q,p),a/(a-b))));return result;});
  }
  return polygon;
 });
 const bottom=Math.min(...clippedFaces.flat().map(p=>p.y))-.006;
 const top=Math.max(originalStemTop,bottom+.012);
 const inverse=inverseRotation(rotationOf(hub)),local=(p:V3)=>transform(sub(p,hub.position),inverse,v()),localYaw=multiplyRotations(inverse,yaw);
 hub.pieces!.push({size:[.08,top-bottom,.08],rotation:localYaw,offset:local(v(center.x,(top+bottom)/2,center.z))});
 hub.mountPoint={standard:'MP-80 four-bolt service pad',position:local(v(center.x,bottom,center.z)),normal:transform(v(0,-1,0),inverse,v()),orientation:localYaw,faceSizeM:[.08,.08],boltPatternM:[.048,.048],uses:['Temporary shoring','Interior framing','Insulation battens','Decoration'],note:'Finite experimental attachment profile; bolt holes and threads are specified, not resolved as collision geometry.'};
 const reach=.4,base=sub(center,mul(out,reach));
 const at=(x:number,y:number,z:number)=>add(v(base.x,y,base.z),add(mul(tangent,x),mul(out,z)));
 const mastBottom=.3125,headThickness=.32,mastTop=bottom-headThickness;
 const minOverlap=Math.min(MIN_OVERLAP,segmentLength*.2);
 const height=mastTop-mastBottom,extension=(height-segmentLength)/(segments-1),overlap=segmentLength-extension;
 if(extension<0||overlap<minOverlap-1e-8)throw Error(`Stand height outside adjustment range: ${height}`);
 const entries:BuildPart[]=[];
 const piece=(suffix:string,size:Box['size'],position:V3,targets:string[]=[])=>{
  const box:Box={id:`${id}-${suffix}`,size,position,rotation:yaw,density:7850,material:'Steel telescopic stand component (rigid)',color:0xc4794f,friction:.65};
  entries.push({box,stage,connectTo:targets,structural:true});return box;
 };
 const foot=piece('foot',[.60,.1125,.50],at(0,.25625,.20));
 foot.material='Ballasted steel foot beneath offset head (rigid)';
 for(let i=0;i<segments;i++){
  const width=.08+(segments-1-i)*.006,wall=.002,section=piece(`tube-${i+1}`,[width,segmentLength,width],at(0,mastBottom+i*extension+segmentLength/2,0),[`${id}-${i?`tube-${i}`:'foot'}`]);
  section.material=`Hollow steel telescope section ${i+1}; lock pin and clamp collar`;
  section.pieces=[...[-1,1].map(sign=>({size:[wall,segmentLength,width] as Box['size'],offset:v(sign*(width-wall)/2,0,0)})),...[-1,1].map(sign=>({size:[width-2*wall,segmentLength,wall] as Box['size'],offset:v(0,0,sign*(width-wall)/2)}))];
 }
 piece('head',[.12,.04,reach+.12],at(0,mastTop+.02,reach/2),[`${id}-tube-${segments}`]);
 piece('adapter',[.08,headThickness-.04,.08],at(0,(bottom+mastTop+.04)/2,reach),[`${id}-head`]);
 const result=prefabricatedStand(entries);result.box.id=id;result.box.material='Telescopic steel stand (locked rigid assembly)';
 result.box.prefab!.fastenings.forEach(f=>f.description=f.a.includes('tube')?'Captured sleeve with locking pin and clamp collar':'Workshop welded assembly');
 result.box.telescopic={model:STAND_MODEL,heightM:bottom-.2,minHeightM:segmentLength+mastBottom+headThickness-.2,maxHeightM:segments*segmentLength-(segments-1)*minOverlap+mastBottom+headThickness-.2,overlapM:overlap,segmentLengthM:segmentLength,segments:segments,operation:'Set height, lock sleeves, place stand; secure head to MP-80 pad'};
 const points=verticesOf(hub);hub.size=['x','y','z'].map(a=>Math.max(...points.map(p=>p[a as keyof V3]))-Math.min(...points.map(p=>p[a as keyof V3]))) as Box['size'];
 return result;
}
