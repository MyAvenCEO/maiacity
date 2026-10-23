/**
 * Minimal schema DSL with static type inference, runtime validation, unit metadata
 * and data-pack loading (unit conversion of parameters).
 *
 * Schemas serve four purposes at once:
 *  - TypeScript types (`Infer<typeof S>`)
 *  - runtime validation of commands, components (strict mode) and data packs
 *  - metadata for generic UI (labels, units, refs) — inspectors and tables are built from it
 *  - explicit units: `s.param('m3/h')` converts whatever unit the data pack used into m3/h
 */
import { convert, parseUnit, sameDimension } from './units.ts';

export interface Source {
  title: string;
  publisher?: string;
  year?: number;
  url?: string;
  note?: string;
}

/** A calibrated parameter: value in the declared unit plus provenance. */
export interface Param {
  value: number;
  unit: string;
  range?: [number, number];
  source?: Source;
  note?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface Meta {
  label?: string;
  description?: string;
  unit?: string;
  /** For refs: entity kind / component expected on the referenced entity. */
  ref?: string;
  hidden?: boolean;
}

/**
 * A schema's shape as a string: its kind, its unit, and the shapes it is made of (fields, items,
 * options). Two schemas print the same when they accept the same data; a save records the print of
 * the world's schemas, so a world saved under other shapes is known for what it is (decision 0019).
 */
export function schemaPrint(x: unknown, seen = new Set<unknown>()): string {
  if (x instanceof Schema) {
    if (seen.has(x)) return '↺';
    seen.add(x);
    const parts: string[] = [x.kind];
    if (x.meta.unit) parts.push(`[${x.meta.unit}]`);
    for (const [k, v] of Object.entries(x)) {
      if (k === 'meta' || typeof v === 'function') continue;
      const inner = schemaPrint(v, seen);
      if (inner) parts.push(`${k}:${inner}`);
    }
    seen.delete(x);
    return `(${parts.join(' ')})`;
  }
  if (Array.isArray(x)) return x.every((v) => typeof v === 'string' || typeof v === 'number') ? `[${x.join(',')}]` : `[${x.map((v) => schemaPrint(v, seen)).join(',')}]`;
  if (x && typeof x === 'object') {
    const entries = Object.entries(x).filter(([, v]) => v instanceof Schema || (v && typeof v === 'object') || typeof v === 'boolean');
    return entries.length ? `{${entries.map(([k, v]) => `${k}:${typeof v === 'boolean' ? v : schemaPrint(v, seen)}`).join(',')}}` : '';
  }
  return typeof x === 'boolean' ? String(x) : '';
}

export abstract class Schema<T> {
  declare readonly _type: T;
  meta: Meta = {};
  abstract readonly kind: string;
  /** Validate and normalize (e.g. unit-convert params). Returns normalized value. */
  abstract parse(input: unknown, path: string, errors: string[]): T;
  describe(meta: Meta): this {
    const clone = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(clone, this);
    clone.meta = { ...this.meta, ...meta };
    return clone;
  }
  optional(): OptionalSchema<T> {
    return new OptionalSchema(this);
  }
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

class NumberSchema extends Schema<number> {
  readonly kind = 'number';
  constructor(public opts: { min?: number; max?: number; int?: boolean } = {}) {
    super();
  }
  parse(input: unknown, path: string, errors: string[]): number {
    if (typeof input !== 'number' || !Number.isFinite(input)) {
      errors.push(`${path}: expected finite number, got ${JSON.stringify(input)}`);
      return 0;
    }
    if (this.opts.int && !Number.isInteger(input)) errors.push(`${path}: expected integer`);
    if (this.opts.min !== undefined && input < this.opts.min) errors.push(`${path}: ${input} < min ${this.opts.min}`);
    if (this.opts.max !== undefined && input > this.opts.max) errors.push(`${path}: ${input} > max ${this.opts.max}`);
    return input;
  }
}

class StringSchema extends Schema<string> {
  readonly kind = 'string';
  parse(input: unknown, path: string, errors: string[]): string {
    if (typeof input !== 'string') {
      errors.push(`${path}: expected string`);
      return '';
    }
    return input;
  }
}

class BooleanSchema extends Schema<boolean> {
  readonly kind = 'boolean';
  parse(input: unknown, path: string, errors: string[]): boolean {
    if (typeof input !== 'boolean') {
      errors.push(`${path}: expected boolean`);
      return false;
    }
    return input;
  }
}

class EnumSchema<const V extends string> extends Schema<V> {
  readonly kind = 'enum';
  constructor(public values: readonly V[]) {
    super();
  }
  parse(input: unknown, path: string, errors: string[]): V {
    if (typeof input !== 'string' || !(this.values as readonly string[]).includes(input)) {
      errors.push(`${path}: expected one of ${this.values.join('|')}, got ${JSON.stringify(input)}`);
      return this.values[0]!;
    }
    return input as V;
  }
}

class LiteralSchema<const V extends string | number | boolean> extends Schema<V> {
  readonly kind = 'literal';
  constructor(public value: V) {
    super();
  }
  parse(input: unknown, path: string, errors: string[]): V {
    if (input !== this.value) errors.push(`${path}: expected ${JSON.stringify(this.value)}`);
    return this.value;
  }
}

class OptionalSchema<T> extends Schema<T | undefined> {
  readonly kind = 'optional';
  constructor(public inner: Schema<T>) {
    super();
    this.meta = inner.meta;
  }
  parse(input: unknown, path: string, errors: string[]): T | undefined {
    if (input === undefined || input === null) return undefined;
    return this.inner.parse(input, path, errors);
  }
}

class NullableSchema<T> extends Schema<T | null> {
  readonly kind = 'nullable';
  constructor(public inner: Schema<T>) {
    super();
    this.meta = inner.meta;
  }
  parse(input: unknown, path: string, errors: string[]): T | null {
    if (input === null || input === undefined) return null;
    return this.inner.parse(input, path, errors);
  }
}

class ArraySchema<T> extends Schema<T[]> {
  readonly kind = 'array';
  constructor(public item: Schema<T>) {
    super();
  }
  parse(input: unknown, path: string, errors: string[]): T[] {
    if (!Array.isArray(input)) {
      errors.push(`${path}: expected array`);
      return [];
    }
    return input.map((v, i) => this.item.parse(v, `${path}[${i}]`, errors));
  }
}

class RecordSchema<T> extends Schema<Record<string, T>> {
  readonly kind = 'record';
  constructor(public value: Schema<T>) {
    super();
  }
  parse(input: unknown, path: string, errors: string[]): Record<string, T> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      errors.push(`${path}: expected object map`);
      return {};
    }
    const out: Record<string, T> = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = this.value.parse((input as Record<string, unknown>)[key], `${path}.${key}`, errors);
    }
    return out;
  }
}

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends Infer<S[K]> ? K : never }[keyof S];
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type InferShape<S extends Shape> = Simplify<
  { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> }
