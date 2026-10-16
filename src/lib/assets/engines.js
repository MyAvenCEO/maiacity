/*
 * ENGINES AND RECIPE FILES — the frozen engines (./engines.json: each version's BLAKE3 hash and size, its file
 * static/engines/engine-v<n>.js, made by scripts/freeze-engine.mjs from ./box/engine.js), and the shape of a recipe
 * file of ours (./recipe.js), written the same in Vite's build (./box/plugin.js) and in the page (./recipes.js), so its
 * BLAKE3 hash names the same bytes in both.
 *
 * One of our recipe files is its asset's library (its group's list narrowed to that one asset: its builders, every
 * version's, and what they share with other assets, bundled with three.js left to the engine) and one line naming
 * the version and variant it builds. So each asset, version and variant has a file and a hash of its own, and the
 * hash moves only when the asset's own code changes, or code it shares: never with another asset's. The versions of
 * one asset share its library, so a change to one moves the hashes of all.
 */
import manifest from './engines.json' with { type: 'json' };

/**
 * @typedef {{ v: number, date: string, blake3: string, bytes: number, three: string, modules: string[], note: string }} Engine
 *   a frozen engine: its version, when, the BLAKE3 hash of its file and its size, the three.js it carries, the modules
 *   a recipe may require of it, and what it brought
 */

/** every frozen engine, oldest first @type {Engine[]} */
export const ENGINES = manifest.engines;

/** the latest engine: the one our recipes are made for */
export const LATEST = ENGINES[ENGINES.length - 1];

/** an engine by its version @param {number} v */
export const engineAt = (v) => ENGINES.find((e) => e.v === v);

/** where an engine's file is served, under the site's base path @param {number} v */
export const enginePath = (v) => `/engines/engine-v${v}.js`;

/**
 * The start of every recipe file of ours: a script that hands the engine (./box/engine.js) one function, which runs
 * its library (strict, as the modules it was made of were) and gives back the asset's recipe.
 */
export const RECIPE_HEAD = 'defineRecipe(function (require) {\n"use strict";\nvar module = { exports: {} }, exports = module.exports;\n';

/**
 * The end of one asset's recipe file: the line naming it. @param {string} id @param {number} v @param {string | null} [variant]
 */
export const recipeTail = (id, v, variant) => `\nreturn module.exports.recipe(${JSON.stringify(id)}, ${v}, ${JSON.stringify(variant ?? null)});\n});\n`;

/** The end of a recipe file whose library names no asset (a trial of the lab's). */
export const RECIPE_END = '\nreturn module.exports.recipe();\n});\n';

/**
 * One asset's recipe file. @param {string} library the asset's library @param {string} id @param {number} v
 * @param {string | null} [variant]
 */
export const recipeFile = (library, id, v, variant) => RECIPE_HEAD + library + recipeTail(id, v, variant);
