/**
 * Scouting for sites (the player's question "where should we settle?").
 *
 * A **criterion** is a physical quantity mapped over the land — slope, height above the nearest
 * water, distance to a road, sun on the ground, plant-available water of the soil … — each with its
 * unit and where the knowledge comes from. Only what a scout could know is used (decisions 0004,
 * 0023): the topographic map, the climate normals, a coarse soil map, the woods one can see — never
 * the coming weather or the exact soil under every metre.
 *
 * A **goal** says what "a good place" means for a purpose: weighted criteria, each scored from its
 * worst to its best value, with hard limits that rule a place out. Goals are the player's; the
 * presets are starting points to edit. Scores are weighted geometric means, so a place bad in one
 * important respect does not hide behind good ones.
 */
import { s, type EntityId, type Infer, type Source } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';

export interface Criterion {
  id: string;
  label: string;
  unit: string;
  description: string;
  /** where a scout's knowledge of it comes from */
  knowledge: string;
  source?: Source;
}

/** a criterion (or a goal's score) over the land: cell centres at x0 + (i + ½)·cell, z0 + (j + ½)·cell */
export interface SiteGrid {
  id: string;
  label: string;
  unit: string;
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** row-major (j·nx + i); NaN where a goal rules the place out */
  values: Float32Array;
  min: number;
  max: number;
}

export const GoalTermSchema = s.object({
  criterion: s.string(),
  /** how much it matters (> 0) */
  weight: s.number({ min: 0.01, max: 10 }),
  /** the value scoring 0 … */
  worst: s.number(),
  /** … and the value scoring 1 (linear between, clamped) */
  best: s.number(),
  /** hard limits: outside them a place is ruled out */
  min: s.number().optional(),
  max: s.number().optional(),
});
export type GoalTerm = Infer<typeof GoalTermSchema>;

export const GoalSchema = s.object({
  id: s.string(),
  label: s.string(),
  description: s.string().optional(),
  terms: s.array(GoalTermSchema),
});
export type Goal = Infer<typeof GoalSchema>;

/** a goal preset of the practice pack: what "a good place" usually means for a purpose (a rule of thumb with its source) */
export const SitingGoalSchema = s.object({
  label: s.string(),
  description: s.string().optional(),
  terms: s.array(GoalTermSchema),
  source: s.any<Source>(),
});
export type SitingGoal = Infer<typeof SitingGoalSchema>;

/** one criterion's part in a place's score */
export interface TermScore {
  criterion: string;
  label: string;
  value: number;
  unit: string;
  /** 0..1 */
  utility: number;
  weight: number;
  /** the hard limit it breaks, if any */
  ruledOut?: string;
}

export interface Candidate {
  at: Vec2;
  /** 0..1, or 0 when ruled out */
  score: number;
  ruledOut: boolean;
  terms: TermScore[];
}

export interface SitingPort {
  criteria(): Criterion[];
  /** the preset goals of the world's practice (starting points to edit) */
  goals(): Goal[];
  /** a goal by preset id or as a definition, checked (throws with the presets and criteria there are) */
  goal(goal: Goal | string): Goal;
  grid(criterion: string): SiteGrid;
  /** a goal's suitability over the land (0..1; NaN where ruled out); a goal is a preset id or a definition */
  score(goal: Goal | string): SiteGrid;
  /** the best places for a goal, at least `separation` metres apart */
  candidates(goal: Goal | string, opts?: { count?: number; separation?: number; near?: Vec2; radius?: number }): Candidate[];
  /** why a place scores as it does for a goal */
  explain(goal: Goal | string, at: Vec2): Candidate;
}

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    siting: SitingPort;
  }
  interface DataTypes {
    sitingGoals?: Record<string, SitingGoal>;
  }
}

export type { EntityId };
