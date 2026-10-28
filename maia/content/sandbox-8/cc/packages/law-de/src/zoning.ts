/**
 * How the land of the Göttingen valley may be used (camp L6): the map lies outside any built-up area
 * and any development plan, in the outer area (Außenbereich, § 35 BauGB), where a home needs a permit
 * that is given only to the privileged (a farm, say). The building authority is the district's. The
 * land-use plans are the municipality's law: they speak for the area of Göttingen (`lawGoettingen`,
 * `lawGoettingenPlanned`), and a world chooses one by its packs.
 */
export const zoning = {
  authority: 'bauaufsicht',
  zones: {
    outer: { label: 'outer area (Außenbereich, § 35 BauGB)', dwelling: false, building: false },
  },
};

/**
 * The same valley under a development plan (Bebauungsplan, § 30 BauGB) that a firm develops: homes and
 * businesses may be built and lived in (the permits themselves are not modelled yet).
 */
export const plannedZoning = {
  authority: 'bauaufsicht',
  zones: {
    plan: { label: 'development plan area (Bebauungsplan, § 30 BauGB)', dwelling: true, building: true },
  },
};
