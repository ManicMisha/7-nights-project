import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator, BIOME } from '../js/worldgen.js';
import { Chunk, blockIndex } from '../js/chunk.js';
import { MAT } from '../js/materials.js';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../js/config.js';
import { hashSeed } from '../js/noise.js';

function generate(seed, cx, cz) {
  const chunk = new Chunk(cx, cz);
  new TerrainGenerator(hashSeed(seed)).generate(chunk);
  return chunk;
}

test('generation is deterministic for a seed', () => {
  for (const [cx, cz] of [[0, 0], [-3, 7], [12, -9]]) {
    assert.deepEqual(generate('demo', cx, cz).blocks, generate('demo', cx, cz).blocks);
  }
});

test('different seeds produce different terrain', () => {
  assert.notDeepEqual(generate('demo', 0, 0).blocks, generate('other', 0, 0).blocks);
});

test('bedrock floor and no floating water above sea level', () => {
  const chunk = generate('demo', 2, -1);
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      assert.equal(chunk.blocks[blockIndex(x, 0, z)], MAT.BEDROCK);
      for (let y = SEA_LEVEL + 1; y < WORLD_HEIGHT; y++) {
        assert.notEqual(chunk.blocks[blockIndex(x, y, z)], MAT.WATER);
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
    const below = chunk.blocks[blockIndex(x, height - 1, z)];
    // The top block may be carved by a cave entrance in the mountains, but
    // everywhere else the column is solid right up to its reported height.
    if (biome !== BIOME.MOUNTAINS) assert.notEqual(below, MAT.AIR);
  }
});
