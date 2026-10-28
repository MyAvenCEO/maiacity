import { mount } from 'svelte';
import App from './App.svelte';
import { session } from '../../../page/session.svelte.js';
import { lifecycle } from '../../../page/lifecycle.js';
window.fixtureLifecycle = lifecycle();
window.fixtureLifecycle.start();
window.fixtureSession = session;
window.fixtureDocument = crypto.randomUUID();
mount(App, { target: document.body });
