import {shedScenario,type BuildDefinition,type BuildPart} from './shed';
import {fasteningPatch,type FastenerProfile} from './fasteners';
import {transform,type Box,type Scenario,type V3,type Quaternion} from './simulation';
import {v,add,sub,mul,cross,length,unit,hull,frameRotation} from './geometry';

// Per-point experimental capacities. Each point stands for a small bolt or
// screw group; none of these are design resistances from a standard.
// Stiffness is matched to the mass of the parts joined: stiffer springs on light
// purlins or bars only made the iterative solver chatter.
export const HOLDING_DOWN_BOLTS:FastenerProfile={name:'Holding-down bolt group',stiffness:1e7,damping:1e5,withdrawalN:60000,shearN:50000};
export const END_PLATE_BOLTS:FastenerProfile={name:'Bolted end-plate connection',stiffness:1e7,damping:1e5,withdrawalN:80000,shearN:90000};
export const BRACING_BOLTS:FastenerProfile={name:'Bracing bolt',stiffness:5e6,damping:2e4,withdrawalN:20000,shearN:30000};
export const POST_BOLTS:FastenerProfile={name:'Gable post / header bolt',stiffness:5e6,damping:2e4,withdrawalN:20000,shearN:30000};
export const PURLIN_BOLTS:FastenerProfile={name:'Purlin cleat bolt',stiffness:2e6,damping:2000,withdrawalN:8000,shearN:10000};
export const PANEL_FASTENER:FastenerProfile={name:'Sandwich panel fastener',stiffness:2e6,damping:2000,withdrawalN:1500,shearN:2500};
// Thin flashings are rigid bodies here, so their fixings are compliant: real sheet would flex.
export const TRIM_FIXING:FastenerProfile={name:'Flashing / gutter rivet',stiffness:2e5,damping:300,withdrawalN:600,shearN:1000};
export const DOOR_HARDWARE:FastenerProfile={name:'Sectional door roller / hinge',stiffness:2e6,damping:2000,withdrawalN:1500,shearN:2500};

/** Main dimensions in metres. Frames span X, the hall runs along Z, the door faces +Z. */
export const HALL={span:12,length:20,bay:5,eavesM:5.7,pitchDeg:10,slabTopM:.25} as const;
const PITCH=HALL.pitchDeg*Math.PI/180,TAN=Math.tan(PITCH),COS=Math.cos(PITCH),SIN=Math.sin(PITCH);
const FRAMES=[-10,-5,0,5,10],SLAB=HALL.slabTopM,EAVES=HALL.eavesM;
const COL={depth:.25,width:.25,flange:.012,web:.008};
const INNER=HALL.span/2-COL.depth/2,OUTER=HALL.span/2+COL.depth/2,COLUMN_TOP=EAVES+.03;
const RAFTER={depth:.3,width:.15,flange:.0107,web:.0071,plate:.02,plateWidth:.2,haunchLength:1.5,haunchDepth:.3,haunchFlange:.012};
const PURLIN={depth:.15,flange:.06,t:.002},PURLIN_X=[5.6,4.25,2.9,1.55,.25];
const WALL=.08,GLAZING=.016,ROOF=.1,ROW=1.1,WALL_OUT=OUTER+WALL;
const GABLE=10+COL.width/2+.012;// inner face of gable cladding, also outer face of end-frame cover plates
const POST={x:2.5,depth:.2,width:.2,flange:.012,web:.008};
const DOOR={halfWidth:2.55,thickness:.045,sections:8,height:.55};
const ROOF_EDGE=6.45,ROOF_LENGTH=20.9,ROOF_PANEL=1.045,RIDGE_GAP=.002;
/** Butt joints between neighbouring panels, purlins and gutter lengths. Only real bearing faces touch. */
const JOINT=.004;
/** Bay extent along Z, from frame line to frame line, out to the gable cladding at the ends, minus butt joints. */
const bayZ=(bay:number):Range=>[bay===0?-GABLE+JOINT:FRAMES[bay]+JOINT/2,bay===3?GABLE-JOINT:FRAMES[bay+1]-JOINT/2];

/** Rafter top of steel, rafter underside, purlin top (roof panel underside) and roof top, all mirrored about x = 0. */
const T=(x:number)=>EAVES+(INNER-Math.abs(x))*TAN;
const B=(x:number)=>T(x)-RAFTER.depth/COS;
const R=(x:number)=>T(x)+PURLIN.depth/COS;
const RT=(x:number)=>R(x)+ROOF/COS;

