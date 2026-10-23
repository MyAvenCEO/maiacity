import { mount } from 'svelte';
import App from './App.svelte';
import { session } from '../../../src/lib/avendb/session.svelte.js';
window.fixtureSession = session;
window.fixtureDocument = crypto.randomUUID();
mount(App, { target: document.body });
