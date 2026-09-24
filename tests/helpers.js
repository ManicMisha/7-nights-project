// Shared test fixtures: a minimal stand-in for World (which needs Three.js)
// that stores chunks and runs the real lighting engine.

import { Chunk, chunkKey, cellIndex } from '../js/chunk.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../js/config.js';
import { MAT, DENSITY_PER_METRE } from '../js/materials.js';
import { LightEngine } from '../js/lighting.js';

export class TestWorld {
  constructor() {
    this.chunks = new Map();
    this.light = new LightEngine(this);
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Adds a chunk whose blocks are filled by `fill(chunk)`. */
  addChunk(cx, cz, fill) {
    const chunk = new Chunk(cx, cz);
    fill(chunk);
    chunk.updateBounds();
    chunk.generated = true;
    this.chunks.set(chunk.key, chunk);
    return chunk;
  }

  /** Generates every chunk within `radius` of the origin, then lights the inner ones. */
  build(radius, fill) {
    for (let cz = -radius; cz <= radius; cz++) {
      for (let cx = -radius; cx <= radius; cx++) this.addChunk(cx, cz, fill);
    }
    for (let cz = -radius + 1; cz <= radius - 1; cz++) {
      for (let cx = -radius + 1; cx <= radius - 1; cx++) this.light.lightChunk(this.getChunk(cx, cz));
    }
  }

  getMaterial(x, y, z) {
    return this.getChunk(x >> 4, z >> 4).materials[cellIndex(x & 15, y, z & 15)];
  }

  setMaterial(x, y, z, id) {
    this.getChunk(x >> 4, z >> 4).materials[cellIndex(x & 15, y, z & 15)] = id;
    return this.light.onBlockChanged(x, y, z, id);
  }

  skyLight(x, y, z) {
    return this.getChunk(x >> 4, z >> 4).light[cellIndex(x & 15, y, z & 15)] >> 4;
  }

  blockLight(x, y, z) {
    return this.getChunk(x >> 4, z >> 4).light[cellIndex(x & 15, y, z & 15)] & 15;
  }
}

/** Fill function: solid stone for y < height, air above (full/empty densities). */
export function flatStone(height) {
  return (chunk) => {
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) chunk.materials[cellIndex(x, y, z)] = MAT.STONE;
      }
    }
    chunk.fillDensityFromMaterials();
  };
}

/**
 * A world generator from a signed-distance function f(x, y, z) in metres
 * (> 0 inside the terrain), sampled at cell centres like the real one.
 */
export function sdfGenerator(f) {
  return {
    generate(chunk) {
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const v = f(chunk.cx * CHUNK_SIZE + x + 0.5, y + 0.5, chunk.cz * CHUNK_SIZE + z + 0.5);
            const i = cellIndex(x, y, z);
            const d = Math.max(-127, Math.min(127, Math.round(v * DENSITY_PER_METRE)));
            chunk.density[i] = v > 0 ? Math.max(1, d) : Math.min(0, d);
            chunk.materials[i] = v > 0 ? MAT.STONE : MAT.AIR;
          }
        }
      }
    },
  };
}
