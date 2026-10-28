// @ts-nocheck
/** Same bounded streaming probes as the standalone network check. No credentials,
 * account payloads, full response buffers or arbitrary error strings are exported.
 * @param {{signal?: AbortSignal, fetcher?: typeof fetch, origin?: string, now?: () => number, random?: Crypto, transferMs?: number}} [options] */
export async function runNetworkDiagnostics({ signal, fetcher = fetch, origin = location.origin, now = () => performance.now(), random = crypto, transferMs = 8000 } = {}) {
 const results = [], MiB = 1048576;
 async function request(kind, url, bytes, { upload, manifest = false } = {}) {
  if (signal?.aborted) return { kind, status: 'cancelled' };
  const controller = new AbortController(), start = now();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, transferMs);
  const result = { kind, status: 'unavailable', requestedBytes: bytes, receivedBytes: 0, ms: null, mbps: null };
  const chunks = [];
  try {
   const target = new URL(url, origin); target.searchParams.set('audit', random.randomUUID());
   const response = await fetcher(target, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    ...(kind === 'maia-download' ? { headers: { Range: `bytes=0-${bytes-1}` } } : {}),
    ...(upload ? { method: 'POST', body: upload, headers: { 'Content-Type': 'application/octet-stream' } } : {}) });
   result.httpStatus = response.status;
   result.headersMs = Math.max(0, now() - start);
   if (!response.ok || (kind === 'maia-download' && response.status !== 206)) { result.reason = 'http-or-range-unavailable'; await response.body?.cancel(); return result; }
   const reader = response.body?.getReader();
   if (!reader) { result.reason = 'stream-unavailable'; return result; }
   const limit = upload ? 65536 : Math.max(bytes, 1024);
   for (;;) {
    const part = await reader.read(); if (part.done) break;
    result.receivedBytes += part.value.byteLength;
    if (result.receivedBytes > limit) { await reader.cancel(); result.reason = 'response-byte-limit'; return result; }
    if (manifest) chunks.push(part.value);
   }
   result.ms = Math.max(0, now() - start);
   if (manifest) {
    const all = new Uint8Array(result.receivedBytes); let at = 0;
    for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
    result.value = JSON.parse(new TextDecoder().decode(all));
   } else if (!upload && result.receivedBytes !== bytes) { result.reason = 'incomplete-byte-count'; return result; }
   const encoding = response.headers.get('content-encoding');
   if (!manifest && !upload && encoding && encoding !== 'identity') { result.reason = 'compressed-wire-size-unavailable'; return result; }
   result.status = 'measured';
   if (upload) result.sentBytes = upload.byteLength;
   if (!manifest && kind !== 'http-rtt' && result.ms > 0) result.mbps = (upload?.byteLength ?? result.receivedBytes) * 8 / result.ms / 1000;
   return result;
  } catch { result.reason = controller.signal.aborted ? (signal?.aborted ? 'cancelled' : 'timeout') : 'network-unavailable'; return result; }
  finally { result.ms ??= Math.max(0, now() - start); clearTimeout(timeout); signal?.removeEventListener('abort', abort); controller.abort(); }
 }
 for (let i = 0; i < 2 && !signal?.aborted; i++) results.push(await request('http-rtt', 'https://speed.cloudflare.com/__down?bytes=0', 0));
 let release = null;
 if (!signal?.aborted) {
  const manifest = await request('release', '/release.json', 262144, { manifest: true });
  const value = manifest.value;
  const file = value?.kind === 'maia.city release v1' && /^[0-9a-f]{40}$/.test(value.commit ?? '') && value.files && typeof value.files === 'object'
   ? Object.keys(value.files).sort().find(key => /^_app\/immutable\/(?:workers\/)?assets\/avendb_browser_bg[.-][A-Za-z0-9_-]+\.wasm$/.test(key) && /^[0-9a-f]{64}$/.test(value.files[key])) : null;
  if (file) { release = { commit: value.commit }; results.push(await request('maia-download', `/${file}`, 4 * MiB)); }
  else results.push({ kind: 'maia-download', status: 'unavailable', reason: manifest.reason ?? 'release-file-unavailable', ms: manifest.ms, mbps: null });
 }
 if (!signal?.aborted) results.push(await request('download', `https://speed.cloudflare.com/__down?bytes=${8 * MiB}`, 8 * MiB));
 if (!signal?.aborted) {
  const upload = new Uint8Array(MiB);
  for (let i = 0; i < upload.length; i += 65536) random.getRandomValues(upload.subarray(i, i + 65536));
  results.push(await request('upload', 'https://speed.cloudflare.com/__up', upload.length, { upload }));
 }
 return { status: signal?.aborted ? 'cancelled' : 'finished', release, results,
  semantics: 'Bounded single-stream HTTP, not maximum bandwidth or avenDB useful throughput. Maia is the public web-serving path; every node remains an ordinary peer.' };
}
