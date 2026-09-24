# Assets needed

Art and audio the game needs that can't reasonably be generated in code.
Until an asset is chosen, the game uses a clean placeholder shape in the
palette colours from `DESIGN.md`.

**Licence rule:** only our own work or CC0. Kenney (kenney.nl) and Quaternius
(quaternius.com) publish CC0 low-poly packs that fit the style. Check the
licence on each pack's own page when picking it, and record it here.
Nothing from Raft or Minecraft.

**Format:** glTF 2.0 (`.glb`), which Three.js loads natively, animations
included. Keep models low-poly and use flat or softly painted colours, not
photo textures.

| Asset | Used for | Phase | Status | Candidate source | Licence |
|---|---|---|---|---|---|
| Trees (2–3 species, plus stump and log pieces) | Harvesting, forests | 5 | Needed | Quaternius or Kenney nature packs | — |
| Rocks and boulders (small, medium, large) | Harvesting stone | 5 | Needed | Kenney nature packs | — |
| Ore nodes (coal, iron) | Harvesting ore | 5 | Needed | Our own, from rock models plus coloured inserts | — |
| Bushes, berry bushes, grass clumps, flowers | Gathering, vegetation | 5, 8 | Needed | Quaternius or Kenney nature packs | — |
| Building pieces: foundation, wall, floor, stairs, roof, door, window, fence (4 tiers) | Building | 6 | Needed; code placeholders first | Our own low-poly models; Kenney building kits for reference | — |
| Crafting bench, furnace, chest, bed, campfire, torch | Furniture | 6, 6b | Needed | Kenney survival kit | — |
| Tools: axe, pickaxe, shovel, hammer (4 tiers) | First-person tools | 4, 9 | Needed | Kenney or Quaternius tool packs | — |
| First-person hands and arms | Viewmodel | 9 | Needed | Our own | — |
| Hostile creatures, animated (2–3 types) | Night enemies | 9 | Needed; hardest to source | Quaternius animated monster packs | — |
| Item icons | Inventory UI | 5–6b | Rendered from the 3D models in code | Our own | — |
| Sound: footsteps, chopping, digging, building, UI, creatures, ambience | Audio | 10 | Procedural placeholders exist (`sound.js`) | Kenney audio packs | — |
| UI font | HUD and menus | 10 | System font for now | Kenney's CC0 fonts | — |
