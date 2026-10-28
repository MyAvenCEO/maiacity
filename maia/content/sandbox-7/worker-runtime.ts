import { Simulation, Playback, type Scenario, type Box, type V3, transform } from './simulation';
import { ShedBuild, type BuildDefinition, type FailureEvent, type Connection } from './shed';
import { brickHouseDefinition } from './brick-house';
import { metalShedDefinition } from './metal-shed';
import { domeDefinition, type DomeSettings } from './dome';
import {standDefinition,type StandSettings} from './stand-lab';
import { industrialHallDefinition } from './industrial-hall';
import { germanHouseDefinition } from './german-house';
import { Wind, type WindSettings, type WindLoad } from './wind';

export type Command =
  | {type:'push-stand';impulseNs:number;direction:'x'|'z'}
  | { type: 'reset'; scenario: Scenario; diameter: number; domeSettings?:DomeSettings; standSettings?:StandSettings; validate?: boolean }
  | { type: 'advance'; elapsed: number }
  | { type: 'run'; running: boolean }
  | { type: 'speed'; speed: number }
  | { type: 'step' | 'place' | 'stop' | 'export' }
  | { type: 'start'; mode: 'stage' | 'all' }
  | { type: 'release' | 'select'; id: string }
  | { type: 'wind'; settings: WindSettings };
export type WireConnection = Omit<Connection, 'joint' | 'grip'> & { grip?: { profile: NonNullable<Connection['grip']>['profile']; intact: number; points: Omit<NonNullable<Connection['grip']>['points'][number], 'joint'>[] } };
export type Snapshot = {
  ticks: number; dt: number; mass: number; running: boolean; speed: number;
  specs?: Box[]; poses: Float64Array;
  initial?: { scenario: Scenario; definition?: BuildDefinition; plan?: ShedBuild['plan']; stages?: readonly string[] };
  contacts?: ReturnType<Simulation['contacts']>;
  wind: { settings: WindSettings; total: V3; selected?: WindLoad };
  selected: string;
  build?: { count: number; suppliedMass: number; withdrawnMass:number; withdrawnParts:string[]; standInventory:ShedBuild['standInventory']; altered: boolean; automatic: boolean; connectionCount: number; failedCount: number; connections: WireConnection[]; failures: FailureEvent[]; markers: V3[] };
};
export type Request = { epoch: number; request: number; command: Command };
export type Reply = { epoch: number; request: number; snapshot?: Snapshot; record?: unknown; error?: string };

