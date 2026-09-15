// Puts an HTTP Basic Auth gate in front of the pull zone using Bunny Edge Scripting.
// The password comes from EARLY_ACCESS_PW and is injected into the deployed script.
import { NAMES, api } from './bunny.mjs';

const SCRIPT_NAME = process.env.SCRIPT_NAME ?? 'maiacity-gate';
const USER = process.env.EARLY_ACCESS_USER ?? 'maia';
const PASS = process.env.EARLY_ACCESS_PW;
if (!PASS) throw new Error('EARLY_ACCESS_PW is not set');

const code = `import * as BunnySDK from "https://esm.sh/@bunny.net/edgescript-sdk@0.11.2";

const USER = ${JSON.stringify(USER)};
const PASS = ${JSON.stringify(PASS)};
const REALM = 'maiaCITY early access';

const unauthorized = () =>
  new Response('Early access only.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="' + REALM + '", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const allowed = (header) => {
  if (!header || !header.toLowerCase().startsWith('basic ')) return false;
  try {
    const [user, ...rest] = atob(header.slice(6)).split(':');
    return user === USER && rest.join(':') === PASS;
  } catch {
    return false;
  }
};

BunnySDK.net.http.servePullZone().onOriginRequest((ctx) => {
  if (!allowed(ctx.request.headers.get('authorization'))) return unauthorized();
  return ctx.request;
});
`;

const log = (...args) => console.log(...args);

async function tryJson(path, options) {
	try {
		const result = await api(path, options);
		log(`ok   ${options?.method ?? 'GET'} ${path}`);
		return result;
	} catch (error) {
		log(`fail ${options?.method ?? 'GET'} ${path} :: ${error.message.slice(0, 300)}`);
		return null;
	}
}

// 1. Find or create the middleware script.
const list = await api('/compute/script?page=1&perPage=100');
let script = list.Items?.find((s) => s.Name === SCRIPT_NAME);

if (!script) {
	// ScriptType 0 = middleware (runs on a pull zone), 1 = standalone (own hostname).
	script = await tryJson('/compute/script', {
		method: 'POST',
		body: { Name: SCRIPT_NAME, ScriptType: 0 }
	});
}
if (!script) throw new Error('could not create the edge script');
log(`script: ${script.Name} (id ${script.Id}, type ${script.ScriptType})`);

// 2. Push the code.
const pushed =
	(await tryJson(`/compute/script/${script.Id}/code`, { method: 'POST', body: { Code: code } })) ??
	(await tryJson(`/compute/script/${script.Id}/code`, { method: 'PUT', body: { Code: code } }));
if (!pushed) log('note: code push failed — see errors above');

log('script object: ' + JSON.stringify(await api(`/compute/script/${script.Id}`)).slice(0, 600));
await tryJson(`/compute/script/${script.Id}/publish`, { method: 'POST', body: { Note: 'early access gate' } });

// 3. Attach it to the pull zone.
const zones = await api('/pullzone');
const zone = zones.find((z) => z.Name === NAMES.pullZone);

const attached =
	(await tryJson(`/pullzone/${zone.Id}`, {
		method: 'POST',
		body: { MiddlewareScriptId: script.Id }
	})) ??
	(await tryJson(`/pullzone/${zone.Id}`, {
		method: 'POST',
		body: { EdgeScriptId: script.Id, EdgeScriptExecutionPhase: 0 }
	}));

const after = (await api('/pullzone')).find((z) => z.Name === NAMES.pullZone);
log(`pull zone now: MiddlewareScriptId=${after.MiddlewareScriptId} EdgeScriptId=${after.EdgeScriptId}`);
log(attached ? 'gate attached' : 'gate NOT attached — check the errors above');
log(`user: ${USER}`);
