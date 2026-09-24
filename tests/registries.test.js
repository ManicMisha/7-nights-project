import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAT, MAT_LEGACY, defaultDensity, DENSITY_FULL, DENSITY_EMPTY } from '../js/materials.js';
import { ITEM, ITEM_PLACES, ITEM_NAME, PALETTE_ITEMS, dropItem, isItem } from '../js/items.js';
import {
  PIECE, PIECE_DEFS, TIER, SLOT, pieceSlot, pieceKey, pieceKeyCell, pieceKeySlot, pieceMaxHealth, makePiece,
} from '../js/pieces.js';
import { HARVESTABLE, HARVESTABLE_DEFS } from '../js/harvestables.js';

test('air is empty and everything else is full by default', () => {
  assert.equal(defaultDensity(MAT.AIR), DENSITY_EMPTY);
  assert.equal(defaultDensity(MAT.STONE), DENSITY_FULL);
  assert.equal(defaultDensity(MAT.WATER), DENSITY_FULL);
});

test('terrain materials are not legacy; prototype leftovers are', () => {
  for (const id of [MAT.STONE, MAT.DIRT, MAT.GRASS, MAT.SAND, MAT.WATER, MAT.COAL_ORE]) assert.equal(MAT_LEGACY[id], 0);
  for (const id of [MAT.LOG, MAT.LEAVES, MAT.PLANKS, MAT.TORCH, MAT.TALL_GRASS]) assert.equal(MAT_LEGACY[id], 1);
});

test('every item has a unique id, a name and places a material', () => {
  const ids = Object.values(ITEM).filter((id) => id !== ITEM.NONE);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.ok(isItem(id), `item ${id} is registered`);
    assert.notEqual(ITEM_PLACES[id], MAT.AIR);
    assert.notEqual(ITEM_NAME[id], 'Unknown');
  }
  for (const id of PALETTE_ITEMS) assert.ok(isItem(id));
  assert.equal(isItem(0), false);
  assert.equal(isItem(200), false);
  assert.equal(isItem(1.5), false);
});

test('mining drops the right item', () => {
  assert.equal(dropItem(MAT.GRASS), ITEM.DIRT);
  assert.equal(dropItem(MAT.STONE), ITEM.COBBLESTONE);
  assert.equal(dropItem(MAT.LOG), ITEM.LOG);
  assert.equal(dropItem(MAT.BEDROCK), ITEM.NONE);
  assert.equal(dropItem(MAT.TALL_GRASS), ITEM.NONE);
});

test('walls on different edges of a cell use different slots', () => {
  const slots = [0, 1, 2, 3].map((r) => pieceSlot(PIECE.WALL, r));
  assert.deepEqual(slots, [SLOT.EDGE_N, SLOT.EDGE_E, SLOT.EDGE_S, SLOT.EDGE_W]);
  assert.equal(pieceSlot(PIECE.FLOOR, 3), SLOT.FLOOR);
  assert.equal(pieceSlot(PIECE.CHEST, 1), SLOT.CENTER);
  // A floor, four walls and a chest can share one cell.
  const keys = new Set([PIECE.FLOOR, PIECE.CHEST].map((t) => pieceKey(5, pieceSlot(t, 0))).concat(slots.map((s) => pieceKey(5, s))));
  assert.equal(keys.size, 6);
});

test('piece keys round-trip to cell and slot', () => {
  const key = pieceKey(32767, SLOT.EDGE_W);
  assert.equal(pieceKeyCell(key), 32767);
  assert.equal(pieceKeySlot(key), SLOT.EDGE_W);
});

test('higher tiers are tougher; every piece type is defined', () => {
  assert.ok(pieceMaxHealth(PIECE.WALL, TIER.METAL) > pieceMaxHealth(PIECE.WALL, TIER.WOOD));
  assert.equal(pieceMaxHealth(PIECE.CHEST, TIER.METAL), pieceMaxHealth(PIECE.CHEST, TIER.WOOD));
  for (const id of Object.values(PIECE)) assert.ok(PIECE_DEFS[id], `piece ${id} has a definition`);
  assert.deepEqual(makePiece(PIECE.DOOR, TIER.WOOD, 5), { type: PIECE.DOOR, tier: TIER.WOOD, rotation: 1, health: 150 });
});

test('every harvestable type is defined', () => {
  for (const id of Object.values(HARVESTABLE)) assert.ok(HARVESTABLE_DEFS[id]?.name);
});
