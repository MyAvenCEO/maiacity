---
title: Captions in DaVinci Resolve, five times faster
originalTitle: "DaVinci Resolve just made It 5X FASTER"
source: https://www.youtube.com/watch?v=T0Pncr6oyMo
type: video
author: Maciek Sulima
authorUrl: https://www.youtube.com/@maciek_sulima
added: 2026-09-16
categories: [filmmaking, ai, code]
hook: >-
  Forty captions on the timeline, and the client wants a different font. In DaVinci Resolve
  that used to mean forty clicks into forty titles, one slider at a time.
shift:
  from: Every caption is its own title, so every change is made forty times, by hand, with sliders.
  to: One template, a text box you drag in the viewer, and the whole group edited at once.
quote: "It sounds like a small thing, but this is a massive update."
---

## The story

Forty captions on a timeline. One font change.

That used to be forty separate jobs in DaVinci Resolve. Open a title, change the font, close it, open the next. Want all of them a little higher? Forty more. A little bigger? Forty again. Maciek Sulima has been cutting reels and short-form video on a Polish filmmaking channel for years, and this was the part of the job he describes as painful — not hard, just endlessly repeated.

Every caption is a Text+ title, and Text+ is built for one title at a time. Sliders in a panel, one parameter each. Fine for a lower third. Miserable for a transcript.

Resolve 21.1 changed the first half of that. Select several Text+ titles and the Inspector edits them together: font, size, position, scale, in a few clicks instead of a few hundred.

That alone is worth the update. It is still only half of the trick.

The other half is where the size comes from. Out of the box you set a title's size with a slider, then set its position with another slider, then go back to the first one because the second one changed what looked right. Sulima's fix is to stop using the slider at all: he ties the size to a text box, switches the layout to that box, and turns on the Fusion overlay so the box shows in the viewer. From then on he grabs the corners of the box with the mouse. Bigger box, bigger text. Drag it, the text moves. Multi-line layouts that took a minute of slider-nudging take a second of dragging.

One problem. That setup is an expression, and an expression can't be applied to forty titles at once.

So he applies it once. One Text+ with the expression and the text box already set becomes a template. He drops the template into the bin of Snap Captions, a free plug-in that turns a transcript into individual Text+ titles, chooses how many words per caption, and runs it. Every caption it generates is born with the setup inside.

Now the job is: click a caption, drag its box where it should sit, next. Select the whole group and change the layout position to move all of them together, their individual spacing intact. Back to the Inspector to scale the group as one.

Forty captions, one font, one drag.

## From the ground up

- **A Text+ title.** In DaVinci Resolve, text on screen is a clip called Text+. Each caption is its own Text+ clip on the timeline, which is why a transcript turns into dozens of them.
- **The Inspector.** The panel on the right that shows a clip's settings — font, size, position, colour — as sliders and boxes. Before 21.1 it only ever showed one Text+ at a time; now it edits every selected one together.
- **The Text and Layout tabs.** Two pages inside a Text+'s settings. Text holds the font and the size. Layout decides how the text sits in the frame.
- **An expression.** A small formula you attach to a parameter instead of a fixed number. Right-click a parameter, choose Expression, and from then on the value is calculated, not typed. Here it tells the size to follow the text box.
- **Layout mode: text box.** A layout setting that puts the text inside a rectangle. With the expression on size, the rectangle becomes the control: resize the box and the text resizes with it.
- **The Fusion overlay.** A view option that draws a title's controls — the text box, in this case — directly on the picture in the viewer, so you can grab and drag them there.
- **A template.** One Text+ that already carries the expression and the text box setup. Anything cloned from it carries the setup too.
- **Snap Captions.** A free plug-in that converts captions into separate Text+ titles. Give it a template and every title it makes starts as a copy of it.

## The steps

1. Update to DaVinci Resolve 21.1 or later — multi-selection editing of Text+ arrived there.
2. Create the captions: transcribe the clip and convert the transcript into Text+ titles.
3. Open one Text+ and go to the Size parameter on the Text tab.
4. Right-click Size, choose Expression, and enter the expression from the video (see Open questions). Size now follows the text box.
5. Go to the Layout tab and set the layout mode to Text Box.
6. Enable the Fusion overlay in the viewer. The text box appears on the picture; drag its corners to resize the text, drag the box to move it.
7. Keep that one Text+ as your template. Don't repeat steps 3–5 by hand — the expression can't be applied to many titles at once.
8. Drag the template into the Snap Captions bin, choose the words per caption, and run it. Every generated caption already has the setup.
9. Go through the captions: select each, drag its box into place.
10. To move the whole group, select all of them and change the layout position. Their spacing stays.
11. To scale the whole group, select all of them and scale in the Inspector.

## Beliefs that shift

- *Changing forty titles means forty edits.* → Select them all; the Inspector edits the group.
- *Size is a slider.* → Size can be a box you drag in the picture, and a box is faster than any slider.
- *A clever setup has to be rebuilt every time.* → Build it once, make it the template, let the plug-in copy it forty times.

## What we learn

- **Repeated work is a design flaw, not a chore.** If you do the same edit forty times, the fix is in the setup, not in typing faster.
- **Put the control where the eye is.** Dragging a box on the picture beats a slider in a panel because you see the result while you make it.
- **Expressions replace hands.** A parameter that follows another parameter is one you never touch again.
- **Templates scale what expressions can't.** The one thing that couldn't be applied in bulk was applied once and cloned.
- **Group moves keep group spacing.** Moving the layout position shifts everything together; scaling in the Inspector resizes everything together.

## Open questions

- The exact expression entered on the Size parameter is shown on screen, not spoken; it ties size to the text box. Confirm the expression before relying on it.
- Snap Captions is described as free; check the current licence and the Resolve versions it supports.
- The follow-up video promises an animation workflow built on this setup — worth adding to the library when it lands.
