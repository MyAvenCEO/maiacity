import {prefabricatedStand} from './prefab';
import {telescopicStand} from './telescopic-stand';
import {shedScenario,type BuildDefinition,type BuildPart} from './shed';
import {verticesOf,type Box,type Scenario} from './simulation';
import {type FastenerProfile} from './fasteners';
import {v,add,sub,mul,dot,cross,length,unit,mean,hull,frameRotation} from './geometry';
import type {V3} from './simulation';
export const DOME_GRIP:FastenerProfile={name:'Hub timber grip',stiffness:5e6,damping:5000,withdrawalN:8000,shearN:12000};
export const DOME_BOLT:FastenerProfile={name:'Hub base bolt',stiffness:5e6,damping:5000,withdrawalN:12000,shearN:18000};
export const SHORING_FIXING:FastenerProfile={name:'Temporary support screw / bolt',stiffness:5e6,damping:5000,withdrawalN:1500,shearN:2500};
export const ENTRANCE_BOLT:FastenerProfile={name:'Plywood through-bolt with load-spreading washer',stiffness:1e6,damping:2000,withdrawalN:2400,shearN:4800};
export const PANEL_CLIP:FastenerProfile={name:'Panel fixing',stiffness:1e6,damping:2000,withdrawalN:400,shearN:800};
export const DEFAULT_DOME_DIAMETER=8,MIN_DOME_DIAMETER=6;
function validateDiameter(diameter:number){
 if(!Number.isFinite(diameter)||diameter<MIN_DOME_DIAMETER)throw new Error(`Dome diameter must be at least ${MIN_DOME_DIAMETER} m and finite.`);
}
export function domeScenario(diameter=DEFAULT_DOME_DIAMETER):Scenario{
 validateDiameter(diameter);
 const scenario=shedScenario();
 return {...scenario,boxes:scenario.boxes.map(box=>box.id==='ground'?{...box,size:[Math.max(30,diameter+34),.4,Math.max(20,diameter+4)]}:box),id:'dome',title:'13 / Build a geodesic dome',question:'Foundation → connector hubs and triangulated struts → panel brackets → triangular shell.'};
}
/** A vertex-up icosahedron, subdivided once (2V) and projected to a sphere. */
export function domeMesh(detail=1){
 if(!Number.isSafeInteger(detail)||detail<1)throw Error('Mesh subdivisions must be a positive integer.');
 const vertices:V3[]=[v(0,1,0),v(0,-1,0)];const h=1/Math.sqrt(5),r=2/Math.sqrt(5);
 for(let ring=0;ring<2;ring++)for(let i=0;i<5;i++){const a=i*2*Math.PI/5+ring*Math.PI/5;vertices.push(v(r*Math.sin(a),ring?-h:h,r*Math.cos(a)));}
 const coarse=hull(vertices).faces;const mids=new Map<string,number>();
 const midpoint=(a:number,b:number)=>{const key=[a,b].sort((x,y)=>x-y).join('/');if(!mids.has(key)){mids.set(key,vertices.length);vertices.push(unit(add(vertices[a],vertices[b])));}return mids.get(key)!;};
 const faces:number[][]=[];
 for(const [a,b,c] of coarse){const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);faces.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);}
 const upper=faces.filter(f=>f.every(i=>vertices[i].y>=-1e-7));
 const entrance=vertices.findIndex(p=>Math.abs(p.y-h)<1e-7&&p.z>.8);
 const entranceCoarse=upper.filter(f=>f.includes(entrance));
 const boundary=[...new Set(entranceCoarse.flat())].filter(i=>i!==entrance);
 const boundaryKeys=new Set<string>();
 for(const f of entranceCoarse)for(let j=0;j<3;j++)if(f[j]!==entrance&&f[(j+1)%3]!==entrance)boundaryKeys.add([f[j],f[(j+1)%3]].sort((a,b)=>a-b).join('/'));
 const refined:number[][]=[],entranceFlags:boolean[]=[];
 const fineMids=new Map<string,number>();
 const fineMid=(a:number,b:number)=>{
  const key=[a,b].sort((a,b)=>a-b).join('/');
  if(!fineMids.has(key)){
   // Keep the five-sided entrance perimeter planar, with collinear extra nodes.
   fineMids.set(key,vertices.length);const p=mean([vertices[a],vertices[b]]);
   vertices.push(boundaryKeys.has(key)?p:unit(p));
  }
  return fineMids.get(key)!;
 };
 const thirds=new Map<string,number>(vertices.map((p,i)=>[[p.x,p.y,p.z].map(n=>String(Math.round(n*1e10))).join('/'),i]));
 const third=(a:number,b:number,c:number,i:number,j:number)=>{
  const raw=mul(add(add(mul(vertices[a],detail-i-j),mul(vertices[b],i)),mul(vertices[c],j)),1/detail);
  const key=[raw.x,raw.y,raw.z].map(n=>String(Math.round(n*1e10))).join('/');
  if(!thirds.has(key)){
   const edge=i===0?[a,c]:j===0?[a,b]:i+j===detail?[b,c]:undefined;
   const planar=edge&&boundaryKeys.has(edge.sort((a,b)=>a-b).join('/'));
   thirds.set(key,vertices.length);vertices.push(planar?raw:unit(raw));
  }
  return thirds.get(key)!;
 };
 for(const f of upper){const isEntrance=f.includes(entrance);
  if(detail>2){
   const [a,b,c]=f;
   for(let i=0;i<detail;i++)for(let j=0;j<detail-i;j++){
    refined.push([third(a,b,c,i,j),third(a,b,c,i+1,j),third(a,b,c,i,j+1)]);entranceFlags.push(isEntrance);
    if(i+j<detail-1){refined.push([third(a,b,c,i+1,j),third(a,b,c,i+1,j+1),third(a,b,c,i,j+1)]);entranceFlags.push(isEntrance);}
   }
   continue;
  }
  if(detail===1){refined.push(f);entranceFlags.push(isEntrance);continue;}
  const [a,b,c]=f,ab=fineMid(a,b),bc=fineMid(b,c),ca=fineMid(c,a);
  refined.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);entranceFlags.push(...Array(4).fill(isEntrance));
 }
 const used=[...new Set(refined.flat())].sort((a,b)=>vertices[a].y-vertices[b].y||a-b),index=new Map(used.map((id,i)=>[id,i]));
 const entrancePerimeterEdges=[...boundaryKeys].flatMap(key=>{
  const [a,b]=key.split('/').map(Number),m=fineMids.get(key);
  const chain=detail>2?Array.from({length:detail+1},(_,j)=>third(a,b,a,j,0)):[];
  return (detail===1?[[a,b]]:detail>2?chain.slice(0,-1).map((id,j)=>[id,chain[j+1]]):[[a,m!],[m!,b]]).map(pair=>pair.map(i=>index.get(i)!) as [number,number]);
 });
 return {vertices:used.map(i=>{const p=vertices[i];return v(p.x,Math.max(0,p.y),p.z);}),faces:refined.map(f=>f.map(i=>index.get(i)!)),entranceFlags,entranceBoundary:boundary.map(i=>index.get(i)!),entrancePerimeterEdges};
}
export type DomeSettings={targetCellSizeM:number;timberSectionsMm:[number,number,number]};
export const DEFAULT_DOME_SETTINGS:DomeSettings={targetCellSizeM:2.5,timberSectionsMm:[120,100,80]};
export function domeDetail(diameter:number,targetCellSizeM:number){
 validateDiameter(diameter);
 if(!Number.isFinite(targetCellSizeM)||targetCellSizeM<=0)throw Error('Target cell size must be positive and finite.');
 // The projected small cells are roughly coarse chord / subdivision count.
 // It is a target, not a strict maximum after spherical projection.
 return Math.max(1,Math.ceil((.618033988749895*diameter/2)/targetCellSizeM));
}
export function domeDefinition(diameter=DEFAULT_DOME_DIAMETER, options: {detailedShoring?:boolean;earlyWithdrawal?:boolean;legacyCompactShoring?:boolean;settings?:DomeSettings} = {}):BuildDefinition{
 validateDiameter(diameter);
 const legacy=!!(options.detailedShoring||options.legacyCompactShoring);
 const settings=options.settings??DEFAULT_DOME_SETTINGS;
 if(settings.timberSectionsMm.some(n=>!Number.isFinite(n)||n<=0))throw Error('Timber sections must be positive finite dimensions.');
 const stock=legacy?(diameter<=8?[80,80,80]:[120,100,80]):settings.timberSectionsMm,wide=stock.some(n=>n>80);
 const detail=legacy?(diameter>10?2:1):domeDetail(diameter,settings.targetCellSizeM),mesh=domeMesh(detail),radius=diameter/2,origin=v(0,.34,0),nodes=mesh.vertices.map(p=>add(mul(p,radius),origin));
 const sleeveLength=Math.min(.82,Math.min(...nodes.filter(p=>p.y>origin.y+1e-6).map(p=>p.y))-.8);
 if(!legacy&&sleeveLength<=.08)throw Error('Cells are too small for the support head and timber clearance. Increase target cell size.');
 const sleeveOverlap=Math.min(.10,sleeveLength*.2),sleeveCount=Math.max(2,1+Math.ceil((radius+.3-(sleeveLength+.4))/(sleeveLength-sleeveOverlap)));
 const footScale=detail===2?.5:Math.min(1,diameter/8);
 const temporaryProps:string[]=[],temporarySupportGroups:string[][]=[];
 const plan:BuildPart[]=[],stages=['Foundation','Base hubs & ring','Lower struts & hubs','Upper struts & hubs','Crown & withdraw stands','Panel brackets','Panels, windows & entrance'];
 const put=(box:Box,stage:number,connectTo:string[],profile:FastenerProfile,structural=true)=>{const entry:BuildPart={box,stage,connectTo,profile,structural};plan.push(entry);return entry;};
 const solid=(id:string,points:V3[],density:number,material:string,color:number):Box=>{
  const center=mean(points),local=points.map(p=>sub(p,center));
  return {id,position:center,size:['x','y','z'].map(axis=>Math.max(...local.map(p=>p[axis as keyof V3]))-Math.min(...local.map(p=>p[axis as keyof V3]))) as Box['size'],polyhedron:hull(local),density,material,color,friction:.65};
 };
 put({id:'dome-foundation',size:[diameter+.6,.2,diameter+.6],position:v(0,.1,0),density:2400,material:'Concrete (rigid)',color:0x96998d,friction:.65},0,[],DOME_BOLT);
 const edges:[number,number][]=[];const seen=new Set<string>();
 for(const [fi,f] of mesh.faces.entries())if(detail===1||!mesh.entranceFlags[fi])for(let j=0;j<3;j++){const pair=[f[j],f[(j+1)%3]].sort((a,b)=>a-b) as [number,number],key=pair.join('/');if(!seen.has(key)){seen.add(key);edges.push(pair);}}
 // Keep the threshold even though it has no adjacent cladding triangle.
 for(const edge of mesh.entrancePerimeterEdges){const pair=edge.sort((a,b)=>a-b),key=pair.join('/');if(!seen.has(key)){seen.add(key);edges.push(pair);}}
 // A pentagonal front bay replaces the five triangles around this original
 // icosahedron vertex. Its central hub and spokes would obstruct a doorway.
 const entranceNode=mesh.vertices.findIndex(p=>Math.abs(p.y-1/Math.sqrt(5))<1e-7&&p.z>.8);
 const boundary=mesh.entranceBoundary;
 const activeNodes=new Set(edges.flat());
 const doorwayNormal=mesh.vertices[entranceNode],doorwayX=v(1,0,0),doorwayUp=unit(cross(doorwayNormal,doorwayX));
 const bottomNodes=boundary.filter(i=>nodes[i].y<.35),doorwayOrigin=mean(bottomNodes.map(i=>nodes[i]));
 const onBoundary=(i:number)=>Math.abs(dot(sub(nodes[i],doorwayOrigin),doorwayNormal))<1e-7;
 const doorWidth=1,doorHeight=2.1/doorwayUp.y;
 const doorwayPolygon=boundary.map(i=>({x:dot(sub(nodes[i],doorwayOrigin),doorwayX),y:dot(sub(nodes[i],doorwayOrigin),doorwayUp)}));
 const polygonCenter={x:0,y:doorwayPolygon.reduce((sum,p)=>sum+p.y,0)/5};
 doorwayPolygon.sort((a,b)=>Math.atan2(a.y-polygonCenter.y,a.x)-Math.atan2(b.y-polygonCenter.y,b.x));
 const doorwayPoint=(p:{x:number;y:number},offset:number)=>add(doorwayOrigin,add(mul(doorwayX,p.x),add(mul(doorwayUp,p.y),mul(doorwayNormal,offset))));
 const section=(a:number,b:number)=>stock[Math.min(mesh.vertices[a].y,mesh.vertices[b].y)<.35?0:Math.min(mesh.vertices[a].y,mesh.vertices[b].y)<.75?1:2]/1000;
 const edgeFrame=(a:number,b:number)=>{const y=unit(sub(nodes[b],nodes[a])),radial=sub(mean([nodes[a],nodes[b]]),origin),z=unit(sub(radial,mul(y,dot(radial,y)))),x=unit(cross(y,z));return {x,y,z};};
 const edgeId=(a:number,b:number)=>`dome-strut-${Math.min(a,b)+1}-${Math.max(a,b)+1}`;
 const hubId=(i:number)=>`dome-hub-${i+1}`;
 const caps=new Map<string,V3[]>();
 for(const [a,b] of edges){const frame=edgeFrame(a,b);for(const [node,sign] of [[a,1],[b,-1]]){
  const center=add(nodes[node],mul(frame.y,.139*sign)),points:V3[]=[];
  const half=section(a,b)/2+.015;for(const x of [-half,half])for(const z of [-half,half])points.push(add(center,add(mul(frame.x,x),mul(frame.z,z))));caps.set(`${node}/${a}/${b}`,points);
 }}
 const hubs=nodes.map((node,i)=>{
  const points=edges.filter(e=>e.includes(i)).flatMap(([a,b])=>caps.get(`${i}/${a}/${b}`)!);
  if(!activeNodes.has(i))return undefined!;
  const footing=mesh.vertices[i].y<1e-7;
  if(footing)for(const x of [-.065,.065])for(const z of [-.065,.065])points.push(v(node.x+x,.2,node.z+z));
  const hub=solid(hubId(i),points,7850,'Steel connector hub with bolting tabs (rigid)',0x7794a0);
  hub.pieces=edges.filter(e=>e.includes(i)&&!e.includes(entranceNode)).map(([a,b])=>{
    const f=edgeFrame(a,b),sign=i===a?1:-1;
    return {size:[section(a,b)+.02,.36,.006] as Box['size'],rotation:frameRotation(f.x,f.y,f.z),offset:sub(add(node,add(mul(f.y,sign*(.139+.18)),mul(f.z,-section(a,b)/2-.003))),hub.position)};
  });
  const bounds=verticesOf(hub);hub.size=['x','y','z'].map(axis=>Math.max(...bounds.map(p=>p[axis as keyof V3]))-Math.min(...bounds.map(p=>p[axis as keyof V3]))) as Box['size'];
  return hub;
 });
 const strut=(a:number,b:number,stage:number,targets:string[])=>{
  const frame=edgeFrame(a,b);const entry=put({id:edgeId(a,b),position:mean([nodes[a],nodes[b]]),size:[section(a,b),length(sub(nodes[b],nodes[a]))-(wide?.40:.30),section(a,b)],rotation:frameRotation(frame.x,frame.y,frame.z),density:600,material:`Wood ${Math.round(section(a,b)*1000)} × ${Math.round(section(a,b)*1000)} mm (rigid)`,color:section(a,b)>.1?0xa87e4e:section(a,b)>.08?0xbc925e:0xc9a06b,friction:.6},stage,targets,DOME_GRIP);entry.placementEnds={targets:[hubId(a),hubId(b)],points:[nodes[a],nodes[b]]};return entry;
 };
 const installed=new Set<number>();
 for(let i=0;i<nodes.length;i++){
  if(i===entranceNode||!activeNodes.has(i))continue;
  const y=mesh.vertices[i].y,stage=y<1e-7?1:y<.6?2:y<.99?3:4;
  const prior=edges.filter(e=>e.includes(i)&&installed.has(e[0]===i?e[1]:e[0]));
  if(y<1e-7)put(hubs[i],stage,['dome-foundation'],DOME_BOLT);
  else{
   const prefix=`assembly-prop-${i+1}`,group:string[]=[];temporarySupportGroups.push(group);
   const candidates=hubs[i].polyhedron!.faces.map(face=>face.map(j=>add(hubs[i].polyhedron!.vertices[j],hubs[i].position))).filter(face=>unit(cross(sub(face[1],face[0]),sub(face.at(-1)!,face[0]))).y<-.5);
   const area=(face:V3[])=>face.slice(1,-1).reduce((sum,_,j)=>sum+length(cross(sub(face[j+1],face[0]),sub(face[j+2],face[0])))/2,0);
   const surface=candidates.sort((a,b)=>stage>=3?area(b)-area(a):Math.hypot(mean(a).x-nodes[i].x,mean(a).z-nodes[i].z)-Math.hypot(mean(b).x-nodes[i].x,mean(b).z-nodes[i].z))[0];
   const radial=unit(v(nodes[i].x,0,nodes[i].z||1e-12));
   const center=wide?sub(nodes[i],mul(radial,.12)):mean(surface);
   if(!options.detailedShoring&&!options.legacyCompactShoring){
    const id=`${prefix}-cap`,stand=telescopicStand(hubs[i],sub(nodes[i],mul(radial,.12)),id,stage,sleeveCount,sleeveLength,wide?nodes[i].y-.04:Math.min(...surface.map(p=>p.y))+.02);
    plan.push(stand);temporaryProps.push(id);group.push(id);
    put(hubs[i],stage,[id],DOME_BOLT).placementReference=id;
   }else{
   // An integral steel mounting stem presents a broad, flat bearing surface
   // below the hub's faceted center and clear of its strut tabs.
   const stemLength=wide?.32:.18,stemBottom=wide?nodes[i].y-.36:Math.min(...surface.map(p=>p.y))-.16,capBottom=stemBottom-.012;
   
   const out=length(v(center.x,0,center.z))<1e-6?v(0,0,1):unit(v(center.x,0,center.z)),tangent=v(out.z,0,-out.x),yaw=frameRotation(tangent,v(0,1,0),out);
   hubs[i].pieces!.push({size:[.08,stemLength,.08],rotation:yaw,offset:sub(v(center.x,stemBottom+stemLength/2,center.z),hubs[i].position)});
   const reach=detail===2&&mesh.vertices[i].y<.4?.4:0,standCenter=sub(center,mul(out,reach));
   const at=(x:number,y:number,z:number)=>add(v(standCenter.x,y,standCenter.z),add(mul(tangent,x),mul(out,z)));
   const support=(box:Box,targets:string[])=>{temporaryProps.push(box.id);group.push(box.id);return put(box,stage,targets,detail===2?{...DOME_GRIP,name:'Heavy support through-bolt'}:SHORING_FIXING);};
   const timber=(id:string,size:Box['size'],position:V3):Box=>({id,size,position,density:600,material:'Temporary timber support (rigid)',color:0xc4794f,friction:.65,rotation:yaw});
   // A broad, unanchored sole plate carries weight by contact and can slide or tip.
   const foot=timber(`${prefix}-base`,[.8*footScale,.08,.90*footScale],at(0,.24,-.35*footScale));
   if(detail===2){foot.density=7850;foot.material='Heavy steel support foot (rigid)';foot.color=0x7794a0;}
   support(foot,[]);
   const shoe:Box={id:`${prefix}-shoe`,position:at(0,.284,0),rotation:yaw,size:[.18,.208,.14],density:7850,material:'Steel support shoe (rigid)',color:0x7794a0,friction:.65,pieces:[
    {size:[.18,.008,.14],offset:v()},
    ...[-1,1].map(sign=>({size:[.008,.20,.12] as Box['size'],offset:v(sign*.044,.104,0)}))
   ]};
   support(shoe,[`${prefix}-base`]);
   support(timber(prefix,[.08,capBottom-.289,.08],v(standCenter.x,(capBottom+.287)/2,standCenter.z)),[shoe.id]);
   // Three diagonal timbers have horizontal feet and vertical ends against the post.
   const headDepth=detail===2?.32:.16,braceTop=capBottom-headDepth-.06;
   for(const [axis,sign] of [[0,-1],[0,1],[1,-1]]){
    const polygon=[[(axis===1?.62:.26)*footScale,.28],[(axis===1?.72:.36)*footScale,.28],[.04,braceTop],[.04,braceTop-.22]];
    const points=polygon.flatMap(([r,y])=>[-.025,.025].map(t=>v(axis===0?sign*r:t,y,axis===1?sign*r:t)));
    const brace=solid(`${prefix}-brace-${axis}-${sign}`,points,600,'Temporary timber diagonal brace (rigid)',0xc4794f);
    brace.position=at(brace.position.x,brace.position.y,brace.position.z);brace.rotation=yaw;
    support(brace,[`${prefix}-base`,prefix]);
   }
   const cap:Box={id:`${prefix}-cap`,position:at(0,capBottom+.006,0),rotation:yaw,size:[.12,headDepth+.012,reach+.12],density:7850,material:'Steel support head with side plates (rigid)',color:0x7794a0,friction:.65,pieces:[
    {size:[.12,.012,reach+.12],offset:v(0,0,reach/2)},
    ...[-1,1].map(sign=>({size:[.008,headDepth,.08] as Box['size'],offset:v(sign*.044,-.006-headDepth/2,0)}))
   ]};
   const head=support(cap,[prefix]);head.placementReference=prefix;
   if(detail===2)head.profile={...DOME_GRIP,name:'Through-bolted heavy support head'};
   put(hubs[i],stage,[cap.id],DOME_BOLT).placementReference=cap.id;
   }
  }
  for(const [a,b] of prior)strut(a,b,stage,[hubId(a),hubId(b)]);
  installed.add(i);
 }
 const panels:BuildPart[]=[];
 mesh.faces.forEach((face,fi)=>{
  if(mesh.entranceFlags[fi])return;
  const points=face.map(i=>nodes[i]);let normal=unit(cross(sub(points[1],points[0]),sub(points[2],points[0])));
  if(dot(normal,sub(mean(points),origin))<0)normal=mul(normal,-1);
  const centroid=mean(points),inner=points.map(p=>add(centroid,mul(sub(p,centroid),.994)));
  const panel=solid(`dome-panel-${fi+1}`,inner.flatMap(p=>[add(p,mul(normal,.10)),add(p,mul(normal,.106))]),1200,'Polycarbonate panel (rigid)',[0x81b3ad,0x98c6ba,0xa4c9c5][fi%3]);
  // Windows are physical polycarbonate panels; transparency changes optics only.
  if((centroid.y-origin.y)/radius>.19&&(centroid.y-origin.y)/radius<.715&&Math.abs(centroid.x)/radius>.325){panel.opacity=.28;panel.color=0xb8e2ee;panel.material='Clear polycarbonate window (rigid)';}
  const targets:string[]=[];
  for(let k=0;k<3;k++){
   const [a,b]=[face[k],face[(k+1)%3]].sort((a,b)=>a-b),frame=edgeFrame(a,b),mid=mean([nodes[a],nodes[b]]);
   const sign=dot(sub(centroid,mid),frame.x)>0?1:-1;
   const bottom:V3[]=[];for(const along of [-.06,.06])for(const across of [.008,.035])bottom.push(add(mid,add(mul(frame.y,along),add(mul(frame.x,sign*across),mul(frame.z,section(a,b)/2)))));
   const top=bottom.map(p=>add(p,mul(frame.z,(.10-dot(normal,sub(p,points[0])))/dot(normal,frame.z))));
   const id=`dome-panel-bracket-${fi+1}-${k+1}`;put(solid(id,[...bottom,...top],7850,'Steel panel bracket (rigid)',0x6a8791),5,[edgeId(a,b)],DOME_GRIP).placementReference=edgeId(a,b);targets.push(id);
  }
  panels.push({fitToAttachments:wide,box:panel,stage:6,connectTo:targets,profile:PANEL_CLIP,structural:false});
 });
 // One rigid pentagonal plywood panel with a genuine rectangular cutout.
 // Three non-overlapping convex regions preserve the void in mass, wind and collision.
 type P2={x:number;y:number};
 const clip=(polygon:P2[],distance:(p:P2)=>number)=>polygon.flatMap((p,i)=>{
  const q=polygon[(i+1)%polygon.length],dp=distance(p),dq=distance(q),out:P2[]=[];
  if(dp>=0)out.push(p);
  if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);out.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)});}
  return out;
 });
 const outline=doorwayPolygon.map(p=>({x:p.x*.994,y:polygonCenter.y+(p.y-polygonCenter.y)*.994}));
 const regions=[clip(outline,p=>-doorWidth/2-p.x),clip(outline,p=>p.x-doorWidth/2),
  clip(clip(clip(outline,p=>p.x+doorWidth/2),p=>doorWidth/2-p.x),p=>p.y-doorHeight)];
 // Clear enlarged hub cores, not just the timber faces, at all five corners.
 const entranceOffset=wide?Math.max(.10,...nodes.flatMap((_,i)=>hubs[i]&&onBoundary(i)?verticesOf(hubs[i]).map(p=>dot(sub(add(p,hubs[i].position),doorwayOrigin),doorwayNormal)):[]))+.01:.10;
 const doorPosition=doorwayPoint(polygonCenter,entranceOffset+.012),doorPolys=regions.map(region=>hull(region.flatMap(p=>[entranceOffset,entranceOffset+.024].map(depth=>sub(doorwayPoint(p,depth),doorPosition)))));
 const doorVertices=doorPolys.flatMap(p=>p.vertices);
 const entrancePanel:Box={id:'dome-entrance-pentagon',position:doorPosition,
  size:['x','y','z'].map(axis=>Math.max(...doorVertices.map(p=>p[axis as keyof V3]))-Math.min(...doorVertices.map(p=>p[axis as keyof V3]))) as Box['size'],
  convexPieces:doorPolys,density:600,material:'Plywood entrance panel with door opening (rigid)',color:0xc9a06b,friction:.6};
 const entranceTargets:string[]=[];
 const boundaryEdges=edges.filter(([a,b])=>onBoundary(a)&&onBoundary(b)&&a!==entranceNode&&b!==entranceNode);
 for(const [a,b] of boundaryEdges){
  const frame=edgeFrame(a,b),isBottom=nodes[a].y<.35&&nodes[b].y<.35;
  // Two sill fixings sit to either side of the opening, never across its void.
  for(const t of (wide?[.2,.5,.8]:isBottom?[.2,.8]:[.5])){
   const alongEdge=add(mul(nodes[a],1-t),mul(nodes[b],t));
   if(isBottom&&Math.abs(alongEdge.x)<doorWidth/2+.15)continue;
   const mid=add(mul(nodes[a],1-t),mul(nodes[b],t)),center=doorwayPoint(polygonCenter,0);
   const sign=dot(sub(center,mid),frame.x)>0?1:-1;
   const bottom:V3[]=[];for(const along of [-.06,.06])for(const across of [.008,.035])bottom.push(add(mid,add(mul(frame.y,along),add(mul(frame.x,sign*across),mul(frame.z,section(a,b)/2)))));
   const toward=unit(sub(sub(center,mid),mul(doorwayNormal,dot(sub(center,mid),doorwayNormal))));
   const top=bottom.map(p=>add(add(p,mul(toward,.06)),mul(doorwayNormal,entranceOffset-dot(doorwayNormal,sub(p,doorwayOrigin)))));
   const id=`entrance-panel-bracket-${entranceTargets.length+1}`;
   put(solid(id,[...bottom,...top],7850,'Steel entrance panel bracket (rigid)',0x6a8791),5,[edgeId(a,b)],DOME_GRIP).placementReference=edgeId(a,b);entranceTargets.push(id);
  }
 }
 panels.push({fitToAttachments:wide,box:entrancePanel,stage:6,connectTo:entranceTargets,profile:wide?ENTRANCE_BOLT:PANEL_CLIP,structural:false});
 plan.push(...panels);

 const workshopGroups=temporarySupportGroups.map(group=>group.map(id=>plan.find(p=>p.box.id===id)!));
 if(!options.detailedShoring&&options.legacyCompactShoring){
  for(const entries of workshopGroups){
   const at=plan.indexOf(entries[0]);plan.splice(at,entries.length,prefabricatedStand(entries));
  }
  temporaryProps.splice(0,temporaryProps.length,...workshopGroups.map(g=>g.at(-1)!.box.id));
  temporarySupportGroups.splice(0,temporarySupportGroups.length,...temporaryProps.map(id=>[id]));
 }

 const shoringReleaseAfter = !options.detailedShoring && options.earlyWithdrawal !== false ? temporaryProps.flatMap(id=>{
  const hub=plan.find(p=>p.connectTo.includes(id));if(!hub)return [];
  const incident=plan.filter(p=>p.box.id.startsWith('dome-strut-')&&p.connectTo.includes(hub.box.id));
  // A stand stays until the entire permanent strut fan at its hub exists.
  // This is a tested recipe rule, not a general structural-safety inference.
  if(incident.length<3)return [];
  return [{afterPart:incident.at(-1)!.box.id,parts:[id]}];
 }) : [];
 return {shoringReleaseAfter,removeWithdrawnShoring:!options.detailedShoring,plan,stages,parameters:{diameterM:diameter,frequency:detail*2,timberSectionsMm:stock,targetCellSizeM:settings.targetCellSizeM},shoringStorageX:Math.max(7,radius+2.7),temporaryProps,withdrawShoringAfterStage:4,temporarySupportGroups,placementGroups:temporarySupportGroups,filterRigidInternalContacts:false,solverIterations:16,internalPgsIterations:24,contactNaturalFrequency:120,allowedLinearError:.0001,rootId:'dome-foundation',interval:.12,name:'Geodesic dome',note:`${detail*2}V dome (planar pentagonal entrance): ${diameter} m diameter, ${radius} m frame rise. Mesh calculated from a ${settings.targetCellSizeM} m target cell size. Lower / middle / upper timber sections: ${stock.join(" / ")} mm; hubs and brackets fit these sections. Strength limits are not increased with diameter; oversized structures may fail. Larger entrances use additional physical brackets and plywood through-bolts with washers. Hub and structural fastening strengths remain finite and experimental. Timber struts, steel hubs and 6 mm polycarbonate cladding. Clear panels form windows. A large five-sided plywood entrance panel has a 1 m wide opening with 2.1 m vertical headroom above the sill; no door leaf is installed. Its centre hub and five spokes are omitted. The ring remains as a threshold. Bolting tabs grip strut sides; physical brackets support panels. Orange supports use one reusable telescopic steel stand model. Set and lock its height in one placement operation. A compact MP-80 service pad remains on each elevated hub for later interior framing, insulation battens or decoration. ${options.detailedShoring?'Detailed support mode: internal fastenings have finite strength; withdrawn stands are parked beside the slab.':'Each locked stand is one rigid compound body with nested hollow sleeves of constant stock length and mass; sleeve bending and internal lock failure are omitted. Returned stands are reused from the equipment pool. Hub attachments remain finite. A stand is withdrawn after the last permanent strut at its hub is fitted. Withdrawn stands leave the scene and simulation with recorded material outflow.'} Feet can slide or tip. Handling is not simulated. Hub grips, base bolts and panel fixings have experimental finite strength. Parts remain rigid; no strut buckling, panel flex, seam sealing or weatherproof claim. Placement and fastening are lab operations.`};
}
