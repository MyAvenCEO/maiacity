/**
 * Placement contract (decision 0014; design/foundations.md §4).
 *
 * Everything that ages or acts sits somewhere: in a space (a room, a cavity, the site's open
 * air), on one side of a face (a façade, a roof plane, a road surface), or in a medium at a depth
 * (a road's base course in the ground). Where a thing sits decides what it is exposed to: an
 * untreated board inside a roof space and the same board as cladding on a south-west façade are
 * one material in two exposures.
 *
 * - The site is the root space. "outside" is the site's open air; "ground" is the medium below.
 * - Assets (buildings, roads, later fields) create spaces and faces as they are realised and
 *   place their parts. A part may sit in several places (a wall on four façades).
 * - Kinds are descriptive only; no model branches on them (decisions 0009, 0014).
 */
import { s, type EntityId, type Schema } from '../../kernel/src/index.ts';

/** one side of a face: a space, the site's open air, or the ground */
export type Side = EntityId | 'outside' | 'ground';

export type PlacementIn =
  | { space: EntityId }
  /** on a face: side 0 or 1 of its `between` */
  | { face: EntityId; side: 0 | 1 }
  /** in a medium: the top of the part at `depth` m below the surface, `thickness` m deep, under a face */
  | { medium: 'ground' | 'water'; depth: number; thickness?: number; under?: EntityId };

export const PlacementInSchema = s.union(
  s.object({ space: s.ref('Space') }),
  s.object({ face: s.ref('Face'), side: s.int({ min: 0, max: 1 }) }),
  s.object({ medium: s.enum(['ground', 'water']), depth: s.number({ min: 0, unit: 'm' }), thickness: s.number({ min: 0, unit: 'm' }).optional(), under: s.ref('Face').optional() }),
) as unknown as Schema<PlacementIn>;

export interface Space {
  kind: string;
  label: string;
  /** the enclosing space (null: the site itself) */
  parent: EntityId | null;
  /** m³, when enclosed */
  volume?: number;
  /** the asset that made it (null: the site) */
  owner: EntityId | null;
}

export const SpaceSchema = s.object({
  kind: s.string(),
  label: s.string(),
  parent: s.nullable(s.ref('Space')),
  volume: s.number({ min: 0, unit: 'm3' }).optional(),
  owner: s.nullable(s.string()),
}) as unknown as Schema<Space>;

export interface Face {
  kind: string;
  label: string;
  owner: EntityId;
  /** m² */
  area: number;
  /** unit normal pointing from side 0 into side 1 (x east, y up, z south): orientation for sun, driving rain and wind */
  normal: [number, number, number];
  /** what the face separates: side 0, side 1 */
  between: [Side, Side];
}

export const FaceSchema = s.object({
  kind: s.string(),
  label: s.string(),
  owner: s.string(),
  area: s.number({ min: 0, unit: 'm2' }),
  normal: s.array(s.number()),
  between: s.array(s.string()),
}) as unknown as Schema<Face>;

export interface Part {
  label: string;
  in: PlacementIn[];
}

/** component on an asset: where each of its parts sits */
export interface Placed {
  parts: Record<string, Part>;
}

export const PlacedSchema = s.object({ parts: s.record(s.object({ label: s.string(), in: s.array(PlacementInSchema) })) }) as unknown as Schema<Placed>;

/** a placement in words and numbers, for inspectors and agents */
export interface Where {
  part: string;
  label: string;
  in: PlacementIn;
  /** e.g. "on the outside of 'South-west façade' (34 m², facing SW, vertical), between 'Ground floor' and the open air" */
  description: string;
  /** what the part meets on its exposed side: the open air, the ground, or an enclosed space */
  exposedTo: 'outside' | 'ground' | 'water' | { space: EntityId; label: string };
  /** for faces: compass azimuth of the normal (deg clockwise from north) and tilt from horizontal (deg) */
  orientation?: { azimuth: number; tilt: number };
}

export interface SpacePort {
  /** the site: the root space */
  site(): EntityId;
  spacesOf(owner: EntityId): [EntityId, Space][];
  facesOf(owner: EntityId): [EntityId, Face][];
  /** where the parts of an asset sit (all parts, or one) */
  where(owner: EntityId, part?: string): Where[];
}

export interface SpaceState {
  site: EntityId | null;
}

declare module '../../kernel/src/index.ts' {
  interface ComponentTypes {
    Space: Space;
    Face: Face;
    Placed: Placed;
  }
  interface PortTypes {
    space: SpacePort;
  }
  interface ModuleStateTypes {
    space: SpaceState;
  }
  interface CommandTypes {
    'space.create': { payload: { kind: string; label: string; owner: EntityId; parent?: EntityId; volume?: number }; result: EntityId };
    'space.addFace': { payload: Omit<Face, 'between'> & { between: [Side, Side] }; result: EntityId };
    'space.place': { payload: { owner: EntityId; part: string; label: string; in: PlacementIn[] }; result: void };
    'space.release': { payload: { owner: EntityId }; result: void };
    /** a part taken away (taken down): it sits nowhere any more */
    'space.unplace': { payload: { owner: EntityId; part: string }; result: void };
  }
}
