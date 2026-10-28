// A 10 L drinking-water canister, in metres. 302 × 154 × 397 mm overall.
// Dimensions: https://rocksports.de/Kocher-Zubehoer/Wassersaecke-Trinksysteme/Kanister/Huenersdorff-Weithalskanister-10-L-natur::33151.html
// Internal contours, handle and moulded ribs are inferred; nominal capacity is 10 L.
import * as THREE from 'three';
import { assetKit } from '../assets/parts.js';
import { GEO } from '../assets/kit.js';
export function waterCanister() {
 const root = new THREE.Group(); root.name = '10 L water canister';
 const kit = assetKit(root, { assemblies: [{ id:'body', label:'Water container', note:'10 L portable water storage', out:[0,0,0] }], steps:['Body','Handle','Caps'] });
 const white = new THREE.MeshStandardMaterial({color:'#e9e6d7',roughness:0.58});
 const blue = new THREE.MeshStandardMaterial({color:'#397a9b',roughness:0.5});
 /** @param {string} id @param {string} label @param {THREE.BufferGeometry} geo @param {THREE.Material} mat @param {[number,number,number]} at */
 const part=(id,label,geo,mat,at)=>{const o=new THREE.Mesh(geo,mat);o.position.set(...at);kit.part(o,{id,label,assembly:'body',what:label,specs:id==='body'?[['Capacity','10 litres'],['Material','HDPE']]:[['Dimensions','Inferred']]});return o;};
 part('body','Moulded HDPE body',GEO.rbox(.302,.32,.154,.018),white,[0,.16,0]);
 for(const x of [-.062,.062]) part('handle-leg-'+(x<0?'left':'right'),'Integral handle support',new THREE.BoxGeometry(.025,.06,.033),white,[x,.35,0]);
 part('handle','Carry handle',GEO.rbox(.149,.025,.033,.009),white,[0,.3845,0]);
 part('neck','Wide filling neck',new THREE.CylinderGeometry(.046,.046,.032,32),white,[-.095,.331,.0]);
 part('cap','Blue screw cap',new THREE.CylinderGeometry(.05,.05,.024,32),blue,[-.095,.357,0]);
 const tap=part('outlet','Sealed water outlet',new THREE.CylinderGeometry(.013,.013,.016,16),blue,[.151,.045,0]);tap.rotation.z=Math.PI/2;
 for(const z of [-.078,.078]) for(const y of [.08,.17,.26]) part(`rib-${z<0?'front':'back'}-${Math.round(y*100)}`,'Moulded stiffening rib',GEO.rbox(.235,.009,.006,.002),white,[0,y,z]);
 kit.seal(); return root;
}
