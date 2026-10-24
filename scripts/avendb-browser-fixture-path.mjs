/** Shared static module mapping for the disposable production-worker browser fixture. */
import { join } from 'node:path';
export function fixturePath(path, root, pkg) {
    if (path.includes('..')) throw new Error('invalid path');
    if (path === '/fixture.js') return join(root, 'avendb/crates/avendb-browser/tests/transports/device.js');
    if (path === '/passkey.js') return join(root, 'avendb/crates/avendb-browser/js/passkey.js');
    // remote.js shares this production read policy with the native adapter. Relative
    // module resolution leaves /client/, so it needs its actual repository URL.
    if (path === '/game/code/sources/local-policy.js') return join(root, path.slice(1));
    if (path.startsWith('/client/device/avendb_browser') || path.startsWith('/client/device/snippets/')) return join(pkg, path.slice('/client/device/'.length));
    if (path.startsWith('/client/')) return join(root, 'src/lib/avendb', path.slice('/client/'.length));
    throw new Error(`fixture module not found: ${path}`);
}
