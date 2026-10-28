/**
 * Conformance suites for model contracts (decision 0015).
 *
 * A contract's suite is a list of checks every implementation must pass — built-in models,
 * external simulations behind the gRPC bridge, measured and entered data alike. Suites are plain
 * functions with no test framework, so they run in the package tests, against external endpoints
 * and in tools. A contract needs at least two implementations that pass its suite (rule of two).
 */

export interface ConformanceCase<S> {
  name: string;
  /** throws on failure */
  run(subject: S): void;
}

export interface ConformanceSuite<S> {
  contract: string;
  cases: ConformanceCase<S>[];
}

export interface ConformanceResult {
  contract: string;
  implementation: string;
  passed: string[];
  failed: { name: string; error: string }[];
}

export function runConformance<S>(suite: ConformanceSuite<S>, implementation: string, subject: S): ConformanceResult {
  const result: ConformanceResult = { contract: suite.contract, implementation, passed: [], failed: [] };
  for (const c of suite.cases) {
    try {
      c.run(subject);
      result.passed.push(c.name);
    } catch (e) {
      result.failed.push({ name: c.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

/** throw a readable error listing every failed case */
export function assertConformance(result: ConformanceResult): void {
  if (!result.failed.length) return;
  throw new Error(`${result.implementation} does not conform to '${result.contract}':\n  - ${result.failed.map((f) => `${f.name}: ${f.error}`).join('\n  - ')}`);
}

/** a small assertion helper for suites (no test framework in simulation packages) */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
