// @ts-nocheck
import { test, expect } from 'bun:test';
import { parseHTML } from 'linkedom';
import { screenHost, screenSlot } from './screen-slots.js';
test('screen controls survive late hosts, navigation and host replacement without duplicates', () => {
 const { document } = parseHTML('<html><body><main><button>Clock</button></main><header><div id="a"></div><div id="b"></div></header></body></html>');
 const prior = globalThis.document; globalThis.document = document;
 try {
  const control=document.querySelector('button'), home=document.querySelector('main');
  const a=document.querySelector('#a'), b=document.querySelector('#b');
  const slot=screenSlot(control,'center');
  expect(control.parentElement).toBe(home);
  const first=screenHost(a,'center');
  expect(control.parentElement).toBe(a);
  const right=screenHost(b,'right');
  slot.update('right'); expect(control.parentElement).toBe(b);
  slot.update('center'); first.destroy(); expect(control.parentElement).toBe(home);
  const replacement=screenHost(a,'center'); expect(control.parentElement).toBe(a);
  expect(document.querySelectorAll('button').length).toBe(1);
  slot.destroy(); expect(document.querySelectorAll('button').length).toBe(0);
  expect(home.childNodes.length).toBe(0);
  replacement.destroy(); right.destroy();
 } finally {globalThis.document=prior;}
});
