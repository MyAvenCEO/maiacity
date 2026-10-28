import { mount } from 'svelte';
import App from './App.svelte';
import { session } from '../../../page/session.svelte.js';
import { sync } from '../../../page/sync.svelte.js';
window.fixtureSession = session;
window.fixtureBehind = () => Object.assign(sync, { known: true, behind: 200 });
mount(App, { target: document.body });
