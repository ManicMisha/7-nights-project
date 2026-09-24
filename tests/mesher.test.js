import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChunkGeometry } from '../js/mesher.js';
import { MAT } from '../js/materials.js';
import { TerrainGenerator } from '../js/worldgen.js';
import { hashSeed } from '../js/noise.js';
import { TestWorld, flatStone } from './helpers.js';

test('flat ground produces only its top faces', () => {
  const w = new TestWorld();
  w.build(2, flatStone(10));
  const { solid, water } = buildChunkGeometry(w, w.getChunk(0, 0));
  assert.equal(water, null);
  assert.equal(solid.vertexCount, 16 * 16 * 4, 'one quad per column, nothing hidden is drawn');
  assert.equal(solid.index.length, 16 * 16 * 6);
});

test('a single removed block exposes the faces around the hole', () => {
  const w = new TestWorld();
  w.build(2, flatStone(10));
  w.setMaterial(8, 9, 8, MAT.AIR);
  const { solid } = buildChunkGeometry(w, w.getChunk(0, 0));
  // The hole's top face is gone but its floor and four walls appear: 255 + 1 + 4.
  assert.equal(solid.vertexCount / 4, 260);
});

test('generated terrain meshes into well-formed buffers', () => {
  const gen = new TerrainGenerator(hashSeed('demo'));
  const w = new TestWorld();
  w.build(2, (chunk) => gen.generate(chunk));
  const { solid } = buildChunkGeometry(w, w.getChunk(0, 0));
  assert.ok(solid.vertexCount > 0);
  assert.equal(solid.index.length % 6, 0);
  assert.equal(solid.position.length, solid.vertexCount * 3);
  for (const i of solid.index) assert.ok(i < solid.vertexCount);
});
