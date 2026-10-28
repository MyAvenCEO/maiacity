/**
 * @cc/law-de: German law as data (decision 0010, design/modular-split.md §5.2–§5.4). Law is made by an authority for
 * its territory, so each part of this pack speaks for the area of the authority that made it, and the parts merge
 * key by key along the chain of areas, the specific over the general (`@cc/areas`):
 *
 * - `lawDe` (Germany): federal law. The law of claims (fines, private claims, public fees), of estates and insolvency,
 *   what a holder may do against someone on their land (BGB, ZPO), the end of a let, the fines of the federal
 *   offences, and § 35 BauGB on homes in the outer area.
 * - `lawDeNi` (Lower Saxony): the state's building order (NBauO) with its administrative enforcement (NVwVG, NPOG),
 *   and the state's coercive fine.
 * - `lawGoettingen`, `lawGoettingenPlanned` (Göttingen): the land-use plan over the map, as it is (the outer area) or
 *   under a development plan a firm develops.
 *
 * This is the law that was in the practice and region packs, moved catalog by catalog; nothing was added. Catalogs
 * that mix law and practice field by field stay where they are (practice-de: labourSettings with the leave and
 * working-time law, lettingUses, roadDedication, structureSettings with the fire service's fee, buildingSettings
 * with the NBauO clearance; economy-de: jobs, products; region-goettingen: the holidays of Lower Saxony in
 * labourSettings), listed in docs/decisions/deviations.json.
 */
import type { Pack } from '../../areas/src/index.ts';
import { claimLaw, claimLawNi } from './claims.ts';
import { estateLaw, insolvencyLaw } from './insolvency.ts';
import { buildingLaw, buildingLawNi, enforcement, leaseEnd, trespass } from './land.ts';
import { plannedZoning, zoning } from './zoning.ts';

export { buildingLaw, buildingLawNi, claimLaw, claimLawNi, enforcement, estateLaw, insolvencyLaw, leaseEnd, plannedZoning, trespass, zoning };

/** federal law: speaks for Germany, the first area of the chain */
export const lawDe: Pack = { role: 'law', area: 'de', catalogs: { areas: { de: { label: 'Germany' }, 'de-ni': { label: 'Lower Saxony', parent: 'de' } }, claimLaw, estateLaw, insolvencyLaw, trespass, leaseEnd, buildingLaw, enforcement } };

/** Lower Saxony's law: its building order and its coercive fine, and its municipalities (the one a world lies in) */
export const lawDeNi: Pack = { role: 'law', area: 'de-ni', catalogs: { areas: { 'de-ni-goettingen': { label: 'Göttingen', parent: 'de-ni' } }, claimLaw: claimLawNi, buildingLaw: buildingLawNi } };

/** Göttingen's land-use plan over the map: the outer area, outside any built-up area and development plan */
export const lawGoettingen: Pack = { role: 'law', area: 'de-ni-goettingen', catalogs: { zoning } };

/** the same land under a development plan a firm develops: homes and businesses may be built (the contractor's worlds) */
export const lawGoettingenPlanned: Pack = { role: 'law', area: 'de-ni-goettingen', catalogs: { zoning: plannedZoning } };
