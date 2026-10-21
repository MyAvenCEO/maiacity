import {describe,it,expect} from 'vitest';
import {partsCatalog,boundsOf,massOf,geometryDetails,previewSpec,partGeometryRecord} from '../src/parts-catalog';
import {industrialHallDefinition} from '../src/industrial-hall';
import {germanHouseDefinition} from '../src/german-house';
import {shedPlan} from '../src/shed';
import {brickHouseDefinition} from '../src/brick-house';
import {metalShedDefinition} from '../src/metal-shed';
import {domeDefinition} from '../src/dome';
import {standDefinition,DEFAULT_STAND_SETTINGS} from '../src/stand-lab';
import type {BuildDefinition,BuildPart} from '../src/shed';

describe('assembly parts catalogue',()=>{
  it('maps every placement once for each building, including unplaced components',()=>{
    for(const definition of [{plan:shedPlan()},brickHouseDefinition(),metalShedDefinition(),domeDefinition(),standDefinition(DEFAULT_STAND_SETTINGS),industrialHallDefinition(),germanHouseDefinition()]){
      const groups=partsCatalog(definition.plan,definition as BuildDefinition);
      expect(groups.flatMap(g=>g.instances.map(p=>p.box.id)).sort()).toEqual(definition.plan.filter(p=>!p.box.fixed).map(p=>p.box.id).sort());
      for(const g of groups){expect(g.quantity).toBeGreaterThan(0);expect(g.massKg).toBeGreaterThan(0);expect(boundsOf(g.spec).size.every(n=>n>0)).toBe(true);}
    }
  });
  it('groups repeated boards but distinguishes notched boards from plain boards',()=>{
    const groups=partsCatalog(shedPlan());
    const plain=groups.find(g=>g.instances.some(p=>p.box.id==='floor-board-2'))!;
    expect(plain.quantity).toBe(6);
    expect(groups.find(g=>g.instances.some(p=>p.box.id==='floor-board-1'))).not.toBe(plain);
    expect(groups.find(g=>g.instances.some(p=>p.box.id==='floor-board-8'))).not.toBe(plain);
    expect(geometryDetails(shedPlan().find(p=>p.box.id==='floor-board-8')!.box)).toContain('Solid regions');
  });
  it('ignores world pose and IDs without rounding away different cuts or materials',()=>{
    const a=shedPlan()[0],b=structuredClone(a);b.box.id='copy';b.box.position.x=18;b.box.angle=1;
    expect(partsCatalog([a,b])).toHaveLength(1);
    b.box.size=[a.box.size[2],a.box.size[1],a.box.size[0]];expect(partsCatalog([a,b])).toHaveLength(1);b.box.size=[...a.box.size];
    b.box.size[0]+=.000001;expect(partsCatalog([a,b])).toHaveLength(2);
    b.box.size=[...a.box.size];b.box.material='Other';expect(partsCatalog([a,b])).toHaveLength(2);
  });
  it('uses actual compound extents, not the nominal size field, and mixed densities',()=>{
    const box={...shedPlan()[0].box,size:[1,1,1] as [number,number,number],pieces:[{size:[2,1,1] as [number,number,number],offset:{x:3,y:0,z:0}},{size:[1,1,1] as [number,number,number],offset:{x:0,y:0,z:0}}],shapeDensities:[100,200]};
    expect(boundsOf(box).size).toEqual([4.5,1,1]);expect(massOf(box)).toBe(400);
  });
  it('groups all telescope extensions as one stock model and counts peak concurrent equipment',()=>{
    const d=domeDefinition();const groups=partsCatalog(d.plan,d),stands=groups.filter(g=>g.reusable);
    expect(stands).toHaveLength(1);expect(stands[0].instances.length).toBe(d.temporaryProps!.length);
    expect(stands[0].quantity).toBeLessThan(stands[0].instances.length);
    const [a,b,c]=stands[0].instances.map(p=>structuredClone(p));
    const dummy={...shedPlan()[0],box:{...shedPlan()[0].box,id:'release'}} as BuildPart;
    const fixture={...d,plan:[a,b,dummy,c],temporaryProps:[a.box.id,b.box.id,c.box.id],temporarySupportGroups:[],withdrawShoringAfterStage:99,shoringReleaseAfter:[{afterPart:'release',parts:[a.box.id]}]};
    expect(partsCatalog(fixture.plan,fixture).find(g=>g.reusable)!.quantity).toBe(2);
  });
  it('groups congruent inclined panels and displays their true thickness without changing physics geometry',()=>{
    const d=domeDefinition(),before=JSON.stringify(d.plan),groups=partsCatalog(d.plan,d);
    const windows=groups.filter(g=>g.spec.opacity!==undefined);
    expect(windows).toHaveLength(1);expect(windows[0].quantity).toBe(12);
    expect(boundsOf(previewSpec(windows[0].spec)).size[2]).toBeCloseTo(.006,9);
    expect(JSON.stringify(d.plan)).toBe(before);
  });
  it('exports every hub solid at full precision in mm with its assembly quantity',()=>{
    const d=domeDefinition(),group=partsCatalog(d.plan,d).find(g=>g.spec.id.startsWith('dome-hub'))!,record=partGeometryRecord(group);
    expect(record.units).toBe('mm');expect(record.solids.length).toBeGreaterThan(1);
    const [a,b]=record.solids[0].vertices,[c,dv]=group.spec.polyhedron!.vertices;
    expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeCloseTo(Math.hypot(c.x-dv.x,c.y-dv.y,c.z-dv.z)*1000,8);
    expect(record.sourceSpecMetres).toEqual(group.spec);expect(record.quantity).toBe(group.quantity);
    expect(record.fabricationStatus).toContain('Reference geometry only');
  });
  it('regenerates counts and dimensions for changed dome settings',()=>{
    const a=domeDefinition(8),b=domeDefinition(16);
    const ca=partsCatalog(a.plan,a),cb=partsCatalog(b.plan,b);
    expect(cb.flatMap(g=>g.instances).length).toBeGreaterThan(ca.flatMap(g=>g.instances).length);
    expect(boundsOf(cb.find(g=>g.spec.id==='dome-foundation')!.spec).size[0]).toBeGreaterThan(boundsOf(ca.find(g=>g.spec.id==='dome-foundation')!.spec).size[0]);
  });
});