>;

export class ObjectSchema<S extends Shape> extends Schema<InferShape<S>> {
  readonly kind = 'object';
  constructor(public shape: S, public opts: { passthrough?: boolean } = {}) {
    super();
  }
  parse(input: unknown, path: string, errors: string[]): InferShape<S> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      errors.push(`${path}: expected object`);
      return {} as InferShape<S>;
    }
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = this.opts.passthrough ? { ...src } : {};
    for (const key of Object.keys(this.shape)) {
      const value = this.shape[key]!.parse(src[key], path ? `${path}.${key}` : key, errors);
      if (value !== undefined) out[key] = value;
      else delete out[key];
    }
    if (!this.opts.passthrough) {
      for (const key of Object.keys(src)) {
        if (!Object.hasOwn(this.shape, key) && !key.startsWith('$')) errors.push(`${path || '<root>'}: unknown field "${key}"`);
      }
    }
    return out as InferShape<S>;
  }
}

class UnionSchema<T> extends Schema<T> {
  readonly kind = 'union';
  constructor(public options: Schema<unknown>[], public discriminator?: string) {
    super();
  }
  parse(input: unknown, path: string, errors: string[]): T {
    for (const option of this.options) {
      const local: string[] = [];
      const value = option.parse(input, path, local);
      if (local.length === 0) return value as T;
    }
    errors.push(`${path}: matches none of ${this.options.length} union options`);
    return input as T;
  }
}

