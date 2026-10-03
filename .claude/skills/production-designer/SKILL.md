---
name: production-designer
description: The production designer of maiaCITY's films — the worlds, sets, props and 3D models a film is shot in, and their art direction. The worlds (the room, the tired land, the Isar in Munich, the backyard, Sandbox 1–4) and how a new one is built to be walked and filmed — a real place from open map and terrain data; the 3D models library (src/lib/models, the /app/models viewer) and how a model is built to its real measure from photos; sets built into a scene while it is filmed; palette, texture, a cinematic world and its details. Use it whenever a world, a set, a prop or a model is built, placed, dressed or matched to photos of a real place.
---

# Production designer

Everything in front of the camera that isn't a person: the place, the things in it, their colours and textures. A
maiaCITY film is shot in real rooms and in 3D worlds, and the two must read as one world.

## The designer's laws

1. **The set tells the story before anyone speaks.** The tired land's ochre monoculture and trucks against the dome
   cell's seven-layer forest; a bedroom of wine crates and one bulb against the vision. Design the contrast the arc
   needs (`storyteller`, `retention.md`).
2. **To its real measure.** A real place is rebuilt from photos in metres — every wall, window, door and thing where
   the photos put it. The person who lives there notices a window on the wrong side at once.
3. **Things are reusable models.** Furniture, fixtures and vehicles are built once in the 3D models library and placed
   in any world (`models.md`), never modelled inside one world's code.
4. **Light comes from the place.** The sky turned to the place's real north, the windows where they are, the lamps
   that are really there — the `gaffer` lights what the design gives.
5. **A cinematic world, art-directed.** Choose a palette (a few base tones, a pop of complementary colour), textures
   that read up close (limed oak, plaster, wool, glass), and details for whoever looks closely — LifeOfRiza's designed
   parcel label whose QR code opens her channel (`storyteller`, `scenes.md`).
6. **Never promise what the world can't show.** Sandbox 4 has no people; a set is built when the words need something
   the world lacks (`worlds.md`).

## The sub-skills

| File | The skill | Use it for |
|---|---|---|
| `worlds.md` | the worlds and their sets | Sandbox 4's map and framing, the room, the tired land, the Isar, the backyard, building a new world (a real place from OpenStreetMap and the survey's terrain, or from photos), sets built into a scene for one film |
| `models.md` | the 3D models | the library and its viewer, the conventions every model keeps, building a model from photos, materials and textures |

## The order of work

1. Read the script and the arc: what each scene's place must say (`director`).
2. Collect references: photos of the real place, the moodboard, the measures.
3. Build or reuse: models first (`models.md`), then the world or the set (`worlds.md`).
4. Turn the sky to the place's north and put the practical lights where they are (`gaffer`, `world-light.md`).
5. Check from the camera's positions in the shot list, at the hours the shots use, against the photos — then from
   above, for the layout.
