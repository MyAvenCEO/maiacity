// One run of Lean's WebAssembly build (Lean 4.35.0, our own build: lean-4.35.0-wasm.patch), the same in a page and in
// Node: a fresh instance of the compiled module, its in-memory filesystem filled with the files given, Lean's
// command line run once. It answers Lean's exit code, what it wrote, how long the run took and how big the
// instance's memory grew (the WebAssembly heap, which is what a phone's tab pays for).

/** The bundle pack.mjs writes: `index` lists `{path, size}` in the order their bytes follow each other in `bytes`. */
export function unbundle(index, bytes) {
	const files = new Map();
	let at = 0;
	for (const f of index.files) {
		files.set(f.path, bytes.subarray(at, at + f.size));
		at += f.size;
	}
	return files;
}

/** Runs `lean` with `args` on `files` (a Map of absolute path to bytes); `createLean` is lean.js's factory and
 * `module` the compiled lean.wasm, shared by every run so it is compiled once; `keep` names files to read back. */
export async function run({ createLean, module, files, args, leanPath, keep = [] }) {
	const out = [];
	const err = [];
	let code = null;
	const t0 = performance.now();
	const lean = await createLean({
		noInitialRun: true,
		print: (s) => out.push(s),
		printErr: (s) => err.push(s),
		onExit: (c) => (code = c),
		instantiateWasm(imports, done) {
			WebAssembly.instantiate(module, imports).then((instance) => done(instance, module));
			return {};
		},
	});
	const t1 = performance.now();
	for (const [path, bytes] of files) {
		const dir = path.slice(0, path.lastIndexOf('/'));
		if (dir) lean.FS.mkdirTree(dir);
		lean.FS.writeFile(path, bytes);
	}
	lean.ENV.LEAN_PATH = leanPath;
	const t2 = performance.now();
	try {
		const c = lean.callMain(args);
		if (code === null) code = c;
	} catch (e) {
		// emscripten's exit() unwinds as an ExitStatus; anything else is a crash
		if (e && e.name === 'ExitStatus') code = e.status;
		else err.push(String(e && e.stack ? e.stack : e));
	}
	const t3 = performance.now();
	const kept = {};
	for (const path of keep) {
		try {
			kept[path] = lean.FS.readFile(path);
		} catch {}
	}
	const heap = lean.HEAP8 ? lean.HEAP8.buffer.byteLength : (lean.wasmMemory?.buffer.byteLength ?? null);
	return {
		code,
		out: out.join('\n'),
		err: err.join('\n'),
		ms: { start: Math.round(t1 - t0), files: Math.round(t2 - t1), lean: Math.round(t3 - t2) },
		heapMB: heap ? Math.round(heap / 1048576) : null,
		kept,
	};
}
