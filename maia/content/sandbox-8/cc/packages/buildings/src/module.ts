/**
 * Buildings (decision 0026): houses and halls are structures like any other. This module draws
 * their plans (the building planner), gives a building its spaces and faces as its elements are
 * finished (decision 0014), lets the roof overhang shelter its façades, and brings the practice
 * pack's site rules as a rulebook. Building, ageing, inspection, renewal, books and letting are the
 * structures' own.
 */
import { defineModule, s, type EntityId } from '../../kernel/src/index.ts';
import type {} from '../../structures/src/index.ts';
import type { BuildingDesign } from './contract.ts';
import type {} from '../../space/src/index.ts';
import { BuildingSettingsSchema, BuildingTypeSchema } from './contract.ts';
import { buildingPlanner, siteRulebook } from './design.ts';
import { overhangShelter, placeElement } from './placement.ts';

export const buildingsModule = defineModule({
  id: 'buildings',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Face', 'Project', 'Structure', 'WorkPackage'],
  label: 'Buildings',
  description: 'The building planner: houses and halls drawn from the practice pack’s building types, their spaces and faces, and the site rules.',
  requires: ['structures', 'terrain', 'vegetation', 'routing', 'production', 'space'],
  components: {
    Shell: s.object({ building: s.string() }, { passthrough: true }),
  },
  data: { buildingTypes: s.record(BuildingTypeSchema), buildingSettings: BuildingSettingsSchema },
  on: {
    // a finished element takes its place in the building (the shell is made with the first; a
    // building revised to other storeys gets its shell made again and everything placed anew)
    'structures.elementDone': (ctx, e) => {
      const st = ctx.get('Structure', e.structure);
      if (st?.plan.planner !== 'building') return;
      const shell = ctx.get('Shell', e.structure);
      if (shell && shell.storeys.length !== (st.plan.detail as BuildingDesign).geometry.floors) {
        ctx.command('space.release', { owner: e.structure });
        ctx.remove('Shell', e.structure);
        for (const x of st.done) if (x !== e.element) placeElement(ctx, e.structure, st, x);
      }
      placeElement(ctx, e.structure, st, e.element);
    },
    // an element taken down sits nowhere any more
    'structures.elementRemoved': (ctx, e) => {
      const st = ctx.get('Structure', e.structure);
      if (st?.plan.planner === 'building') ctx.command('space.unplace', { owner: e.structure, part: e.element });
    },
    // a cancelled building's half-made spaces and faces are no place for anything, nor a demolished one's
    'structures.cancelled': (ctx, e) => {
      const st = ctx.get('Structure', e.structure);
      if (st?.plan.planner === 'building') ctx.command('space.release', { owner: e.structure as EntityId });
    },
    'structures.demolished': (ctx, e) => {
      const st = ctx.get('Structure', e.structure);
      if (st?.plan.planner === 'building') ctx.command('space.release', { owner: e.structure as EntityId });
    },
  },
  contributes: {
    planners: () => buildingPlanner,
    exposure: overhangShelter,
    rulebook: siteRulebook,
  },
});
