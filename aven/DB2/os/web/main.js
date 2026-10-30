// avenOS in the browser. A Peer-Light's origin from the cast runs avenOS as that device; a host whose `/aven.json`
// names an Aven Peer is that network's (Network.svelte: claim it, sign in, or invite only); any other host is the
// box's own view (localhost) or a visitor's (App.svelte). Every view of the tree is pushed by the Peer-Light's core
// (id.svelte.js), the page's one WebAssembly module.
import { mount } from 'svelte';
import cast from '../../sandbox/cast.json';
import App from './App.svelte';
import Network from './Network.svelte';
import { hostNetwork, net, runNetwork, storageBlocked } from './network.svelte.js';
import { runBox, runLight } from './peers.svelte.js';
import './style.css';

const device = Object.keys(cast.peers).find((id) => cast.peers[id].origin === location.hostname);
const target = document.getElementById('app');

// a Peer-Light's origin runs that Peer-Light, in a worker of its own
if (device) runLight(cast, device);
const config = device ? null : await hostNetwork();

// the box's own view gets its views from a Peer-Light's core too; a visitor's host runs none and may act as no one
if (!device && !config && location.hostname === 'localhost') runBox(cast);

document.title = device ? `avenOS · ${cast.peers[device].name}` : 'avenOS';
if (config) {
	// a window that keeps no storage for this host (a private window) gets no Peer-Light, and is told why
	net.storage = await storageBlocked();
	if (!net.storage) runNetwork(config);
	mount(Network, { target, props: { config } });
} else mount(App, { target, props: { cast, device } });
