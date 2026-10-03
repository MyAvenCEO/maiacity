# Apple Log 2 grading: research and pipeline audit

For maiaCITY's film studio. Written 2026-10-03.

This is research only. Nothing was changed in the repository, the timelines, the grades, the footage or the vault.

Code references point at the worktree `blissful-payne-fc072f` at commit `beb176e`. Every constant below was checked against
a primary source (the ACES CTL, OpenColorIO's code and configs, Apple's SDK headers and docs) or computed from one.

---

## 1. Answer first

| Question | Answer |
|---|---|
| Is ACES (ACEScct working space, ACES 2.0 output) the right timeline space for Apple Log 2? | **Yes.** |
| Do we decode the right curve today? | **Yes.** Apple Log 2 uses the Apple Log curve, and our constants match ACES and OpenColorIO exactly. |
| Do we use the right gamut today? | **Yes**, for every file detected as `apple-log-2`. We use Apple Wide Gamut with Bradford adaptation into AP1, the same as ACES and OCIO. |
| Is the output gamma right? | **Yes, for a Rec.709 master.** We use the ACES 2.0 SDR 100-nit output with BT.1886 (a pure 2.4 power) and tag the files BT.709 (1-1-1). Apple devices show 1-1-1 video lighter than that (see caveat 7). |

**Why ACES is the right choice for us**
- **Apple supports it.** Apple lists the Academy Color Encoding System on the iPhone 17 Pro spec sheet.
- **There is an official transform for Apple Log 2.** ACES added `CSC.Apple.AppleLog2_to_ACES` (transform ID
  `urn:ampas:aces:transformId:v2.0:CSC.Apple.AppleLog2_to_ACES.a2.v1`) on 2026-02-04.
- **OpenColorIO ships it.** OCIO 2.6.0, released 2026-10-01, has a built-in `Apple Log 2` colour space in its ACES 2.1
  studio config. ACES 2.1 does not change the output transforms, so our ACES 2.0 output is still current.
- **ACEScct is built for grading.** It is a log working space with a Cineon-like toe. AP1 holds all of Rec.2020 and
  most of Apple Wide Gamut.
- **One space carries both sources.** The rendered worlds (linear Rec.709 → AP1) and the iPhone footage meet in it, and
  that is maiaCITY's main reason for ACES.
- **The output is open and already native.** ACES 2.0's output transform is fully published, and our Rust/Metal version
  is already verified against OCIO. DaVinci Wide Gamut/Intermediate is a valid alternative (Cullen Kelly treats the
  two as equal), but its display rendering belongs to Resolve.

**Caveats, most important first**
1. **There is no gamut compression.** Apple Wide Gamut reaches beyond AP1: about 11 % of its code volume, mostly
   blue-violet and saturated cyan. Those pixels leave the input transform with negative AP1 values. Every grade cube
   then clamps them at ACEScct 0, the grading still clips them, and the ACES 2.0 output clamps AP1 at 0 again. LEDs,
   neon, phone screens and the CB60 in HSI mode all produce such colours.
   **Fix:** add the ACES Reference Gamut Compression right after the input transform, as a switch (F3).
2. **Apple Log (v1) is never detected automatically.** The detector looks for `com.apple.log`, but Apple writes
   `com.apple.rec2020.apple-log`. The iPhone 17 Pro's own Camera app can record either "Log" or "Log 2".
   A v1 clip arrives as `unknown`. That is safe for proxies, but the render, the hero frames and the measurements
   then quietly treat any unknown clip as Rec.709 video (F1, F2).
3. **Full-resolution frames lose half their chroma.** Grading stills, hero frames and the 4K render are decoded to
   4:2:0 even when the source is 4:2:2 ProRes (F4).
4. **Exposure and white balance are offsets in ACEScct.** Above about 4.5 stops under grey that equals a linear gain.
   Below it, it lifts and tints the deepest blacks (on Day 01: only the near-black shots, by about half an IRE). Colourists do exposure and balance in linear (F5).
5. **Bradford is a convention.** Apple's white paper names no chromatic adaptation. ACES, OCIO and we all use Bradford.
6. **Our Apple Log 2 reference values need re-checking.** They came from a hand-built OCIO 2.5.2 chain. Regenerate
   them from OCIO 2.6.0's built-in colour space (F6).
7. **The delivery gamma is a decision, not a bug.** The BT.1886 2.4 master is the standard. Apple's ColorSync shows
   1-1-1 video with its own lighter video curve, and our hero frames are tagged the same way, so on a Mac they look as
   they will on an iPhone. Choose which target you judge against and keep it (F10).

---

## 2. Apple Log 2: the facts

