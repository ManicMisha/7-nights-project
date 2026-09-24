import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../js/world.js';
import { MAT } from '../js/materials.js';
import { ChunkDelta, decodeChunkDelta } from '../js/save.js';
import { chunkKey } from '../js/chunk.js';
import { flatStone } from './helpers.js';

// A generator that makes flat stone ground 10 cells deep.
const flat = { generate: flatStone(10) };

function makeWorld() {
  return new World(new THREE.Scene(), flat, { terrain: null, water: null });
}

test('generated cells get densities that agree with their materials', () => {
  const w = makeWorld();
  w.generateChunk(0, 0);
  assert.equal(w.getMaterial(3, 9, 3), MAT.STONE);
  assert.equal(w.getDensity(3, 9, 3), 127);
  assert.equal(w.getMaterial(3, 10, 3), MAT.AIR);
  assert.equal(w.getDensity(3, 10, 3), -127);
});

test('edits are recorded per chunk and marked unsaved', () => {
  const w = makeWorld();
  w.generateChunk(0, 0);
  w.generateChunk(-1, 0);
  assert.equal(w.setMaterial(2, 9, 2, MAT.AIR), true);
  assert.equal(w.setMaterial(-1, 10, 0, MAT.PLANKS), true);
  assert.equal(w.setMaterial(2, 9, 2, MAT.AIR), false, 'no-op edits are ignored');
  assert.equal(w.deltaFor(0, 0).cells.size, 1);
  assert.equal(w.deltaFor(-1, 0).cells.size, 1);
  assert.equal(w.unsaved.size, 2);

  const saved = w.takeUnsavedChunks();
  assert.equal(saved.length, 2);
  assert.equal(w.unsaved.size, 0);
  const decoded = decodeChunkDelta(saved.find((c) => c.cx === -1).data);
  assert.equal(decoded.cells.size, 1);
});

test('a partly filled cell keeps its material; emptying it turns it to air', () => {
  const w = makeWorld();
  w.generateChunk(0, 0);
  w.setCell(4, 9, 4, MAT.STONE, 40);
  assert.equal(w.getMaterial(4, 9, 4), MAT.STONE);
  assert.equal(w.getDensity(4, 9, 4), 40);
  w.setCell(4, 9, 4, MAT.STONE, -10);
  assert.equal(w.getMaterial(4, 9, 4), MAT.AIR);
  assert.equal(w.getDensity(4, 9, 4), -10);
  w.setCell(4, 20, 4, MAT.AIR, 90);
  assert.ok(w.getDensity(4, 20, 4) <= 0, 'air never has positive density');
});

test('edits come back when an unloaded chunk is generated again', () => {
  const w = makeWorld();
  w.generateChunk(0, 0);
  w.setMaterial(1, 9, 1, MAT.AIR);
  w.setCell(1, 10, 1, MAT.DIRT, 50);
  w.chunks.clear(); // simulate unloading
  w.generateChunk(0, 0);
  assert.equal(w.getMaterial(1, 9, 1), MAT.AIR);
  assert.equal(w.getMaterial(1, 10, 1), MAT.DIRT);
  assert.equal(w.getDensity(1, 10, 1), 50);
});

test('deltas loaded from a save apply to newly generated chunks', () => {
  const w = makeWorld();
  const delta = new ChunkDelta(2, -1);
  delta.setCell(0, MAT.AIR, -127); // local (0, 0, 0) → world (32, 0, -16)
  w.loadDeltas([delta]);
  w.generateChunk(2, -1);
  assert.equal(w.getMaterial(32, 0, -16), MAT.AIR);
  assert.equal(w.getMaterial(33, 0, -16), MAT.STONE);
});

test('chunks share their piece and harvest maps with the delta', () => {
  const w = makeWorld();
  const chunk = w.generateChunk(0, 0);
  chunk.pieces.set(8, { type: 1, tier: 0, rotation: 0, health: 400 });
  chunk.harvestState.set(0, { state: 1, timer: 0 });
  assert.equal(w.deltaFor(0, 0).pieces.size, 1);
  assert.equal(w.deltaFor(0, 0).harvest.size, 1);
});

test('untouched chunks are forgotten when they unload', () => {
  const w = makeWorld();
  w.generateChunk(40, 40);
  w.generateChunk(41, 40);
  w.setMaterial(41 * 16, 9, 40 * 16, MAT.AIR);
  w.takeUnsavedChunks();
  w.unloadFar(0, 0);
  assert.equal(w.chunks.size, 0);
  assert.equal(w.deltas.has(chunkKey(41, 40)), true, 'edited chunk keeps its delta');
  assert.equal(w.deltas.has(chunkKey(40, 40)), false, 'untouched chunk is dropped');
});

test('grid memory per chunk stays within budget', () => {
  const w = makeWorld();
  const chunk = w.generateChunk(0, 0);
  // materials + density + light (32 KiB each) + height map
  assert.equal(chunk.byteSize, 3 * 32768 + 256);
  assert.ok(chunk.byteSize <= 100 * 1024);
});
