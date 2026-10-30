// avenOS in the browser. A Peer-Light's origin from the cast runs avenOS as that device; a host whose `/aven.json`
// names an Aven Peer is that network's (Network.svelte: claim it, sign in, or invite only); any other host is the
// box's own view (localhost) or a visitor's (App.svelte).
import { mount } from 'svelte';
import cast from '../../sandbox/cast.json';
import App from './App.svelte';
import Network from './Network.svelte';
import { hostNetwork, runNetwork } from './network.svelte.js';
import { runLight } from './peers.svelte.js';
import './style.css';

const device = Object.keys(cast.peers).find((id) => cast.peers[id].origin === location.hostname);
const target = document.getElementById('app');

// a Peer-Light's origin runs that Peer-Light, in a worker of its own
if (device) runLight(cast, device);
const config = device ? null : await hostNetwork();

document.title = device ? `avenOS · ${cast.peers[device].name}` : 'avenOS';
if (config) {
	runNetwork(config);
	mount(Network, { target, props: { config } });
} else mount(App, { target, props: { cast, device } });
