import { mount } from 'svelte';
import App from './App.svelte';
import { session } from '../../../src/lib/avendb/session.svelte.js';
import { lifecycle } from '../../../src/lib/avendb/lifecycle.js';
window.fixtureLifecycle = lifecycle();
window.fixtureLifecycle.start();
window.fixtureSession = session;
window.fixtureDocument = crypto.randomUUID();
mount(App, { target: document.body });
