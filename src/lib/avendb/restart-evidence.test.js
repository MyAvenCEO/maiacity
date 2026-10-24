// @ts-nocheck — sanitized diagnostic fixtures.
import {test, expect} from 'bun:test';
import {restartEvidence} from './restart-evidence.js';
const report = (...names) => ({events:names.map(event=>({event,phase:'starting'}))});
test('distinguishes same-document lock from document reload', () => {
 expect(restartEvidence(report('document-start','open','session-lock-request','locked')).kind).toBe('session-lock');
 expect(restartEvidence(report('document-start','open','document-start')).kind).toBe('unexplained-restart');
});
test('explicit reload and unloading navigation are attributed only when recorded', () => {
 expect(restartEvidence(report('document-start','app-reload-request','document-start')).kind).toBe('app-reload');
 expect(restartEvidence(report('document-start','app-navigation-unload','document-start')).kind).toBe('app-navigation');
 expect(restartEvidence(report('document-start','route-navigation','document-start')).kind).toBe('unexplained-restart');
});
test('exit and back-forward events do not establish browser memory termination', () => {
 const answer=restartEvidence(report('document-start','open','pagehide','document-start','navigation-back_forward'));
 expect(answer.kind).toBe('document-navigation');
 expect(restartEvidence(report('document-start','open','worker-failed','document-start')).kind).toBe('unexplained-restart');
});
test('durable boundaries remain useful without sessionStorage or distinct counter values', () => {
 expect(restartEvidence(report('document-start','open','document-start')).kind).toBe('unexplained-restart');
 expect(restartEvidence(report('document-start')).kind).toBe('insufficient');
 expect(restartEvidence({events:[],previous:{phase:'open'}}).kind).toBe('unexplained-restart');
});
test('old reload request does not explain a later unrelated restart', () => {
 expect(restartEvidence(report('document-start','app-reload-request','document-start','open','document-start')).kind).toBe('unexplained-restart');
});
