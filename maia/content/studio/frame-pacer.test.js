// @ts-nocheck — executed by bun:test
import { expect, test } from 'bun:test';
import { FramePacer } from './frame-pacer.js';
test('30 FPS preview stays on cadence across a 60 Hz display clock', () => {
 const p = new FramePacer();
 const frames = Array.from({length: 600}, (_, i) => i * 1000 / 60).filter(t => p.accept(t, 30));
 expect(frames.length).toBe(300);
 for(let i=1;i<frames.length;i++) expect(frames[i]-frames[i-1]).toBeCloseTo(1000/30, 6);
});
test('a late frame does not cause a burst of catch-up renders', () => {
 const p = new FramePacer();
 expect(p.accept(0,30)).toBe(true);
 expect(p.accept(500,30)).toBe(true);
 expect(p.accept(501,30)).toBe(false);
 expect(p.accept(533.4,30)).toBe(true);
});
test('changing FPS and stopping allow an immediate fresh frame', () => {
 const p = new FramePacer(); p.accept(0,30);
 expect(p.accept(10,60)).toBe(true);
 p.reset(); expect(p.accept(11,30)).toBe(true);
});
