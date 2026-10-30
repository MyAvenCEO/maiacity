// avenOS in the browser. A Peer-Light's origin from the cast runs avenOS as that device; any other host is the box's own
// view (localhost) or a visitor's (App.svelte).
import { mount } from 'svelte';
import cast from '../../sandbox/cast.json';
import App from './App.svelte';
import { runLight } from './peers.svelte.js';
import './style.css';

const device = Object.keys(cast.peers).find((id) => cast.peers[id].origin === location.hostname);

// a Peer-Light's origin runs that Peer-Light, in a worker of its own
if (device) runLight(cast, device);

document.title = device ? `avenOS · ${cast.peers[device].name}` : 'avenOS';
mount(App, { target: document.getElementById('app'), props: { cast, device } });
