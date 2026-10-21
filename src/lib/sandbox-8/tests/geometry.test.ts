// @ts-nocheck — run by bun test, not type-checked, as the app's other tests
import {expect,test} from 'vitest';
import {fitRigidRotation,v,mean,sub,add,length,hull,polyVolume} from '../geometry';
import {transform} from '../simulation';
test.each([.4,Math.PI])('panel fitting recovers rigid translation and rotation %s',angle=>{
 const points=[v(-2,-1,0),v(3,-1,0),v(0,2,0),v(1,1,0)],rotation={x:Math.sin(angle/2),y:0,z:0,w:Math.cos(angle/2)},target=points.map(p=>transform(p,rotation,v(1,2,3)));
 const fit=fitRigidRotation(points,target),a=mean(points),b=mean(target);
 for(let i=0;i<points.length;i++)expect(length(sub(add(b,transform(sub(points[i],a),fit,v())),target[i]))).toBeLessThan(1e-6);
});
test('convex face hull excludes coplanar interior and collinear points',()=>{
 const points=[0,1].flatMap(x=>[0,1].flatMap(y=>[0,1].map(z=>v(x,y,z))));
 points.push(v(.5,.5,0),v(.5,0,0));const poly=hull(points);
 expect(poly.faces).toHaveLength(6);expect(poly.faces.every(face=>face.length===4)).toBe(true);expect(polyVolume(poly)).toBeCloseTo(1,10);
});
