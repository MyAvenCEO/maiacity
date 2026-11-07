// A test's proposal naming its levels of detail (play/SPEC.md §4.5, ../../src/lod.ts): every new asset version names them
// on its card. A fixture's assets are simple shapes, their levels derived, unless the proposal names its own.
export const DERIVED = { levels: "derived" } as const;

/** a proposal's body with `card.lod` named (derived) where neither it nor its record names one */
export function leveled<T extends Record<string, any>>(body: T): T {
  if (body?.card?.lod !== undefined || body?.record?.card?.lod !== undefined) return body;
  return { ...body, card: { ...(body.card ?? {}), lod: DERIVED } };
}
