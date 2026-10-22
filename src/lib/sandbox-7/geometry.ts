import type {V3, Quaternion} from './simulation';
export const v=(x=0,y=0,z=0):V3=>({x,y,z});
export const add=(a:V3,b:V3):V3=>v(a.x+b.x,a.y+b.y,a.z+b.z);
export const sub=(a:V3,b:V3):V3=>v(a.x-b.x,a.y-b.y,a.z-b.z);
export const mul=(a:V3,s:number):V3=>v(a.x*s,a.y*s,a.z*s);
export const dot=(a:V3,b:V3)=>a.x*b.x+a.y*b.y+a.z*b.z;
export const cross=(a:V3,b:V3):V3=>v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
export const length=(a:V3)=>Math.hypot(a.x,a.y,a.z);
export const unit=(a:V3)=>mul(a,1/length(a));
export const mean=(points:V3[])=>mul(points.reduce(add,v()),1/points.length);
export type Polyhedron={vertices:V3[];faces:number[][]};
/** Small authored convex solids. Coplanar hull triangles are collected into one face. */
export function hull(vertices:V3[]):Polyhedron {
 const faces:number[][]=[],seen=new Set<string>();
 for(let a=0;a<vertices.length;a++)for(let b=a+1;b<vertices.length;b++)for(let c=b+1;c<vertices.length;c++){
  let n=cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));if(length(n)<1e-9)continue;n=unit(n);
  let d=vertices.map(p=>dot(n,sub(p,vertices[a])));if(d.some(x=>x>1e-7)&&d.some(x=>x< -1e-7))continue;
  if(d.some(x=>x>1e-7)){n=mul(n,-1);d=d.map(x=>-x);}
  const ids=d.flatMap((x,i)=>Math.abs(x)<1e-7?[i]:[]),key=ids.join(',');if(seen.has(key))continue;seen.add(key);
  const center=mean(ids.map(i=>vertices[i])),u=unit(sub(vertices[ids[0]],center)),w=cross(n,u);
  // Coplanar input points can lie inside the face or on its edges. Sorting
  // all of them by angle creates a concave boundary and incorrect mass.
  const projected=ids.map(id=>({id,x:dot(sub(vertices[id],center),u),y:dot(sub(vertices[id],center),w)})).sort((a,b)=>a.x-b.x||a.y-b.y);
  type P=typeof projected[number];
  const turn=(a:P,b:P,c:P)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=(ps:P[])=>{const out:P[]=[];for(const p of ps){while(out.length>1&&turn(out.at(-2)!,out.at(-1)!,p)<=1e-10)out.pop();out.push(p);}return out;};
  const lower=half(projected),upper=half([...projected].reverse());
  faces.push([...lower.slice(0,-1),...upper.slice(0,-1)].map(p=>p.id));
 }
 return {vertices,faces};
}
export function polyVolume(p:Polyhedron){let volume=0;for(const face of p.faces)for(let i=1;i<face.length-1;i++)volume+=dot(p.vertices[face[0]],cross(p.vertices[face[i]],p.vertices[face[i+1]]))/6;return Math.abs(volume);}
/** Quaternion from a right-handed orthonormal frame (columns X,Y,Z). */
export function frameRotation(x:V3,y:V3,z:V3):Quaternion {
 const tr=x.x+y.y+z.z;let q:Quaternion;
 if(tr>0){const s=Math.sqrt(tr+1)*2;q={w:s/4,x:(y.z-z.y)/s,y:(z.x-x.z)/s,z:(x.y-y.x)/s};}
 else if(x.x>y.y&&x.x>z.z){const s=Math.sqrt(1+x.x-y.y-z.z)*2;q={w:(y.z-z.y)/s,x:s/4,y:(y.x+x.y)/s,z:(z.x+x.z)/s};}
 else if(y.y>z.z){const s=Math.sqrt(1+y.y-x.x-z.z)*2;q={w:(z.x-x.z)/s,x:(y.x+x.y)/s,y:s/4,z:(z.y+y.z)/s};}
 else{const s=Math.sqrt(1+z.z-x.x-y.y)*2;q={w:(x.y-y.x)/s,x:(z.x+x.z)/s,y:(z.y+y.z)/s,z:s/4};}return q;
}

/** Least-squares rigid rotation from corresponding attachment locations (Horn). */
export function fitRigidRotation(source:V3[],target:V3[]):Quaternion {
 const a=mean(source),b=mean(target),s=Array.from({length:3},()=>[0,0,0]);
 source.forEach((p,i)=>{
  const x=sub(p,a),y=sub(target[i],b),av=[x.x,x.y,x.z],bv=[y.x,y.y,y.z];
  for(let row=0;row<3;row++)for(let col=0;col<3;col++)s[row][col]+=av[row]*bv[col];
 });
 const [[xx,xy,xz],[yx,yy,yz],[zx,zy,zz]]=s;
 const n=[[xx+yy+zz,yz-zy,zx-xz,xy-yx],[yz-zy,xx-yy-zz,xy+yx,zx+xz],
  [zx-xz,xy+yx,-xx+yy-zz,yz+zy],[xy-yx,zx+xz,yz+zy,-xx-yy+zz]];
 const shift=Math.max(...n.map(row=>row.reduce((sum,x)=>sum+Math.abs(x),0)))+1e-12;
 // A tiny nonzero seed in every component also handles a half-turn rotation.
 let q=[1,1e-6,2e-6,3e-6];
 for(let i=0;i<100;i++){
  const next=n.map((row,j)=>row.reduce((sum,x,k)=>sum+x*q[k],shift*q[j])),norm=Math.hypot(...next);
  q=next.map(x=>x/norm);
 }
 return {w:q[0],x:q[1],y:q[2],z:q[3]};
}
