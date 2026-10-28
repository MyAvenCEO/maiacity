import { piecesOf, polyhedraOf, volumeOf, rotationOf, inverseRotation, multiplyRotations, transform, verticesOf, type Box } from './simulation';
import { sub, add } from './geometry';
import type { BuildPart } from './shed';

/** Workshop-built stand: retain every collision shape and its material density,
 * but replace internal fastening constraints with a single rigid assembly. */
export function prefabricatedStand(entries: BuildPart[]): BuildPart {
  const cap=entries.at(-1)!.box, inverse=inverseRotation(rotationOf(cap));
  const convexPieces:NonNullable<Box['convexPieces']>=[],pieces:NonNullable<Box['pieces']>=[];
  const polyDensities:number[]=[],boxDensities:number[]=[];
  const toLocal=(point:Box['position'],component:Box)=>transform(sub(transform(point,rotationOf(component),component.position),cap.position),inverse,{x:0,y:0,z:0});
  for(const {box} of entries){
    for(const poly of polyhedraOf(box)){convexPieces.push({...poly,vertices:poly.vertices.map(p=>toLocal(p,box))});polyDensities.push(box.density);}
    for(const piece of piecesOf(box)){
      pieces.push({...piece,offset:toLocal(piece.offset,box),rotation:multiplyRotations(inverse,multiplyRotations(rotationOf(box),piece.rotation??{x:0,y:0,z:0,w:1}))});boxDensities.push(box.density);
    }
  }
  const box:Box={id:cap.id,position:cap.position,rotation:rotationOf(cap),size:[1,1,1],convexPieces,pieces,shapeDensities:[...polyDensities,...boxDensities],
    density:1,material:'Prefabricated braced stand (rigid assembly)',color:0xc4794f,friction:cap.friction,
    prefab:{components:entries.map(e=>structuredClone(e.box)),fastenings:entries.flatMap(e=>e.connectTo.map(b=>({a:e.box.id,b,description:e.profile?.name??'Workshop fastening'})))}};
  const points=verticesOf(box);box.size=['x','y','z'].map(axis=>Math.max(...points.map(p=>p[axis as keyof typeof p]))-Math.min(...points.map(p=>p[axis as keyof typeof p]))) as Box['size'];
  box.density=entries.reduce((sum,e)=>sum+volumeOf(e.box)*e.box.density,0)/volumeOf(box);
  return {box,stage:entries[0].stage,connectTo:[],structural:true};
}
