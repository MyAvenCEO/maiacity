// `localhost` is the control room; a Peer-Light's origin from the cast shows that peer's landing page.
import { mount } from 'svelte';
import cast from '../sandbox/cast.json';
import ControlRoom from './ControlRoom.svelte';
import Landing from './Landing.svelte';
import './style.css';

const target = document.getElementById('app');
const light = Object.entries(cast.peers).find(([, peer]) => peer.origin === location.hostname);

if (light) {
	const [id, peer] = light;
	document.title = 'avenDB2 · coming soon';
	mount(Landing, { target, props: { id, peer, cast } });
} else {
	mount(ControlRoom, { target, props: { cast } });
}
