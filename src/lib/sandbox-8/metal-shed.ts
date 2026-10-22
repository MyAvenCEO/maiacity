import {shedPlan,shedScenario,ROOF_PITCH,roofUndersideY,type BuildDefinition,type BuildPart} from './shed';
import {fasteningPatch,type FastenerProfile} from './fasteners';
import {transform,type Scenario} from './simulation';
export const SHEET_FIXING:FastenerProfile={name:'Sheet fixing',stiffness:1e6,damping:700,withdrawalN:400,shearN:800};
export function metalShedScenario():Scenario{return {...shedScenario(),id:'metal-shed',title:'12 / Build a sheet-metal shed',question:'Timber frame → steel wall sheets → pitched steel roof → seam cover strips.'};}
export function metalShedDefinition():BuildDefinition{
 const plan=shedPlan().filter(p=>p.stage<6);
 for(const entry of plan){
  if(entry.stage!==3)continue;
  const b=entry.box,t=.0015;
  if(b.size[0]===.04){b.position.x=Math.sign(b.position.x)*(1.5+t/2);b.size[0]=t;}
  else{b.position.z=Math.sign(b.position.z)*(1.2+t/2);b.size[2]=t;}
  b.id=b.id.replace('wall-','sheet-');b.material='Galvanized steel sheet (rigid)';b.density=7850;b.color=0x789a9e;entry.profile=SHEET_FIXING;entry.structural=false;
 }
 const rotation={x:-Math.sin(ROOF_PITCH/2),y:0,z:0,w:Math.cos(ROOF_PITCH/2)},origin={x:0,y:roofUndersideY(0),z:0};
 const roof=(id:string,x:number,width:number,normalOffset:number,stage:number):BuildPart=>({stage,structural:false,profile:SHEET_FIXING,connectTo:[],box:{id,size:[width,.0015,2.696],position:transform({x,y:normalOffset,z:0},rotation,origin),rotation,material:'Galvanized steel sheet (rigid)',density:7850,friction:.6,color:stage===6?0x688c94:0xa3bbc0}});
 const supports=plan.filter(p=>p.stage===5);
 for(let i=0;i<3;i++){
  const p=roof(`metal-roof-sheet-${i+1}`,(i-1)*1.08,1.078,.00075,6);
  for(const support of supports)try{fasteningPatch(p.box,support.box);p.connectTo.push(support.box.id);}catch{/* No shared face: not a fastening target. */}
  plan.push(p);
 }
 for(const [i,x] of [-.54,.54].entries()){
  const p=roof(`roof-seam-cover-${i+1}`,x,.04,.00225,7);p.connectTo=[`metal-roof-sheet-${i+1}`,`metal-roof-sheet-${i+2}`];plan.push(p);
 }
 return {plan,stages:['Bottom frame','Floor','Wall frame','Metal wall sheets','Top frame','Roof supports','Metal roof sheets','Roof seam covers'],rootId:'base-left',interval:.25,name:'Sheet-metal shed',note:'Timber frame with 1.5 mm galvanized steel wall and roof sheets. Roof falls 5° away from the entrance; raised cover strips bridge roof seams. Sheet fixings and timber grips can fail. Thin sheets remain rigid: no buckling, tearing geometry, corrosion or verified weather sealing. Capacities are experimental.'};
}
