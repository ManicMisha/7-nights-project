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
| 1 | Data model: material + density grid, building pieces, harvestables, IndexedDB saves | **Done** |
| 2 | Smooth terrain (Surface Nets) and new world generation | **Done** |
| 3 | Stylized terrain look | Next |
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
| `materials.js` | What fills a grid cell: material registry as typed lookup tables, density constants |
| `items.js` | What the player carries: item registry (stable ids), drops, the creative palette |
| `pieces.js` | Building-piece types, tiers, cell slots and keys (gameplay in Phase 6) |
| `harvestables.js` | Trees, plants, rocks and ore nodes: types, regrow times, records |
| `chunk.js` | 16×128×16 grid chunk: material, density and light per cell; harvestables; pieces |
| `worldgen.js` | Deterministic terrain as a density field: domain warping, rivers, lakes, terraced cliffs, mountains with overhangs, caves, ore veins, trees and plants (with harvestable records) |
| `save.js` | ChunkDelta (the player's changes to a chunk) and its binary format; world metadata |
| `storage.js` | IndexedDB reads and writes |
| `persistence.js` | Load on start, restore the player, autosave, delete |
| `lighting.js` | Sky and block light flood fill with incremental updates |
| `surfacenets.js` | Smooth terrain mesh (Surface Nets) from the density grid: seamless across chunks, per-vertex light and AO |
| `mesher.js` | Cube meshing for water and the legacy blocks (and all terrain when `smoothTerrain` is off) |
| `world.js` | Chunk streaming (generate → light → mesh) under a frame budget, grid API (`getMaterial`, `getDensity`, `setCell`), deltas, raycast |
| `shaders.js`, `sky.js`, `water.js` | Custom materials, day/night cycle, water passes |
| `physics.js` | Smooth-ground character collision (step-up, slope following) plus box collision for legacy blocks |
| `player.js`, `interaction.js`, `mobs.js` | Player controller, mining/placing, enemies |
| `inventory.js`, `ui.js`, `sound.js`, `input.js` | Items, HUD and menus, audio, controls |
| `main.js` | Bootstraps everything and runs the loop |

Modules that don't touch the DOM are the game's logic core and are covered
by `npm test`: the registries, `noise`, `chunk`, `worldgen`, `lighting`,
`mesher`, `world`, `save`, `inventory`, `physics`, `flags` and the maths in
`bench` and `persistence`. The tests resolve `'three'` to the vendored build
through a Node hook (`tests/setup.js`), mirroring the import map, so even
`world.js` runs in Node. Keep new gameplay logic DOM-free so it can be
tested the same way.

## World data model

The world is three kinds of data. Gameplay reads them; rendering is
derived from them.

1. **Terrain grid.** 1 m cells in 16×128×16 chunks. Each cell has a
   material id (`Uint8`) and a signed terrain density (`Int8`, −127…127,
   `DENSITY_PER_METRE` = 32 units per metre), sampled at the cell centre.
   Density > 0 means the cell is filled with terrain, and its material is
   then always a terrain material (`MAT_TERRAIN`). Density ≤ 0 means empty
   terrain: air, water or a legacy block. The generator writes roughly the
   signed distance to the surface, so the Surface Nets mesher can place the
   surface between cells; player edits currently set cells full or empty
   (Phase 4's dig tool lowers density gradually). Light (sky and block, 4 bits
   each) is stored per cell too. About 96 KiB per chunk.
2. **Building pieces.** A sparse map per chunk (`chunk.pieces`), keyed by
   cell index × 8 + slot. Each cell has slots for a floor, four edges (walls,
   doors, fences) and a centre object, so a floor, four walls and a chest can
   share a cell. A piece stores type, tier, rotation and health. The
   registry is in `pieces.js`; placement gameplay arrives in Phase 6.
3. **Harvestable objects.** World generation emits a deterministic list of
   records per chunk (`chunk.harvestables`: type, cell, size). Only state the
   player changes is stored (`chunk.harvestState`: record index → state and
   regrow timer). Trees and plants get records today, and are still drawn
   by legacy log, leaf and plant materials at the same cells until Phase 5.

Items (`items.js`) are separate from all three: inventory slots hold item
ids, and each item says which material it places for now.

**Legacy materials.** `MAT_LEGACY` marks materials left over from the
block prototype. Trees and plants move to harvestables in Phase 5; placed
planks, cobblestone, glass, bricks, torches and glowstone move to building
pieces in Phase 6. New code shouldn't add legacy materials.

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

**D7: saves store only what changed (Phase 1).** The world regenerates
from its seed, so a save holds, per chunk, a `ChunkDelta`: edited cells,
placed pieces and harvest state, plus world metadata (player, inventory,
time). A world is identified by its seed; without `?seed` the last world
played is resumed. See *Saves* for the format and compatibility rules.

**D8: smooth terrain with Surface Nets (Phase 2).** Terrain is drawn
where the density field crosses zero, with density samples at cell centres.
Surface Nets was chosen over Marching Cubes (fewer triangles, shared
vertices, smoother at 1 m cells, simple to make seamless) and over Dual
Contouring (needs normals per edge and a solver; sharp features aren't
wanted in a soft stylized look). Each chunk owns the sample edges that
start inside it and reads one layer of samples from each neighbour, so
borders match exactly. Details that make it look right:
- The generator stores approximate *distance* to the surface (height
  difference ÷ √(1 + slope²)), so steep slopes don't saturate the ±127
  range, which turns them into staircases.
- Normals come from the density gradient; ambient occlusion is the
  interpolated amount of terrain one metre out from the surface; light comes
  from the existing grid lighting (cave darkness and torches still work).
- Terrain uses flat palette colours per material until Phase 3.

Collision follows the same surface (`physics.js`): the ground height is
solved exactly between cell centres, entities step up rises of up to 0.6 m,
follow the ground downhill, and are stopped by anything higher. Legacy blocks
still collide as boxes. The `smoothTerrain` flag (on by default;
`?flags=-smoothTerrain` to compare) switches meshing and physics back to
cubes. Remove it, and the cube-terrain paths, once nothing needs them.

## Saves

- **Where:** IndexedDB database `7nights`, stores `worlds` (metadata, keyed
  by world id) and `chunks` (encoded deltas, keyed by `worldId|cx,cz`).
  Settings stay in `localStorage` (`7nights.settings`); the last world played
  is `7nights.lastWorld`.
- **When:** every 30 s of play, when the game is paused, and when the tab is
  hidden or closed. Metadata and changed chunks are written in one
  transaction. Benchmarks (`?bench`) never read or write saves.
- **Chunk format:** little-endian binary, documented at the top of
  `save.js`. Magic `N7CH` and a version number, then edited cells (4 bytes
  each), pieces (12 bytes) and harvest states (8 bytes). An empty delta is
  28 bytes.
- **Compatibility rules:**
  - Changing the chunk or metadata format: bump its version, keep reading
    every older version (migrate on load), and add a test with an old buffer.
  - Changing world generation so existing terrain changes: bump
    `GENERATOR_VERSION` in `worldgen.js`. Saves from another generator
    version are not loaded (their edits would land on different terrain).
    The player is told, starts fresh, and the old save is replaced.
    Phase 2 raised it to 2, so worlds saved during Phase 1 aren't loaded;
    the player sees an explanation and a fresh world.
  - Item, piece and harvestable type ids are saved: never renumber them.
- **What isn't saved:** mobs, dropped particles and the day count (the
  7-night counter arrives in Phase 6b).

