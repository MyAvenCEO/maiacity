/**
 * Messages between the UI thread and the simulation worker.
 *
 * The simulation runs entirely in a Web Worker (src/worker). The UI never touches simulation
 * state: it sends commands and queries and receives
 *   - `static` world data (terrain heights, water, trees, road designs, network edges) when
 *     their revisions change — large, infrequent, typed arrays transferred
 *   - `frame`s (~10 Hz while running): clock, HUD, moving things, progress — small, frequent
 */
import type { Goal } from '../../../packages/siting/src/index.ts';
import type { Blocker, EntityMeta, Explained, Locale, LogEntry, ProcessView } from '../../../packages/kernel/src/index.ts';
import type { GridSpec, Vec2 } from '../../../packages/geo/src/index.ts';
import type { WaterBody } from '../../../packages/terrain/src/index.ts';
import type { RoadDesign, SectionProgress } from '../../../packages/roads/src/index.ts';
import type { PlanSpec } from '../../../packages/structures/src/index.ts';

/** Sim seconds per real second for each speed step (0 = paused). */
export const SPEEDS = [0, 60, 600, 3600, 6 * 3600, 86_400] as const;
export const SPEED_LABELS = ['Paused', '1 min/s', '10 min/s', '1 h/s', '6 h/s', '1 day/s'] as const;

/** Who issued a command: the human in the browser, or an AI agent (MCP). */
export type Actor = 'human' | 'agent';

export type ToWorker =
  | { type: 'init'; seed: number; snapshot?: unknown; /** a world definition (decision 0021); default: the Göttingen contractor start */ world?: unknown }
  | { type: 'dispatch'; id: number; command: string; payload: unknown }
  | { type: 'speed'; speed: number }
  | { type: 'skip'; to: 'shiftStart' | 'nextDay' | 'nextWeek' }
  | { type: 'query'; id: number; query: Query }
  | { type: 'snapshot'; id: number }
  /** the human pauses / resumes the AI agent (server mode; the agent's world-changing tools are refused while paused) */
  | { type: 'agentPause'; paused: boolean }
  /** the human's verdict on an agent's remedy proposal (server mode; persisted in the proposal record) */
  | { type: 'proposalVerdict'; proposal: string; verdict: ProposalVerdict; comment?: string };

export type Query =
  | { kind: 'projection'; name: string; args?: Record<string, unknown> }
  | { kind: 'roadPreview'; points: Vec2[]; classId: string }
  | { kind: 'inspect'; id: string }
  | { kind: 'schedule'; project: string }
  | { kind: 'ledger'; since?: number }
  | { kind: 'pick'; x: number; z: number; radius: number }
  | { kind: 'heightAt'; points: Vec2[] }
  /** a map overlay; `goal:custom` takes the goal definition */
  | { kind: 'overlay'; layer: OverlayLayer; goal?: Goal }
  /** a structure's plan before it is built (pure; does not change the world) */
  | { kind: 'structurePreview'; spec: PlanSpec }
  /** supplier offers for a material, sorted by delivered price (UI order dialog) */
  | { kind: 'offers'; material: string };

/** ground layers, scouting criteria (`crit:<id>`) and goals (`goal:<preset id>` or `goal:custom`) */
export type OverlayLayer = 'none' | 'slope' | 'soil' | 'moisture' | 'frost' | 'condition' | 'traffic' | `crit:${string}` | `goal:${string}`;

export type FromWorker =
  | { type: 'ready'; world: StaticWorld; frame: Frame }
  | { type: 'static'; patch: Partial<StaticWorld> }
  | { type: 'frame'; frame: Frame }
  | { type: 'result'; id: number; ok: boolean; result?: unknown; error?: string; actor?: Actor }
  | { type: 'error'; message: string };

export interface TreeArrays {
  revision: number;
  /** per tree: x, z, height, crownRadius */
  data: Float32Array;
  /** per tree: 0 = broadleaf, 1 = conifer */
  kind: Uint8Array;
  /** per tree: species index into speciesColors */
  species: Uint8Array;
  speciesColors: string[];
}

export interface EdgeView {
  id: string;
  points: Vec2[];
  /** heights along points */
  heights: number[];
  width: number;
  surface: string;
  open: boolean;
  asset?: string;
  label?: string;
}

export interface RoadStatic {
  id: string;
  label: string;
  classId: string;
  classLabel: string;
  surface: 'asphalt' | 'gravel';
  carriageway: number;
  shoulder: number;
  status: string;
  color: string;
  design: Pick<RoadDesign, 'alignment' | 'stations' | 'sections' | 'length' | 'stockpile' | 'siteStore'>;
}

/** what this world is (decision 0021): shown to players, never changed by them */
export interface WorldInfo {
  id: string;
  label: string;
  description?: string;
  /** contract → its source, e.g. weather → 'measured: dwd-01691-daily' (decision 0022) */
  bound: Record<string, string>;
}

