// Same third settler, second frozen recipe. V1 remains in elder-woman.js.
import * as THREE from 'three';
import { elderWoman, ELDER_LOOK } from './elder-woman.js';

export function elderWomanV2() {
 const cast = elderWoman();
 const g = cast.rig.object.geometry;
 const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
 const old = new THREE.Color(ELDER_LOOK?.hairColour ?? '#ded3b1');
 const root = new THREE.Color('#8b7148'), blonde = new THREE.Color('#cfb780'), silver = new THREE.Color('#dfc991');
 const colour = new THREE.Color();
 // Only the separately coloured scalp hair and bun are changed. Skin, face, brows, morphs and rig are retained.
 for (let i=0; i<p.count; i++) {
  const distance = Math.abs(c.getX(i)-old.r)+Math.abs(c.getY(i)-old.g)+Math.abs(c.getZ(i)-old.b);
  if (distance > .012 || p.getY(i)<1.48) continue;
  const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
  const top=THREE.MathUtils.smoothstep(y,1.55,1.64);
  const sweep=x+.26*(z-.015)+.025;
  const lock=.5+.5*Math.sin(sweep*620 + z*35);
  const fine=.5+.5*Math.sin(sweep*1900+z*91);
  const part=Math.exp(-Math.pow(sweep/.0032,2));
  const lift=(.0008+.011*top+.0004*lock*top)*(1-.65*part);
  p.setXYZ(i,x+n.getX(i)*lift,y+n.getY(i)*lift,z+n.getZ(i)*lift);
  colour.copy(root).lerp(blonde,.50+.32*lock).lerp(silver,.12*fine);
  colour.lerp(root,.55*part);
  c.setXYZ(i,colour.r,colour.g,colour.b);
 }
 p.needsUpdate=true; c.needsUpdate=true;
 g.computeBoundingBox(); g.computeBoundingSphere();
 return cast;
}
