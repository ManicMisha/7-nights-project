import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK } from '../js/blocks.js';
import { TestWorld, flatStone } from './helpers.js';

const GROUND = 10; // stone for y < 10

test('open sky is fully lit and solid ground is dark', () => {
  const w = new TestWorld();
  w.build(2, flatStone(GROUND));
  assert.equal(w.skyLight(5, GROUND, 5), 15);
  assert.equal(w.skyLight(5, GROUND + 40, 5), 15);
  assert.equal(w.skyLight(5, GROUND - 1, 5), 0);
});

test('a torch lights its surroundings, fading one level per block', () => {
  const w = new TestWorld();
  w.build(2, flatStone(GROUND));
  w.setBlock(8, GROUND, 8, BLOCK.TORCH);
  assert.equal(w.blockLight(8, GROUND, 8), 14);
  assert.equal(w.blockLight(11, GROUND, 8), 11);
  // Light crosses the chunk border (x = 16 is the next chunk).
  assert.equal(w.blockLight(17, GROUND, 8), 5);
});

test('removing a torch removes its light', () => {
  const w = new TestWorld();
  w.build(2, flatStone(GROUND));
  w.setBlock(8, GROUND, 8, BLOCK.TORCH);
  w.setBlock(8, GROUND, 8, BLOCK.AIR);
  for (let x = 2; x < 20; x++) assert.equal(w.blockLight(x, GROUND, 8), 0);
});

test('digging a shaft lets sunlight down; sealing it darkens it again', () => {
  const w = new TestWorld();
  w.build(2, flatStone(GROUND));
  for (let y = GROUND - 1; y >= GROUND - 4; y--) w.setBlock(4, y, 4, BLOCK.AIR);
  assert.equal(w.skyLight(4, GROUND - 4, 4), 15);
  w.setBlock(4, GROUND - 1, 4, BLOCK.STONE);
  assert.equal(w.skyLight(4, GROUND - 4, 4), 0);
});

test('light edits report the chunks that need re-meshing', () => {
  const w = new TestWorld();
  w.build(2, flatStone(GROUND));
  const dirty = w.setBlock(15, GROUND, 8, BLOCK.TORCH);
  const keys = [...dirty].map((c) => `${c.cx},${c.cz}`);
  assert.ok(keys.includes('0,0'));
  assert.ok(keys.includes('1,0'), 'neighbouring chunk across the border is marked dirty');
});
