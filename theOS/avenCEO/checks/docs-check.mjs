// The docs check (AIP-1, claim c1): content a person can't reach. Its rule:
//   1. every scroll container whose content is taller than it can scroll: a box whose overflow-y clips (hidden or
//      clip; in CSS, hidden makes a scroll container that only a script can scroll) fails when its content is taller
//      than it; auto and scroll let a person scroll, visible hands the content to the box around it;
//   2. the page never scrolls sideways: content wider than the window fails, whether the page scrolls to it or hides it;
//   3. boxes made to scroll sideways are fine (their overflow is theirs, not the page's).
// A fixed box doesn't scroll with the page: one whose box or content reaches past the window fails.
// docsCheck runs inside the page (Playwright's page.evaluate), so it must not use anything from this module's scope.
// It returns one entry per failure; an empty list is a pass.
export function docsCheck() {
  const SLACK = 1; // sub-pixel rounding, never a line of text
  const fails = [];
  const blocked = (v) => v === 'hidden' || v === 'clip';
  const where = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      parts.unshift(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + [...e.classList].map((c) => `.${c}`).join(''));
      if (e.id) break;
    }
    return parts.join(' > ');
  };
  const html = document.documentElement, body = document.body;
  const hs = getComputedStyle(html), bs = body ? getComputedStyle(body) : null;
  // The page (the viewport) takes its overflow from <html>, or from <body> when <html>'s is visible; <body> then
  // doesn't clip anything itself.
  const fromBody = hs.overflowX === 'visible' && hs.overflowY === 'visible' && bs;
  const page = fromBody ? bs : hs;
  const se = document.scrollingElement || html;
  if (se.scrollHeight > innerHeight + SLACK && blocked(page.overflowY)) {
    fails.push({ rule: 'the page is taller than the window and cannot scroll', where: fromBody ? 'body' : 'html', content: se.scrollHeight, box: innerHeight, overflow: page.overflowY });
  }
  // When <html> and <body> both clip sideways, <body> clips on its own and the page's width never counts what it hides.
  const wide = Math.max(se.scrollWidth, fromBody || !body ? 0 : body.scrollWidth);
  if (wide > html.clientWidth + SLACK) {
    fails.push({ rule: blocked(page.overflowX) ? 'the page is wider than the window and hides the rest' : 'the page scrolls sideways', where: 'page', content: wide, box: html.clientWidth, overflow: page.overflowX });
  }
  for (const el of document.querySelectorAll('body *, body')) {
    if (el === body && fromBody) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || !el.getClientRects().length) continue;
    // A fixed box doesn't move with the page: whatever reaches past the window's bottom can't be scrolled to, its own
    // box whatever its overflow (one that grows to fit never scrolls), and content spilling out of it too.
    if (s.position === 'fixed') {
      const r = el.getBoundingClientRect();
      const bottom = ['auto', 'scroll'].includes(s.overflowY) ? r.bottom : Math.max(r.bottom, r.top + el.scrollHeight);
      if (bottom > innerHeight + SLACK) fails.push({ rule: 'a fixed box reaches past the window', where: where(el), content: Math.round(bottom), box: innerHeight, overflow: s.overflowY });
    }
    if (!blocked(s.overflowY)) continue;
    if (el.scrollHeight > el.clientHeight + SLACK) {
      fails.push({ rule: 'a box is taller inside than it can scroll', where: where(el), content: el.scrollHeight, box: el.clientHeight, overflow: s.overflowY });
    }
  }
  return fails;
}