| | Apple Log (v1) | Apple Log 2 | Source |
|---|---|---|---|
| Phones | iPhone 15 Pro and later | iPhone 17 Pro and later. On 17 Pro and 18 Pro the Camera app offers Log or Log 2. | [Apple Support: Record ProRes video](https://support.apple.com/guide/iphone/record-prores-video-iphde02c478d/ios) |
| Transfer curve | Apple Log | **The same Apple Log curve, with the same constants** | [ACES CTL v1](https://github.com/aces-aswf/aces-input-and-colorspaces/blob/main/apple/CSC.Apple.AppleLog_to_ACES.ctl), [ACES CTL v2](https://github.com/aces-aswf/aces-input-and-colorspaces/blob/main/apple/CSC.Apple.AppleLog2_to_ACES.ctl), [OCIO AppleCameras.cpp](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/src/OpenColorIO/transforms/builtins/AppleCameras.cpp) |
| Primaries | ITU-R BT.2020 | **Apple Wide Gamut:** R (0.725, 0.301), G (0.221, 0.814), B (0.068, −0.076) | [AVCaptureColorSpace.appleLog](https://developer.apple.com/documentation/avfoundation/avcapturecolorspace/applelog), [.appleLog2](https://developer.apple.com/documentation/avfoundation/avcapturecolorspace/applelog2), ACES CTL, OCIO |
| White point | D65 | D65 (0.3127, 0.3290) | as above |
| Adaptation into ACES | Bradford | Bradford. The white paper names none, so OCIO chose Bradford as most consistent with ACES. | [OCIO-Config-ACES #163](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/issues/163) |
| Y′CbCr matrix | BT.2020 | BT.2020 (non-constant luminance) | CoreVideo `CVImageBuffer.h` (macOS SDK 26.2) |
| Colour tags in the file | primaries BT.2020 | primaries and transfer function **left undefined or absent**; matrix BT.2020 | CoreVideo header comment on `kCVImageBufferLogTransferFunction_AppleLog2` |
| Log identifier (`LogTransferFunction` extension / `logs` atom) | `com.apple.rec2020.apple-log` | `com.apple.apple-wide-gamut.apple-log` | Printed from the CoreVideo constants on macOS SDK 26.2. Constants: [CV AppleLog2](https://developer.apple.com/documentation/corevideo/kcvimagebufferlogtransferfunction_applelog2) (OS 26), [CM AppleLog2](https://developer.apple.com/documentation/coremedia/kcmformatdescriptionlogtransferfunction_applelog2) (OS 27) |
| ACES transform | `CSC.Apple.AppleLog_to_ACES` | `CSC.Apple.AppleLog2_to_ACES` | [aces-input-and-colorspaces/apple](https://github.com/aces-aswf/aces-input-and-colorspaces/tree/main/apple) (commit 2331f7d9, 2026-02-04) |
| OpenColorIO | `Apple Log` (builtin `APPLE_LOG_to_ACES2065-1`) | `Apple Log 2` (builtin `APPLE_LOG-APPLEWG_to_ACES2065-1`) and `Linear Apple Wide Gamut`, in `ocio://studio-config-v5.0.0_aces-v2.1_ocio-v2.6` | [OCIO PR #2343](https://github.com/AcademySoftwareFoundation/OpenColorIO/pull/2343) (merged 2026-09-15), [Config PR #179](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/pull/179) (merged 2026-09-23), [OCIO 2.6.0 release](https://github.com/AcademySoftwareFoundation/OpenColorIO/releases/tag/v2.6.0) (2026-10-01) |
| Codecs | ProRes (Camera app); HEVC (Final Cut Camera, Blackmagic Camera) | ProRes or HEVC. ProRes RAW can be developed to it ("RAW to Log: Apple Log 2"). | [Apple newsroom: Final Cut Camera 2.0](https://www.apple.com/newsroom/2025/09/apple-announces-final-cut-camera-2-0/), [FCP: ProRes RAW settings](https://support.apple.com/guide/final-cut-pro/adjust-prores-raw-camera-settings-ver3eb60032c/mac) |

### The curve (identical in both versions)

R is scene-linear reflectance (0.18 is mid grey). P is the normalised code value: 0 = 10-bit code 64 and 1 = code 940 in
the video-range ProRes file, after Y′CbCr → R′G′B′. This is how `cst.rs:7–9` and Resolve read it.

```
encode:  P = γ·log2(R + β) + δ      R ≥ Rt
         P = c·(R − R0)²            R0 ≤ R < Rt
         P = 0                      R < R0
decode:  R = 2^((P − δ)/γ) − β      P ≥ Pt,   Pt = c·(Rt − R0)² = 0.208555
         R = √(P/c) + R0            0 ≤ P < Pt
         R = R0                     P < 0
R0 = −0.05641088   Rt = 0.01   c = 47.28711236   β = 0.00964052   γ = 0.08550479   δ = 0.69336945
```

**Code values around grey**, computed from the curve. "% (video)" is the waveform percentage, from code 64 at 0 % to
code 940 at 100 %.

| Stops from 18 % grey | Linear | Apple Log P | % (video) | 10-bit video code | 10-bit full | ACEScct |
|---|---|---|---|---|---|---|
| black (0.0) | 0 | 0.1505 | 15.0 | 196 | 154 | 0.0729 |
| −6 | 0.0028 | 0.1659 | 16.6 | 209 | 170 | 0.1025 |
| −5 | 0.0056 | 0.1820 | 18.2 | 223 | 186 | 0.1322 |
| −4 | 0.0113 | 0.2162 | 21.6 | 253 | 221 | 0.1853 |
| −3 | 0.0225 | 0.2693 | 26.9 | 300 | 276 | 0.2424 |
| −2 | 0.045 | 0.3348 | 33.5 | 357 | 342 | 0.2994 |
| −1 | 0.09 | 0.4089 | 40.9 | 422 | 418 | 0.3565 |
| **0 (grey card)** | **0.18** | **0.4883** | **48.8** | **492** | **500** | **0.4136** |
| +½ | 0.255 | 0.5292 | 52.9 | 528 | 541 | 0.4421 |
| +1 | 0.36 | 0.5706 | 57.1 | 564 | 584 | 0.4707 |
| +2.32 (90 % white) | 0.90 | 0.6815 | 68.2 | 661 | 697 | 0.5460 |
| +3 | 1.44 | 0.7392 | 73.9 | 712 | 756 | 0.5848 |
| +4 | 2.88 | 0.8243 | 82.4 | 786 | 843 | 0.6419 |
| +5 | 5.76 | 0.9096 | 91.0 | 861 | 930 | 0.6990 |
| code 1.0 | 12.0 (+6.06 stops) | 1.0 | 100 | 940 | 1023 | 0.7594 |

- **Above grey,** each stop adds about 8.55 % (that is γ).
- **Below grey,** the quadratic toe squeezes the shadows. The bottom five stops share only about 27 ten-bit codes.
  Apple traded shadow codes for less visible noise.
- **These are the encoding's limits, not the sensor's.** CineD's lab measured about 11–12 stops above the noise floor
  in one setting, but called its own result unreliable (§4).

### The matrices

All are linear and row-major. Apple Wide Gamut is abbreviated AWG.

```
AWG → CIE XYZ (D65):
  0.6514914802  0.2215531133  0.0774113336
  0.2704812904  0.8160372589 −0.0865185493   ← the blue primary is imaginary (negative luminance), like AP0 and ARRI AWG4
 −0.0233638324 −0.0350875971  1.1475091803

AWG → ACES2065-1 (AP0), Bradford — official (OCIO 2.6 "Linear Apple Wide Gamut"; equal to transforms.js:49–53):
  0.694961049318096  0.241405268785364  0.06363368189654
  0.047362746414932  1.004295925054283 −0.051658671469216
 −0.021989789359883 −0.028989104971474  1.050978894331358

AWG → ACEScg (AP1), Bradford — what our journey uses (cst.rs:100, test cst.rs:74–81):
  1.002218225606  0.119088905758 −0.121307131364
  0.004699430937  1.165691726122 −0.170391157059
 −0.016445885461 −0.032973705289  1.049419590751   ← negative terms: AWG reaches outside AP1

AWG → Rec.2020 (both D65) — used below to show what a wrong tag does:
  1.02810  0.09898 −0.12708
  0.00252  1.17085 −0.17337
 −0.02209 −0.06405  1.08614
```

**Gamut sizes** (area of the triangle on the CIE 1931 xy diagram): Rec.709 0.112, Rec.2020 0.212, AP1 0.225,
**Apple WG 0.264**, ARRI AWG4 0.276, DaVinci WG 0.379.
- Apple Wide Gamut is about 24 % larger than Rec.2020, and close to ARRI's AWG4.
- Its blue primary lies slightly outside even DaVinci Wide Gamut.

**What a wrong tag costs.** Apple Log 2 decoded as Apple Log (Rec.2020) — which is what any Apple Log v1 LUT, or a
"Rec.2020" tag, does to it — measured on the 18 colour patches of a ColorChecker:
- mean ΔE2000 3.5, worst 6.4 (the blue patch);
- chroma down 2–28 %;
- hue turned by up to about 8°;
- light skin turned 7° towards red, with 6 % less chroma.

It looks like a white-balance problem, but no balance can undo it.

**Corrections to the LogGate article (§3.3):**
- The curve did not change; only the gamut did.
- The gamut is Apple Wide Gamut, not Rec.2020. Tagging Apple Log 2 as "Rec.2020" is exactly the error measured above.
- Apple Log 2 is not ProRes-only: Apple says ProRes or HEVC.
- Rec.2020 is far from "nearly every colour the eye sees", and Apple Wide Gamut is itself about a quarter larger.

---

## 3. What the two videos and the article teach

The transcripts were fetched from youtube-transcript.ai and the repeated auto-captions were removed. They are saved in
`scratchpad/research/`.

### 3.1 Sebastian Dylag — *How to Color Grade Apple LOG 2 in DaVinci Resolve (iPhone 17 Pro)*

[YouTube](https://www.youtube.com/watch?v=EVcWNMbUcks), 2026-04-03, 9:27.

**What he shows**
- **Two routes.** One is his own one-click LUTs, with a free "basic" one. The other is a two-node manual grade.
- **The manual grade.** Node 1 is a Color Space Transform: input colour space *Apple Log 2*, input gamma *Apple Log*,
  output Rec.709 / Rec.709. Node 2 is the grade: saturation up (to 70 on Resolve's scale), gain up, lift down, gamma,
  and temperature (−200 on an orange city shot).
- **Framing.** He shoots 4:3 on an iPhone 17 Pro Max so he can cut both vertical and horizontal versions.

**What it confirms for us**
- In Resolve the only difference from Apple Log is the input colour space; the gamma stays "Apple Log". This matches
  ACES and OCIO.
- The technical transform comes first and the creative grade after.
- Shooting 4:3 is a real option for our 9:16 crops.

**What not to copy**
- He converts straight to display Rec.709, with the scene "Rec.709" gamma and no tone-mapping step mentioned. That gives
  a flat picture with hard-clipped highlights, which he then grades in display space.
- Our chain already grades scene-referred, underneath the ACES 2.0 output, which is the professional version of the same
  idea.
- Third-party one-click LUTs bypass the colour management entirely.

### 3.2 Christopher Balladarez — *Cinematic Color Grading in DaVinci Resolve – Free Powergrade*

[YouTube](https://www.youtube.com/watch?v=n6A5eu0NPYA), 2025-08-01, 23:26. This is not about the iPhone; he grades Canon
C-Log3, DJI D-Log and Sony S-Log3.

**His set-up and node order**
- **Project settings.** His free powergrade runs on a Rec.709 Gamma 2.4 timeline with a "Rec.709-A" output. With paid
  looks such as Film Unlimited he works in DaVinci Wide Gamut / Intermediate.
- **1. Light noise reduction first** (about 5, never above 10).
- **2. CST in.**
- **3. A glow** in soft light, with its saturation pulled back.
- **4. A white-balance node set to linear gamma,** balanced with the gain wheel or the channel gains, never with the log
  wheels.
- **5. Exposure in the HDR palette,** told the camera's colour space.
- **6. A "density" node** in HSV colour space, green channel raised to about 120, instead of the saturation knob (which
  he never touches).
- **7. Contrast and pivot, then a filmic tone curve.**
- **8. Greens moved cooler, less saturated and darker.**
- **9. Subtle grain** (Film Look Creator).
- **10. CST out to Rec.709,** then a Kodak 2383 print LUT reached through a conversion to Cineon, and a finishing LUT at
  low gain.
- **For drone footage,** the CST's luminance mapping and saturation compression.

**What it teaches us**
- White balance and exposure in linear light.
- Density instead of additive saturation.
- Noise reduction first, and very light.
- Greens need their own move.
- Finishing stays subtle.
- All of this agrees with our skill files, and two of the tools behind it are missing (§7).

**What not to copy**
- A print LUT after an output transform: our `color-story.md:116–117` already forbids it.
- Rec.709-A as a habit. It is a tagging decision, not a grade.

### 3.3 LogGate — *Apple Log 2 Explained: The Complete iPhone 17 Pro Filmmaker's Guide*

[loggate.tech](https://loggate.tech/apple-log-2-iphone-17-pro-guide/), 2026-05-28. Published by an app vendor, with no
author named.

**What it says**
- How to turn Log on in the native Camera app (ProRes, then Log), and that the files are large.
- Three grading routes: Apple's technical LUT, then a creative grade; Resolve set to DaVinci Wide Gamut / Intermediate
  with the clips tagged; or Final Cut's log processing.
- The common mistakes: over-exposure (meter with the histogram or zebras, not the viewfinder), LUTs stacked twice,
  untagged clips, and LUTs made for other cameras.

**What it teaches us**
- Tag discipline, and the technical transform before the look. Both are already our design.
- The guards we lack are v1 detection and a hard stop on unknown tags (F1, F2).

**What it gets wrong:** see the corrections at the end of §2.

---

## 4. The gurus

Only people with verifiable public work on iPhone or Apple Log, or on the colour-managed path it travels, are listed.

### Stu Maschwitz (Prolost) — filmmaker and VFX supervisor; Apple Log's most detailed public advocate

**His approach**
- Apple Log is a *known* curve, so treat it as scene data.
- Convert it with transforms: his LUT set takes Apple Log to Rec.709 and to ACEScc/ACEScct.
- Grade underneath the display transform, and let the highlights shoulder off softly into an ACES output.
- Expose with a false-colour LUT that lights 18 % grey yellow.
- Some of his LUTs carry a built-in +1 stop, so you can under-expose by a stop to hold the highlights.
- Shoot with Blackmagic Camera and a display LUT.

**Sources:** [Log is the "Pro" in iPhone 15 Pro](https://prolost.com/blog/applelog) (2023-10-10),
[iPhone ProRes Log in Peru and Taiwan](https://prolost.com/blog/iphonelog-peru-taiwan) (2024-01-30),
[Apple's "Let Loose" event shot on iPhone](https://prolost.com/blog/panavision-iphone) (2024-05-09),
[Prolost Apple Log LUTs](https://proloststore.com/apple-log).

**Caveat:** I found no Apple Log 2 post, and the LUT page lists Apple Log (v1) only. Do not use those LUTs on Log 2.

### Cullen Kelly — Los Angeles senior colourist and educator

His work is camera-agnostic, but it is the method everyone applies to iPhone log.

**His approach**
- Scene-referred colour management.
- Exposure and colour balance in **linear** (the HDR palette's global wheel); contrast and look development in
  **log** ([Frame.io, 2024-08-05](https://blog.frame.io/2024/08/05/when-should-you-color-grade-in-log-linear/)).
- ACES or Resolve colour management, whichever suits the job. On the choice he says: "Neither one of these is
  necessarily better than the other." ([Frame.io, 2024-02-12](https://blog.frame.io/2024/02/12/davinci-resolve-color-management-vs-aces-which-should-you-choose/))
- Turn on ACES gamut compression for bright saturated lights
  ([Frame.io, 2023-06-26](https://blog.frame.io/2023/06/26/aces-1-3-color-gamut-compression/)).
- Build looks in order of impact, with subtractive saturation and finishing at a fraction of full strength. This is
  already in our skill.

**Caveat:** I found no article of his specific to the iPhone.

### Darren Mostyn — UK colourist with 18 years' experience

**Source:** [How to Grade Apple Log in DaVinci Resolve](https://www.youtube.com/watch?v=J_UuYr91sPo) (2024-02-25;
transcript checked).

**His approach**
- Don't trust "official" Apple Log LUTs found online: the two he found had different curves.
- Use the CST with Apple Log gamma and the correct primaries instead. Rec.2020 is correct for v1, and he shows how
  visibly saturation changes when the gamut is wrong.
- Work on a DaVinci Wide Gamut / Intermediate timeline, output Rec.709 Gamma 2.4 (2.2 only if the monitor is calibrated
  to it), and grade underneath that output.
- Shoot with Blackmagic Camera: shutter, ISO and white balance locked, a display LUT on, and ND filters outdoors.

### Juan Melara — colourist known for film emulation and camera matching

**His approach,** from his iPhone 15/16 Pro → ALEXA match
([product](https://juanmelara.com.au/products/iphone16pro-to-alexa-powergrade-and-luts),
[instructions](https://juanmelara.com.au/iphone16pro2alexa-usage-instructions)):
- Linearise Apple Log.
- Match it to the ALEXA with a 3×3 matrix plus a core transform, in linear.
- Output ARRI LogC, balance after the match, and apply a separate output transform last.

**The lesson for us:** camera matching belongs in linear, before the grade, and stays separate from the look.

**Caveat:** it is built for Apple Log v1 (Rec.2020). Applied to Apple Log 2 it would be the wrong gamut.

### The colour scientists behind the transform

They are the reference for the CST step itself.
- **Doug Walker** (OCIO TSC) proposed the OCIO "Apple Log 2" space and chose Bradford adaptation, because the white
  paper names none ([#163](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/issues/163)).
- **Carol Payne** reviewed and implemented it (OCIO #2343, Config #179).
- **Scott Dyer** maintains the ACES CTLs.

### The tester: CineD's lab (Gunther Machu)

**Source:** [Lab test of the iPhone 17 Pro](https://www.cined.com/lab-test-of-the-iphone-17-pro-rolling-shutter-dynamic-range-trials-and-exposure-challenges/)
(dated 2026-09-08 on the page).

**What it found,** shooting Blackmagic Camera in manual mode with Apple Log 2 and ProRes RAW:
- rolling shutter under 3 ms on the 1× camera;
- the dynamic-range test was abandoned, because moving from 1/25 to 1/30 s seemed to *gain* about 2 stops — a sign of
  scene-dependent processing or frame stacking.

**The lesson:** lock everything, never change the shutter within a scene, and find your own clipping point with a test.

### Searched, but not included

Waqas Qazi and Patrick Inhofer: I found no verifiable work by either on Apple Log or the iPhone. Mixing Light, Inhofer's
site, has an ACES 2.0 gamut-mapping article by Billy Causey
([2026-05-21](https://mixinglight.com/color-grading-tutorials/aces-2-0-volumetric-gamut-mapping-in-action/)), but no
Apple Log piece.

---

## 5. Our pipeline audit

### 5.1 The chain as built

1. **Probe:** `vault/crates/vault-media/src/probe.rs:84–121`. Reads the format description's primaries, transfer,
   matrix, range and bit depth. It also reads the sample description's extension atoms (`atom:logs=…`) and the
   `LogTransferFunction` extension.
2. **Detect:** `vault/crates/vault-media/src/color.rs:18–65`. Our own tag wins. `com.apple.apple-wide-gamut.apple-log`
   becomes `apple-log-2` (l.31–33). The JS twin is `game/film/color.js:147–183`, used by the API through ffprobe, which
   cannot see the `logs` atom.
3. **Profile:** stored on the media record, and a profile set by hand wins (`vault/app/src/proxies.rs:386–432`). An
   unknown file gets no proxy until it is told (l.427–430). The detector version is `DETECTOR = 2` (l.35).
4. **Decode:** AVAssetReader to 10-bit 4:2:0 video range, `x420`. Proxies use `proxy.rs:87–91`. Grading stills, hero
   frames, measurements and the render use `vault-render/src/av.rs:104–105`. Core Image then turns Y′CbCr into RGB by
   the frame's own matrix and range tags, with no colour management (`vault-media/src/gpu.rs:54–85`,
   `vault-render/src/gpu.rs:379–396`).
5. **Journey (input transform):** `vault/crates/vault-color/src/cst.rs`.
   - The table of journeys is at l.91–108; Apple Log 2 is l.100.
   - The Metal kernel is l.170–223; the curve l.257–273; the matrix and Bradford adaptation l.326–350.
   - The exact maths runs in Metal for every journey. A baked cube is ruled out for Apple Wide Gamut (l.83–87, 106).
6. **Framing:** a Lanczos scale and crop, in ACEScct.
7. **Grade:** the stacks apply as base → clip → scene → timeline (`vault-render/src/tools.rs` — the tools l.60–110,
   `compile` l.533, `apply` l.651).
   - Colour tools that follow each other bake into a 65³ cube over ACEScct 0…1.
   - The balance runs as its own exact kernel (`vault-render/src/gpu.rs:47–53`, `grade.rs:124–137`).
8. **Output:** ACES 2.0 SDR 100 nits, Rec.709, BT.1886 (`vault-color/src/aces2.rs:254–256, 296–304`). Baked to 129³
   for the render, the hero frames and the player (`vault/app/src/render.rs:59–63`), and to 65³ for the web viewer
   (`proxies.rs:101–115`).
9. **Encode:** HEVC Main10 or H.264, tagged BT.709 1-1-1, TV range (`vault-render/src/av.rs`, around l.374 and l.459).

**Side paths**
- **Proxies:** ACEScct in HEVC Main10 at 1920. The BT.709 tag is only a container label; the comment
  `maiacity:color=acescct` names the real content (`proxy.rs:62–247`).
- **Grading stills:** a 3840-wide 16-bit PNG of ACEScct codes (`render.rs:999–1026`).
- **Hero frames and previews:** display codes, tagged with CoreVideo's "Rec.709 video" colour space
  (`vault-render/src/gpu.rs:568–600`).
- **Web viewer:** proxy (ACEScct) → 33³ grade cube → 65³ output cube → canvas (`src/lib/studio/gl.js`,
  `src/lib/studio/view.js`).
- **Native player:** the proxy or the original → exact journey → the whole chain → 129³ output
  (`vault-render/src/player.rs`).

### 5.2 What is right (verified)

- **The curve constants** in `cst.rs:258–264` and its Metal twin (l.180) equal the ACES CTL and OCIO's
  `GenerateAppleLogToLinearOps`, including the clamp to R0 below code 0.
- **The Apple Wide Gamut primaries** (`cst.rs:38`) equal the ACES CTL, OCIO and the white paper as OCIO transcribes it.
- **AWG → AP0** (`game/film/transforms.js:49–53`) equals OCIO 2.6's built-in "Linear Apple Wide Gamut" matrix to 15
  significant digits.
- **AWG → AP1** equals AP0→AP1 × AWG→AP0 within 1e-8 (`vault-color/tests/cst.rs:74–81`).
- **The ACEScct curve** (`cst.rs:306–320`) follows S-2016-001; grey lands at 0.4135884.
- **Detection uses Apple's real Apple Log 2 identifier,** confirmed by printing the CoreVideo constant. The repo's own
  render test ("Day 19 World + Apple Log 2") detected DAY01 C010 this way (`vault/PLAN.md:95–104`).
- **Apple Wide Gamut never goes through a cube** in the proxy, render or player path: the exact kernel is used, as
  `cst.rs:83–87` intends.
- **The output transform is right.**
  - ACES 2.0 matches OCIO 2.5.2 within 0.07 of a 10-bit code.
  - The AP1 clamp to [0, 8·r_hit] is ACES 2.0's.
  - The final encode is the pure 2.4 power of the OCIO display "Rec.1886 Rec.709 - Display" (`aces2.rs:296–304`).
- **The order is right.** Input transform → balance → looks → finishing → output. Halation and bloom work in linear.
  Captions go on after the output, in display space.
- **Unknown files never get a proxy** until someone says what they are.

### 5.3 Findings and fixes

Recommendations. The status under a finding says what has been applied since.

#### F1 — Apple Log (v1) is never detected · High

**Status: fixed in #167 (2026-10-03).**

**Evidence**
- `color.rs:34` looks for `logs=com.apple.log` and `logtransferfunction=com.apple.log`. Apple writes
  `com.apple.rec2020.apple-log` (CoreVideo, available since macOS 14.2 / iOS 17.2).
- The fallbacks at l.40 (`applelog`, `apple log`, `apple_log`) miss the hyphen.
- `game/film/color.js:165–166` has the same gap.
- Result: a v1 clip — from an iPhone 15/16 Pro, or a 17 Pro left on "Log" — falls through to l.55 and becomes `unknown`.

**Fix in `color.rs`** — replace l.30–36:
```rust
// Apple's own log identifiers (CoreVideo kCVImageBufferLogTransferFunction_AppleLog2 / _AppleLog)
if apple.contains("com.apple.apple-wide-gamut.apple-log") {
    return info("apple-log-2", "log atom (Apple Wide Gamut · Apple Log)");
}
if apple.contains("com.apple.rec2020.apple-log") {
    return info("apple-log", "log atom (Rec.2020 · Apple Log)");
}
```

**Fix in `color.js`** — insert before l.165:
```js
if (all.includes('com.apple.apple-wide-gamut.apple-log')) return info('apple-log-2', 'log atom (Apple Wide Gamut · Apple Log)');
if (all.includes('com.apple.rec2020.apple-log')) return info('apple-log', 'log atom (Rec.2020 · Apple Log)');
```

**Also**
- Bump `DETECTOR` to 3 (`proxies.rs:35`) so files once told `unknown` are read again.
- Add both identifiers to the tests: `vault-media` and `api/test/film-color.test.ts`.
- Check one real v1 clip. Files recorded before iOS 17.2 probably carry no identifier and rightly stay `unknown`.

#### F2 — Unknown colour is rendered as Rec.709 without stopping · High

**Status: fixed in #167 (2026-10-03).**

**Evidence**
- The render: `vault-render/src/render.rs:360–364` adds a warning and switches to `rec709`.
- Measurements and the frames the base correction reads: `render.rs:1085`.
- Hero frames: `render.rs:1137`.
- A log clip read as Rec.709 is flat and wrong-coloured in every frame and every number.

**Fix:** make it an error for camera video.
```rust
if vault_media::cst::journey(&profile).is_none() {
    anyhow::bail!("{title}: colour unknown ({from}) — set its profile in the studio before rendering");
}
```
Keep the Rec.709 assumption only where `detect()` itself said `rec709` (8-bit untagged video). Alternatively, refuse to
queue a render while any V1 clip is unknown.

#### F3 — No gamut compression for Apple Wide Gamut · High under coloured light, nothing otherwise

**Evidence**
- AWG→AP1 has negative terms (`cst.rs:106`).
- A blue LED recorded as AWG (0.02, 0.05, 0.9) arrives as AP1 (−0.083, −0.095, 0.943), which is ACEScct
  (−0.80, −0.93, 0.55).
- Each grade cube clamps its input to 0…1 (`vault-render/src/gpu.rs:91`, `output.rs:130`).
- The grading-still PNG clips at 0.
- ACES 2.0 clamps AP1 at 0 (`aces2.rs:298`).
- So saturation, hue and key tools cannot recover such colours: they arrive flat and off-hue.

**Fix:** the ACES Reference Gamut Compression, applied in linear AP1 after the matrix and before the ACEScct curve. This
is the official ACES 2.0 look
([Look.Academy.ReferenceGamutCompress](https://github.com/aces-aswf/aces-look/blob/main/reference_gamut_compression/Look.Academy.ReferenceGamutCompress.ctl):
apply it immediately after the input transform, so every grade sees positive AP1). Spec:
[docs.acescentral.com/rgc](https://docs.acescentral.com/rgc/specification/).
```rust
/// ACES Reference Gamut Compression on linear AP1 (cyan, magenta, yellow distance limits; ColorChecker protected).
pub fn gamut_compress(c: [f64; 3]) -> [f64; 3] {
    const LIM: [f64; 3] = [1.147, 1.264, 1.312];
    const THR: [f64; 3] = [0.815, 0.803, 0.880];
    const PWR: f64 = 1.2;
    let ach = c[0].max(c[1]).max(c[2]);
    if ach == 0.0 { return c; }
    std::array::from_fn(|i| {
        let d = (ach - c[i]) / ach.abs();
        let (l, t) = (LIM[i], THR[i]);
        let cd = if d < t { d } else {
            let s = (l - t) / (((1.0 - t) / (l - t)).powf(-PWR) - 1.0).powf(1.0 / PWR);
            let nd = (d - t) / s;
            t + s * nd / (1.0 + nd.powf(PWR)).powf(1.0 / PWR)
        };
        ach - cd * ach.abs()
    })
}
```

**Where it goes**
- `Journey::apply` (`cst.rs:112–122`): run it after `mul(m, lin)` when a new `Journey.compress` flag is set. Default it
  on for `apple-log-2`, and let each media record switch it.
- Metal: add a `float compress` argument to the `acescct` kernel (`cst.rs:216`) and port the same function using
  `precise::pow`.
- Put the flag into `journey_hash` (`render.rs:384–388`) so render reports pin it.

**Effect**
- The blue LED becomes AP1 (0.017, 0.031, 0.943), which is ACEScct (0.22, 0.27, 0.55).
- Skin and sky are untouched.
- The default limits cover Apple Wide Gamut: its largest distances are 1.116 (cyan), 1.162 (magenta) and 1.028 (yellow),
  against limits of 1.147, 1.264 and 1.312.

**Why a switch rather than always on**
- [ACES's own pages](https://docs.acescentral.com/background/about-rendering/) say ACES 2 avoids most of the clipping the
  RGC was built for, and some guides advise turning it off with 2.0.
- On the other side, the ACES 2.0 look set still ships it, to be applied after the input transform, and our cube clamps
  need positive AP1.
- So judge it on 4K stills of a CB60 HSI or LED shot.

#### F4 — 4:2:2 ProRes is decoded to 4:2:0 for full-resolution frames · Medium

**Status: fixed in #167 (2026-10-03); grading stills made before are remade by the app (#168).**

**Evidence**
- `av.rs:104–105` always asks for `x420`. That reader feeds the grading stills, hero frames, measurements and the render.
- For proxies it does no harm (`proxy.rs:87–91`): they are decoded straight to 1920 wide, where 4K 4:2:0 chroma is
  already full resolution.
- At 3840 it discards half the vertical chroma before the grade: colour edges soften and keys get worse.

**Fix:** choose the pixel format by codec.
```rust
let fmt: &[u8; 4] = match codec.as_str() {
    "apch" | "apcn" | "apcs" | "apco" => b"x422", // ProRes 422 family: 4:2:2 10-bit (kCVPixelFormatType_422YpCbCr10BiPlanarVideoRange)
    "ap4h" | "ap4x" => b"x444",                   // ProRes 4444 (or b"RGhA": the decoder converts to RGB)
    _ => b"x420",                                 // HEVC / H.264 are 4:2:0 already
};
```
If Core Image refuses `x422` on any path, use `RGhA` for single frames, where speed does not matter.

#### F5 — Exposure and white balance work in the log · Medium

**Status: fixed in #168 (2026-10-03): the balance's `linear` switch, on for every new balance.** Measured on Day 01
after the fix: the 7 → 9 IRE below was the exposure itself, since those blacks sit above the toe. The log offset
touched only the two shots with real near-black content (c765990b, the veranda), lifting and warming their deepest
blacks by about half an IRE.

**Evidence**
- `grade.rs:124–137` and the Metal twin (`vault-render/src/gpu.rs:47–53`) add temp, tint and exposure as ACEScct
  offsets.
- Above ACEScct 0.155 (linear 2⁻⁷, about 4.5 stops under grey) an offset is an exact gain. Below it, the offset is an
  additive lift.
- Day 01 recorded the result: +0.6 stop raised the blacks from 7 to 9 IRE (`.claude/skills/colorist/base-correction.md:138–140`).
- Cullen Kelly does exposure and balance in linear for exactly this reason.

**Fix:** a linear mode, behind a flag that defaults to off so Day 01's grades stay bit-identical. Contrast, highlights,
lows and saturation stay in the log.
```metal
static float from_cct(float c) { return c <= 0.155251141552511f ? (c - 0.0729055341958355f) / 10.5402377416545f
                                                                : precise::exp2(c * 17.52f - 9.72f); }
// in balance(): wb = (temp, tint, exposure) in stops, now as gains in linear AP1
float3 lin = float3(from_cct(s.r), from_cct(s.g), from_cct(s.b));
lin *= precise::exp2(float3(wb.z + 0.5f * wb.x, wb.z - wb.y, wb.z - 0.5f * wb.x));
float3 c = float3(to_cct(lin.r), to_cct(lin.g), to_cct(lin.b));
c = PIVOT + (c - PIVOT) * (1.0f + tone.x);   // contrast, then highlights/lows/sat as today
```
The result is identical above the toe and clean in it. A later step could set temperature and tint through a CAT
(Bradford or CAT02 in cone space) instead of AP1 channel gains.

#### F6 — Verify against the new official references · Medium (cheap)

**Evidence:** the `apple-log-2` rows in `vault-color/tests/cst_reference.txt` (l.481 on) came from OCIO 2.5.2 through a
hand-built chain (`transforms.js:139–144`): 2.5 had no Apple Log 2.

**Fix**
- Regenerate those rows with OCIO 2.6.0, `ocio://studio-config-v5.0.0_aces-v2.1_ocio-v2.6`, converting "Apple Log 2" to
  "ACEScct". Expect agreement within about 1e-6.
- Optionally, run the ACES CTL through `ctlrender` as well.
- Point `idt-apple-log-2` at the built-in colour space.

**Also check the Y′CbCr matrix**
- `examples/proxy_check.rs` compares our GPU result with AVFoundation's own RGB. If both used the same wrong matrix, it
  would not notice.
- Decode one Apple Log 2 frame as raw `x422` planes and convert it on the CPU with the BT.2020 coefficients
  (Kr = 0.2627, Kb = 0.0593, video range).
- Compare that with Core Image's RGB.

#### F7 — The web viewer shows AWG originals through an inexact cube · Low

**Evidence**
- `proxies.rs:101–115` bakes a 65³ cube for any journey, and `src/lib/studio/view.js:32` marks the result `exact: true`.
- `cst.rs:83–86` documents that such a cube is 0.1–0.4 ACEScct off for Apple Wide Gamut in bright saturated colours.

**Fix:** return `cube_fits` with the LUT and mark it `exact: false`, or always show the proxy. The 8-bit decode of
proxies in the browser is already noted in `look.md:181–182`.

#### F8 — Grading stills clip below ACEScct 0 · Low; disappears with F3

**Evidence:** `render.rs:1008–1026` writes an unsigned 16-bit PNG, so negative values clip. That is harmless for noise
below black and only matters for colours outside AP1.

#### F9 — ProRes RAW and some open-gate modes · Information

**ProRes RAW**
- No path handles ProRes RAW: there is no `aprn`/`aprh` anywhere in the repo.
- Apple's own route: Final Cut Pro's "iPhone ProRes RAW" processing with **RAW to Log = Apple Log 2**. Compressor can
  denoise the RAW with machine learning.
- Until we support RAW, don't shoot it for the Day films. If a shot needs it, develop it in Final Cut Pro to ProRes 422
  HQ Apple Log 2, and check that the studio reads `apple-log-2` (otherwise set it by hand).

**Open gate:** some open-gate modes record Rec.709 only, or Apple Log at 1920×1440
([Blackmagic Camera 3.1.2](https://www.newsshooter.com/2025/10/08/blackmagic-camera-version-3-1-2-update-adds-1920x1440-open-gate-recording-with-apple-log/),
[whoismatt](https://whoismatt.com/iphone-17-pro-a-filmmakers-review/)).

#### F10 — Delivery gamma against Apple screens · A decision, not a bug

**Status: decided 2026-10-03: we judge to the Apple view (colorist `color-story.md`, principle 12).**

**The facts**
- The master is BT.1886 2.4, tagged 1-1-1. That is correct.
- Hero frames and previews are tagged with CoreVideo's "Rec.709 video" colour space (`gpu.rs:568–600`). A Mac therefore
  shows them as Apple devices will show the video, which is lighter than a BT.1886 reference monitor. Apple has been
  reported to decode 1-1-1 video with a curve of about 1.96, which is why Resolve added "Rec.709-A".
- For an iPhone audience that is coherent.

**Recommendation**
- Decide whether you judge for the Apple-device view (today's behaviour) or for BT.1886, and write the choice into the
  skill.
- OCIO 2.6's ACES config also offers "Gamma 2.2 Rec.709 - Display" and "sRGB - Display" with the same ACES 2.0 view, if
  a web or phone master is ever wanted.

---

## 6. The CST journey end to end — the recommended chain

| # | Step | Status |
|---|---|---|
| 1 | **Shoot** Apple Log 2 in ProRes 422 HQ (§9). | rule |
| 2 | **Ingest:** read `LogTransferFunction` / `logs`. `com.apple.apple-wide-gamut.apple-log` → `apple-log-2`; `com.apple.rec2020.apple-log` → `apple-log`; unknown → stop and ask, never render as Rec.709. Show each clip's journey label (`cst::Journey.label`) in the Grade tab and in `grade_look`. | **change** (F1, F2) |
| 3 | **Decode** Y′CbCr 10-bit with the file's BT.2020 matrix and video range into normalised code values (64 → 0, 940 → 1). Keep 4:2:2 for full-resolution frames. | **change** (F4) |
| 4 | **Linearise** with the Apple Log inverse. | keep |
| 5 | **Gamut:** AWG → AP1, Bradford from D65 to the ACES white. | keep |
| 6 | **Gamut compress:** the ACES RGC in linear AP1, on by default for `apple-log-2`. | **add** (F3) |
| 7 | **ACEScct.** Proxies, grading stills, the player and the render all start here. | keep |
| 8 | **Noise reduction at the source,** before any grade, only on shots that need it (§7.5). | add later |
| 9 | **Base correction:** exposure and white balance as linear gains, then contrast, highlights, lows and saturation in log. | **change** (F5) |
| 10 | **Clip trim → scene look → film look → finishing** (halation and bloom in linear, then grain and vignette). New tools in §7. | keep / extend |
| 11 | **Output:** ACES 2.0 SDR 100 nits Rec.709, BT.1886 2.4, a 129³ tetrahedral cube; tag 1-1-1. Optional later: an HDR master through ACES 2.0 HDR 1000 nits (P3-D65 in Rec.2100 PQ). Apple Log 2 holds about 6 stops above grey, and iPhones play HDR. | keep |
| 12 | **Verify:** OCIO 2.6.0 reference rows and the Y′CbCr matrix check (F6). | **add** |
| 13 | **On set:** bake our own monitoring LUT, Apple Log 2 → ACES 2.0 SDR Rec.709, at 33³. `cst::journey("apple-log-2")` then `aces2::OutputTransform::sdr_rec709().apply`, written with `vault_color::cube_file`. Load it into Blackmagic Camera, so the phone shows the studio's ungraded picture. Compare it once on a grey card against Apple's own Apple Log 2 LUT. | **add** |

---

## 7. New grading tools to add, ranked by value

Every new tool keeps its maths in Rust/Metal, gets one entry in `game/film/grade-tools.json`, and is judged on 4K stills
(memory: grading-rust-metal-ssot). None of them relights the shot (memory: grading-less-is-more).

1. **Gamut compress** — a technical step in the input journey, not on a stack.
   - **What:** the ACES RGC (F3). Out-of-AP1 colours roll smoothly inside AP1; everything within the ColorChecker gamut
     is untouched.
   - **Where:** after AWG → AP1 and before ACEScct, switchable per media record.
   - **Why:** LEDs, neon, phone screens and the CB60's HSI and effect modes are exactly the colours AWG records beyond
     AP1. Without it every cube clips them. Cost: one Metal function.
2. **Linear exposure and white balance** — the base stack, first.
   - **What:** exposure, temp and tint as gains in linear AP1 (F5).
   - **Why:** no milky blacks after an exposure move, and the same behaviour in every tonal range (Cullen Kelly).
     Day 01's notes show the log version's side effect. Cost: small.
3. **Film curve** — scene and film looks, or a shot's trim.
   - **What:** a contrast pivoted at grey, plus an independent **toe** and **shoulder** that roll off towards soft
     black and white limits, in ACEScct.
   - **Why:** "contrast in the toe and the shoulder, the middle straight" (`color-story.md:19–20`, Volpatto). Today it
     takes contrast plus highlights/lows plus CDL power to fake it, and the low-key, dense look Samuel liked on Day 01
     was built exactly that way. Bakes into the cube.
4. **Saturation by brightness and density** — the looks.
   - **What:** a saturation-against-luminance curve (pastel highlights, rich mids, quiet blacks), and a subtractive
     **density**: luminance falls as chroma rises, optionally by hue.
   - **Why:** `color-story.md` asks for both. `hi_sat` covers only the highlights, `hue_lum` has to be set
     hue by hue, and Balladarez's main trick is density instead of saturation. Bakes into the cube.
     (Line references for this item: `color-story.md:22–23` and `108–110`.)
5. **Noise reduction** — the source, before the balance; only as a quiet technical fix.
   - **What:** first a spatial chroma NR (smoothing Cb/Cr guided by luma, a few pixels at 4K), which is cheap in Metal.
     Temporal NR (motion-compensated, Vision optical flow) only if night interiors need it.
   - **Why:** small sensor, Apple Log's crowded toe, the Edison bulb and dim CB60 scenes, and the 0.5× and 4× cameras.
     Cost: chroma NR is small; temporal NR is large.
6. **Journey inspector and monitoring-LUT export** — tooling rather than a grade layer.
   - **What:** each clip's profile, where it was told from, and its journey label next to its stacks, plus the on-set
     LUT export from §6.
   - **Why:** it catches F1 and F2 before a balance is made. A per-media override already exists (`meta.color.override`).

**Not recommended**
- Face-tracked lifts or relighting shapes (memory: less is more).
- More hue tools: hue vs hue, sat and lum already exist.
- A separate highlight desaturation: `hi_sat` and ACES 2.0's chroma compression already do it.
- A print LUT after the output transform.

---

## 8. Proposed updates to the colourist skill

These are text to add or change. They were not applied.

### `SKILL.md`

**Add law 9** after law 8:
> 9. **The journey before the balance.** Every iPhone shot must read `apple-log-2` from its log atom in the studio: the
>    Apple Log curve, Apple Wide Gamut into AP1 (Bradford), ACEScct. A shot that reads `apple-log` or `unknown` is
>    fixed at its tag (or the phone's setting), never with the balance: Apple Log 2 taken as Apple Log turns skin about
>    7° towards red and takes up to a quarter of the colour out (`base-correction.md`).

**In "The order of work", change step 2 to:**
> 2. Survey every scene's shots on one scope sheet, **and each shot's journey (profile and where it was told from)**;
>    pick each scene's master; ask Samuel the warmth per scene.

### `base-correction.md`

**Add a section between "The rules" and "What to compare":**
> ## Before the balance: the input
>
> 1. **The journey.** An iPhone 17 Pro original must read `apple-log-2 · log atom (Apple Wide Gamut · Apple Log)`.
>    `apple-log` is the first Apple Log (Rec.2020): right for an iPhone 15/16 Pro, wrong for a 17 Pro set to Log 2.
>    `unknown` is never balanced: set it in the Bin first.
> 2. **A wrong tag looks like a white-balance problem and isn't one.** Apple Log 2 read as Apple Log: skin about 7°
>    towards red, blues and yellows 20–28 % paler, every hue a few degrees off (ΔE 3.5 on a ColorChecker).
> 3. **The numbers on a 4K still.** A grey card exposed right reads ACEScct 0.414 and about 38 % on the Rec.709 display
>    (10 nits through ACES 2.0). Apple Log's black (code 0.150) is ACEScct 0.073 and display 0.
> 4. **Saturated light** (LEDs, neon, a phone screen, the CB60 in HSI): Apple Wide Gamut records colours the working
>    space can't hold. Without gamut compression in the journey they arrive flat and a little off-hue: never neutralise
>    or match on them.
> 5. **Colour edges:** the grading stills are 4:2:0 even from 4:2:2 ProRes (until the decoder changes). Judge a red
>    title or a saturated edge on a zoomed hero frame.

**At the end of "Watch the toe", add:**
> When the linear exposure and white balance are in, use them for every exposure move larger than about a third of a
> stop; the log offset stays for printer-light trims.

**Add to "Don't":**
> - Don't balance a shot whose journey isn't the camera's (an Apple Log 2 clip told `apple-log`, `rec709` or `unknown`).

### `look.md`

**In "The tools", after the stacks bullet:**
> - **A `lut` is ACEScct in and ACEScct out.** Never an Apple Log or Apple Log 2 → Rec.709 LUT, a LUT made for Apple Log
>   (iPhone 15/16 Pro, Rec.2020) or another camera, or anything that outputs a display picture. On Apple Log 2 the first
>   two are the wrong gamut; the last tone-maps twice.

**Add a section after "Teal and orange, without ruining skin":**
> ## Coloured light: LEDs, neon, the CB60 in HSI
>
> Apple Wide Gamut records blues, violets and cyans beyond the working space. With the gamut compression on, they roll
> into it smoothly; check it on a 4K still with and without. Without it, don't push saturation or hue curves into those
> colours. A `hue_sat` pull on that hue, or `hi_sat`, hides a flat patch better than a key.

**When the tools from §7 exist, add a section:**
> ## The curve, saturation by brightness, density
>
> - **Film curve** in the film look: contrast pivoted at grey (0.414), with the toe and shoulder carrying the
>   compression. The shot's trim still sets its key.
> - **Saturation by brightness:** highlights towards pastel (about 0.8 at +3 stops), mids 1.0, the deepest shadows
>   about 0.85.
> - **Density** before more saturation: saturated colours a little darker. Go to `hue_sat` only when one hue still needs
>   it.

**Add to "Don't":**
> - Don't grade an Apple Log 2 shot through anything made for Apple Log or another camera.

### `color-story.md`

**Replace principle 12 with:**
> 12. **Check on the phone; never grade on it.** The master is Rec.709 BT.1886 (2.4) tagged 1-1-1. Our hero frames are
>     tagged as Rec.709 video, so a Mac shows them the way an iPhone shows the film (Apple's video curve, reported at
>     about 1.96): lighter than a BT.1886 reference monitor. Decide once which one we judge to — today, the Apple view —
>     and check the uploaded file on the phone. If a web or phone master is ever wanted, OpenColorIO's ACES 2.0 views on
>     "Gamma 2.2 Rec.709" or "sRGB" are the same rendering on another display.

**In "Making renders sit with iPhone footage", add before step 1:**
> 0. **One gamut.** The renders are born in linear Rec.709, inside AP1. The iPhone's Apple Wide Gamut reaches outside it
>    in saturated blue and violet. With the gamut compression on, both sources share AP1 before the look.

**In "Film-like density and roll-off", add after the list:**
> Our tools for it: the film curve (2), the split (3), saturation by brightness (4), density (5), the hue curves (6).

**Add to "Sources":**
> ACES CSC Apple Log 2 (aces-input-and-colorspaces); OpenColorIO 2.6 "Apple Log 2"; ACES Reference Gamut Compression
> (docs.acescentral.com/rgc); Kelly on log vs linear (blog.frame.io, 2024-08-05); Prolost on Apple Log.

### Optional, outside the colourist skill

`cinematographer/exposure.md` and `gaffer/setups.md`:
- Next to Apple Log's numbers, add the video-range codes: grey 49 % / code 492, black 15 % / 196, 90 % white 68 % / 661.
- Add the "ProRes Log Video Encoding → Log 2" setting, and the ProRes RAW and open-gate caveats from §9.

---

## 9. Capture checklist: Samuel's iPhone 17 Pro in Apple Log 2

1. **App.**
   - Use Blackmagic Camera (Apple Log 2 since version 3.1) or Final Cut Camera 2.0 for manual control.
   - In the native Camera app, first set **Settings → Camera → Formats → ProRes Log Video Encoding → Log 2**. On the 17
     Pro it can also record the first Apple Log.
2. **Codec.**
   - ProRes 422 HQ (10-bit 4:2:2); ProRes 422 when storage is short.
   - HEVC log only for long takes on a full phone: it is 4:2:0 and compressed.
   - **No ProRes RAW for the Day films yet** (F9).
3. **Resolution and frame rate.**
   - UHD 3840×2160: our grading stills are 3840 wide.
   - 25 fps (50 Hz mains) or 30 fps to match the worlds. Pick one per film.
   - Above 4K30/60, or for 120 fps, record to an external SSD over a USB 3.2 Gen 2 cable.
4. **Shutter, ND and flicker.** Keep 180° (1/50 at 25 fps, 1/60 at 30) and use ND outdoors. Test LED and fluorescent
   flicker at 1/60 under 50 Hz light. **Never change the shutter within a scene** (CineD saw exposure jump with it).
5. **ISO.** Use the lowest the light allows and lock it. Light the face (the CB60, the window) rather than raising ISO.
   The 1× main camera is the cleanest; test the 0.5× and 4× before relying on them at night.
6. **White balance.** Set Kelvin by hand, per scene, and lock it: no auto white balance. For mixed light, set it between
   the sources (try 4,000–4,500 K). It is baked into the log: get it close in camera.
7. **Exposure**, on the log waveform (video %):
   - grey card at about **49 %** (10-bit 492);
   - light skin **+½ to +1 stop**, which is **53–57 %**;
   - a window or sky that must hold no higher than about +5 stops (91 %).
   - Each stop above grey is about 8.5 %.
   - Set zebras around 95 %, and find your phone's real clipping point once with a bright lamp: the code ceiling is +6
     stops, but the sensor may clip sooner.
   - In high-contrast scenes under-expose by up to one stop to hold the highlights, then raise it in the balance
     (Prolost's +1-stop method). Never more.
   - Know whether your false colour reads the log signal or the LUT picture. The numbers here are for log.
8. **Lock and don't touch.** Lock focus, exposure and white balance before recording, and don't tap the screen during a
   take. The iPhone's processing reacts to the scene (CineD).
9. **Monitoring.** Load our own Apple Log 2 → ACES 2.0 Rec.709 LUT (§6, step 13) as the display LUT, so what you see is
   the studio's ungraded picture. Record the log, not the LUT.
10. **Open gate (4:3)** is worth it for 9:16 crops, but only if the app keeps Apple Log 2 at a usable size. Some modes
    record Rec.709 only, or 1920×1440. Check the colour-space indicator.
11. **References.**
    - Hold a grey card (or a white card) and, if you have one, a colour chart in frame at the start of every set-up.
      They become the `regions` for the base correction.
    - Once per kind of light, shoot a grey-card ladder from −2 to +2 stops.
12. **Coloured light.** For the CB60 in HSI or effect modes, or a phone screen in frame, expect colours outside the
    working space (F3). Shoot one test and judge the 4K still.
13. **Check on ingest.** Every clip must read `apple-log-2 · log atom` in the studio. `apple-log` means the phone was on
    "Log"; `unknown` means the file lost its tag. Fix the setting, or set the profile by hand, before any grading.

---

## Sources

**Apple**
- [AVCaptureColorSpace.appleLog2](https://developer.apple.com/documentation/avfoundation/avcapturecolorspace/applelog2)
  and [.appleLog](https://developer.apple.com/documentation/avfoundation/avcapturecolorspace/applelog).
- [kCVImageBufferLogTransferFunction_AppleLog2](https://developer.apple.com/documentation/corevideo/kcvimagebufferlogtransferfunction_applelog2),
  [kCMFormatDescriptionLogTransferFunction_AppleLog2](https://developer.apple.com/documentation/coremedia/kcmformatdescriptionlogtransferfunction_applelog2),
  and the header comments in `CVImageBuffer.h` and `CMFormatDescription.h` (Xcode, macOS SDK 26.2). The identifier
  values were printed from the constants.
- [iPhone 17 Pro tech specs](https://support.apple.com/en-us/125090) ("Apple Log 2", "Academy Color Encoding System").
- [Record ProRes video (Log or Log 2)](https://support.apple.com/guide/iphone/record-prores-video-iphde02c478d/ios) and
  [About Apple ProRes on iPhone](https://support.apple.com/en-us/109041).
- [Final Cut Camera: record video and ProRes RAW](https://support.apple.com/guide/final-cut-camera/record-video-in-final-cut-camera-dev6b8c9521d/ios)
  and [about standard, log and RAW](https://support.apple.com/guide/final-cut-camera/about-standard-log-and-raw-video-dev8637f6692/ios).
- [FCP: ProRes RAW settings, RAW to Log](https://support.apple.com/guide/final-cut-pro/adjust-prores-raw-camera-settings-ver3eb60032c/mac).
- [Apple newsroom: Final Cut Camera 2.0](https://www.apple.com/newsroom/2025/09/apple-announces-final-cut-camera-2-0/).
- Apple's Apple Log 2 white paper and LUTs are behind a developer sign-in (developer.apple.com/download/all/?q=Apple%20log%202).
  They were not opened; the values above are as ACES and OCIO transcribe them.

**ACES and OpenColorIO**
- [ACES Apple CSCs](https://github.com/aces-aswf/aces-input-and-colorspaces/tree/main/apple) and the
  [ACES core library](https://github.com/aces-aswf/aces-core) (Bradford default; ACES 2.0 AP1 clamp in the CHANGELOG).
- [ACES Reference Gamut Compression look](https://github.com/aces-aswf/aces-look/blob/main/reference_gamut_compression/Look.Academy.ReferenceGamutCompress.ctl),
  [RGC specification](https://docs.acescentral.com/rgc/specification/),
  [implementation guide](https://docs.acescentral.com/rgc/guides/rgc-implementation/) and
  [user guide](https://docs.acescentral.com/rgc/guides/rgc-user/).
- [ACES 2 rendering](https://docs.acescentral.com/background/about-rendering/) and the
  [ACESCentral note on bright coloured lights](https://acescentral.com/knowledge-base-2/crushed-colors-caused-by-brightly-colored-lights/).
- [OCIO AppleCameras.cpp](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/src/OpenColorIO/transforms/builtins/AppleCameras.cpp),
  [OCIO PR #2343](https://github.com/AcademySoftwareFoundation/OpenColorIO/pull/2343),
  [OCIO 2.6.0 release](https://github.com/AcademySoftwareFoundation/OpenColorIO/releases/tag/v2.6.0) (`docs/releases/ocio_2_6.rst`;
  built-in `studio-config-v5.0.0_aces-v2.1_ocio-v2.6`),
  [Config-ACES PR #179](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/pull/179) and
  [issue #163](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/issues/163).

**Colourists, testers and tools**
- Prolost: [Apple Log](https://prolost.com/blog/applelog), [Peru and Taiwan](https://prolost.com/blog/iphonelog-peru-taiwan),
  [Let Loose](https://prolost.com/blog/panavision-iphone), [LUTs](https://proloststore.com/apple-log).
- Cullen Kelly on Frame.io: [log vs linear](https://blog.frame.io/2024/08/05/when-should-you-color-grade-in-log-linear/),
  [ACES vs RCM](https://blog.frame.io/2024/02/12/davinci-resolve-color-management-vs-aces-which-should-you-choose/),
  [ACES 1.3 gamut compression](https://blog.frame.io/2023/06/26/aces-1-3-color-gamut-compression/).
- Darren Mostyn: [How to Grade Apple Log](https://www.youtube.com/watch?v=J_UuYr91sPo).
- Juan Melara: [iPhone16Pro2Alexa](https://juanmelara.com.au/iphone16pro2alexa-usage-instructions).
- CineD: [iPhone 17 Pro lab test](https://www.cined.com/lab-test-of-the-iphone-17-pro-rolling-shutter-dynamic-range-trials-and-exposure-challenges/).
- Blackmagic Camera: [PetaPixel](https://petapixel.com/2025/10/09/blackmagic-cameras-new-updates-take-advantage-of-iphone-17-pros-video-chops/)
  and [Newsshooter 3.1.2](https://www.newsshooter.com/2025/10/08/blackmagic-camera-version-3-1-2-update-adds-1920x1440-open-gate-recording-with-apple-log/).
- [whoismatt iPhone 17 Pro review](https://whoismatt.com/iphone-17-pro-a-filmmakers-review/).
- [Mixing Light on ACES 2.0 gamut mapping](https://mixinglight.com/color-grading-tutorials/aces-2-0-volumetric-gamut-mapping-in-action/).

**The three assigned sources**
- [Sebastian Dylag](https://www.youtube.com/watch?v=EVcWNMbUcks),
  [Christopher Balladarez](https://www.youtube.com/watch?v=n6A5eu0NPYA),
  [LogGate](https://loggate.tech/apple-log-2-iphone-17-pro-guide/).

**Not reachable:** the Blackmagic forum (Cloudflare challenge, not bypassed) and gamut.io (403). Resolve's exact CST
naming for Apple Log 2 therefore comes from the Dylag video ("Apple Log 2" input colour space with "Apple Log" gamma),
and other guides call the same entry "Apple Wide Gamut". Treat the name as version-dependent.

**Computed here:** the code-value table, the matrices and gamut areas, the ΔE2000 of a wrong tag, the reach of the RGC
limits, and the share of AWG outside AP1. The scripts and raw materials are in `scratchpad/research/`.