class AnySchema<T> extends Schema<T> {
  readonly kind = 'any';
  parse(input: unknown): T {
    return input as T;
  }
}

const SourceSchema = new ObjectSchema({
  title: new StringSchema(),
  publisher: new StringSchema().optional(),
  year: new NumberSchema().optional(),
  url: new StringSchema().optional(),
  note: new StringSchema().optional(),
});

/** Strip binary floating-point noise introduced by unit factors (12 significant digits). */
const tidy = (x: number): number => (x === 0 ? 0 : Number(x.toPrecision(12)));

/**
 * A data-pack parameter in a declared unit. Accepts `{value, unit, range?, source?}`
 * in ANY unit of the same dimension and converts to the declared unit. A bare number is
 * rejected — data must state its unit.
 */
export class ParamSchema extends Schema<Param> {
  readonly kind = 'param';
  constructor(public unit: string, public opts: { min?: number; max?: number } = {}) {
    super();
    parseUnit(unit);
    this.meta = { unit };
  }
  parse(input: unknown, path: string, errors: string[]): Param {
    if (typeof input !== 'object' || input === null) {
      errors.push(`${path}: expected parameter {value, unit, source?}, got ${JSON.stringify(input)}`);
      return { value: 0, unit: this.unit };
    }
    const raw = input as Record<string, unknown>;
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
      errors.push(`${path}.value: expected finite number`);
      return { value: 0, unit: this.unit };
    }
    const from = typeof raw.unit === 'string' ? raw.unit : '';
    if (!from) {
      errors.push(`${path}.unit: missing unit (expected dimension of ${this.unit})`);
      return { value: raw.value, unit: this.unit };
    }
    let fromOk = true;
    try {
      parseUnit(from);
    } catch (e) {
      errors.push(`${path}.unit: ${(e as Error).message}`);
      fromOk = false;
    }
    if (fromOk && !sameDimension(from, this.unit)) {
      errors.push(`${path}.unit: ${from} is not convertible to ${this.unit}`);
      fromOk = false;
    }
    const value = fromOk ? tidy(convert(raw.value, from, this.unit)) : raw.value;
    const out: Param = { value, unit: this.unit };
    if (Array.isArray(raw.range) && raw.range.length === 2 && fromOk) {
      out.range = [tidy(convert(Number(raw.range[0]), from, this.unit)), tidy(convert(Number(raw.range[1]), from, this.unit))];
      if (out.range[0] > out.range[1]) errors.push(`${path}.range: lower bound above upper bound`);
      else if (value < out.range[0] - 1e-9 || value > out.range[1] + 1e-9) errors.push(`${path}: value ${value} outside its own range`);
    }
    if (raw.source !== undefined) out.source = SourceSchema.parse(raw.source, `${path}.source`, errors) as Source;
    if (typeof raw.note === 'string') out.note = raw.note;
    if (raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low') out.confidence = raw.confidence;
    if (this.opts.min !== undefined && value < this.opts.min) errors.push(`${path}: ${value} ${this.unit} < min ${this.opts.min}`);
    if (this.opts.max !== undefined && value > this.opts.max) errors.push(`${path}: ${value} ${this.unit} > max ${this.opts.max}`);
    return out;
  }
}

/** A data series (e.g. 12 monthly normals) in a declared unit, with provenance. */
export interface Series {
  values: number[];
  unit: string;
  source?: Source;
  note?: string;
  confidence?: 'high' | 'medium' | 'low';
}

