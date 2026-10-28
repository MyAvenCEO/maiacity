/**
 * @cc/economy-de: the German construction economy in 2026 (decision 0010): what can be bought or
 * rented where and at which price (machines, materials, suppliers, freight, diesel), wages and the
 * labour market, regional firms, banks and what they offer, overdraft interest and price escalation.
 */
import type { Pack } from '../../areas/src/index.ts';
import { contractorMarket, contractors } from './contractors.ts';
import { constructionCycleModel, datasets } from './cycle.ts';
import { economySettings } from './economy.ts';
import { counterparties, products } from './finance.ts';
import { rentLevels } from './letting.ts';
import { equipmentSettings, machineModels, usedPlantMarket } from './equipment.ts';
import { materials, suppliers } from './inventory.ts';
import { services } from './services.ts';
import { courseOffers, employers, jobs, labourSettings, transitFares } from './workforce.ts';
import { lodgings, roadside } from './lodgings.ts';

export { constructionCycleModel, datasets, contractorMarket, contractors, counterparties, courseOffers, economySettings, employers, lodgings, roadside, transitFares, products, rentLevels, usedPlantMarket, equipmentSettings, jobs, labourSettings, machineModels, materials, services, suppliers };
export { freight4Axle } from './inventory.ts';
export * as sources from './sources.ts';

/** the pack: a market speaks for no area, it is reached by transport (decision 0011): the world's own */
export const economyDe: Pack = { role: 'economy', catalogs: { courseOffers, employers, lodgings, roadside, transitFares, jobs, labourSettings, machineModels, equipmentSettings, materials, suppliers, services, economySettings, contractors, counterparties, products, rentLevels, usedPlantMarket, constructionCycleModel, contractorMarket } };