export interface StaticWorld {
  world: WorldInfo;
  /** the worlds a new game can start in */
  worlds: { id: string; label: string; description?: string }[];
  grid: GridSpec;
  heights: Float32Array;
  heightsRevision: number;
  /** per grid vertex surface colour (rgb, 0..255) from soil/landcover */
  groundColors: Uint8Array;
  water: WaterBody[];
  trees: TreeArrays;
  edges: EdgeView[];
  edgesRevision: number;
  roads: RoadStatic[];
  roadsRevision: number;
  buildings: BuildingStatic[];
  buildingsRevision: number;
  buildingTypes: { id: string; label: string; description: string; category: string; length: number; width: number; floors: number }[];
  /** scouting: the criteria a scout can map and the goal presets */
  siting: { criteria: { id: string; label: string; unit: string; description: string; knowledge: string }[]; goals: Goal[] };
  location: { name: string; lat: number; lon: number };
  /** the ways into the map */
  accesses: { point: Vec2; inward: Vec2; label: string; mode: string }[];
  roadClasses: {
    id: string;
    label: string;
    description: string;
    standard: string;
    surface: string;
    carriageway: number;
    color: string;
    // ---- additive (UI design panel) ----
    shoulder?: number;
    minRadius?: number;
    maxGrade?: number;
    designSpeed?: number;
    loadClass?: string;
    /** pavement layers top-down (frost protection layer thickness is per section) */
    layers?: { id: string; label: string; kind: string; thickness?: number; material: string }[];
  }[];
  interventions: { id: string; label: string; surface: string; description: string; basis?: string }[];
  /** labour market: mean days between suitable applicants, notice period before a hire starts, advert cost */
  jobs: { id: string; label: string; wage: number; applicantDays: number; noticeDays: number; advertCost: number; qualifications?: string[] }[];
  machineModels: { id: string; label: string; class: string; rentalPerDay: number; purchasePrice: number; enginePower?: number; operatingWeight?: number; fuelUse?: number }[];
  materials: { id: string; label: string; unit: string; color?: string; category?: string; density?: number }[];
  /** the world's first day (days since 1970-01-01) and how its dates are written (its locale) */
  calendar: { epochDay: number; locale: Locale };
  // ---- additive (UI) ----
  /** activity catalogue (labels for work packages) */
  activities?: { id: string; label: string; unit: string; category: string; color?: string }[];
  qualifications?: { id: string; label: string }[];
  /** road design settings the UI needs for snapping hints */
  roadSettings?: { connectDistance: number; frostZone: string };
  /** contractor yard position (default delivery point for new machines) */
  depotPos?: Vec2;
  depotStore?: string;
}

export const BUILDING_STAGES = ['site', 'foundation', 'shell', 'roof', 'envelope', 'services', 'finishing', 'handover'] as const;
export type BuildingStage = (typeof BUILDING_STAGES)[number];

/** a structure as the 3D view draws it (a house, a hall, a tent, a wall: walls and a roof) */
export interface BuildingStatic {
  id: string;
  label: string;
  /** its template */
  type: string;
  typeLabel: string;
  status: string;
  corners: Vec2[];
  center: Vec2;
  /** degrees counter-clockwise from +x */
  rotation: number;
  length: number;
  width: number;
  floors: number;
  storeyHeight: number;
  height: number;
  roofStyle: 'gable' | 'flat' | 'shallow';
  /** degrees */
  roofPitch: number;
  /** finished platform level (m a.s.l.) */
  platform: number;
  wallColor: string;
  roofColor: string;
  /** what kind of thing it is, for the plans that are not buildings: a tent, a wall, a body */
  form?: string;
  /** the vehicle it is set up on (a caravan): the vehicle is drawn, the structure only what setting it up adds */
  on?: string;
}

export interface BuildingStageView {
  elements: string[];
  stages: string[];
  active?: { stage: string; progress: number };
}

export interface MachineView {
  id: string;
  model: string;
  label: string;
  cls: string;
  x: number;
  z: number;
  heading: number;
  status: string;
  /** working right now (rate > 0) */
  working: boolean;
  /** hauling: progress along a haul cycle 0..1, with loaded flag */
  haul?: { phase: number; loaded: boolean };
  pkg?: string;
  color: string;
}

export interface TripView {
  id: string;
  profile: string;
  x: number;
  z: number;
  heading: number;
  loaded: boolean;
  purpose: string;
  /** why it stands where it is (a breakdown), while it does */
  stopped?: string;
}

/** someone who died (of thirst, of hunger …): a moment the player must not miss */
export interface DeathView {
  id: string;
  name: string;
  cause: string;
  /** sim time */
  at: number;
  /** where (their camp), for the grave on the map */
  x?: number;
  z?: number;
}