type P2=[number,number];type Range=[number,number];
const sorted=(a:number,b:number):Range=>a<b?[a,b]:[b,a];
const xyPrism=(polygon:P2[],z:Range):V3[]=>polygon.flatMap(([x,y])=>[v(x,y,z[0]),v(x,y,z[1])]);
const block=(x:Range,y:Range,z:Range):V3[]=>xyPrism([[x[0],y[0]],[x[1],y[0]],[x[1],y[1]],[x[0],y[1]]],z);
const mirror=(points:V3[],side:number)=>side<0?points:points.map(p=>v(-p.x,p.y,p.z));
type Look={material:string;density:number;color:number;opacity?:number;friction?:number};
const STEEL=7850;
const FRAME_STEEL:Omit<Look,'material'>={density:STEEL,color:0x2c5f8d};

function boundsOf(points:V3[]){
 const min=v(Infinity,Infinity,Infinity),max=v(-Infinity,-Infinity,-Infinity);
 for(const p of points)for(const a of ['x','y','z'] as const){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}
 return {min,max,center:mul(add(min,max),.5),size:[max.x-min.x,max.y-min.y,max.z-min.z] as Box['size']};
}
type Plate={size:Box['size'];center:V3;rotation:Quaternion};
const plateCorners=(p:Plate)=>[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>transform(v(x*p.size[0]/2,y*p.size[1]/2,z*p.size[2]/2),p.rotation,p.center))));
const zRotation=(angle:number):Quaternion=>({x:0,y:0,z:Math.sin(angle/2),w:Math.cos(angle/2)});
/** Rafter-slope rotation for one side: the left rafter rises toward +X. */
const slopeRotation=(side:number)=>zRotation(-side*PITCH);
/** World-space parts. Every face that bears on another part is a box piece, axis-aligned or
 * rotated: Rapier's box-box contact stays robust for exactly touching faces. Convex solids are
 * used only for shapes that touch nothing else (haunches, tapered webs) or keep a small gap. */
function part(id:string,look:Look,blocks:[Range,Range,Range][],solids:V3[][]=[],plates:Plate[]=[]):Box{
 const corners=blocks.map(([x,y,z])=>block(x,y,z));
 const {center,size}=boundsOf([...corners.flat(),...solids.flat(),...plates.flatMap(plateCorners)]);
 return {id,position:center,size,density:look.density,material:look.material,color:look.color,friction:look.friction??.6,
  ...(look.opacity!==undefined?{opacity:look.opacity}:{}),
  ...(blocks.length||plates.length?{pieces:[...blocks.map(([x,y,z])=>({size:[x[1]-x[0],y[1]-y[0],z[1]-z[0]] as Box['size'],offset:v((x[0]+x[1])/2-center.x,(y[0]+y[1])/2-center.y,(z[0]+z[1])/2-center.z)})),
   ...plates.map(p=>({size:p.size,offset:sub(p.center,center),rotation:p.rotation}))]}:{}),
  ...(solids.length?{convexPieces:solids.map(points=>hull(points.map(p=>sub(p,center))))}:{})};
}
/** A part lying in a roof slope: local X runs down/up the slope, local Y is the roof normal. */
function slopePart(id:string,look:Look,side:number,position:V3,pieces:{size:Box['size'];offset:V3}[]):Box{
 const rotation=slopeRotation(side);
 const size=pieces.reduce((s,p)=>s.map((n,i)=>Math.max(n,2*Math.abs([p.offset.x,p.offset.y,p.offset.z][i])+p.size[i])) as Box['size'],[0,0,0] as Box['size']);
 return {id,position,rotation,size,pieces,density:look.density,material:look.material,color:look.color,friction:look.friction??.6,...(look.opacity!==undefined?{opacity:look.opacity}:{})};
}
const slopeNormal=(side:number)=>v(side*SIN,COS,0);
const onSlope=(x:number,side:number,z:number,offset:number)=>add(v(x,T(x),z),mul(slopeNormal(side),offset));
/** Area of the inset fastening polygon actually shared by two parts. */
function sharedArea(a:Box,b:Box){
 try{const {points}=fasteningPatch(a,b);if(points.length<3)return 0;
  let n=v();for(let i=1;i<points.length-1;i++)n=add(n,cross(sub(points[i],points[0]),sub(points[i+1],points[0])));return length(n)/2;
 }catch{return 0;}
}

