/**
 * When a quantity counts as reached. Quantities are floats, and work integrated over time or drawn
 * in parts never lands exactly on its total. One rule decides, for processes, shortages, completion
 * and stores alike: within a millionth of the total (and a billionth absolute), it is reached.
 */

/** the tolerance of a quantity of this size */
export const tolerance = (total: number): number => Math.abs(total) * 1e-6 + 1e-9;

/** what is left of `total` after `done`: 0 once within its tolerance */
export const leftOf = (total: number, done: number): number => {
  const left = total - done;
  return left <= tolerance(total) ? 0 : left;
};

/** `have` covers `need` (within the tolerance of `need`) */
export const covers = (have: number, need: number): boolean => have + tolerance(need) >= need;

/** a count of pieces: the whole number within tolerance, else the fraction as it is */
export const wholeIfNear = (x: number): number => (Math.abs(x - Math.round(x)) <= tolerance(x) ? Math.round(x) : x);
