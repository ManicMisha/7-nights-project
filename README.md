# 7 Nights

A survival sandbox built with plain HTML5, ES modules and Three.js r186.
It's being rebuilt from a block-based prototype into a stylized game with
smooth, diggable terrain; see [DESIGN.md](DESIGN.md) for the plan and the
decisions behind it.

The game is entirely static: no build step and no runtime dependencies.
Three.js is included in `vendor/`, so it makes no external requests.

- **Play:** serve this folder with any static file server, e.g.
  `npx http-server .`, then open the printed URL. Opening `index.html`
  directly from disk won't work, because browsers block ES modules on
  `file://`.
- **Play online:** https://manicmisha.github.io/7-nights-project/ (deployed to GitHub
  Pages by `.github/workflows/pages.yml` on every push to `main`).
- **Worlds and saves:** `?seed=anything` opens the world for that seed.
  The same seed always generates the same terrain. Your changes, position,
  inventory and time of day save automatically in the browser (IndexedDB)
  and come back on your next visit. Without `?seed` the last world you
  played is resumed. The pause menu can delete a world's save.
- **Requires** WebGL 2 and a browser with import-map support (any current
  Chrome, Edge, Firefox or Safari).

## Development

- **Tests:** `npm test` runs the logic tests with Node's built-in test runner
  (Node 20+; nothing to install). CI runs them on every push and pull
  request, and only deploys `main` when they pass.
- **Benchmark:** open `?bench` (for example
  https://manicmisha.github.io/7-nights-project/?bench). It flies a fixed
  route over seed `demo` at noon for 40 seconds, then shows average FPS,
  1%-low FPS and frame times, with a button to copy the full results.
  Options: `?bench=60` for a longer run, `&time=0.8` for another time of day
  (0 = midnight, 0.5 = noon), `&seed=…` for another world.
- **Feature flags:** unfinished systems sit behind flags registered in
  `js/flags.js`. Toggle them per session with `?flags=name` or
  `?flags=-name`. The debug overlay (F3) lists the active ones. For example,
  `?flags=-smoothTerrain` shows the same world as cubes, for comparison.
- **Docs:** [DESIGN.md](DESIGN.md) holds architecture decisions and the art
  style; [ASSETS_NEEDED.md](ASSETS_NEEDED.md) tracks art still to source.

## Controls

| Input | Action |
| --- | --- |
| WASD + mouse | Move / look |
| Space | Jump · swim up · fly up |
| Space ×2 or F | Toggle flight |
| Shift | Fly down |
| Ctrl or R | Sprint |
| Left mouse (hold) | Mine block / attack mob |
| Right mouse | Place block |
| 1–9, mouse wheel | Select hotbar slot |
| E | Inventory and block palette |
| F3 | Debug overlay (FPS, position, biome, light, chunk and triangle counts) |
| Esc | Pause menu (settings, time of day, seed) |

## Architecture

All game code lives in `js/`.

| Module | Responsibility |
| --- | --- |
| `config.js` | World dimensions, player/mob tuning, default settings |
| `flags.js` | Feature flags for unfinished systems |
| `bench.js` | `?bench` benchmark mode and frame-time statistics |
| `noise.js` | Seeded PRNG, 2D/3D simplex noise, fBm, ridged noise, integer hashes |
| `materials.js` | Material registry (what fills a grid cell) flattened into typed lookup tables (solid, opaque, emission, attenuation, hardness, drops, face textures); density constants |
| `items.js` | Item registry with stable ids: names, the material each item places, drops, the creative palette |
| `pieces.js` | Building-piece types, material tiers, cell slots and map keys |
| `harvestables.js` | Harvestable object types (trees, plants, rocks, ore nodes) and records |
| `textures.js` | Procedural 32×32 pixel-art tiles → `DataArrayTexture` (mip-mapped, no atlas bleeding); inventory icons; crack overlays |
| `worldgen.js` | Terrain as a density field: domain-warped continentalness, hills, lakes, winding rivers, terraced cliffs and ridged mountains with 3D overhangs; biomes (ocean, beach, plains, mountains, river); slope-aware materials; caves and ore veins from interpolated 3D noise; trees and plants |
| `chunk.js` | 16×128×16 grid chunk: material, density and light per cell; height map; harvestable records; pieces |
| `lighting.js` | Sky and block light flood fill (0–15) that crosses chunk borders; incremental remove/re-flood on edits |
| `surfacenets.js` | Smooth terrain mesh (Surface Nets) from the density grid: seamless across chunks, gradient normals, per-vertex light, ambient occlusion and terrain-class blend weights |
| `terraintextures.js` | Stylized terrain textures (grass, soil, rock, sand, snow) painted in code from the palette |
| `mesher.js` | Cube mesher for water and legacy blocks (trees, plants, placed blocks): face culling, per-vertex smooth lighting and ambient occlusion, packed 14-byte vertices |
| `world.js` | Chunk streaming (generate → light → mesh) under a per-frame time budget; grid get/set (`getMaterial`, `getDensity`, `setCell`); per-chunk deltas of the player's changes; voxel DDA raycast |
| `save.js` / `storage.js` / `persistence.js` | Save data and its binary format; IndexedDB access; loading, restoring, autosaving and deleting worlds |
| `shaders.js` | Stylized triplanar terrain shader (slope and height blending, ore nuggets), block, water, sky and cloud shaders; shared lighting and fog |
| `water.js` | Refraction pass (colour and depth) and planar reflection pass with an oblique clip plane |
| `sky.js` | Day/night cycle: sun and moon, sky colours, sunsets, stars, light colour, clouds |
| `physics.js` | Collision shared by player and mobs: stands on the smooth surface, steps up small rises, follows slopes; legacy blocks collide as boxes |
| `player.js` | First-person controller: walking, sprinting, jumping, swimming, flight, fall damage, health |
| `interaction.js` | Block targeting, timed mining with cracks and particles, placing, melee |
| `mobs.js` | Zombies: spawn in darkness (surface at night, caves any time), chase and attack, knockback, burn in daylight |
| `inventory.js` / `ui.js` | 36-slot inventory with stacking, hotbar, hearts, inventory screen, menus |
| `sound.js` | Procedural Web Audio sound effects |
| `main.js` | Bootstraps everything and runs the game loop |
