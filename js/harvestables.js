// Harvestable objects: trees, plants, rocks and ore nodes. They're objects
// placed on the world grid, not terrain. World generation produces a list
// of records per chunk (chunk.harvestables) deterministically from the
// seed, so only what the player changes needs saving (chunk.harvestState:
// record index → state).
//
// Phase 1 generates records for trees and plants. They are still drawn by
// the legacy log/leaf/plant materials stamped into the grid at the same
// place. Phase 5 turns them into real objects (chop, fall, split into logs)
// and adds rocks, ore nodes, berries, fibre and clay.
//
// Type ids are written into save files: never renumber them.

export const HARVESTABLE = {
  OAK_TREE: 1,
  TALL_GRASS: 2,
  RED_FLOWER: 3,
  YELLOW_FLOWER: 4,
  BOULDER: 5,
  COAL_NODE: 6,
  IRON_NODE: 7,
  BERRY_BUSH: 8,
  FIBRE_PLANT: 9,
  CLAY_DEPOSIT: 10,
};

/** Name and regrow time in seconds (0 = never regrows). */
export const HARVESTABLE_DEFS = {
  [HARVESTABLE.OAK_TREE]: { name: 'Oak tree', regrowSeconds: 0 },
  [HARVESTABLE.TALL_GRASS]: { name: 'Tall grass', regrowSeconds: 300 },
  [HARVESTABLE.RED_FLOWER]: { name: 'Poppy', regrowSeconds: 600 },
  [HARVESTABLE.YELLOW_FLOWER]: { name: 'Dandelion', regrowSeconds: 600 },
  [HARVESTABLE.BOULDER]: { name: 'Boulder', regrowSeconds: 0 },
  [HARVESTABLE.COAL_NODE]: { name: 'Coal deposit', regrowSeconds: 0 },
  [HARVESTABLE.IRON_NODE]: { name: 'Iron deposit', regrowSeconds: 0 },
  [HARVESTABLE.BERRY_BUSH]: { name: 'Berry bush', regrowSeconds: 480 },
  [HARVESTABLE.FIBRE_PLANT]: { name: 'Fibre plant', regrowSeconds: 360 },
  [HARVESTABLE.CLAY_DEPOSIT]: { name: 'Clay deposit', regrowSeconds: 0 },
};

/** State of a record; anything but INTACT is saved. */
export const HARVEST_STATE = { INTACT: 0, HARVESTED: 1 };

/**
 * A harvestable record. (x, y, z) are local to the chunk; y is the cell the
 * object stands in (one above the ground). `size` is type-specific (a
 * tree's trunk height, for example).
 */
export function makeHarvestable(type, x, y, z, size = 0) {
  return { type, x, y, z, size };
}
