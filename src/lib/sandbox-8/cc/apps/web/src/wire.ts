/**
 * Wire format for protocol messages over a WebSocket (server mode).
 *
 * Messages are the same as between the UI and the Web Worker (protocol.ts). Structured clone is
 * not available over a socket, so:
 *   - typed arrays (terrain heights, colours, trees) travel as raw binary after a JSON header
 *   - non-finite numbers (ETA = Infinity) survive as markers instead of becoming null
 * Layout: [u32 header length][header JSON (utf-8)][pad to 8][blob 0][pad][blob 1]…
 */

type TypedArray = Float32Array | Float64Array | Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Uint8ClampedArray;

const CTORS: Record<string, new (buffer: ArrayBuffer, offset: number, length: number) => TypedArray> = {
  Float32Array,
  Float64Array,
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Uint8ClampedArray,
};

const align8 = (n: number) => (n + 7) & ~7;

/** Encode a message (any JSON-like value with typed arrays) as one binary buffer. */
export function encodeMessage(msg: unknown): Uint8Array {
  const blobs: TypedArray[] = [];
  const descs: { o: number; n: number }[] = [];
  let offset = 0;
  const json = JSON.stringify(msg, function (this: unknown, _key: string, value: unknown) {
    if (typeof value === 'number' && !Number.isFinite(value)) return { $n: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Inf' : '-Inf' };
    if (value && typeof value === 'object' && ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      const ta = value as TypedArray;
      const k = ta.constructor.name;
      if (!CTORS[k]) return Array.from(ta as ArrayLike<number>);
      const d = { o: offset, n: ta.length };
      descs.push(d);
      blobs.push(ta);
      offset = align8(offset + ta.byteLength);
      return { $ta: k, o: d.o, n: d.n };
    }
    return value;
  });
  const header = new TextEncoder().encode(json);
  const base = align8(4 + header.byteLength);
  const out = new Uint8Array(base + offset);
  new DataView(out.buffer).setUint32(0, header.byteLength, true);
  out.set(header, 4);
  blobs.forEach((b, i) => out.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), base + descs[i]!.o));
  return out;
}

/** Decode a buffer produced by encodeMessage. Typed arrays are copied out of the buffer. */
export function decodeMessage<T = unknown>(data: ArrayBuffer | Uint8Array): T {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(0, true);
  const json = new TextDecoder().decode(bytes.subarray(4, 4 + len));
  const base = align8(4 + len);
  return JSON.parse(json, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as { $n?: string; $ta?: string; o?: number; n?: number };
      if (v.$n !== undefined && Object.keys(v).length === 1) return v.$n === 'NaN' ? NaN : v.$n === 'Inf' ? Infinity : -Infinity;
      if (v.$ta !== undefined && CTORS[v.$ta]) {
        const Ctor = CTORS[v.$ta]!;
        const bytesPer = (Ctor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
        const start = bytes.byteOffset + base + v.o!;
        const copy = bytes.buffer.slice(start, start + v.n! * bytesPer) as ArrayBuffer;
        return new Ctor(copy, 0, v.n!);
      }
    }
    return value;
  }) as T;
}