## Performance budget

Target: 60 FPS on a GTX 1060-class GPU, and on integrated graphics at the
Low preset (presets arrive in Phase 11). Performance beats visual extras.

Measurements on seed `demo` at render distance 6. CPU timings are
meaningful; the cloud sessions that take them only have software rendering,
so FPS figures come from `?bench` on real hardware.

| Metric | Phase 0 | Phase 1 | Phase 2 |
|---|---|---|---|
| Generate one chunk (median) | 0.7 ms | 0.96 ms incl. density fill (0.75 ms alone) | 2.1 ms (warping, rivers, cliffs, overhangs, ore veins) |
| Light one chunk (median) | 1.8 ms | 1.6–2.1 ms | unchanged |
| Mesh one chunk (median) | 1.3 ms (cubes) | 1.2–1.3 ms | 1.3 ms smooth terrain (+ a small cube pass for water and legacy blocks) |
| Triangles per chunk (terrain) | — | — | ~3.1k smooth vs ~3.2k as cubes |
| Grid memory per chunk | 64 KiB | 96 KiB | unchanged |
| Draw calls per frame | ~290 across 3 passes | unchanged | ~350–400 (a third mesh per chunk while legacy blocks remain) |
| Save size | — | 28 B per changed chunk + 4 B per edited cell | unchanged |

Water costs two extra render passes per frame (reflection and refraction),
removed in Phase 8.

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
