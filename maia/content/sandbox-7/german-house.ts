import {shedScenario,type BuildDefinition,type BuildPart} from './shed';
import {sharedFaceArea} from './brick-house';
import {fasteningPatch,type FastenerProfile} from './fasteners';
import {transform,type Box,type Scenario,type V3,type Quaternion} from './simulation';
import {v,add,sub,mul,cross,length,hull,frameRotation} from './geometry';

// Experimental per-point capacities for the timber roof, cladding and joinery.
// Masonry, mortar and wall ties are ideal rigid bonds, as in the brick house.
export const PLATE_ANCHOR:FastenerProfile={name:'Wall-plate anchor bolt',stiffness:5e6,damping:2e4,withdrawalN:12000,shearN:15000};
export const RAFTER_ANCHOR:FastenerProfile={name:'Rafter tie-down bracket and nails',stiffness:2e6,damping:5000,withdrawalN:3000,shearN:5000};
export const BOARD_NAIL:FastenerProfile={name:'Roof boarding nails',stiffness:1e6,damping:2000,withdrawalN:600,shearN:1200};
export const STAPLE:FastenerProfile={name:'Underlayment staples / batten',stiffness:2e5,damping:300,withdrawalN:150,shearN:300};
export const SHINGLE_NAIL:FastenerProfile={name:'Shingle nails and self-seal strip',stiffness:2e5,damping:300,withdrawalN:120,shearN:250};
export const TRIM_SCREW:FastenerProfile={name:'Barge board / gutter bracket screw',stiffness:5e5,damping:500,withdrawalN:500,shearN:900};
export const FRAME_ANCHOR:FastenerProfile={name:'Window / door frame anchor',stiffness:2e6,damping:3000,withdrawalN:1500,shearN:2500};
export const GLAZING_BEAD:FastenerProfile={name:'Glazing bead and setting blocks',stiffness:1e6,damping:1000,withdrawalN:800,shearN:1500};
export const HINGE:FastenerProfile={name:'Door hinges and lock',stiffness:2e6,damping:2000,withdrawalN:2000,shearN:3000};

/** Outer dimensions and levels in metres. X along the eaves, Z front (+, entrance) to back. */
export const HOUSE={lengthM:10,depthM:8,pitchDeg:40,eavesM:5.75,storeys:2} as const;
const X=HOUSE.lengthM/2,Z=HOUSE.depthM/2,FACE=.115,INNER=.175,XI=X-FACE,ZI=Z-FACE,XII=XI-INNER,ZII=ZI-INNER;
const BASE=.25,COURSE=.25/3,JOINT=.01,BRICK=.5,SLAB=.25;
const STOREY=[{floor:BASE,top:2.75},{floor:3.0,top:5.5}] as const,TOP=5.75;
const PITCH=HOUSE.pitchDeg*Math.PI/180,TAN=Math.tan(PITCH),COS=Math.cos(PITCH),SIN=Math.sin(PITCH);
const PLATE={z:[ZI-.01-.16,ZI-.01] as [number,number],y:[TOP,TOP+.12] as [number,number]};
const RAFTER={width:.08,depth:.2,seat:.03,tail:4.5,count:13,end:4.8};
/** Rafter underside and top lines; both slopes are mirror images about z = 0. */
const U=(z:number)=>PLATE.y[1]+RAFTER.seat+(PLATE.z[1]-Math.abs(z))*TAN;
const T=(z:number)=>U(z)+RAFTER.depth/COS;
const DECK={t:.024,eaves:4.65,ridge:.002,verge:5.3},UNDERLAY=.003,SHINGLE=.006,SHINGLE_EDGE=DECK.verge-.005;
const MORTAR=0xb7b1a5,KS=0xdedbd2,FRAME=0x383c40;
const BRICKS=[0x8c3a28,0x98452f,0x7d3425,0xa04d33,0x86402e,0x92412b];

type Range=[number,number];type Look={material:string;density:number;color:number;opacity?:number;friction?:number};
type Block={r:[Range,Range,Range]};type Solid={points:V3[]};type Plate={size:Box['size'];center:V3;rotation:Quaternion};
const sorted=(a:number,b:number):Range=>a<b?[a,b]:[b,a];
const corners=([x,y,z]:[Range,Range,Range])=>x.flatMap(px=>y.flatMap(py=>z.map(pz=>v(px,py,pz))));
const plateCorners=(p:Plate)=>[-1,1].flatMap(a=>[-1,1].flatMap(b=>[-1,1].map(c=>transform(v(a*p.size[0]/2,b*p.size[1]/2,c*p.size[2]/2),p.rotation,p.center))));
type Shown={r?:[Range,Range,Range];plate?:Plate;color:number};
/** One rigid part from world-space boxes, convex solids and rotated plates. An optional display list
 * subdivides the same solid into what you see (bricks and their mortar joints); physics uses the
 * collision pieces, which have exactly the same outer surface, volume and mass. */
