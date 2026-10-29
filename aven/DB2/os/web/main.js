// One page, three places: `localhost` is the sandbox's control room, a Peer-Light's origin from the cast runs avenOS
// as that peer, and any other host (where the released avenOS is served) shows avenOS alone.
import { mount } from 'svelte';
import cast from '../../sandbox/cast.json';
import ControlRoom from './ControlRoom.svelte';
import AvenOS from './AvenOS.svelte';
import './style.css';

const target = document.getElementById('app');
const host = location.hostname;
const light = Object.entries(cast.peers).find(([, peer]) => peer.origin === host);

if (light) {
	const [id, peer] = light;
	document.title = 'avenOS · coming soon';
	mount(AvenOS, { target, props: { id, peer, cast } });
} else if (host === 'localhost' || host === '127.0.0.1') {
	mount(ControlRoom, { target, props: { cast } });
} else {
	document.title = 'avenOS · coming soon';
	mount(AvenOS, { target, props: {} });
}
