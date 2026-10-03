---
title: We put thirteen domes in one world, and you can walk into every one without waiting
subtitle: avenCITY Sandbox 4 is a whole dome cell to walk, from the café squares round the master dome to the food forest at its edges, and what it took to make a browser carry it.
day: 17
author: avenSAMUEL
authorImage: dad53831fb215f1d6c5fc29c111aba8a2d7b472b43ab076da7537787c2895b8a.jpg
authorRole: Building maiaCITY
date: 2026-09-25
cover: 3522dc73211ca1727f9329862beeadfc53ec20018b95d90c98b427163c77404c.jpg
coverAlt: A dome cell from the air, the master dome in the middle, six large and six medium domes round it, paths and a stream through a thick food forest.
excerpt: >-
  Until today every dome stood alone, behind a loading screen. Now thirteen of them stand in one
  world, and the moment you step into a doorway you are simply inside.
categories: [game, housing, food, code]
draft: true
---

Until today, every dome stood alone.

You chose one from a list, watched a loading screen, and walked around it. When you left it, it was gone. Nothing stood beside it.

A village is not a list of buildings. It is the walk between them.

## A dome cell is thirteen domes and everything between them

![A dome cell from the air: the master dome in the middle, the rings of domes round it, paths and a stream through the forest.](3522dc73211ca1727f9329862beeadfc53ec20018b95d90c98b427163c77404c.jpg)

In [avenCITY Sandbox 4](/games/sandbox-4/) you stand in a whole dome cell. The master dome is in the middle. Six large domes stand in a ring round it, and six medium domes stand further out, between them. They are the same domes you walked through on [Day 15](/blog/day-15-inside-the-domes/): the same glass, the same stone arcades and terraces, the same four doors.

Between them, paths wander from door to door, in to the ring round the master dome and out to a loop round the whole cell. A turquoise stream winds round the edge and sends its creeks in between the domes, each one ending in a pond, with a timber bridge wherever a path crosses the water.

![Looking down between the domes: the paths, the stream and its creeks, the forest.](9eed66bb5e73ae7bc39744d85c416ae23bdafcdfaf03545aec060209fbd98573.jpg)

## The land between the domes is a forest you can eat

Round a single dome on Day 15, the forest was dense: a tree every few metres, each with its guild of shrubs, herbs, clover, squash and climbing vines. I wanted the same density everywhere in the cell, not a thin scatter of trees between the domes.

![Between two domes: fruit trees, berry bushes and flowers along the path.](e841e8de88eef17c9ba84b9e30195aa0aa2b2fce3e148161c5ab3f44d3bfb1aa.jpg)

Beyond the medium domes, out to the edges of the cell, the forest gets thicker still. Every layer is full there, and every kind is in it: chestnut and walnut, apple, mango, avocado and citrus, papaya, fig, pomegranate, coconut palms and bananas. Under them grow coffee and cacao, berries, comfrey, ginger, strawberries, pumpkins and passion fruit. It is the part of the cell that feeds it.

![The food forest at the edge of the cell, every layer full.](cab04a7593bc33ea53453056d1adf5b4522b11a9ec4f0eab174039be57559676.jpg)

The master dome has everything round it that it has in Sandbox 3. There are twelve café squares off its ring path: cafés, restaurants under strings of lights, fruit bars, pizza ovens. The hens scratch about their coops among the trees.

![A restaurant square beside the master dome, the forest behind it.](251d10efd50c39ff2c94d60ab63da70729af3bcafe57a2d7fd3cc64d16612f80.jpg)

![A hen coop in the trees beside the master dome.](577f1497f1fa9c035c1dca2a4524868b031f23975e76f897ca8dfb9e536dc6c3.jpg)

## The roof is solar glass, and you can still see the sky

The glass of every dome is now what it is meant to be: solar glass. Each triangle has rows of dark blue cells laid into it, with clear gaps between them, so it is lightly tinted from outside. From inside you look up through a lattice of cells at the sky, and the light still falls through to the forest.

![Looking up from inside the master dome through the solar glass.](adfd93e8cf0dbb793c1e36d2217ce34a1d6b7dbfc37467782349b08eb05ea409.jpg)

## You walk in, and there is no loading screen

This was the hard part.

A dome's full inside is heavy. The master dome has thousands of plants, a theatre, workshops, two floors of rooms, galleries, stairs and terraces. Building one takes several seconds. Thirteen of them at once would not fit in a browser at all.

So the cell uses a trick games have always used: *level of detail*. From a distance, every dome is a simple version of itself. It has its real glass, arcade and terraces, but only a sketch of the inside: the soil, the plaza, the beds, the galleries and rooms, simple trees, the master's stone tiers. As you walk up to a dome, the game quietly builds its full inside into the world, a piece at a time, while you are still walking. When it is ready, the simple version steps aside.

![Walking up to the master dome: by the time you reach the door, its full inside is there.](0e257b7076a46a9cca06d28e2d6acac26ad256b76045702069a828938cc1e62b.jpg)

By the time you reach the door, the dome is complete. You walk through it into the real thing: the food forest, the kitchen garden, the stairs up to the galleries, the terraces. There is no screen in between and no second world. Walk away across the cell and the inside is taken down again, to make room for the next dome you walk towards.

![Through the door of the master dome and straight into its forest.](dbb8051ef5b8733a10f793725312e46f60bb317aca58cb569f688a372cff8331.jpg)

## What it takes to carry a whole cell

The forest needed the same treatment. Around the domes and out to the edges there are tens of thousands of plants. Drawing every leaf of every one of them, all the time, is impossible. So the cell is cut into tiles of seventy metres. The tiles near you draw every plant in full, fruit and all. The tiles further off draw a simple tree for each one: a trunk and a crown the right size, in the right place. As you walk, the tiles change over, and you never see it happen.

A few more things keep it running:

- **Everything that shares a shape is drawn together.** A thousand apple trees are one piece of work for the graphics card, not a thousand.
- **The game knows where things are.** Every tree, pillar and table is filed by area, so checking whether you can take a step looks at the few things near you, not the forty thousand in the cell.
- **Lights follow you.** A browser can only afford a handful of real lights. The eight lamps nearest to you light their rooms, stairs and paths, and the rest glow where they hang.
- **The moon holds still.** On the first night in the cell, the moonlight spun round the sky, because the light that follows you was re-aimed from its own last position every frame and drifted. It now takes its direction from the sky and only moves with you.

On my laptop the cell runs at about 40 frames a second out in the forest, and a little less inside the master dome with all of it around you.

## At night it is lit for the walk home

The sun follows the in-game clock, so the cell has its evenings and its nights. When it gets dark, small lights come on along every path, and the domes glow warm through their glass.

![The master dome at night, lit from inside, a path light at the edge of the forest.](1f5d51413b7cdbfc88713427995babcbfd280c44b8647ca18844d870963e4cdc.jpg)

Imagine walking home through it. You leave the café square by the master dome, cross the bridge over the creek, and follow the lights between the trees to the medium dome where you live. By the time you reach the door, the lamps are on in your gallery.

Tomorrow, the rooms become homes and the forest finds its voice: [baths, terraces and the sound of the cell →](/blog/day-18-homes-and-the-sound-of-the-forest/)

[Walk the dome cell in avenCITY Sandbox 4 →](/games/sandbox-4/)

[Read the manifesto →](/)
