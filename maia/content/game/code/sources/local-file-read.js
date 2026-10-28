// @ts-nocheck
/** Whole local files have one allocation/read loop per device+root. Each caller owns its deadline.
 * When all callers leave, stop after the current chunk returns. Keep the cancelled flight registered
 * until then so retries cannot multiply full-file buffers behind a blocked worker. No network fallback. */
export function createLocalFileReads({ window = 4 << 20, allocate = n => new Uint8Array(n), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
 const devices = new WeakMap();
 return function read(device, file, wait) {
  if (!device || !file || typeof file.root !== 'string' || !Number.isSafeInteger(file.len) || file.len < 0 || !Number.isSafeInteger(file.size) || file.size < 0 || !Number.isFinite(wait) || wait <= 0) return Promise.resolve(null);
  let flights = devices.get(device);
  if (!flights) devices.set(device, flights = new Map());
  const key = JSON.stringify([file.root, file.size, file.len]);
  let flight = flights.get(key);
  if (flight?.cancelled) return Promise.resolve(null);
  if (!flight) {
   flight = { cancelled: false, consumers: new Set() };
   flights.set(key, flight);
   const ours = flight;
   // Let the first consumer register before work starts. A zero-consumer cancelled flight never allocates.
   void Promise.resolve().then(async () => {
    if (ours.cancelled) return null;
    const bytes = allocate(file.len);
    for (let at = 0; at < file.len;) {
     if (ours.cancelled) return null;
     const end = Math.min(file.len, at + window);
     const result = await device.run({ op: 'read_file', root: file.root, size: file.size, from: at, to: end, local: true });
     if (ours.cancelled) return null;
     const chunk = result?.bytes;
     if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > end - at) throw new Error('Invalid local file range');
     bytes.set(chunk, at);
     at += chunk.length;
    }
    return bytes;
   }).catch(() => null).then(bytes => {
    // Remove before waking consumers: their continuations can immediately request a fresh read.
    if (flights.get(key) === ours) flights.delete(key);
    // Nobody receives a result after their own deadline, even if another caller kept the read alive.
    for (const consumer of [...ours.consumers]) consumer.finish(bytes);
   }).finally(() => { if (flights.get(key) === ours) flights.delete(key); });
  }
  const ours = flight;
  return new Promise(resolve => {
   const consumer = { timer: undefined, finish(bytes) { clearTimer(consumer.timer); ours.consumers.delete(consumer); resolve(bytes); } };
   ours.consumers.add(consumer);
   consumer.timer = setTimer(() => {
    consumer.finish(null);
    if (!ours.consumers.size) ours.cancelled = true;
   }, wait);
  });
 };
}