export function industrialHallScenario():Scenario{
 const scenario=shedScenario();
 return {...scenario,boxes:scenario.boxes.map(box=>box.id==='ground'?{...box,size:[60,.4,50]}:box),id:'industrial-hall',title:'15 / Build an industrial hall',
  question:'Slab → steel portal frames → bracing, gable posts and purlins → insulated panels, ribbon windows and rooflights → flashings, gutters and a sectional door.'};
}

export function industrialHallDefinition():BuildDefinition{
 const plan:BuildPart[]=[],stages:string[]=[],placementGroups:string[][]=[];let stage=-1;
 const nextStage=(name:string)=>{stages.push(name);stage++;};
 // From the bracing onward, each part is fitted to the current pose of the parts it fastens
 // to (as a fitter would), so a frame that has settled a few millimetres never preloads
 // new fixings. Existing structure is never moved to meet a new part.
 const put=(box:Box,connectTo:string[],profile?:FastenerProfile,structural=true)=>{const entry:BuildPart={box,stage,connectTo,profile,structural,...(stage>=3&&connectTo.length?{fitToAttachments:true}:{})};plan.push(entry);return entry;};
 const find=(id:string)=>plan.find(p=>p.box.id===id)!.box;
 // Attachment targets are discovered once while authoring: only real shared
 // faces with a usable area. Running parts never join by proximity.
 const touching=(box:Box,candidates:Box[])=>candidates.filter(c=>sharedArea(box,c)>2e-4).map(c=>c.id);
 const sides=[-1,1] as const,sideName=(s:number)=>s<0?'left':'right';

 nextStage('Foundation slab');
 put(part('hall-slab',{material:'Reinforced concrete floor slab (rigid)',density:2400,color:0xa3a59b,friction:.7},[[[-6.5,6.5],[0,SLAB],[-10.5,10.5]]]),[]);

 nextStage('Steel columns');
 FRAMES.forEach((z,frame)=>sides.forEach(side=>{
  const x=side*HALL.span/2,o=side*OUTER,i=side*INNER,top=COLUMN_TOP-.012,shaft:Range=[SLAB+.025,top],width:Range=[z-COL.width/2,z+COL.width/2];
  const blocks:[Range,Range,Range][]=[
   // The base plate stays inside the cladding line and extends into the hall.
   [sorted(o,o-side*.45),[SLAB,SLAB+.025],width],
   [sorted(o,o-side*COL.flange),shaft,width],
   [sorted(i,i+side*COL.flange),shaft,width],
   [sorted(o-side*COL.flange,i+side*COL.flange),shaft,[z-COL.web/2,z+COL.web/2]],
   [sorted(o,i),[top,COLUMN_TOP],width],
  ];
  // End-frame columns carry a welded full-height plate: a flat face for the gable cladding.
  if(Math.abs(z)===10){const d=Math.sign(z);blocks.push([sorted(o,i),[SLAB,COLUMN_TOP],sorted(z+d*COL.width/2,z+d*(GABLE-10))]);}
  put(part(`column-${frame+1}-${sideName(side)}`,{...FRAME_STEEL,material:`Steel HEA 250-type column${Math.abs(z)===10?' with gable plate':''} (rigid)`},blocks),['hall-slab'],HOLDING_DOWN_BOLTS);
 }));

 nextStage('Rafter pairs (lifted as units)');
 FRAMES.forEach((z,frame)=>{
  const ids:string[]=[];
  for(const side of sides){
   const r=RAFTER,flange:Range=[z-r.width/2,z+r.width/2],web:Range=[z-r.web/2,z+r.web/2],tv=r.flange/COS;
   const xf=-INNER,x0=xf+r.plate,xa=-r.plate,x1=x0+r.haunchLength,h0=B(x0)-r.haunchDepth;
   // Flanges are rotated plates with square-cut ends, kept clear of both end plates.
   const n=slopeNormal(-1),ts=r.flange*SIN,along=(a:number,b:number)=>(b-a)/COS;
   const flangePlate=(a:number,b:number,line:(x:number)=>number,inward:number):Plate=>{
    const mid=(a+b)/2,center=add(v(mid,line(mid),z),mul(n,inward*r.flange/2));
    return {size:[along(a,b),r.flange,r.width],center:side<0?center:v(-center.x,center.y,center.z),rotation:slopeRotation(side)};
   };
   const flanges=[flangePlate(x0,xa-ts,T,-1),flangePlate(x0+ts,xa,B,1)];
   const solids=[
    xyPrism([[x0,T(x0)-tv],[xa,T(xa)-tv],[xa,B(xa)+tv],[x0,B(x0)+tv]],web),
    // Welded eaves haunch: a tapered web and a sloping flange under the rafter.
    xyPrism([[x0,B(x0)],[x1,B(x1)],[x0,h0]],web),
    xyPrism([[x0,h0],[x1,B(x1)],[x1,B(x1)-r.haunchFlange],[x0,h0-r.haunchFlange]],flange),
   ].map(points=>mirror(points,side));
   // End plates are box pieces: box-box contact is robust when the mirrored
   // apex plates bear exactly face to face.
   const plateZ:Range=[z-r.plateWidth/2,z+r.plateWidth/2],mx=(a:number,b:number)=>sorted(-side*a,-side*b);
   const plates:[Range,Range,Range][]=[[mx(xf,x0),[h0-r.haunchFlange-.02,EAVES+.015],plateZ],[mx(xa,0),[B(xa)-.04,T(0)+.015],plateZ]];
   const id=`rafter-${frame+1}-${sideName(side)}`;ids.push(id);
   put(part(id,{...FRAME_STEEL,material:'Steel IPE 300-type rafter with haunch and end plates (rigid)'},plates,solids,flanges),[`column-${frame+1}-${sideName(side)}`,...(side>0?[`rafter-${frame+1}-left`]:[])],END_PLATE_BOLTS);
  }
  // Rafter halves are bolted together at the apex on the ground and lifted as one unit.
  placementGroups.push(ids);
 });

 nextStage('Wall bracing');
 for(const side of sides)for(const [top,bottom] of [[0,1],[4,3]]){
  const zA=FRAMES[top],zB=FRAMES[bottom],toward=Math.sign(zB-zA),a=v(0,COLUMN_TOP-.35,zA+toward*.06),b=v(0,.75,zB-toward*.065);
  const axis=unit(sub(b,a)),across=v(0,axis.z,-axis.y),x=side*(OUTER-COL.flange-.006);
  const bar:Plate={size:[.012,.1,length(sub(b,a))],center:v(x,(a.y+b.y)/2,(a.z+b.z)/2),rotation:frameRotation(v(1,0,0),across,axis)};
  put(part(`wall-brace-${sideName(side)}-${top===0?'back':'front'}`,{material:'Steel flat bracing 100 × 12 (rigid)',density:STEEL,color:0x3d4a55},[],[],[bar]),
   [`column-${top+1}-${sideName(side)}`,`column-${bottom+1}-${sideName(side)}`],BRACING_BOLTS);
 }

 nextStage('Gable posts & door header');
 for(const [frame,zf] of [[0,-10],[4,10]] as const){
  const d=Math.sign(zf),zg=d*GABLE,zi=zg-d*POST.depth,end=d<0?'back':'front';
  for(const side of sides){
   const px=side*POST.x,xs:Range=[px-POST.width/2,px+POST.width/2],full=sorted(zi,zg);
   // A sloped steel cap plate bears on the rafter underside; the shaft stops just below it.
   const cap:Plate={size:[POST.width/COS,.015,POST.depth],center:add(v(px,B(px),(zi+zg)/2),mul(slopeNormal(side),-.0075)),rotation:slopeRotation(side)};
   const yb=Math.min(...plateCorners(cap).map(p=>p.y));
   const blocks:[Range,Range,Range][]=[
    [xs,[SLAB,SLAB+.02],full],
    [xs,[SLAB+.02,yb],sorted(zg,zg-d*POST.flange)],
    [xs,[SLAB+.02,yb],sorted(zi,zi+d*POST.flange)],
    [[px-POST.web/2,px+POST.web/2],[SLAB+.02,yb],sorted(zi+d*POST.flange,zg-d*POST.flange)],
   ];
   put(part(`gable-post-${end}-${sideName(side)}`,{...FRAME_STEEL,material:'Steel gable wind post with sloped cap plate (rigid)'},blocks,[],[cap]),['hall-slab',`rafter-${frame+1}-${sideName(side)}`],POST_BOLTS);
  }
  if(d>0){
   const zc=(zi+zg)/2,x=POST.x-POST.web/2,inner=x-.012,flange:Range=[zc-.075,zc+.075],tf=.0107;
   put(part('door-header',{...FRAME_STEEL,material:'Steel door header beam with end plates (rigid)'},[
    [[-x,-inner],[4.64,4.96],[zc-.08,zc+.08]],[[inner,x],[4.64,4.96],[zc-.08,zc+.08]],
    [[-inner,inner],[4.65,4.65+tf],flange],[[-inner,inner],[4.95-tf,4.95],flange],[[-inner,inner],[4.65+tf,4.95-tf],[zc-.0036,zc+.0036]],
   ]),['gable-post-front-left','gable-post-front-right'],POST_BOLTS);
  }
 }

 nextStage('Purlins');
 const purlins=new Map<number,Box[]>([[-1,[]],[1,[]]]);
 for(let bay=0;bay<4;bay++)for(const side of sides)for(const [row,px] of PURLIN_X.entries()){
  const [z0,z1]=bayZ(bay),length=z1-z0,x=side*px,web=side*(PURLIN.flange/2-PURLIN.t/2);
  const box=slopePart(`purlin-${sideName(side)}-${row+1}-bay-${bay+1}`,{material:'Cold-formed galvanized C150 purlin (rigid)',density:STEEL,color:0xaab5ba},side,onSlope(x,side,(z0+z1)/2,PURLIN.depth/2),[
   {size:[PURLIN.flange,PURLIN.t,length],offset:v(0,-PURLIN.depth/2+PURLIN.t/2,0)},
   {size:[PURLIN.flange,PURLIN.t,length],offset:v(0,PURLIN.depth/2-PURLIN.t/2,0)},
   {size:[PURLIN.t,PURLIN.depth-2*PURLIN.t,length],offset:v(web,0,0)},
  ]);
  put(box,touching(box,[find(`rafter-${bay+1}-${sideName(side)}`),find(`rafter-${bay+2}-${sideName(side)}`)]),PURLIN_BOLTS);
  purlins.get(side)!.push(box);
 }

 const PANEL_LOOK:Look={material:'Insulated sandwich wall panel: steel skins, PIR core (rigid composite)',density:140,color:0xdcdfdc};
 const GLASS_LOOK:Look={material:'Polycarbonate multiwall glazing, 16 mm (rigid)',density:170,color:0xbfe4ef,opacity:.35};
 const panelLook=(row:number,index:number):Look=>row===0?{...PANEL_LOOK,color:0x58616a}:row===4||row===5?{...PANEL_LOOK,color:index%2?0xd3d7d4:0xdcdfdc}:{...PANEL_LOOK,color:index%2?0xe2e4e1:0xd8dbd8};
 const rowY=(row:number):Range=>[SLAB+ROW*row,SLAB+ROW*(row+1)];
 const columns=(frame:number,side:number)=>find(`column-${frame+1}-${sideName(side)}`);
 const sidePanels=new Map<number,Box[]>([[-1,[]],[1,[]]]);

 nextStage('Side walls & ribbon windows');
 for(const side of sides)for(let row=0;row<5;row++)for(let bay=0;bay<4;bay++){
  const z=bayZ(bay),glazed=row===3,thick=glazed?GLAZING:WALL;
  const x=sorted(side*OUTER,side*(OUTER+thick)),id=`${glazed?'window':'wall-panel'}-${sideName(side)}-row-${row+1}-bay-${bay+1}`;
  // The top panel reaches the roof underside at its outer face.
  const box=part(id,glazed?GLASS_LOOK:panelLook(row,bay),[[x,row<4?rowY(row):[rowY(4)[0],R(WALL_OUT)],z]]);
  put(box,touching(box,[columns(bay,side),columns(bay+1,side)]),PANEL_FASTENER,false);
  sidePanels.get(side)!.push(box);
 }

 nextStage('Gable walls & windows');
 const gablePanels:Box[]=[];
 for(const [frame,zf] of [[0,-10],[4,10]] as const){
  const d=Math.sign(zf),end=d<0?'back':'front',supports=[columns(frame,-1),columns(frame,1),find(`gable-post-${end}-left`),find(`gable-post-${end}-right`)];
  const segments:[string,Range][]=[['left',[-WALL_OUT,-POST.x-JOINT/2]],['middle',[-POST.x+JOINT/2,POST.x-JOINT/2]],['right',[POST.x+JOINT/2,WALL_OUT]]];
  for(let row=0;row<6;row++)for(const [index,[name,x]] of segments.entries()){
   if(d>0&&name==='middle'&&row<4)continue;// the door opening
   const glazed=row===3,thick=glazed?GLAZING:WALL,z=sorted(d*GABLE,d*(GABLE+thick)),id=`gable-${glazed?'window':'panel'}-${end}-${name}-row-${row+1}`;
   // Raked top panels follow the roof line with a 2 mm sealing gap.
   const rake=(x:number)=>R(x)-.002,top=name==='middle'?[[x[1],rake(x[1])],[0,rake(0)],[x[0],rake(x[0])]] as P2[]:[[x[1],rake(x[1])],[x[0],rake(x[0])]] as P2[];
   const box=row<5?part(id,glazed?GLASS_LOOK:panelLook(row,index),[[x,rowY(row),z]])
    :part(id,panelLook(row,index),[],[xyPrism([[x[0],rowY(5)[0]],[x[1],rowY(5)[0]],...top],z)]);
   put(box,touching(box,supports),PANEL_FASTENER,false);gablePanels.push(box);
  }
 }

 nextStage('Roof panels & rooflights');
 const roofPanels:Box[]=[];
 const slopeLength=(ROOF_EDGE-RIDGE_GAP)/COS,ribLength=slopeLength-.35;
 for(const side of sides)for(let j=0;j<ROOF_LENGTH/ROOF_PANEL;j++){
  const z=-ROOF_LENGTH/2+ROOF_PANEL*(j+.5),mid=side*(ROOF_EDGE+RIDGE_GAP)/2,light=j%5===2;
  // Local +X points down-slope on the right and up-slope on the left; ribs stop short of the ridge flashing.
  const ribX=side*(slopeLength/2-ribLength/2);
  const look:Look=light?{material:'Twin-skin translucent GRP rooflight panel (rigid)',density:35,color:0xe9f5f0,opacity:.45}
   :{material:'Insulated sandwich roof panel: steel skins, PIR core (rigid composite)',density:115,color:j%2?0x8a9398:0x949da2};
  const box=slopePart(`${light?'rooflight':'roof-panel'}-${sideName(side)}-${j+1}`,look,side,onSlope(mid,side,z,PURLIN.depth+ROOF/2),[
   {size:[slopeLength,ROOF,ROOF_PANEL-JOINT],offset:v()},
   ...[-.35,0,.35].map(dz=>({size:[ribLength,.03,.025] as Box['size'],offset:v(ribX,ROOF/2+.015,dz)})),
  ]);
  put(box,touching(box,purlins.get(side)!),PANEL_FASTENER,false);roofPanels.push(box);
 }

 nextStage('Ridge, gutters, trims & downpipes');
 const FLASHING:Look={material:'Coated steel flashing (rigid)',density:STEEL,color:0x3a4147};
 for(let k=0;k<4;k++){
  // Two flat wings, each a box piece lying on its roof slope (robust box-box contact).
  const z=-ROOF_LENGTH/2+5.225*(k+.5),t=.001,reach=.32,position=v(0,RT(0),z),length=5.225-JOINT;
  const box:Box={id:`ridge-flashing-${k+1}`,position,size:[2*reach,reach*TAN+t,length],density:FLASHING.density,material:FLASHING.material,color:FLASHING.color,friction:.6,
   pieces:sides.map(side=>({size:[reach/COS,t,length] as Box['size'],rotation:{x:0,y:0,z:-side*Math.sin(PITCH/2),w:Math.cos(PITCH/2)},offset:sub(add(v(side*reach/2,RT(reach/2),z),mul(slopeNormal(side),t/2)),position)}))};
  put(box,touching(box,roofPanels),TRIM_FIXING,false);
 }
 const gutters=new Map<number,Box[]>([[-1,[]],[1,[]]]);
 for(const side of sides)for(let k=0;k<4;k++){
  const z:Range=[-ROOF_LENGTH/2+5.225*k+JOINT/2,-ROOF_LENGTH/2+5.225*(k+1)-JOINT/2],s=(a:number,b:number)=>sorted(side*a,side*b),t=.001;
  const box=part(`gutter-${sideName(side)}-${k+1}`,{...FLASHING,material:'Coated steel box gutter (rigid)'},[
   [s(WALL_OUT,WALL_OUT+t),[5.5,5.74],z],[s(WALL_OUT+t,6.38),[5.5,5.5+t],z],[s(6.38-t,6.38),[5.5+t,5.72],z],
  ]);
  put(box,touching(box,[...sidePanels.get(side)!,...gablePanels]),TRIM_FIXING,false);gutters.get(side)!.push(box);
 }
 for(const side of sides)for(const d of [-1,1]){
  const s=(a:number,b:number)=>sorted(side*a,side*b),zg=d*GABLE,y:Range=[SLAB+.05,5.45];
  const box=part(`corner-trim-${sideName(side)}-${d<0?'back':'front'}`,FLASHING,[
   [s(WALL_OUT,WALL_OUT+.002),y,sorted(zg-d*.15,zg+d*(WALL+.002))],[s(WALL_OUT-.15,WALL_OUT),y,sorted(zg+d*WALL,zg+d*(WALL+.002))],
  ]);
  put(box,touching(box,[...sidePanels.get(side)!,...gablePanels]),TRIM_FIXING,false);
  const zp=d*9.6,w=.04,t=.0015,pipe=part(`downpipe-${sideName(side)}-${d<0?'back':'front'}`,{...FLASHING,material:'Coated steel downpipe 80 × 80 (rigid)'},[
   [s(WALL_OUT,WALL_OUT+t),[.35,5.5-JOINT],[zp-w,zp+w]],[s(WALL_OUT+.08-t,WALL_OUT+.08),[.35,5.5-JOINT],[zp-w,zp+w]],
   [s(WALL_OUT+t,WALL_OUT+.08-t),[.35,5.5-JOINT],[zp-w,zp-w+t]],[s(WALL_OUT+t,WALL_OUT+.08-t),[.35,5.5-JOINT],[zp+w-t,zp+w]],
  ]);
  put(pipe,touching(pipe,sidePanels.get(side)!),TRIM_FIXING,false);
 }

 nextStage('Sectional door');
 const zi=GABLE-POST.depth,door:Range=[zi-DOOR.thickness,zi];
 for(let k=0;k<DOOR.sections;k++){
  const y:Range=[SLAB+DOOR.height*k,SLAB+DOOR.height*(k+1)],glazed=k===5;
  const box=part(`door-section-${k+1}`,glazed?{material:'Insulated door section with glazing strip (rigid)',density:300,color:0xd6ebf2,opacity:.55}:{material:'Insulated steel door section, 45 mm (rigid)',density:300,color:k%2?0xf0f0ec:0xe8e8e3},[[[-DOOR.halfWidth,DOOR.halfWidth],y,door]]);
  put(box,touching(box,[find('gable-post-front-left'),find('gable-post-front-right'),...(k?[find(`door-section-${k}`)]:[])]),DOOR_HARDWARE,false);
 }

 return {plan,stages,rootId:'hall-slab',interval:.1,placementGroups,solverIterations:16,internalPgsIterations:8,contactNaturalFrequency:120,allowedLinearError:.0001,filterRigidInternalContacts:false,
  experimentParameters:{spanM:HALL.span,lengthM:HALL.length,bayM:HALL.bay,eavesM:HALL.eavesM,pitchDeg:HALL.pitchDeg},
  name:'Industrial hall',
  note:`Steel portal-frame hall: ${HALL.span} m span, ${HALL.length} m long in four ${HALL.bay} m bays, ${HALL.eavesM} m to the rafters at the eaves, ${HALL.pitchDeg}° duo-pitch roof. Five frames of HEA-type columns on holding-down bolts and haunched IPE-type rafters with bolted end plates; each rafter pair is bolted at the apex and lifted as one unit. Flat-bar wall bracing in the end bays. Gable wind posts carry a door header. Cold-formed purlins carry insulated roof panels with GRP rooflights. Insulated wall panels span between columns with a polycarbonate ribbon window; the top gable panels are raked to the roof line. Ridge flashing, box gutters, corner trims, downpipes and an eight-section door. Every connection has finite experimental strength; panels rest on each other and the slab by contact. Steel members stay rigid: no bending, buckling, yield or bolt slip curves. Sandwich panels use a declared average composite density. No weather sealing, rain or thermal model.`};
}
