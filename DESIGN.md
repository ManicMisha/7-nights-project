# 7 Nights — design notes

Living document for anyone (human or AI) picking the project up. It records
*why* things are the way they are. Update it in the same PR as the change.

## Goal

A survival sandbox: gather → craft → build → survive 7 nights. It keeps
Minecraft-style freedom to dig, harvest and build anywhere, but it has **no
visible cubes**. The world is stored on an invisible grid and drawn as smooth,
stylized terrain and objects (see *Art style*).

## Status and roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: Three.js upgrade, colour management, tests, benchmark, flags, these docs | **Done** |
| 1 | Data model: material + density grid, building pieces, harvestables, IndexedDB saves | Next |
| 2 | Smooth terrain (Surface Nets) and new world generation | Planned |
| 3 | Stylized terrain look | Planned |
| 4 | Digging and terrain placement, tool tiers | Planned |
| 5 | Harvesting: trees, rocks, ore, plants | Planned |
| 6 | Building pieces | Planned |
| 6b | Survival loop: crafting, smelting, hunger, thirst, the 7 nights | Planned |
| 7 | Lighting and sky | Planned |
| 8 | Stylized water and vegetation | Planned |
| 9 | Characters, mobs, first-person hands and tools | Planned |
| 10 | Effects and polish | Planned |
| 11 | Performance and quality presets | Planned |

Every phase ships through a PR into `main` and leaves the game playable.
GitHub Pages deploys `main` only.

## Architecture

Plain JavaScript ES modules, no build step. Three.js is vendored as a single
minified ES module and resolved through an import map in `index.html`, so
`import * as THREE from 'three'` works in every module.

| Module | Responsibility |
|---|---|
| `config.js` | World dimensions, player/mob tuning, default settings |
| `flags.js` | Feature flags for unfinished systems |
| `bench.js` | `?bench` benchmark mode and frame-time statistics |
| `noise.js` | Seeded PRNG, simplex noise, fBm, hashes |
| `blocks.js` | Block registry as typed lookup tables (becomes materials / items / pieces in Phase 1) |
| `chunk.js` | 16×128×16 chunk storage and light |
| `worldgen.js` | Deterministic terrain, biomes, caves, ores, trees |
| `lighting.js` | Sky and block light flood fill with incremental updates |
| `mesher.js` | Chunk meshing (cube faces today; Surface Nets from Phase 2) |
| `world.js` | Chunk streaming (generate → light → mesh) under a frame budget, block API, raycast |
| `shaders.js`, `sky.js`, `water.js` | Custom materials, day/night cycle, water passes |
| `physics.js`, `player.js`, `interaction.js`, `mobs.js` | Movement, collision, mining/placing, enemies |
| `inventory.js`, `ui.js`, `sound.js`, `input.js` | Items, HUD and menus, audio, controls |
| `main.js` | Bootstraps everything and runs the loop |

Modules that don't touch Three.js or the DOM (`noise`, `blocks`, `chunk`,
`worldgen`, `lighting`, `mesher`, `inventory`, `physics`, `flags`, and the
maths in `bench`) are the game's logic core. They're covered by `npm test`,
and new gameplay logic should stay DOM-free so it can be tested the same way.

## Decisions

**D1: stay on the web with Three.js (Phase 0).** A Raft-style stylized look
(low-poly models, one sun with soft shadows, bloom, simple fog, stylized
water) is cheap to render and well within WebGL on integrated graphics. The
web keeps the game one link away and lets every change be run and measured
in CI and in cloud sessions. Unreal was considered and dropped (hardware
limits). Unity URP and Godot 4 were considered but not needed.

**D2: Three.js r186, vendored, no bundler.** The npm package no longer ships
a minified build, so `vendor/three.module.min.js` is a one-off esbuild bundle
of `build/three.module.js` (which imports `three.core.js`):

```sh
npx esbuild node_modules/three/build/three.module.js --bundle --minify \
  --format=esm --legal-comments=eof --outfile=vendor/three.module.min.js
```

Stay on `WebGLRenderer`, not WebGPU, for integrated-GPU coverage. When
upgrading, check the release notes for renamed classes (r128 → r186 renamed
`DataTexture2DArray` to `DataArrayTexture` and deprecated `Clock` in favour
of `Timer`).

