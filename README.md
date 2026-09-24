# 7 Nights

A Minecraft-inspired voxel sandbox built with plain HTML5, ES modules and
Three.js r128. It is entirely static: no build step and no dependencies to
install. Three.js is included in `vendor/`, so the game makes no external
requests.

- **Play:** serve this folder with any static file server, e.g.
  `npx http-server .`, then open the printed URL. Opening `index.html`
  directly from disk won't work, because browsers block ES modules on
  `file://`.
- **Seeds:** `index.html?seed=anything`. The same seed always produces the
  same world.
- **Requires** WebGL 2 (used for the mip-mapped block texture array).

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
| `noise.js` | Seeded PRNG, 2D/3D simplex noise, fBm, ridged noise, integer hashes |
| `blocks.js` | Block registry flattened into typed lookup tables (solid, opaque, emission, attenuation, hardness, drops, face textures) |
| `textures.js` | Procedural 32×32 pixel-art tiles → `DataTexture2DArray` (mip-mapped, no atlas bleeding); inventory icons; crack overlays |
| `worldgen.js` | Continentalness/hills/lakes/ridged-mountain height field; biomes (ocean, beach, plains, mountains); spaghetti + cavern caves from interpolated 3D noise; ores; trees that cross chunk borders; flowers and grass |
| `chunk.js` | 16×128×16 block and light storage, height map, vertical bounds |
| `lighting.js` | Sky and block light flood fill (0–15) that crosses chunk borders; incremental remove/re-flood on edits |
| `mesher.js` | Face culling, per-vertex smooth lighting and ambient occlusion with quad flipping; packed 14-byte vertices; one `BufferGeometry` per chunk for solid, cutout and cross blocks, plus one for water |
| `world.js` | Chunk streaming (generate → light → mesh) under a per-frame time budget; block get/set; edit persistence across unloads; voxel DDA raycast |
| `shaders.js` | Terrain, water, sky and cloud shaders; shared lighting and ray-marched "blocky" volumetric fog |
| `water.js` | Refraction pass (colour and depth) and planar reflection pass with an oblique clip plane |
| `sky.js` | Day/night cycle: sun and moon, sky colours, sunsets, stars, light colour, clouds |
| `physics.js` | Axis-separated AABB vs. voxel collision (shared by player and mobs) |
| `player.js` | First-person controller: walking, sprinting, jumping, swimming, flight, fall damage, health |
| `interaction.js` | Block targeting, timed mining with cracks and particles, placing, melee |
| `mobs.js` | Zombies: spawn in darkness (surface at night, caves any time), chase and attack, knockback, burn in daylight |
| `inventory.js` / `ui.js` | 36-slot inventory with stacking, hotbar, hearts, inventory screen, menus |
| `sound.js` | Procedural Web Audio sound effects |
| `main.js` | Bootstraps everything and runs the game loop |
