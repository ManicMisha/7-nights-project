import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator, BIOME, GENERATOR_VERSION } from '../js/worldgen.js';
import { Chunk, cellIndex } from '../js/chunk.js';
import { MAT, MAT_TERRAIN } from '../js/materials.js';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../js/config.js';
import { hashSeed } from '../js/noise.js';
import { HARVESTABLE } from '../js/harvestables.js';

function generate(seed, cx, cz) {
  const chunk = new Chunk(cx, cz);
  new TerrainGenerator(hashSeed(seed)).generate(chunk);
  return chunk;
}

test('generation is deterministic for a seed', () => {
  for (const [cx, cz] of [[0, 0], [-3, 7], [12, -9]]) {
    assert.deepEqual(generate('demo', cx, cz).materials, generate('demo', cx, cz).materials);
  }
});

test('different seeds produce different terrain', () => {
  assert.notDeepEqual(generate('demo', 0, 0).materials, generate('other', 0, 0).materials);
});

test('bedrock floor and no floating water above sea level', () => {
  const chunk = generate('demo', 2, -1);
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      assert.equal(chunk.materials[cellIndex(x, 0, z)], MAT.BEDROCK);
      for (let y = SEA_LEVEL + 1; y < WORLD_HEIGHT; y++) {
        assert.notEqual(chunk.materials[cellIndex(x, y, z)], MAT.WATER);
      }
    }
  }
});

test('column info matches generated surface height', () => {
  const gen = new TerrainGenerator(hashSeed('demo'));
  const chunk = new Chunk(0, 0);
  gen.generate(chunk);
  for (const [x, z] of [[1, 1], [8, 8], [14, 3]]) {
    const { height, biome } = gen.columnInfo(x, z);
    assert.ok(Object.values(BIOME).includes(biome));
    const below = chunk.materials[cellIndex(x, height - 1, z)];
    // The top block may be carved by a cave entrance in the mountains, but
    // everywhere else the column is solid right up to its reported height.
    if (biome !== BIOME.MOUNTAINS) assert.notEqual(below, MAT.AIR);
  }
});

test('trees and plants are generated as harvestable records', () => {
  const plantMaterial = {
    [HARVESTABLE.TALL_GRASS]: MAT.TALL_GRASS,
    [HARVESTABLE.RED_FLOWER]: MAT.RED_FLOWER,
    [HARVESTABLE.YELLOW_FLOWER]: MAT.YELLOW_FLOWER,
  };
  let trees = 0;
  let plants = 0;
  for (let cz = -4; cz <= 4; cz++) {
    for (let cx = -4; cx <= 4; cx++) {
      const chunk = generate('demo', cx, cz);
      assert.deepEqual(chunk.harvestables, generate('demo', cx, cz).harvestables, 'records are deterministic');
      for (const r of chunk.harvestables) {
        assert.ok(r.x >= 0 && r.x < CHUNK_SIZE && r.z >= 0 && r.z < CHUNK_SIZE, 'record lies inside its chunk');
        const at = chunk.materials[cellIndex(r.x, r.y, r.z)];
        if (r.type === HARVESTABLE.OAK_TREE) {
          trees++;
          assert.ok(r.size >= 4 && r.size <= 6);
          for (let y = r.y; y < r.y + r.size; y++) assert.equal(chunk.materials[cellIndex(r.x, y, r.z)], MAT.LOG);
        } else {
          plants++;
          assert.equal(at, plantMaterial[r.type]);
        }
      }
    }
  }
  assert.ok(trees > 0 && plants > 0, `found ${trees} trees and ${plants} plants`);
});

test('density is positive exactly where terrain is (generator v2)', () => {
  const gen = new TerrainGenerator(hashSeed('demo'));
  for (const [cx, cz] of [[0, 0], [5, -3], [-8, 11], [20, 20]]) {
    const chunk = new Chunk(cx, cz);
    gen.generate(chunk);
    for (let i = 0; i < chunk.materials.length; i++) {
      const terrain = MAT_TERRAIN[chunk.materials[i]] === 1;
      assert.equal(chunk.density[i] > 0, terrain, `cell ${i}: material ${chunk.materials[i]}, density ${chunk.density[i]}`);
    }
  }
});

test('water is open water, never sealed under terrain', () => {
  const gen = new TerrainGenerator(hashSeed('demo'));
  for (const [cx, cz] of [[0, 0], [-4, 2], [3, 9], [-12, -7]]) {
    const chunk = new Chunk(cx, cz);
    gen.generate(chunk);
    for (let y = 0; y < SEA_LEVEL; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if (chunk.materials[cellIndex(x, y, z)] !== MAT.WATER) continue;
          const above = chunk.materials[cellIndex(x, y + 1, z)];
          assert.ok(above === MAT.WATER || above === MAT.AIR, `water at ${x},${y},${z} has ${above} above it`);
        }
      }
    }
  }
});

test('rivers wind through the land', () => {
  const gen = new TerrainGenerator(hashSeed('demo'));
  const seen = new Set();
  for (let z = -2048; z < 2048; z += 24) {
    for (let x = -2048; x < 2048; x += 24) seen.add(gen.columnInfo(x, z).biome);
  }
  assert.equal(GENERATOR_VERSION, 2);
  for (const biome of Object.values(BIOME)) assert.ok(seen.has(biome), `found biome ${biome}`);
});