function part(id:string,look:Look,blocks:Block[],solids:Solid[]=[],plates:Plate[]=[],shown:Shown[]=[]):Box{
 const all=[...blocks.flatMap(b=>corners(b.r)),...solids.flatMap(s=>s.points),...plates.flatMap(plateCorners)];
 const min=v(Math.min(...all.map(p=>p.x)),Math.min(...all.map(p=>p.y)),Math.min(...all.map(p=>p.z))),max=v(Math.max(...all.map(p=>p.x)),Math.max(...all.map(p=>p.y)),Math.max(...all.map(p=>p.z)));
 const c=mul(add(min,max),.5);
 const pieces=[...blocks.map(({r:[x,y,z]})=>({size:[x[1]-x[0],y[1]-y[0],z[1]-z[0]] as Box['size'],offset:v((x[0]+x[1])/2-c.x,(y[0]+y[1])/2-c.y,(z[0]+z[1])/2-c.z)})),
  ...plates.map(p=>({size:p.size,offset:sub(p.center,c),rotation:p.rotation}))];
 return {id,position:c,size:[max.x-min.x,max.y-min.y,max.z-min.z],density:look.density,material:look.material,color:look.color,friction:look.friction??.6,
  ...(look.opacity!==undefined?{opacity:look.opacity}:{}),...(pieces.length?{pieces}:{}),...(solids.length?{convexPieces:solids.map(s=>hull(s.points.map(p=>sub(p,c))))}:{}),
  ...(shown.length?{renderPieces:shown.map(p=>p.r?{size:[p.r[0][1]-p.r[0][0],p.r[1][1]-p.r[1][0],p.r[2][1]-p.r[2][0]] as Box['size'],offset:v((p.r[0][0]+p.r[0][1])/2-c.x,(p.r[1][0]+p.r[1][1])/2-c.y,(p.r[2][0]+p.r[2][1])/2-c.z),color:p.color}
   :{size:p.plate!.size,offset:sub(p.plate!.center,c),rotation:p.plate!.rotation,color:p.color})}:{})};
}
const hash=(...n:number[])=>{let h=2166136261;for(const x of n){h^=Math.round(x*1000)+0x9e3779b9;h=Math.imul(h,16777619);}return (h>>>0);};

/** A wall face: along-axis coordinate a runs over x (front/back) or z (gables); n is the outward normal coordinate. */
type Wall={name:'front'|'back'|'left'|'right';axis:'x'|'z';sign:1|-1};
const WALLS:Wall[]=[{name:'front',axis:'x',sign:1},{name:'back',axis:'x',sign:-1},{name:'left',axis:'z',sign:-1},{name:'right',axis:'z',sign:1}];
const outer=(w:Wall)=>w.sign*(w.axis==='x'?Z:X);
/** World box from along-axis range, height range and normal range for this wall. */
const wallBox=(w:Wall,a:Range,y:Range,n:Range):[Range,Range,Range]=>w.axis==='x'?[a,y,n]:[n,y,a];
const wallPoint=(w:Wall,a:number,y:number,n:number)=>w.axis==='x'?v(a,y,n):v(n,y,a);
const facingN=(w:Wall)=>sorted(outer(w),outer(w)-w.sign*FACE);
const innerN=(w:Wall)=>sorted(outer(w)-w.sign*FACE,outer(w)-w.sign*(FACE+INNER));

type Opening={wall:Wall['name'];a:Range;y:Range;kind:'window'|'entrance'|'patio'};
const W=(wall:Opening['wall'],a:Range,y:Range,kind:Opening['kind']='window'):Opening=>({wall,a,y,kind});
const EG:Range=[1.0,2.25],OG:Range=[3.75,5.0],ATTIC:Range=[6.25,7.0];
export const OPENINGS:Opening[]=[
 W('front',[-4,-2.75],EG),W('front',[-1.75,-.75],[BASE,2.25],'entrance'),W('front',[.5,1.75],EG),W('front',[2.75,4],EG),
 W('front',[-4,-2.75],OG),W('front',[-1.75,-.75],OG),W('front',[.5,1.75],OG),W('front',[2.75,4],OG),
 W('back',[-4,-2.75],EG),W('back',[-1.5,1],[BASE,2.25],'patio'),W('back',[2.25,3.5],EG),
 W('back',[-4,-2.75],OG),W('back',[-1,.25],OG),W('back',[2.25,3.5],OG),
 W('left',[-2.5,-1.25],EG),W('left',[1,2.25],OG),W('left',[-.5,.5],ATTIC),
 W('right',[1,2.25],EG),W('right',[-2.5,-1.25],OG),W('right',[-.5,.5],ATTIC),
];
const LINTEL_BEARING=.115;
/** The gable facing stays 5 mm under the roof boarding; the inner leaf stays 5 mm under the end rafters. */
const rakeFacing=(y:number)=>PLATE.z[1]+(PLATE.y[1]+RAFTER.seat+RAFTER.depth/COS-.005-y)/TAN;
const rakeInner=(y:number)=>PLATE.z[1]+(PLATE.y[1]+RAFTER.seat-.005-y)/TAN;

