/** @cc/materials: material response — durability from exposure only (decisions 0014, 0015). */
export * from './contract.ts';
export { DECAY_DOSE_MODEL, doseDurabilityModule, ISO_FACTOR_MODEL, isoDurabilityModule } from './module.ts';
export { durabilityConformance, type DurabilitySubject } from './conformance.ts';
