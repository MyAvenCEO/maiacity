/**
 * The placement module: the site as root space, spaces and faces made by assets, and where each
 * part of an asset sits. Assets write through the internal commands; everyone reads the port.
 */
import { command, defineModule, s, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import { FaceSchema, PlacedSchema, PlacementInSchema, SpaceSchema, type Face, type PlacementIn, type Side, type SpacePort, type Where } from './contract.ts';

export const SPACE_MODULE_ID = 'space';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** compass azimuth (deg clockwise from north) and tilt from horizontal (deg) of a normal (x east, y up, z south) */
export function orientation(normal: readonly [number, number, number]): { azimuth: number; tilt: number } {
  const [x, y, z] = normal;
  const len = Math.hypot(x, y, z) || 1;
  const tilt = (Math.acos(Math.max(-1, Math.min(1, y / len))) * 180) / Math.PI;
  const azimuth = Math.hypot(x, z) < 1e-9 ? 0 : (((Math.atan2(x, -z) * 180) / Math.PI) % 360 + 360) % 360;
  return { azimuth: Math.round(azimuth * 10) / 10, tilt: Math.round(tilt * 10) / 10 };
}

const compass = (azimuth: number): string => COMPASS[Math.round(azimuth / 45) % 8]!;

function sideLabel(read: ReadCtx, side: Side): string {
  if (side === 'outside') return 'the open air';
  if (side === 'ground') return 'the ground';
  return `'${read.get('Space', side)?.label ?? side}'`;
}

function exposedOf(read: ReadCtx, side: Side): Where['exposedTo'] {
  if (side === 'outside' || side === 'ground') return side;
  return { space: side, label: read.get('Space', side)?.label ?? side };
}

function faceWords(face: Face): string {
  const o = orientation(face.normal);
  const facing = o.tilt < 5 ? 'facing up' : o.tilt > 175 ? 'facing down' : `facing ${compass(o.azimuth)}`;
  const slope = o.tilt < 5 || o.tilt > 175 ? 'horizontal' : Math.abs(o.tilt - 90) < 5 ? 'vertical' : `tilted ${Math.round(o.tilt)}°`;
  return `'${face.label}' (${Math.round(face.area)} m², ${facing}, ${slope})`;
}

export function describe(read: ReadCtx, at: PlacementIn): Omit<Where, 'part' | 'label'> {
  if ('space' in at) {
    const sp = read.get('Space', at.space);
    const parent = sp?.parent ? read.get('Space', sp.parent) : undefined;
    return { in: at, description: `in '${sp?.label ?? at.space}'${parent ? ` (in '${parent.label}')` : ''}`, exposedTo: { space: at.space, label: sp?.label ?? at.space } };
  }
  if ('face' in at) {
    const face = read.get('Face', at.face);
    if (!face) return { in: at, description: `on face ${at.face}`, exposedTo: 'outside' };
    const mine = face.between[at.side];
    return {
      in: at,
      description: `on the side of ${faceWords(face)} towards ${sideLabel(read, mine)}, between ${sideLabel(read, face.between[0])} and ${sideLabel(read, face.between[1])}`,
      exposedTo: exposedOf(read, mine),
      orientation: orientation(face.normal),
    };
  }
  const depth = `${Math.round(at.depth * 100)} cm`;
  const thick = at.thickness !== undefined ? `, ${Math.round(at.thickness * 100)} cm thick` : '';
  const under = at.under ? read.get('Face', at.under) : undefined;
  return { in: at, description: `in the ${at.medium} ${depth} below ${under ? `'${under.label}'` : 'the surface'}${thick}`, exposedTo: at.medium };
}

const spacePort = (read: ReadCtx): SpacePort => ({
  site() {
    const site = read.state('space').site;
    if (!site) throw new Error('space: the site has not been set up');
    return site;
  },
  spacesOf: (owner) => [...read.all('Space')].filter(([, sp]) => sp.owner === owner),
  facesOf: (owner) => [...read.all('Face')].filter(([, f]) => f.owner === owner),
  where(owner, part) {
    const placed = read.get('Placed', owner);
    if (!placed) return [];
    const out: Where[] = [];
    for (const [id, p] of Object.entries(placed.parts)) {
      if (part !== undefined && id !== part) continue;
      for (const at of p.in) out.push({ part: id, label: p.label, ...describe(read, at) });
    }
    return out;
  },
});

const requireSide = (ctx: WriteCtx, side: string): void => {
  if (side !== 'outside' && side !== 'ground' && !ctx.get('Space', side)) ctx.reject('space.unknownSpace', { space: side });
};

export const spaceModule = defineModule({
  id: SPACE_MODULE_ID,
  label: 'Placement (spaces, faces, media)',
  description: 'Where every component sits: the site, the spaces and faces assets make, and the media below.',
  provides: ['space'],
  components: { Space: SpaceSchema, Face: FaceSchema, Placed: PlacedSchema },
  state: { initial: () => ({ site: null }) },
  blockers: {
    'space.unknownSpace': 'There is no space {space}.',
    'space.unknownFace': 'There is no face {face}.',
    'space.badNormal': 'A face needs a unit normal (x, y, z).',
  },
  setup(ctx) {
    const site = ctx.spawn('space', { name: 'Site' });
    ctx.set('Space', site, { kind: 'site', label: 'The site', parent: null, owner: null });
    ctx.setState('space', { site });
  },
  commands: {
    'space.create': command(
      s.object({ kind: s.string(), label: s.string(), owner: s.string(), parent: s.ref('Space').optional(), volume: s.number({ min: 0, unit: 'm3' }).optional() }),
      (ctx, p) => {
        const parent = p.parent ?? ctx.state('space').site!;
        if (!ctx.get('Space', parent)) ctx.reject('space.unknownSpace', { space: parent });
        const id = ctx.spawn('space', { name: p.label });
        ctx.set('Space', id, { kind: p.kind, label: p.label, parent, owner: p.owner, ...(p.volume !== undefined ? { volume: p.volume } : {}) });
        return id;
      },
      { label: 'Create a space', internal: true },
    ),
    'space.addFace': command(
      s.object({ kind: s.string(), label: s.string(), owner: s.string(), area: s.number({ min: 0, unit: 'm2' }), normal: s.array(s.number()), between: s.array(s.string()) }),
      (ctx, p) => {
        const n = p.normal;
        if (n.length !== 3 || Math.abs(Math.hypot(n[0]!, n[1]!, n[2]!) - 1) > 1e-6) ctx.reject('space.badNormal');
        for (const side of p.between) requireSide(ctx, side);
        const id = ctx.spawn('face', { name: p.label });
        ctx.set('Face', id, { kind: p.kind, label: p.label, owner: p.owner, area: p.area, normal: [n[0]!, n[1]!, n[2]!], between: [p.between[0]!, p.between[1]!] });
        return id;
      },
      { label: 'Add a face', internal: true },
    ),
    'space.place': command(
      s.object({ owner: s.string(), part: s.string(), label: s.string(), in: s.array(PlacementInSchema) }),
      (ctx, p) => {
        for (const at of p.in) {
          if ('space' in at && !ctx.get('Space', at.space)) ctx.reject('space.unknownSpace', { space: at.space });
          if ('face' in at && !ctx.get('Face', at.face)) ctx.reject('space.unknownFace', { face: at.face });
          if ('under' in at && at.under && !ctx.get('Face', at.under)) ctx.reject('space.unknownFace', { face: at.under });
        }
        const placed = ctx.get('Placed', p.owner) ?? { parts: {} };
        ctx.set('Placed', p.owner, { parts: { ...placed.parts, [p.part]: { label: p.label, in: p.in } } });
      },
      { label: 'Place a part of an asset', internal: true },
    ),
    'space.unplace': command(
      s.object({ owner: s.string(), part: s.string() }),
      (ctx, p) => {
        const placed = ctx.get('Placed', p.owner);
        if (!placed?.parts[p.part]) return;
        const { [p.part]: _gone, ...parts } = placed.parts;
        ctx.set('Placed', p.owner, { parts });
      },
      { label: 'Take a part of an asset away', internal: true },
    ),
    'space.release': command(
      s.object({ owner: s.string() }),
      (ctx, p) => {
        for (const [id, f] of [...ctx.all('Face')]) if (f.owner === p.owner) ctx.destroy(id);
        for (const [id, sp] of [...ctx.all('Space')]) if (sp.owner === p.owner) ctx.destroy(id);
        if (ctx.get('Placed', p.owner)) ctx.remove('Placed', p.owner);
      },
      { label: 'Release the spaces and faces of an asset', internal: true },
    ),
  },
  ports: { space: spacePort },
  projections: {
    'space.where': {
      label: 'Where the parts of an asset sit',
      description: 'args: owner — the id of something whose parts are placed in space (a building’s or a road’s elements). Stores, kits and machines have no placed parts: the answer is [] for them.',
      compute: (read, args) => read.port('space').where(String(args.owner)),
    },
  },
});