export function germanHouseScenario():Scenario{
 const scenario=shedScenario();
 return {...scenario,boxes:scenario.boxes.map(box=>box.id==='ground'?{...box,size:[40,.4,32]}:box),id:'german-house',title:'16 / Build a German family house',
  question:'Foundation → calcium-silicate inner walls and clinker facing in lifts → floor slabs → gables → rafter roof, boarding and shingles → gutters, windows and doors.'};
}

/** Masonry intervals along a facing course, after openings and lintels. */
function subtract(base:Range,cuts:Range[]):Range[]{
 let out=[base];
 for(const [c0,c1] of cuts)out=out.flatMap(([a,b])=>c1<=a+1e-9||c0>=b-1e-9?[[a,b] as Range]:[...(c0>a+1e-9?[[a,c0] as Range]:[]),...(c1<b-1e-9?[[c1,b] as Range]:[])]);
 return out.filter(([a,b])=>b-a>1e-6);
}

export function germanHouseDefinition():BuildDefinition{
 const plan:BuildPart[]=[],stages:string[]=[];let stage=-1;
 const nextStage=(name:string)=>{stages.push(name);stage++;};
 const masonry:Box[]=[];
 const put=(box:Box,connectTo:string[],profile?:FastenerProfile,structural=true,fastening?:BuildPart['fastening'])=>{
  const entry:BuildPart={box,stage,connectTo,profile,structural,...(fastening?{fastening}:{}),...(profile&&stage>=7?{fitToAttachments:true}:{})};plan.push(entry);return entry;
 };
 const find=(id:string)=>plan.find(p=>p.box.id===id)!.box;
 const sharedArea=(a:Box,b:Box)=>{try{const {points}=fasteningPatch(a,b);let n=v();for(let i=1;i<points.length-1;i++)n=add(n,cross(sub(points[i],points[0]),sub(points[i+1],points[0])));return length(n)/2;}catch{return 0;}};
 const touching=(box:Box,candidates:Box[],min=2e-4)=>candidates.filter(c=>sharedArea(box,c)>min).map(c=>c.id);
 // Masonry is bonded to every earlier masonry part it actually bears on or abuts.
 const near=(a:Box,b:Box)=>(['x','y','z'] as const).every((k,i)=>Math.abs(a.position[k]-b.position[k])<=(a.size[i]+b.size[i])/2+1e-6);
 const bond=(box:Box)=>{const targets=masonry.filter(m=>near(box,m)&&sharedFaceArea(box,m)>1e-4).map(m=>m.id);masonry.push(box);return targets;};
 const MASONRY:Look={material:'Clinker facing brickwork, long format 490 × 73 mm, mortar beds (rigid)',density:1900,color:BRICKS[0]};
 const INNER_LEAF:Look={material:'Calcium-silicate inner leaf, 175 mm, with integral lintels (rigid)',density:1800,color:KS};
 const CONCRETE:Look={material:'Reinforced concrete (rigid)',density:2400,color:0xa8a89f,friction:.7};

 nextStage('Foundation slab');
 put(part('house-foundation',CONCRETE,[{r:[[-X-.05,X+.05],[0,BASE],[-Z-.05,Z+.05]]}]),[]);
 masonry.push(find('house-foundation'));

 const openings=(wall:Wall['name'])=>OPENINGS.filter(o=>o.wall===wall);
 /** Storey-high inner leaf: columns between opening edges, with sill and lintel pieces. */
 const innerLeaf=(w:Wall,storey:number)=>{
  const {floor,top}=STOREY[storey],span:Range=w.axis==='x'?[-XI,XI]:[-ZII,ZII],n=innerN(w);
  const ops=openings(w.name).filter(o=>o.y[0]>=floor-1e-9&&o.y[1]<=top+1e-9);
  const edges=[...new Set([span[0],span[1],...ops.flatMap(o=>o.a)])].sort((a,b)=>a-b);
  const blocks:Block[]=[];
  for(let i=0;i<edges.length-1;i++){
   const a:Range=[edges[i],edges[i+1]],o=ops.find(o=>o.a[0]<=a[0]+1e-9&&o.a[1]>=a[1]-1e-9);
   for(const y of o?[[floor,o.y[0]],[o.y[1],top]] as Range[]:[[floor,top] as Range])if(y[1]-y[0]>1e-6)blocks.push({r:wallBox(w,a,y,n)});
  }
  return part(`inner-leaf-${storey?'upper':'ground'}-${w.name}`,INNER_LEAF,blocks);
 };
 const interiorWall=(storey:number)=>{
  const {floor,top}=STOREY[storey],z:Range=[-.6,-.425],door:Range=[1,1.885];
  return part(`interior-wall-${storey?'upper':'ground'}`,{...INNER_LEAF,material:'Calcium-silicate interior bearing wall, 175 mm, with door lintel (rigid)'},
   [{r:[[-XII,door[0]],[floor,top],z]},{r:[door,[floor+2,top],z]},{r:[[door[1],XII],[floor,top],z]}]);
 };

 /** Course extents along a wall: corners alternate between eaves walls and gables every course. */
 const courseSpan=(w:Wall,k:number):Range=>{
  const owns=(k%2===0)===(w.axis==='x');
  return w.axis==='x'?(owns?[-X,X]:[-XI,XI]):(owns?[-Z,Z]:[-ZI,ZI]);
 };
 const yOf=(k:number)=>BASE+k*COURSE;
 /** Bricks and mortar bed of one course interval. Under the rake each course stops below
  * the roof line, so gable courses step; the barge board covers the steps. */
 const course=(w:Wall,k:number,a:Range)=>{
  const shown:Shown[]=[],y=yOf(k),n=facingN(w),yb=y+JOINT,yt=y+COURSE;
  shown.push({r:wallBox(w,a,[y,yb],n),color:MORTAR});
  const origin=(w.axis==='x'?-X:-Z)+(k%2)*BRICK/2,cuts=[a[0]];
  for(let g=Math.ceil((a[0]+.06-origin)/BRICK)*BRICK+origin;g<a[1]-.06;g+=BRICK)cuts.push(g);cuts.push(a[1]);
  for(let i=0;i<cuts.length-1;i++){
   const b0=i?cuts[i]+JOINT/2:cuts[i],b1=i<cuts.length-2?cuts[i+1]-JOINT/2:cuts[i+1];
   shown.push({r:wallBox(w,[b0,b1],[yb,yt],n),color:BRICKS[hash(k,b0,w.sign,w.axis==='x'?1:2)%BRICKS.length]});
   if(i<cuts.length-2)shown.push({r:wallBox(w,[b1,b1+JOINT],[yb,yt],n),color:MORTAR});
  }
  return shown;
 };
 /** One facing lift: all courses of a band between openings, grouped into connected bodies. */
 const facingLifts=(w:Wall,band:Range,label:string,lintelBand=false,rake?:(y:number)=>number)=>{
  const k0=Math.round((band[0]-BASE)/COURSE),k1=Math.round((band[1]-BASE)/COURSE),ops=openings(w.name);
  const lintels=lintelBand?ops.filter(o=>Math.abs(o.y[1]-band[0])<1e-6):[];
  const rows:Range[][]=[];
  for(let k=k0;k<k1;k++){
   const y=yOf(k)+COURSE/2,span=rake?(():Range=>{const r=Math.min(w.axis==='x'?X:Z,rake(yOf(k)+COURSE));return [-r,r];})():courseSpan(w,k);
   const cuts=[...ops.filter(o=>y>o.y[0]&&y<o.y[1]).map(o=>o.a),...lintels.map(o=>[o.a[0]-LINTEL_BEARING,o.a[1]+LINTEL_BEARING] as Range)];
   rows.push(span[1]-span[0]>.3?subtract(span,cuts):[]);
  }
  // Intervals overlapping across successive courses form one connected lift.
  const groups:{k:number;a:Range}[][]=[];
  rows.forEach((row,i)=>row.forEach(a=>{
   const g=groups.find(g=>g.some(e=>e.k===k0+i-1&&e.a[0]<a[1]-1e-6&&a[0]<e.a[1]-1e-6));
   if(g)g.push({k:k0+i,a});else groups.push([{k:k0+i,a}]);
  }));
  groups.forEach((g,i)=>{
   // Collision: each run of equal courses is one solid box of bricks and mortar.
   const blocks:Block[]=[],n=facingN(w);
   for(const e of g){const last=blocks.at(-1),y:Range=[yOf(e.k),yOf(e.k)+COURSE],r=wallBox(w,e.a,y,n),ai=w.axis==='x'?0:2;
    if(last&&Math.abs(last.r[ai][0]-r[ai][0])<1e-9&&Math.abs(last.r[ai][1]-r[ai][1])<1e-9&&Math.abs(last.r[1][1]-y[0])<1e-9)last.r[1]=[last.r[1][0],y[1]];else blocks.push({r});}
   const box=part(`facing-${w.name}-${label}-${i+1}`,MASONRY,blocks,[],[],g.flatMap(e=>course(w,e.k,e.a)));
   put(box,bond(box),undefined,true,'mortar-bond');
  });
  // Soldier-course lintels over each opening, with a mortar bed on the jambs.
  for(const o of lintels){
   const a:Range=[o.a[0]-LINTEL_BEARING,o.a[1]+LINTEL_BEARING],n=facingN(w),y=band[0],shown:Shown[]=[{r:wallBox(w,a,[y,y+JOINT],n),color:MORTAR}];
   const count=Math.round((a[1]-a[0])/COURSE),pitch=(a[1]-a[0])/count;
   for(let j=0;j<count;j++){
    const b0=a[0]+j*pitch+(j?JOINT/2:0),b1=a[0]+(j+1)*pitch-(j<count-1?JOINT/2:0);
    shown.push({r:wallBox(w,[b0,b1],[y+JOINT,band[1]],n),color:BRICKS[hash(j,o.a[0],w.sign,7)%BRICKS.length]});
    if(j<count-1)shown.push({r:wallBox(w,[b1,b1+JOINT],[y+JOINT,band[1]],n),color:MORTAR});
   }
   const box=part(`lintel-${w.name}-${label}-${o.a[0]}`,{...MASONRY,material:'Clinker soldier-course lintel on hidden steel angle (rigid)'},[{r:wallBox(w,a,band,n)}],[],[],shown);
   put(box,bond(box),undefined,true,'mortar-bond');
  }
 };

 const storeyBands=(s:number)=>{const f=STOREY[s].floor;return {A:[f,f+.75] as Range,B:[f+.75,f+2] as Range,C:[f+2,f+2.25] as Range,DE:[f+2.25,f+2.75] as Range};};
 const slabElements=(level:number,label:string)=>{
  const edges=[-XI+.01,-XI/2,0,XI/2,XI-.01];
  for(let i=0;i<4;i++){
   const x:Range=[edges[i]+(i?.002:0),edges[i+1]-(i<3?.002:0)];
   const box=part(`slab-${label}-${i+1}`,{...CONCRETE,material:'Precast lattice-girder floor slab with topping (rigid)'},[{r:[x,[level,level+SLAB],[-ZI+.01,ZI-.01]]}]);
   put(box,bond(box),undefined,true,'mortar-bond');
  }
 };

 for(const s of [0,1]){
  nextStage(s?'Upper-floor inner walls':'Ground-floor inner walls');
  for(const w of WALLS){const box=innerLeaf(w,s);put(box,bond(box),undefined,true,'mortar-bond');}
  {const box=interiorWall(s);put(box,bond(box),undefined,true,'mortar-bond');}
  nextStage(s?'Upper-floor clinker facing':'Ground-floor clinker facing');
  const bands=storeyBands(s);
  for(const [label,band] of [['A',bands.A],['B',bands.B],['C',bands.C],['DE',bands.DE]] as const)
   for(const w of WALLS)facingLifts(w,band,`${s?'upper':'ground'}-${label.toLowerCase()}`,label==='C');
  nextStage(s?'Top floor slab':'First floor slab');
  slabElements(STOREY[s].top,s?'top':'first');
 }

 nextStage('Gable walls');
 for(const w of WALLS.filter(w=>w.axis==='z')){
  // Inner leaf rows step under the end rafters; the attic window has its own lintel row.
  const blocks:Block[]=[],n=innerN(w);
  for(let y=TOP;y<U(0)-.3;y+=.25){
   const r=Math.min(ZII,rakeInner(y+.25));if(r<.4)break;
   const row:Range=[y,y+.25],cut=y+.125>ATTIC[0]&&y+.125<ATTIC[1];
   for(const a of cut?subtract([-r,r],[[-.5,.5]]):[[-r,r] as Range])blocks.push({r:wallBox(w,a,row,n)});
  }
  const inner=part(`inner-leaf-gable-${w.name}`,{...INNER_LEAF,material:'Calcium-silicate gable inner leaf, stepped under the roof (rigid)'},blocks);
  put(inner,bond(inner),undefined,true,'mortar-bond');
  const bands:[string,Range,boolean][]=[['g1',[TOP,ATTIC[0]],false],['g2',ATTIC,false],['g3',[ATTIC[1],ATTIC[1]+.25],true]];
  for(let y=ATTIC[1]+.25;y<T(0);y+=.5)bands.push([`g${bands.length+1}`,[y,y+.5],false]);
  for(const [label,band,lintel] of bands)facingLifts(w,band,label,lintel,rakeFacing);
 }

 nextStage('Wall plates & rafter pairs');
 const WOOD:Look={material:'Spruce structural timber C24 (rigid)',density:470,color:0xc49a62};
 for(const sz of [1,-1]){
  const plate=part(`wall-plate-${sz>0?'front':'back'}`,{...WOOD,material:'Spruce wall plate 120 × 160 mm (rigid)'},[{r:[[-XI+.01,XI-.01],PLATE.y,sorted(sz*PLATE.z[0],sz*PLATE.z[1])]}]);
  put(plate,touching(plate,[find('slab-top-1'),find('slab-top-2'),find('slab-top-3'),find('slab-top-4')]),PLATE_ANCHOR);
 }
 const slope=(sz:number)=>({n:v(0,COS,sz*SIN),down:v(0,-SIN,sz*COS),rotation:sz>0?frameRotation(v(1,0,0),v(0,COS,SIN),v(0,-SIN,COS)):frameRotation(v(-1,0,0),v(0,COS,-SIN),v(0,-SIN,-COS))});
 /** A point on a roof slope: horizontal distance from the ridge on the rafter top line, then an offset along the slope normal. */
 const onRoof=(sz:number,z:number,offset:number,x=0)=>add(v(x,T(z),sz*z),mul(slope(sz).n,offset));
 const rafterX=(i:number)=>-RAFTER.end+i*2*RAFTER.end/(RAFTER.count-1);
 for(let i=0;i<RAFTER.count;i++){
  const x=rafterX(i),xr:Range=[x-RAFTER.width/2,x+RAFTER.width/2],plates:Plate[]=[],blocks:Block[]=[],solids:Solid[]=[];
  for(const sz of [1,-1]){
   const {n,rotation}=slope(sz),mid=add(v(x,U(RAFTER.tail/2),sz*RAFTER.tail/2),mul(n,RAFTER.depth/2));
   // Three collinear pieces of one rafter keep its collision bounds tight.
   for(let j=0;j<3;j++)plates.push({size:[RAFTER.width,RAFTER.depth,RAFTER.tail/COS/3],center:add(mid,mul(slope(sz).down,(j-1)*RAFTER.tail/COS/3)),rotation});
   // Bird's-mouth seat: a flat bearing on the plate, and the notch wedge above it.
   const seat=sorted(sz*PLATE.z[0],sz*PLATE.z[1]);
   blocks.push({r:[xr,[PLATE.y[1],PLATE.y[1]+RAFTER.seat],seat]});
   solids.push({points:xr.flatMap(px=>[v(px,PLATE.y[1]+RAFTER.seat,sz*PLATE.z[0]),v(px,PLATE.y[1]+RAFTER.seat,sz*PLATE.z[1]),v(px,U(PLATE.z[0])-.0005,sz*PLATE.z[0])])});
  }
  // Collar tie on the inward face; the end pairs sit over the gable walls instead.
  if(i>0&&i<RAFTER.count-1){
   const side=x>=0?-1:1,tie:Range=sorted(x+side*RAFTER.width/2,x+side*(RAFTER.width/2+.06)),y:Range=[7.85,8.05],reach=PLATE.z[1]-(y[1]+.01-RAFTER.depth/COS-PLATE.y[1]-RAFTER.seat)/TAN;
   blocks.push({r:[tie,y,[-reach,reach]]});
  }
  put(part(`rafter-pair-${i+1}`,{...WOOD,material:'Spruce rafter pair 80 × 200 mm with collar tie (rigid)'},blocks,solids,plates),['wall-plate-front','wall-plate-back'],RAFTER_ANCHOR);
 }

 nextStage('Roof boarding & underlayment');
 const roofPlate=(sz:number,x:Range,z:Range,offset:number,thick:number):Plate=>{
  const along=(z[1]-z[0])/COS,center=onRoof(sz,(z[0]+z[1])/2,offset+thick/2,(x[0]+x[1])/2);
  return {size:[x[1]-x[0],thick,along],center,rotation:slope(sz).rotation};
 };
 const rafters=Array.from({length:RAFTER.count},(_,i)=>find(`rafter-pair-${i+1}`));
 const deckJoints=[-DECK.verge,rafterX(3),rafterX(6),rafterX(9),DECK.verge],deck=new Map<number,Box[]>([[1,[]],[-1,[]]]);
 for(const sz of [1,-1])for(let row=0;row<3;row++)for(let i=0;i<4;i++){
  const z:Range=[DECK.ridge+row*(DECK.eaves-DECK.ridge)/3+(row?.002:0),DECK.ridge+(row+1)*(DECK.eaves-DECK.ridge)/3-(row<2?.002:0)];
  const x:Range=[deckJoints[i]+(i?.002:0),deckJoints[i+1]-(i<3?.002:0)];
  const box=part(`roof-boarding-${sz>0?'front':'back'}-${row+1}-${i+1}`,{...WOOD,material:'Tongue-and-groove roof boarding panel, 24 mm (rigid)',color:0xd2b083},[],[],[roofPlate(sz,x,z,0,DECK.t)]);
  put(box,touching(box,rafters),BOARD_NAIL,false);deck.get(sz)!.push(box);
 }
 const underlay=new Map<number,Box>();
 for(const sz of [1,-1]){
  const strips=Array.from({length:6},(_,j)=>roofPlate(sz,[-DECK.verge,DECK.verge],[DECK.ridge+j*(DECK.eaves-DECK.ridge)/6,DECK.ridge+(j+1)*(DECK.eaves-DECK.ridge)/6],DECK.t,UNDERLAY));
  const box=part(`underlayment-${sz>0?'front':'back'}`,{material:'Bitumen roofing underlayment, 3 mm, laid in lapped strips (rigid sheet)',density:1100,color:0x1f2124},[],[],strips);
  put(box,touching(box,deck.get(sz)!),STAPLE,false);underlay.set(sz,box);
 }

 nextStage('Shingles & ridge');
 const SHINGLES=[0x3b3f44,0x33373b,0x42464b,0x2e3135,0x3a3e40];const courses=20,step=(DECK.eaves-DECK.ridge)/courses,shingleOff=DECK.t+UNDERLAY;
 const shingleCourses=new Map<number,Box[]>([[1,[]],[-1,[]]]);
 for(let j=0;j<courses;j++)for(const sz of [1,-1]){
  // Courses from the eaves up; staggered strips leave 4 mm joints over the black underlayment.
  const z:Range=[DECK.eaves-(j+1)*step+(j<courses-1?.002:0),DECK.eaves-j*step-(j?.002:0)];
  const joints=j%2?[-SHINGLE_EDGE,-3.975,-1.325,1.325,3.975,SHINGLE_EDGE]:[-SHINGLE_EDGE,-2.65,0,2.65,SHINGLE_EDGE];
  const shown:Shown[]=joints.slice(0,-1).flatMap((x0,i)=>[{plate:roofPlate(sz,[x0+(i?.002:0),joints[i+1]-(i<joints.length-2?.002:0)],z,shingleOff,SHINGLE),color:SHINGLES[hash(j,i,sz)%SHINGLES.length]},
   ...(i<joints.length-2?[{plate:roofPlate(sz,[joints[i+1]-.002,joints[i+1]+.002],z,shingleOff,SHINGLE),color:0x1f2124}]:[])]);
  const box=part(`shingles-${sz>0?'front':'back'}-${j+1}`,{material:'Laminated bitumen shingle course (rigid)',density:1400,color:SHINGLES[0]},[],[],[roofPlate(sz,[-SHINGLE_EDGE,SHINGLE_EDGE],z,shingleOff,SHINGLE)],shown);
  put(box,[underlay.get(sz)!.id],SHINGLE_NAIL,false);shingleCourses.get(sz)!.push(box);
 }
 {
  const reach=.3,t=.008,plates:Plate[]=[],shown:Shown[]=[];
  for(const sz of [1,-1]){
   plates.push(roofPlate(sz,[-SHINGLE_EDGE,SHINGLE_EDGE],[0,reach],shingleOff+SHINGLE,t));
   for(let i=0;i<16;i++)shown.push({plate:roofPlate(sz,[-SHINGLE_EDGE+i*2*SHINGLE_EDGE/16,-SHINGLE_EDGE+(i+1)*2*SHINGLE_EDGE/16],[0,reach],shingleOff+SHINGLE,t),color:SHINGLES[hash(i,sz,9)%SHINGLES.length]});
  }
  const box=part('ridge-shingles',{material:'Bitumen ridge shingles (rigid)',density:1400,color:SHINGLES[1]},[],[],plates,shown);
  put(box,touching(box,[...shingleCourses.get(1)!,...shingleCourses.get(-1)!]),SHINGLE_NAIL,false);
 }

 nextStage('Barge boards, gutters & downpipes');
 const TRIM:Look={material:'Painted spruce barge board (rigid)',density:470,color:0xece9e1};
 for(const sx of [-1,1])for(const sz of [1,-1]){
  const {rotation,n,down}=slope(sz),off:Range=[-.10,shingleOff+SHINGLE+.03],start=.003+(-off[0])*SIN,along=(DECK.eaves-start)/COS;
  const center=add(add(v(sx*(DECK.verge+.0125),T(start),sz*start),mul(n,(off[0]+off[1])/2)),mul(down,along/2));
  const box=part(`barge-board-${sx<0?'left':'right'}-${sz>0?'front':'back'}`,TRIM,[],[],[{size:[.025,off[1]-off[0],along],center,rotation}]);
  put(box,touching(box,deck.get(sz)!),TRIM_SCREW,false);
 }
 const ZINC:Look={material:'Pre-weathered zinc gutter (rigid)',density:7140,color:0x7d8489};
 const gutters=new Map<number,Box>();
 for(const sz of [1,-1]){
  const {rotation,n,down}=slope(sz),endBottom=v(0,T(DECK.eaves),sz*DECK.eaves),depth=.12,t=.0015;
  const back:Plate={size:[2*DECK.verge,depth+DECK.t,t],center:add(add(endBottom,mul(n,(DECK.t-depth)/2)),mul(down,t/2)),rotation};
  const low=add(add(endBottom,mul(n,-depth)),mul(down,t)),z0=low.z;
  const blocks:Block[]=[{r:[[-DECK.verge,DECK.verge],[low.y-t,low.y],sorted(z0,z0+sz*.16)]},{r:[[-DECK.verge,DECK.verge],[low.y,low.y+.11],sorted(z0+sz*.16,z0+sz*(.16-t))]}];
  const box=part(`gutter-${sz>0?'front':'back'}`,ZINC,blocks,[],[back]);
  put(box,touching(box,deck.get(sz)!),TRIM_SCREW,false);gutters.set(sz,box);
 }
 const facingParts=()=>plan.filter(p=>p.box.id.startsWith('facing-')).map(p=>p.box);
 for(const [sz,x] of [[1,4.6],[-1,-4.6]] as const){
  // The pipe stands 15 mm off the brickwork; three clips bear on single bricks.
  const g=gutters.get(sz)!,gy=g.position.y-g.size[1]/2,w=.04,t=.0015,zz=sz*Z,top=4.9,off=.015;
  const s=(a:number,b:number)=>sorted(zz+sz*a,zz+sz*b);
  const blocks:Block[]=[{r:[[x-w,x+w],[.35,top],s(off,off+t)]},{r:[[x-w,x+w],[.35,top],s(off+.08-t,off+.08)]},{r:[[x-w,x-w+t],[.35,top],s(off+t,off+.08-t)]},{r:[[x+w-t,x+w],[.35,top],s(off+t,off+.08-t)]},
   ...[9,33,57].map(k=>({r:[[x-.015,x+.015],[yOf(k)+.03,yOf(k)+.06],s(0,off)] as [Range,Range,Range]}))];
  // Swan-neck offset up to the gutter outlet, stopping 3 mm below it.
  const a=v(x,top,zz+sz*(off+.04)),b=v(x,gy-.003-.03,(g.position.z-sz*.02)),axis=sub(b,a),len=length(axis),dir=mul(axis,1/len),side=v(1,0,0);
  const neck:Plate={size:[.08,.06,len],center:mul(add(a,b),.5),rotation:frameRotation(side,cross(dir,side),dir)};
  const pipe=part(`downpipe-${sz>0?'front':'back'}`,{...ZINC,material:'Pre-weathered zinc downpipe 80 × 80 mm with wall clips (rigid)'},blocks,[],[neck]);
  put(pipe,touching(pipe,facingParts(),1e-4),TRIM_SCREW,false);
 }

 nextStage('Windows & doors');
 const innerLeaves=()=>plan.filter(p=>p.box.id.startsWith('inner-leaf-')).map(p=>p.box);
 for(const [i,o] of OPENINGS.entries()){
  const w=WALLS.find(w=>w.name===o.wall)!,depth=sorted(outer(w)-w.sign*(FACE+.01),outer(w)-w.sign*(FACE+.08)),fw=.07,door=o.kind!=='window';
  const bottom=o.kind==='entrance'?.02:fw,name=`${o.wall}-${i+1}`;
  const bars:Block[]=[{r:wallBox(w,[o.a[0],o.a[0]+fw],o.y,depth)},{r:wallBox(w,[o.a[1]-fw,o.a[1]],o.y,depth)},
   {r:wallBox(w,[o.a[0]+fw,o.a[1]-fw],[o.y[0],o.y[0]+bottom],depth)},{r:wallBox(w,[o.a[0]+fw,o.a[1]-fw],[o.y[1]-fw,o.y[1]],depth)}];
  const mid=(o.a[0]+o.a[1])/2;if(o.kind==='patio')bars.push({r:wallBox(w,[mid-fw/2,mid+fw/2],[o.y[0]+bottom,o.y[1]-fw],depth)});
  const frame=part(`frame-${name}`,{material:'Anthracite PVC window / door frame with steel core (rigid)',density:1400,color:FRAME},bars);
  put(frame,touching(frame,innerLeaves()),FRAME_ANCHOR,false);
  const glassDepth=sorted((depth[0]+depth[1])/2-.012,(depth[0]+depth[1])/2+.012),y:Range=[o.y[0]+bottom,o.y[1]-fw];
  if(o.kind==='entrance'){
   const leafDepth=sorted((depth[0]+depth[1])/2-.03,(depth[0]+depth[1])/2+.03);
   const leaf=part(`door-leaf-${name}`,{material:'Oak entrance door leaf with insulated core (rigid)',density:650,color:0x6b4429},[{r:wallBox(w,[o.a[0]+fw,o.a[1]-fw],y,leafDepth)}]);
   put(leaf,[frame.id],HINGE,false);continue;
  }
  const panes:Range[]=o.kind==='patio'?[[o.a[0]+fw,mid-fw/2],[mid+fw/2,o.a[1]-fw]]:[[o.a[0]+fw,o.a[1]-fw]];
  const glass=part(`glazing-${name}`,{material:'Triple insulating glass unit (rigid, average density)',density:1050,color:0xb7d7e4,opacity:.3},panes.map(a=>({r:wallBox(w,a,y,glassDepth)})));
  put(glass,[frame.id],GLAZING_BEAD,false);
  if(!door){
   const sill=part(`sill-${name}`,{material:'Anthracite aluminium window sill (rigid)',density:2700,color:0x474c51},[{r:wallBox(w,[o.a[0]+.002,o.a[1]-.002],[o.y[0],o.y[0]+.025],sorted(outer(w)-w.sign*(FACE-.002),outer(w)+w.sign*.05))}]);
   put(sill,touching(sill,facingParts(),1e-4),FRAME_ANCHOR,false);
  }
 }

 return {plan,stages,rootId:'house-foundation',interval:.08,solverIterations:8,internalPgsIterations:4,filterRigidInternalContacts:true,contactNaturalFrequency:120,allowedLinearError:.0001,
  experimentParameters:{lengthM:HOUSE.lengthM,depthM:HOUSE.depthM,pitchDeg:HOUSE.pitchDeg,storeys:HOUSE.storeys},
  name:'German family house',
  note:`Two-storey detached house, ${HOUSE.lengthM} × ${HOUSE.depthM} m, ${HOUSE.pitchDeg}° gable roof. Two-leaf walls: 175 mm calcium-silicate inner leaf and a 115 mm clinker facing leaf of long-format bricks in half bond with grey mortar beds, toothed corners and soldier-course lintels. Facing goes up in lifts; each lift is one rigid body of individual bricks and mortar. Masonry, mortar and wall ties are ideal rigid bonds, as in the brick house; core insulation is not modelled. Precast slabs carry the upper floor and the attic. Spruce rafter pairs with collar ties sit on anchored wall plates under boarding, underlayment and staggered bitumen shingle courses with a ridge cap. Barge boards, zinc gutters and downpipes, anthracite windows with triple glazing and aluminium sills, an oak entrance door and a patio door. Roof, cladding and joinery fixings have finite experimental strength. Timber stays rigid: no bending, creep or moisture.`};
}
