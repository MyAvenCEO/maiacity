import { mount } from 'svelte';
import App from './App.svelte';
import { session } from '../../../src/lib/avendb/session.svelte.js';
import { sync } from '../../../src/lib/avendb/sync.svelte.js';
window.fixtureSession = session;
window.fixtureBehind = () => Object.assign(sync, { known: true, behind: 200 });
mount(App, { target: document.body });
