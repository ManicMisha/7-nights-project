import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAT, MAT_LEGACY, MAT_TERRAIN, MAT_CLASS, MAT_ORE, TERRAIN_CLASS, TERRAIN_CLASS_COUNT, ORE,
  defaultDensity, DENSITY_FULL, DENSITY_EMPTY,
} from '../js/materials.js';
import { paintTerrainLayers, TERRAIN_TEXTURE_SIZE } from '../js/terraintextures.js';
import { ITEM, ITEM_PLACES, ITEM_NAME, PALETTE_ITEMS, dropItem, isItem } from '../js/items.js';
import {
  PIECE, PIECE_DEFS, TIER, SLOT, pieceSlot, pieceKey, pieceKeyCell, pieceKeySlot, pieceMaxHealth, makePiece,
} from '../js/pieces.js';
import { HARVESTABLE, HARVESTABLE_DEFS } from '../js/harvestables.js';

test('terrain is full by default; air, water and legacy blocks are empty terrain', () => {
  assert.equal(defaultDensity(MAT.STONE), DENSITY_FULL);
  assert.equal(defaultDensity(MAT.GRASS), DENSITY_FULL);
  assert.equal(defaultDensity(MAT.AIR), DENSITY_EMPTY);
  assert.equal(defaultDensity(MAT.WATER), DENSITY_EMPTY);
  assert.equal(defaultDensity(MAT.PLANKS), DENSITY_EMPTY);
});

test('terrain materials map to terrain classes; ores are marked', () => {
  for (let id = 0; id < 256; id++) {
    if (!MAT_TERRAIN[id]) continue;
    assert.equal(MAT_LEGACY[id], 0);
    assert.ok(MAT_CLASS[id] < TERRAIN_CLASS_COUNT, `material ${id} has a terrain class`);
  }
  assert.equal(MAT_TERRAIN[MAT.WATER], 0);
  assert.equal(MAT_CLASS[MAT.GRASS], TERRAIN_CLASS.GRASS);
  assert.equal(MAT_CLASS[MAT.SANDSTONE], TERRAIN_CLASS.SAND);
  assert.equal(MAT_ORE[MAT.COAL_ORE], ORE.COAL);
  assert.equal(MAT_ORE[MAT.IRON_ORE], ORE.IRON);
  assert.equal(MAT_ORE[MAT.STONE], ORE.NONE);
});

test('terrain textures are painted for every class, tile seamlessly and carry height', () => {
  const layers = paintTerrainLayers();
  const S = TERRAIN_TEXTURE_SIZE;
  assert.equal(layers.length, TERRAIN_CLASS_COUNT);
  for (const layer of layers) {
    assert.equal(layer.length, S * S * 4);
    // Opposite edges are close in colour, so the texture tiles without seams.
    let diff = 0;
    for (let i = 0; i < S; i++) {
      for (let c = 0; c < 3; c++) {
        diff += Math.abs(layer[(i * S) * 4 + c] - layer[(i * S + S - 1) * 4 + c]);
        diff += Math.abs(layer[i * 4 + c] - layer[((S - 1) * S + i) * 4 + c]);
      }
    }
    assert.ok(diff / (S * 6) < 18, `average edge difference ${diff / (S * 6)}`);
    // The height channel isn't flat.
    let min = 255;
    let max = 0;
    for (let i = 3; i < layer.length; i += 4) {
      min = Math.min(min, layer[i]);
      max = Math.max(max, layer[i]);
    }
    assert.ok(max - min > 40, 'height channel has relief');
  }
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
