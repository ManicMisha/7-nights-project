// Item registry: what the player carries. Items are separate from grid
// materials — a log in your inventory is an item; a tree in the world will
// be a harvestable object (Phase 5); a wall will be a building piece
// (Phase 6). For now every item places a material, like the prototype did.
//
// Item ids are written into save files, so never renumber or reuse an id.
// Retire an item by leaving its id unused.

import { MAT, MAT_NAME, MAT_DROP } from './materials.js';

export const ITEM = {
  NONE: 0,
  DIRT: 1,
  GRASS: 2,
  STONE: 3,
  COBBLESTONE: 4,
  SAND: 5,
  SANDSTONE: 6,
  GRAVEL: 7,
  LOG: 8,
  PLANKS: 9,
  LEAVES: 10,
  GLASS: 11,
  BRICKS: 12,
  SNOW: 13,
  COAL_ORE: 14,
  IRON_ORE: 15,
  GLOWSTONE: 16,
  TORCH: 17,
  RED_FLOWER: 18,
  YELLOW_FLOWER: 19,
};

// item id → the material it places (and whose texture its icon uses)
const PLACES = [
  [ITEM.DIRT, MAT.DIRT], [ITEM.GRASS, MAT.GRASS], [ITEM.STONE, MAT.STONE],
  [ITEM.COBBLESTONE, MAT.COBBLESTONE], [ITEM.SAND, MAT.SAND], [ITEM.SANDSTONE, MAT.SANDSTONE],
  [ITEM.GRAVEL, MAT.GRAVEL], [ITEM.LOG, MAT.LOG], [ITEM.PLANKS, MAT.PLANKS],
  [ITEM.LEAVES, MAT.LEAVES], [ITEM.GLASS, MAT.GLASS], [ITEM.BRICKS, MAT.BRICKS],
  [ITEM.SNOW, MAT.SNOW], [ITEM.COAL_ORE, MAT.COAL_ORE], [ITEM.IRON_ORE, MAT.IRON_ORE],
  [ITEM.GLOWSTONE, MAT.GLOWSTONE], [ITEM.TORCH, MAT.TORCH], [ITEM.RED_FLOWER, MAT.RED_FLOWER],
  [ITEM.YELLOW_FLOWER, MAT.YELLOW_FLOWER],
];

const N = 256;
export const ITEM_NAME = new Array(N).fill('Unknown');
export const ITEM_PLACES = new Uint8Array(N); // material placed by the item (0 = none)
const ITEM_FOR_MATERIAL = new Uint8Array(N);

for (const [item, mat] of PLACES) {
  ITEM_NAME[item] = MAT_NAME[mat];
  ITEM_PLACES[item] = mat;
  ITEM_FOR_MATERIAL[mat] = item;
}

/** True if `id` is a registered item. */
export function isItem(id) {
  return Number.isInteger(id) && id > 0 && id < N && ITEM_PLACES[id] !== 0;
}

/** Item dropped when the material `mat` is mined (ITEM.NONE if nothing). */
export function dropItem(mat) {
  return ITEM_FOR_MATERIAL[MAT_DROP[mat]];
}

/** Material whose texture is used for the item's icon. */
export function itemIconMaterial(item) {
  return ITEM_PLACES[item];
}

/** Items offered by the creative block palette in the inventory screen. */
export const PALETTE_ITEMS = [
  ITEM.GRASS, ITEM.DIRT, ITEM.STONE, ITEM.COBBLESTONE, ITEM.SAND, ITEM.SANDSTONE,
  ITEM.GRAVEL, ITEM.LOG, ITEM.PLANKS, ITEM.LEAVES, ITEM.GLASS, ITEM.BRICKS,
  ITEM.SNOW, ITEM.COAL_ORE, ITEM.IRON_ORE, ITEM.GLOWSTONE, ITEM.TORCH,
  ITEM.RED_FLOWER, ITEM.YELLOW_FLOWER,
];
