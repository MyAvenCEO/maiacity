import {shedScenario,type BuildDefinition} from './shed';
import {telescopicStand} from './telescopic-stand';
import {DOME_BOLT,domeDefinition} from './dome';
import {v} from './geometry';
import {verticesOf,transform,inverseRotation,type Box} from './simulation';
export const STAND_LAB_MIN_HEIGHT=1.253,STAND_LAB_MAX_HEIGHT=8.45;
export const STAND_HUBS={plate:'Simple test fitting',lower:'Lower dome hub',upper:'Upper dome hub',crown:'Crown dome hub'} as const;
export type StandSettings={heightM:number;loadKg:number;friction:number;hub?:keyof typeof STAND_HUBS};
export const DEFAULT_STAND_SETTINGS:StandSettings={heightM:2,loadKg:0,friction:.65,hub:'plate'};
export function standScenario(){return {...shedScenario(),id:'stand-lab',title:'14 / Telescopic stand laboratory',question:'Extend the same stand, add a bearing load, then test sliding, tipping and the head bolts.'};}
export function standDefinition(settings:StandSettings=DEFAULT_STAND_SETTINGS):BuildDefinition{
 const {heightM,loadKg,friction}=settings;
 if(!Number.isFinite(heightM)||heightM<STAND_LAB_MIN_HEIGHT||heightM>STAND_LAB_MAX_HEIGHT)throw Error(`Height must be ${STAND_LAB_MIN_HEIGHT}–${STAND_LAB_MAX_HEIGHT} m for this stand.`);
 if(!Number.isFinite(loadKg)||loadKg<0||!Number.isFinite(friction)||friction<0)throw Error('Load and friction must be finite non-negative values.');
 let hub:Box={id:'test-head-fitting',position:v(0,heightM+.226,0),size:[.08,.04,.08],density:7850,material:'Steel MP-80 test fitting (rigid)',color:0x7794a0,friction:.65,pieces:[{size:[.08,.04,.08],offset:v()}]};
 let stemTop=heightM+.226;
 const kind=settings.hub??'plate';if(!(kind in STAND_HUBS))throw Error('Unknown hub model.');
 if(kind!=='plate'){
  const recipe=domeDefinition(8),stage={lower:2,upper:3,crown:4}[kind];
  hub=structuredClone(recipe.plan.find(p=>p.stage===stage&&p.box.mountPoint)!.box);
  const oldMount=hub.mountPoint!;
  const shoulder=hub.pieces!.pop()!;stemTop=heightM+.2+shoulder.size[1];
  hub.rotation=inverseRotation(oldMount.orientation);
  const offset=transform(oldMount.position,hub.rotation,v());
  hub.position=v(-offset.x,heightM+.2-offset.y,-offset.z);
  hub.id='test-head-fitting';delete hub.mountPoint;
 }
 const stand=telescopicStand(hub,v(0,heightM+.2,0),'test-stand',0,11,.82,stemTop);stand.box.friction=friction;
 const foundation:Box={id:'stand-platform',position:v(0,.1,0),size:[4,.2,4],density:2400,material:'Concrete test platform (rigid)',color:0x96998d,friction:2};
 const plan:BuildDefinition['plan']=[{box:foundation,stage:0,connectTo:[]},stand,{box:hub,stage:0,connectTo:['test-stand'],profile:{...DOME_BOLT,name:'MP-80 head bolts'}}];
 if(loadKg>0)plan.push({box:{id:'test-load',position:v(hub.position.x,hub.position.y+Math.max(...verticesOf(hub).map(p=>p.y))+.15,hub.position.z),size:[.30,.30,.30],density:loadKg/.027,material:'Loose test weight (rigid)',color:0xb0a8a0,friction:.65},stage:0,connectTo:[]});
 return {experimentParameters:{heightM,loadKg,friction,hub:kind},name:'Telescopic stand test',plan,stages:['Stand test'],rootId:'stand-platform',interval:.12,solverIterations:16,internalPgsIterations:24,contactNaturalFrequency:120,allowedLinearError:.0001,note:'One 11-sleeve stand, 0.82 m stock sections. Height changes reset the trial. The loose load rests on the head fitting through contact. The foot is unanchored. Head bolts have finite experimental strength. The locked mast is rigid: sleeve bending, buckling and lock-pin failure are not modeled. A sideways push is an instantaneous impulse applied at the head fitting.'};
}
