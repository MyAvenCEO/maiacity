// @ts-nocheck — plain JS, runs inside the box before anything else
/*
 * THE SHELL'S SECOND LOCK — the frame's rules (./frame.js) are the first: no origin, no connection. Browsers differ in
 * what those rules cover (Safari lets a frame with no origin open its cache storage), so before any builder runs, every
 * way out a worker has is taken off its global scope. A worker has no second realm to fetch them back from: the
 * nested worker goes too, and eval is refused by the frame's policy.
 */
const GONE = [
	'fetch',
	'XMLHttpRequest',
	'WebSocket',
	'WebTransport',
	'EventSource',
	'importScripts',
	'indexedDB',
	'IDBFactory',
	'caches',
	'CacheStorage',
	'Cache',
	'Worker',
	'SharedWorker',
	'BroadcastChannel',
	'Request',
	'Response',
	'FileSystemHandle',
	'FileSystemDirectoryHandle',
	'StorageManager'
];

/** takes `name` off `obj` and everything it inherits from, so no prototype still carries it */
function remove(obj, name) {
	for (let o = obj; o; o = Object.getPrototypeOf(o)) {
		if (!Object.prototype.hasOwnProperty.call(o, name)) continue;
		if (!Reflect.deleteProperty(o, name)) Object.defineProperty(o, name, { value: undefined, writable: false, configurable: false });
	}
}

for (const name of GONE) remove(self, name);
if (self.navigator) remove(self.navigator, 'storage');
