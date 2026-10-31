// avenOS in the browser. A Peer-Light's origin from the cast runs avenOS as that device; a host whose `/aven.json`
// names an Aven Peer is that network's (Network.svelte: claim it, sign in, or invite only); any other host is the
// box's own view (localhost) or a visitor's (App.svelte). Every view of the tree is pushed by the Peer-Light's core
// (id.svelte.js), the page's one WebAssembly module. #/brain is avenBRAIN on every host (Root.svelte).
import { mount } from 'svelte';
import cast from '../../sandbox/cast.json';
import App from './App.svelte';
import Network from './Network.svelte';
import Updating from './Updating.svelte';
import Root from './Root.svelte';
import { hostNetwork, net, runNetwork, storageBlocked } from './network.svelte.js';
import { runBox, runLight } from './peers.svelte.js';
// the fonts are self-hosted from their packages: avenOS calls no third party
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/inter';
import './style.css';

const device = Object.keys(cast.peers).find((id) => cast.peers[id].origin === location.hostname);
const target = document.getElementById('app');
// "Updating…" while this tab follows an `update` refusal, over whatever else shows (update.svelte.js)
mount(Updating, { target: document.body });

// a Peer-Light's origin runs that Peer-Light, in a worker of its own
if (device) runLight(cast, device);
const config = device ? null : await hostNetwork();

// the Service Worker that answers the chat's /files/<hash> from this origin's Peer-Light, named as its worker is
// (public/files-sw.js)
const files = (name) => navigator.serviceWorker?.register(`/files-sw.js?name=${encodeURIComponent(name)}`).catch(() => {});
if (device) files(device);

// the box's own view gets its views from a Peer-Light's core too; a visitor's host runs none and may act as no one
if (!device && !config && location.hostname === 'localhost') runBox(cast);

document.title = device ? `avenOS · ${cast.peers[device].name}` : 'avenOS';
if (config) {
	// a browser that keeps no storage for this host (site data blocked, always private) gets no Peer-Light, and is told why
	net.storage = await storageBlocked();
	if (!net.storage) runNetwork(config);
	if (!net.storage) files('network');
	mount(Root, { target, props: { view: Network, props: { config } } });
} else mount(Root, { target, props: { view: App, props: { cast, device } } });