**D3: colour management is on.** Textures are tagged `SRGBColorSpace`,
`THREE.Color` values are linear, and all lighting and fog maths runs in
linear space. Custom fragment shaders end with `#include <colorspace_fragment>`.
Colours are *authored* in sRGB: in JavaScript use
`new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace)` or hex strings, and in
GLSL wrap literals in `toLinear()`. Perceptual factors (light curves, face
shading, AO) are raised to the power 2.2 before they multiply linear
colours.

**D4: invisible grid (from Phase 1).** 1 m cells, stored per cell as a
material plus a signed density. Gameplay reads the grid. Rendering is derived
from it by Surface Nets, so the player sees smooth ground, never cubes.
Building pieces snap to the same 1 m grid.

**D5: feature flags for unfinished systems.** Register each flag in
`js/flags.js`; toggle it with `?flags=name` or `?flags=-name`. Delete it once
its system is done and on by default.

**D6: verification.** Each phase is checked three ways:
1. `npm test` (runs in CI on every push and PR).
2. Screenshots from a fixed camera setup on seed `demo` at noon, dusk and
   midnight, compared before and after.
3. `?bench` runs. Cloud sessions only have software rendering, so real FPS
   numbers come from the owner's hardware via the Pages link.

## Saves

There are none yet: only settings are stored (`localStorage` key
`7nights.settings`). Phase 1 adds IndexedDB saves of modified chunks with a
format version number from the first release, so later formats can migrate
older saves.

## Performance budget

Target: 60 FPS on a GTX 1060-class GPU, and on integrated graphics at the
Low preset (presets arrive in Phase 11). Performance beats visual extras.

Baseline at the end of Phase 0 (seed `demo`, render distance 6; CPU timings
are meaningful, FPS is not, as these were measured with software rendering):

| Metric | Value |
|---|---|
| Generate / light / mesh one chunk (median) | 0.7 / 1.8 / 1.3 ms |
| World triangles, render distance 6 | ~400–480k |
| Render passes per frame | 3 (water reflection and refraction; removed in Phase 8) |

## Art style

Stylized semi-realism in the spirit of *Raft*: real-world objects and
proportions, simplified and slightly chunky, clean readable silhouettes.
Not photoreal, not blocky. Everything is original: nothing is copied from
Raft or Minecraft (models, textures, UI, names, sounds).

- **Models:** low-to-mid poly, soft bevels, flat or softly painted colour.
  No photo textures.
- **Day:** bright, saturated, cheerful. **Night:** dark, cold, tense.
- **Lighting:** one directional sun with soft shadows, sky/ambient light,
  gentle bloom, gentle fog. No ray tracing, heavy GI or volumetrics.
- **Water:** vivid turquoise, gentle waves, simple shoreline foam, soft
  transparency in the shallows.
- **Readability:** resources, interactables and enemies must stand out from
  the environment (saturation and value contrast, not outlines alone).

### Palette

Authored in sRGB. Phase 3 moves these values into code.

| Role | Hex | Notes |
|---|---|---|
| Sky, day (zenith) | `#4DA8F0` | |
| Sky, day (horizon) | `#BDE6FF` | Also the daytime fog colour |
| Sunlight | `#FFE9B8` | Warm |
| Grass | `#6CC24A` | Main ground colour |
| Grass, shade | `#3F8F3A` | Slopes and ambient occlusion |
| Leaves | `#4FAE3B` | |
| Dirt | `#9C6B43` | |
| Rock | `#8E9196` | |
| Rock, dark | `#5E6268` | Cliffs and cave walls |
| Sand | `#F2D99A` | |
| Water, shallow | `#3FE0D0` | Turquoise |
| Water, deep | `#1E7FC2` | |
| Foam | `#F4FFFF` | |
| Wood | `#B9824A` | Logs, planks, tier 1 building |
| Wood, dark | `#7A4E2B` | Bark and trim |
| Stone (building) | `#A7A39A` | Tier 2 building |
| Brick | `#B5553F` | Tier 3 building |
| Metal | `#7F8A96` | Tier 4 building |
| Sky, night | `#0B1026` | |
| Fog, night | `#1A2340` | |
| Moonlight | `#7E94C9` | Cold |
| Firelight | `#FFB45A` | Torches, campfires |
| Resource highlight | `#FFD84D` | Ore glints, pickups |
| Enemy accent | `#E0453A` | Eyes, hit flashes |

## Conventions

- Small, reviewable commits on a feature branch per phase; PR into `main`.
- Keep the game playable after every phase; unfinished work goes behind a flag.
- Art that can't be generated in code gets a clean placeholder in the palette
  and an entry in `ASSETS_NEEDED.md`. Only our own or CC0 assets.
