// Silver birch, Betula pendula: a light, pale-barked pioneer with pointed leaves and hanging catkins.
// Stage ages are gameplay growth parameters, not a horticultural growth forecast.
import { wood } from './wald-canopy.js';
import { chance, span, tube, v3 } from './grow.js';
export const BIRCH_STAGES = [
 ['Winged seed',0],['Germination',14],['Seedling',35],['Sapling',365],['Young birch',1095],
 ['Catkins',1825],['Seed set',1840],['Green catkins',1880],['Golden leaves',1920],['Winged seeds',1950]
].map(([name,day])=>({name:String(name),day:Number(day),note:'A silver birch grows from the same seed through this stage.'}));
export const birch = wood({
 seed:{size:v3(.0012,.0004,.001),coat:'#ab8b50',shade:'#715a33',depth:.001},hypogeal:false,
 cotyledon:{length:.004,width:.0025,colour:'#86ab52'},
 roots:{tap:1.2,spread:3,count:8,radius:.045},
 flush:{trunk:1.8,trunkBorn:1.6,trunkFlush:1.2,scaffolds:[3,5],scaffoldAngle:.32,gens:6,flush:.16,rest:.08,
  shoot:(gen)=>[0,2.3,1.5,1,.75,.55,.4][gen]??.3,whorl:[2,3],spread:.5,up:.12,droop:.2,wander:.09,radius:.09,taper:.62,thicken:3,bark:['#eee9df','#d6d3ca']},
 leaf:{blade:{stalk:.018,length:.055,width:.034,shape:u=>Math.pow(Math.sin(Math.PI*u),.7)*(1-.5*u)*(1+.05*Math.sin(u*70)),along:4,bow:.04},
  colour:'#659345',young:'#a0be5e',autumn:'#d8b946',droop:.2,gap:.14,per:2,twig:.1,tuft:2,from:3,inner:2},
 bear({bag,g,seed,shoots}) {
  for(const sh of shoots.filter(x=>x.gen>=4)) {
   const r=chance(seed,'catkin',...sh.key); if(r()>.12) continue;
   const k=span(g,4.8,6); if(k<=0)continue;
   const at=sh.tip.clone(), end=at.clone().add(v3(.012,-.06*k,.008));
   bag.add('body',tube([at,end],()=>.004*k,()=>'#a18b46',5));
  }
 }
});