/** builders for data packs: a parameter, a series, a source with an extra note (decision 0006) */
export function param(value: number, unit: string, source?: Source, opts: { range?: [number, number]; note?: string; confidence?: Param['confidence'] } = {}): Param {
  const out: Param = { value, unit };
  if (opts.range) out.range = opts.range;
  if (source) out.source = source;
  if (opts.note) out.note = opts.note;
  if (opts.confidence) out.confidence = opts.confidence;
  return out;
}

export function series(values: number[], unit: string, source?: Source, opts: { note?: string; confidence?: Series['confidence'] } = {}): Series {
  const out: Series = { values, unit };
  if (source) out.source = source;
  if (opts.note) out.note = opts.note;
  if (opts.confidence) out.confidence = opts.confidence;
  return out;
}

/** the same source with an extra note (e.g. which row of a table) */
export const cite = (src: Source, note: string): Source => ({ ...src, note: src.note ? `${src.note}; ${note}` : note });

export class SeriesSchema extends Schema<Series> {
  readonly kind = 'series';
  constructor(public unit: string, public length?: number) {
    super();
    parseUnit(unit);
    this.meta = { unit };
  }
  parse(input: unknown, path: string, errors: string[]): Series {
    if (typeof input !== 'object' || input === null || !Array.isArray((input as { values?: unknown }).values)) {
      errors.push(`${path}: expected series {values: number[], unit}`);
      return { values: [], unit: this.unit };
    }
    const raw = input as Record<string, unknown>;
    const from = typeof raw.unit === 'string' ? raw.unit : '';
    if (!from) errors.push(`${path}.unit: missing unit`);
    else if (!sameDimension(from, this.unit)) errors.push(`${path}.unit: ${from} is not convertible to ${this.unit}`);
    const ok = Boolean(from) && sameDimension(from || this.unit, this.unit);
    const values = (raw.values as unknown[]).map((v, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`${path}.values[${i}]: expected finite number`);
        return 0;
      }
      return ok ? tidy(convert(v, from, this.unit)) : v;
    });
    if (this.length !== undefined && values.length !== this.length) errors.push(`${path}: expected ${this.length} values, got ${values.length}`);
    const out: Series = { values, unit: this.unit };
    if (raw.source !== undefined) out.source = SourceSchema.parse(raw.source, `${path}.source`, errors) as Source;
    if (typeof raw.note === 'string') out.note = raw.note;
    if (raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low') out.confidence = raw.confidence;
    return out;
  }
}

/** Schema builder namespace. */
export const s = {
  number: (opts?: { min?: number; max?: number; int?: boolean; unit?: string; label?: string }) => {
    const sch = new NumberSchema(opts ?? {});
    if (opts?.unit) parseUnit(opts.unit);
    sch.meta = { unit: opts?.unit, label: opts?.label };
    return sch;
  },
  int: (opts?: { min?: number; max?: number; label?: string }) => s.number({ ...opts, int: true }),
  string: () => new StringSchema(),
  boolean: () => new BooleanSchema(),
  enum: <const V extends string>(values: readonly V[]) => new EnumSchema<V>(values),
  literal: <const V extends string | number | boolean>(value: V) => new LiteralSchema<V>(value),
  /** Entity id reference. `kind` documents (and lets UIs resolve) the expected target; several kinds: any of them ('store|structure'). */
  ref: (kind?: string | readonly string[]) => {
    const sch = new StringSchema();
    sch.meta = { ref: typeof kind === 'string' ? kind : kind?.length ? kind.join('|') : '*' };
    return sch;
  },
  array: <T>(item: Schema<T>) => new ArraySchema(item),
  record: <T>(value: Schema<T>) => new RecordSchema(value),
  object: <S extends Shape>(shape: S, opts?: { passthrough?: boolean }) => new ObjectSchema(shape, opts),
  nullable: <T>(inner: Schema<T>) => new NullableSchema(inner),
  union: <const O extends Schema<unknown>[]>(...options: O) => new UnionSchema<Infer<O[number]>>(options),
  param: (unit: string, opts?: { min?: number; max?: number }) => new ParamSchema(unit, opts),
  series: (unit: string, length?: number) => new SeriesSchema(unit, length),
  any: <T = unknown>() => new AnySchema<T>(),
  /** 2D point [x, z] in metres (world ground plane). */
  point: () => {
    const sch = new ArraySchema(new NumberSchema());
    sch.meta = { unit: 'm' };
    return sch as unknown as Schema<[number, number]>;
  },
};