/** Same simulation used headlessly, owned exclusively by the worker in the UI. */
export class WorkerRuntime {
  sim?: Simulation;
  build?: ShedBuild;
  wind?: Wind;
  playback?: Playback;
  selected = 'ground';
  private topology = '';
  private lastDetails = -Infinity;
  private initial = false;
  execute(command: Command): { snapshot?: Snapshot; record?: unknown } {
    if (command.type === 'reset') {
      const next = new Simulation(command.scenario);
      try {
        if (command.validate) {
          const parts = [...next.parts.values()];
          for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
            for (const ca of parts[a].colliders) for (const cb of parts[b].colliders) {
              const contact = ca.contactCollider(cb, 0);
              if (contact && contact.distance < -.0001) throw Error(`Starting overlap: ${parts[a].spec.id} / ${parts[b].spec.id}. Move or resize the part first.`);
            }
          }
        }
        const definition = command.scenario.id === 'german-house' ? germanHouseDefinition() : command.scenario.id === 'industrial-hall' ? industrialHallDefinition() : command.scenario.id === 'stand-lab' ? standDefinition(command.standSettings) : command.scenario.id === 'dome' ? domeDefinition(command.diameter,{settings:command.domeSettings}) : command.scenario.id === 'metal-shed' ? metalShedDefinition() : command.scenario.id === 'brick-house' ? brickHouseDefinition() : undefined;
        const build = definition || command.scenario.id === 'shed' ? new ShedBuild(next, definition) : undefined;
        if(command.scenario.id==='stand-lab'&&build)while(!build.complete)build.placeNext();
        this.sim?.dispose(); this.sim = next; this.build = build;
        this.wind = new Wind(next); this.playback = new Playback(next);
        this.selected = build ? 'ground' : next.parts.has(this.selected) ? this.selected : next.parts.has('board') ? 'board' : next.parts.keys().next().value!;
        this.initial = true; this.topology = ''; this.lastDetails = -Infinity;
      } catch (error) { next.dispose(); throw error; }
    } else {
      const sim = this.sim!, playback = this.playback!, build = this.build;
      switch (command.type) {
        case 'push-stand': {
          if(sim.scenario.id!=='stand-lab'||!Number.isFinite(command.impulseNs))throw Error('Invalid stand push');
          const impulse={x:command.direction==='x'?command.impulseNs:0,y:0,z:command.direction==='z'?command.impulseNs:0};
          sim.body('test-head-fitting').applyImpulse(impulse,true);build!.events.push({tick:sim.ticks,action:'test-impulse',part:'test-head-fitting',impulse,massInKg:0,connections:[]});playback.running=true;break;
        }
        case 'advance': {
          const start=performance.now();
          playback.advance(command.elapsed,1);
          // Small worlds can execute several fixed ticks per render frame.
          // Large worlds yield between expensive ticks so commands stay usable.
          for(let i=1;i<8&&playback.running&&playback.pendingSeconds>=sim.dt&&performance.now()-start<8;i++)playback.advance(0,1);
          break;
        }
        case 'run': playback.running = command.running; break;
        case 'speed': playback.speed = command.speed; break;
        case 'step': if (!playback.running) sim.step(); break;
        case 'place': build?.placeNext(); break;
        case 'start': build?.start(command.mode); playback.running = true; break;
        case 'stop': build?.stop(); break;
        case 'release': if (build?.release(command.id)) playback.running = true; break;
        case 'select': if (sim.parts.has(command.id)) this.selected = command.id; break;
        case 'wind': this.wind!.configure(command.settings); this.wind!.measure(); break;
        case 'export': return { record: { engine: 'Rapier 0.21.0', timestep: sim.dt, scenario: sim.scenario, construction: build?.record(), wind: this.wind!.record(), ticks: sim.ticks, bodies: sim.state(), contacts: sim.contacts() } };
      }
    }
    return { snapshot: this.snapshot(command.type !== 'advance') };
  }
  snapshot(forceDetails = false): Snapshot {
    const sim = this.sim!, build = this.build, wind = this.wind!, playback = this.playback!;
    const entries = [...sim.parts.values()], topology = entries.map(p => p.spec.id).join('|'), changed = topology !== this.topology;
    if (changed && build?.count) this.selected = sim.scenario.id==='stand-lab'?'test-stand':build.plan[build.count - 1].box.id;
    if (!sim.parts.has(this.selected)) this.selected = sim.parts.has('ground') ? 'ground' : entries[0].spec.id;
    const poses = new Float64Array(entries.length * 20);
    entries.forEach(({body}, i) => {
      const p = body.translation(), q = body.rotation(), v = body.linvel(), w = body.angvel(), c = body.worldCom(), inertia = body.principalInertia();
      poses.set([p.x,p.y,p.z,q.x,q.y,q.z,q.w,v.x,v.y,v.z,w.x,w.y,w.z,c.x,c.y,c.z,inertia.x,inertia.y,inertia.z,body.mass()], i*20);
    });
    const total = {x:0,y:0,z:0}; for (const load of wind.loads.values()) { total.x+=load.force.x;total.y+=load.force.y;total.z+=load.force.z; }
    const now = performance.now(), details = forceDetails || changed || now - this.lastDetails >= 100;
    const result: Snapshot = { ticks: sim.ticks, dt: sim.dt, mass: sim.mass, poses, running: playback.running, speed: playback.speed, selected: this.selected,
      specs: changed ? entries.map(p => p.spec) : undefined,
      initial: this.initial ? {scenario:sim.scenario, definition:build?.definition, plan:build?.plan, stages:build?.stages} : undefined,
      contacts: details ? sim.contacts() : undefined,
      wind: {settings:wind.settings,total,selected:wind.loads.get(this.selected)},
      build: build ? { count:build.count, suppliedMass:build.suppliedMass, withdrawnMass:build.withdrawnMass, withdrawnParts:[...build.withdrawnParts], standInventory:build.standInventory, altered:build.altered, automatic:build.automatic,
        connectionCount:build.connections.size, failedCount:build.failedConnections.size,
        connections:[...build.connections.values()].filter(c=>c.a===this.selected||c.b===this.selected).map(({joint,grip,...c})=>({...c,grip:grip?{profile:grip.profile,intact:grip.intact,points:grip.points.map(({joint,...p})=>p)}:undefined})),
        failures:build.failures,markers:build.failures.map(f=>{
          const c=build.connectionHistory.get(f.connection)!, onB=sim.parts.get(c.b)?.spec.material.startsWith('Wood'), body=sim.parts.get(onB?c.b:c.a)?.body;
          const point=c.grip!.points[f.point];return body?transform(onB?point.anchorB:point.anchorA,body.rotation(),body.translation()):{x:0,y:-1000,z:0};
        }) } : undefined };
    this.topology = topology; this.initial = false; if(details)this.lastDetails=now;
    return result;
  }
  dispose() { this.sim?.dispose(); this.sim=undefined; }
}
