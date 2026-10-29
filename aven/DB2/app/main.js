// One page, three places: `localhost` is the sandbox's control room, a Peer-Light's origin from the cast shows that
// peer's landing page, and any other host (where the released page is served) shows the public landing page.
import { mount } from 'svelte';
import cast from '../sandbox/cast.json';
import ControlRoom from './ControlRoom.svelte';
import Landing from './Landing.svelte';
import './style.css';

const target = document.getElementById('app');
const host = location.hostname;
const light = Object.entries(cast.peers).find(([, peer]) => peer.origin === host);

if (light) {
	const [id, peer] = light;
	document.title = 'avenOS · coming soon';
	mount(Landing, { target, props: { id, peer, cast } });
} else if (host === 'localhost' || host === '127.0.0.1') {
	mount(ControlRoom, { target, props: { cast } });
} else {
	document.title = 'avenOS · coming soon';
	mount(Landing, { target, props: {} });
}