export class ValidationError extends Error {
  constructor(public readonly issues: string[], context: string) {
    super(`${context}: ${issues.slice(0, 8).join('; ')}${issues.length > 8 ? ` (+${issues.length - 8} more)` : ''}`);
  }
}

/** Parse or throw. */
export function parseOrThrow<T>(schema: Schema<T>, input: unknown, context: string): T {
  const errors: string[] = [];
  const value = schema.parse(input, '', errors);
  if (errors.length) throw new ValidationError(errors, context);
  return value;
}

/**
 * JSON Schema (draft 2020-12 subset) for a schema — used to describe commands to AI agents
 * (MCP tool input schemas) and external clients. Units and labels become descriptions.
 */
export function toJsonSchema(schema: Schema<unknown>): Record<string, unknown> {
  const desc = (extra: Record<string, unknown>): Record<string, unknown> => {
    const parts: string[] = [];
    if (schema.meta.label) parts.push(schema.meta.label);
    if (schema.meta.description) parts.push(schema.meta.description);
    if (schema.meta.unit) parts.push(`unit: ${schema.meta.unit}`);
    if (schema.meta.ref) parts.push(`entity id${schema.meta.ref !== '*' ? ` (${schema.meta.ref.split('|').join(' or ')})` : ''}`);
    return parts.length ? { ...extra, description: parts.join(' — ') } : extra;
  };
  const s0 = schema as unknown as Record<string, unknown> & { kind: string };
  switch (s0.kind) {
    case 'number': {
      const o = (s0.opts ?? {}) as { min?: number; max?: number; int?: boolean };
      return desc({ type: o.int ? 'integer' : 'number', ...(o.min !== undefined ? { minimum: o.min } : {}), ...(o.max !== undefined ? { maximum: o.max } : {}) });
    }
    case 'string':
      return desc({ type: 'string' });
    case 'boolean':
      return desc({ type: 'boolean' });
    case 'enum':
      return desc({ type: 'string', enum: [...(s0.values as string[])] });
    case 'literal':
      return desc({ const: s0.value });
    case 'optional':
    case 'nullable':
      return toJsonSchema(s0.inner as Schema<unknown>);
    case 'array': {
      if (schema.meta.unit === 'm' && (s0.item as { kind: string }).kind === 'number') return desc({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'point [x, z] in metres (x = east, z = south)' });
      return desc({ type: 'array', items: toJsonSchema(s0.item as Schema<unknown>) });
    }
    case 'record':
      return desc({ type: 'object', additionalProperties: toJsonSchema(s0.value as Schema<unknown>) });
    case 'object': {
      const shape = s0.shape as Record<string, Schema<unknown>>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = toJsonSchema(v);
        if (v.kind !== 'optional') required.push(k);
      }
      const passthrough = Boolean((s0.opts as { passthrough?: boolean } | undefined)?.passthrough);
      return desc({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: passthrough });
    }
    case 'union':
      return desc({ anyOf: (s0.options as Schema<unknown>[]).map((o) => toJsonSchema(o)) });
    case 'param':
      return desc({ type: 'object', properties: { value: { type: 'number' }, unit: { type: 'string' } }, required: ['value', 'unit'] });
    case 'series':
      return desc({ type: 'object', properties: { values: { type: 'array', items: { type: 'number' } }, unit: { type: 'string' } }, required: ['values', 'unit'] });
    default:
      return desc({});
  }
}
