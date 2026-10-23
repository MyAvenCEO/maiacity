/**
 * Felled trees are wood (rung 2, site materials): work that fells trees takes them one by one, in
 * order, each when the work has done its share; then the tree is gone and its stem lies as logs and
 * its crown as brash on the heap. Work stopped half way has felled what it has felled; a tree another
 * work took first gives nothing.
 */
import type { ReadCtx } from '../../kernel/src/index.ts';
import type {} from '../../terrain/src/index.ts';
import type { Fells } from './contract.ts';

/** what felling these trees is: each tree with its share of the work, a tree each, or its stem's m³ */
export function fellsOf<S>(read: ReadCtx, trees: readonly string[], into: { logs: string; brash: string }, store: S, per: 'tree' | 'm3'): Fells<S> {
  const veg = read.port('vegetation');
  return {
    trees: trees.map((id) => {
      const t = veg.tree(id);
      return { id, q: per === 'tree' ? 1 : t ? veg.wood(t).stemVolume : 0 };
    }),
    logs: into.logs,
    brash: into.brash,
    store,
  };
}
