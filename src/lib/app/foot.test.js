import { test, expect } from 'bun:test';
import { foot, footHost, FOOT } from './foot.js';
function element() { return { style: {}, parent: null, children: [], append(child) { child.remove(); this.children.push(child); child.parent = this; }, remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }; }
test('early children join layout host, update order, clean up and survive host replacement', () => {
 const note = element(), first = element(), second = element();
 const action = foot(note, FOOT.waiting);
 expect(note.parent).toBe(null);
 const host = footHost(first);
 expect(note.parent).toBe(first);
 action.update(FOOT.menu);
 expect(note.style.order).toBe(String(FOOT.menu));
 host.destroy();
 const replacement = footHost(second);
 expect(note.parent).toBe(second);
 action.destroy();
 expect(second.children).toHaveLength(0);
 replacement.destroy();
});