export interface PersonView {
  id: string;
  name: string;
  job: string;
  x: number;
  z: number;
  /** off: beyond the map (gone home, at a job in town); resting: on the map off their working time (at their tent, asleep) */
  state: 'working' | 'waiting' | 'idle' | 'off' | 'resting' | 'absent' | 'travelling';
  pkg?: string;
}

export interface StoreView {
  id: string;
  label: string;
  kind: string;
  x: number;
  z: number;
  /** total mass (t) and loose volume (m³) on site */
  tonnes: number;
  volume: number;
  contents: { material: string; label: string; qty: number; unit: string; m3?: number }[];
  color: string;
}

export interface WorkfrontView {
  id: string;
  project: string;
  label: string;
  activity: string;
  x: number;
  z: number;
  progress: number;
  rate: number;
  unit: string;
  status: string;
  blocked: boolean;
  blocker?: string;
  color: string;
  road?: string;
  section?: number;
}

export interface Hud {
  time: number;
  date: string;
  /** the clock's time zone (standard time all year) */
  timeZone: string;
  weather: { temp: number; precip: number; wind: number; cloud: number; kind: string; tMin: number; tMax: number; daylight: boolean; sunElevation: number; sunAzimuth: number };
  /** published forecast from today (lead 0) on — errors grow with lead time */
  forecast: { day: number; date: string; kind: string; tMin: number; tMax: number; rainChance: number; precip: number; wind: number; frost: boolean }[];
  cash: number;
  liquidity: number;
  onShift: boolean;
  staff: number;
  machines: number;
  activeProjects: number;
  blockedPackages: number;
}

export interface Frame {
  t: number;
  speed: number;
  hud: Hud;
  /** the world waits for data (gap policy 'wait', decision 0022): why */
  dataWait?: string;
  /** contracts used outside their model's validity: these values are estimates (decision 0015) */
  validity?: string[];
  machines: MachineView[];
  trips: TripView[];
  people: PersonView[];
  stores: StoreView[];
  workfronts: WorkfrontView[];
  roadProgress: Record<string, SectionProgress[]>;
  /** road id → mean ZEB grade of the last inspection */
  roadGrades: Record<string, number>;
  /** building id → completed construction stages (site/foundation/shell/roof/envelope/services/finishing/handover) + active stage */
  buildingStages: Record<string, BuildingStageView>;
  log: LogEntry[];
  alertCount: number;
  /** everyone who has died in this world, oldest first */
  deaths: DeathView[];
  /**
   * Action log (last 200 commands by humans and agents). Sent only when it changed (and in
   * `ready`); the client keeps the last one it received.
   */
  actions?: ActionEntry[];
  /** AI agent status (server mode). Sent only when it changed; the client keeps the last one. */
  agent?: AgentView;
}

/** One command issued by a human or an agent, as shown in the action log. */
export interface ActionEntry {
  seq: number;
  /** sim time */
  t: number;
  actor: Actor;
  command: string;
  /** short human-readable payload summary */
  summary: string;
  ok: boolean;
  /** formatted rejection reasons */
  reasons?: string[];
  /** the agent's stated intent */
  note?: string;
  /** wall-clock time (ms since epoch) */
  at: number;
}

export interface AgentNote {
  seq: number;
  t: number;
  text: string;
  at: number;
}

export interface AgentView {
  /** the simulation is hosted by a server that agents can connect to */
  remote: boolean;
  /** an MCP client is connected */
  connected: boolean;
  /** the human paused the agent */
  paused: boolean;
  /** the agent may change the real-time speed (server flag --agent-time) */
  agentTime: boolean;
  /** what the agent is doing right now (e.g. "advancing time to Mo 08.03. 07:00") */
  busy?: string;
  notes: AgentNote[];
  /** remedy proposals the agent filed for human review, newest last (server mode) */
  proposals?: ProposalSummary[];
}

export const PROPOSAL_KINDS = ['missing_mechanic', 'better_remedy', 'data_correction', 'other'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const PROPOSAL_VERDICTS = ['useful', 'not_realistic', 'duplicate'] as const;
export type ProposalVerdict = (typeof PROPOSAL_VERDICTS)[number];

/**
 * An agent's proposal for another way to solve a problem (propose_remedy). Proposals never change
 * the running game: they are collected for humans to review and maybe implement as real mechanics.
 */
export interface ProposalSummary {
  id: string;
  title: string;
  kind: ProposalKind;
  subject?: string;
  blockerCode?: string;
  /** sim time when filed */
  t: number;
  /** wall-clock time (ms since epoch) */
  at: number;
  proposal: string;
  realWorldBasis: string;
  whyNotExisting: string;
  expectedEffect: string;
  rules?: string;
  verdict?: { verdict: ProposalVerdict; comment?: string; at: number };
}

export interface InspectResult {
  meta: EntityMeta;
  components: Record<string, unknown>;
  blockers: (Blocker & { message: string })[];
  processes: ProcessView[];
  /** extra domain-specific details prepared by the worker */
  details?: Record<string, unknown>;
}

export type { Explained };
