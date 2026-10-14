# Look

The page should read like a tilt-shift photograph of a model factory, the way photographers fake a
miniature: high viewpoint, a narrow band of sharp focus, everything above and below it melting into
blur, strong saturated colour, direct sun.

What makes it work, in order of impact:

1. **Narrow focus band.** `look.setTilt({ focusY, band, amount })`. The band sits a little below the
   centre of the frame (0.46) and is thin (0.07 of the height); the blur at the frame edges is about
   20 px at 1080p. The blur only gathers from samples that are at least as blurred, so sharp edges
   in the band do not bleed out.
2. **Direct warm sun with long soft shadows.** One directional light from the back left at about
   40 degrees, 4096 shadow map, PCF radius 2. Hemisphere fill is weak so shadows stay readable.
3. **Ambient occlusion** (GTAO) puts contact shadow under every machine, cart and person.
4. **Grade after tone mapping:** saturation 1.32, contrast 1.14, a slight warm white balance,
   vignette 0.38, fine grain.
5. **Density.** Empty floor reads as a render. The world fills free floor with pallets, carts, drums
   and tool chests, racks the back wall, and puts people at machines and on the walkway.
6. **Cut-away hall on a diorama base.** Back and left walls full height so the hall has a back drop;
   front and right walls cut at 1.1 m with the section face coloured. Grass, parking, trees, a truck
   yard and a sign around it; a dark plinth under the base; a table under the plinth.
7. **Colour discipline.** Machines are cream with one accent per station, conveyors graphite, floor
   neutral grey with yellow zone tape, green walkway. Product colours come from `stages`.

What to avoid: a top-down orthographic view (kills the miniature effect), bloom on sunlit surfaces
(threshold is above 2.5 in HDR so only emissive parts glow), labels floating in 3D (one plate per
station on a post is the only text in the scene), and pure white materials (they clip under ACES).

Camera: `spec.look.camera = { az, el, dist }` overrides the default framing; `spec.look.tilt`
overrides the focus band.
