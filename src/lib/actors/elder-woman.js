// Frozen casting for V2's third settler: an older woman, 1.64 m, pale skin and silver-blonde hair.
// Reuses the stand-in's rig, friendly expression and clips. Fine forehead and cheek creases travel with its skin.
import { human } from './human';
/** @type {Parameters<typeof human>[0]} */
export const ELDER_LOOK = { face:'woman', skin:'#ead1bb', hair:'bun', hairColour:'#ded3b1', brows:'#b7aa8c', iris:'#73909a', lips:'#ae8079', shirt:'#71965b', trousers:'#59544d' };
export function elderWoman() {
 const cast=human(ELDER_LOOK,1.64,10);
 cast.rig.object.traverse(o=>{
  const g=/** @type {import('three').Mesh} */ (o).geometry, p=g?.getAttribute('position'), c=g?.getAttribute('color'), n=g?.getAttribute('normal');
  if(!p||!c||!n) return;
  for(let i=0;i<p.count;i++) {
   const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
   if(z<.025||n.getZ(i)<.4||Math.abs(x)>.065||y<1.43||y>1.59) continue;
   const forehead=Math.exp(-Math.pow((y-1.56)/.002,2)) + .7*Math.exp(-Math.pow((y-1.575)/.002,2));
   const cheek=Math.exp(-Math.pow((Math.abs(x)-(.025+(1.50-y)*.45))/.002,2))*Math.exp(-Math.pow((y-1.48)/.025,2));
   const shade=1-Math.min(.15,.10*forehead+.08*cheek);
   c.setXYZ(i,c.getX(i)*shade,c.getY(i)*shade,c.getZ(i)*shade);
  }
  c.needsUpdate=true;
 });
 return cast;
}
