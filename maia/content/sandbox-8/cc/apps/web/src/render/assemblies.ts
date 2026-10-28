/** Presentation assembly definitions, ready for a future physical maintenance model.
 * These are generic visual/maintenance estimates, not manufacturer service instructions.
 * They do not create simulation parts or authorize any world-changing operation.
 */
export type EngineAsset = 'engineDiesel' | 'engineCompactDiesel' | 'engineTwoStroke' | 'engineFourStroke';
export interface EngineMount {
  asset: EngineAsset;
  parent: 'body' | 'house';
  position: readonly [number, number, number];
  scale: number;
  access: { part: string; state: 'open' | 'removed' };
  connections: readonly string[];
  support: 'hoist' | 'bench';
}
const diesel = (position: EngineMount['position'], scale = 1, parent: EngineMount['parent'] = 'body'): EngineMount => ({
  asset: 'engineDiesel', parent, position, scale, access: { part: 'engineCover', state: 'open' },
  connections: ['fuel', 'coolant', 'electrical', 'exhaust', 'drive'], support: 'hoist',
});

export const engineMounts: Readonly<Record<string, EngineMount>> = {
  excavator: diesel([-1.15, .35, -.1], 1.1, 'house'),
  miniExcavator: diesel([-1.15, .35, -.1], 1.1, 'house'),
  wheeledExcavator: diesel([-1.15, .35, -.1], 1.1, 'house'),
  wheelLoader: diesel([-2.25, 1.87, 0], .9),
  dozer: diesel([.7, 1.3, 0], .85),
  grader: diesel([-2.3, 1.3, 0]),
  soilRoller: diesel([-1.3, 1.2, 0], .8),
  tandemRoller: diesel([0, 1.05, 0], .65),
  paver: diesel([-.85, 1.05, 0], .9),
  tipper: { ...diesel([2.8, 1.03, 0]), access: { part: 'cab', state: 'open' } },
  supplier: { ...diesel([2.8, 1.03, 0]), access: { part: 'cab', state: 'open' } },
  flatbed: { ...diesel([2.8, 1.03, 0]), access: { part: 'cab', state: 'open' } },
  waterTruck: { ...diesel([2.55, 1.03, 0]), access: { part: 'cab', state: 'open' } },
  mixer: { ...diesel([2.55, 1.03, 0]), access: { part: 'cab', state: 'open' } },
  lowLoader: { ...diesel([4.8, 1.03, 0]), access: { part: 'cab', state: 'open' } },
  van: { ...diesel([1.8, .62, 0], .65), access: { part: 'bonnet', state: 'open' } },
  car: { ...diesel([1.55, .40, 0], .62), asset: 'engineCompactDiesel', access: { part: 'bonnet', state: 'open' } },
  generator: { asset: 'engineFourStroke', parent: 'body', position: [-.06, .06, 0], scale: 1, access: { part: 'serviceCover', state: 'removed' }, connections: ['fuel', 'electrical', 'exhaust', 'alternator'], support: 'bench' },
  lightTower: diesel([-.3, .55, 0], .6),
  chainsaw: { asset: 'engineTwoStroke', parent: 'body', position: [-.13, .035, 0], scale: .85, access: { part: 'housing', state: 'removed' }, connections: ['fuel', 'ignition', 'throttle', 'clutch'], support: 'bench' },
};

export interface AssemblyState {
  parts: Readonly<Record<string, 'closed' | 'open' | 'removed'>>;
  disconnected: readonly string[];
  mountsReleased: boolean;
  support?: 'hoist' | 'bench';
}

/** Requirements for the model preview / future integration; never a substitute for kernel work. */
export function engineRemovalBlockers(mount: EngineMount, state: AssemblyState): string[] {
  const access = state.parts[mount.access.part];
  const blockers: string[] = [];
  if (access !== 'removed' && access !== mount.access.state) blockers.push(`${mount.access.part} must be ${mount.access.state}`);
  for (const connection of mount.connections) if (!state.disconnected.includes(connection)) blockers.push(`Disconnect ${connection}`);
  if (!state.mountsReleased) blockers.push('Release engine mounts');
  if (state.support !== mount.support) blockers.push(`Support engine with ${mount.support}`);
  return blockers;
}
