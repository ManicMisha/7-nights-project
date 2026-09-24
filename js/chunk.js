// A 16 × WORLD_HEIGHT × 16 column of blocks plus its light values.

import { CHUNK_SIZE, WORLD_HEIGHT } from './config.js';

export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

/** Index of a local block coordinate. X varies fastest, then Z, then Y. */
export function blockIndex(x, y, z) {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

/** Packs chunk coordinates into a single integer map key. */
export function chunkKey(cx, cz) {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.blocks = new Uint8Array(CHUNK_VOLUME);
    // Light nibbles: high 4 bits = sky light, low 4 bits = block light.
    this.light = new Uint8Array(CHUNK_VOLUME);
    // Per column: lowest Y at and above which every cell is air.
    this.heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.minY = WORLD_HEIGHT; // lowest non-air Y (for fast meshing bounds)
    this.maxY = 0; // highest non-air Y

    // Pipeline state: generated → lit → meshed.
    this.generated = false;
    this.lit = false;
    this.meshed = false;
    this.dirty = false; // needs a re-mesh

    this.opaqueMesh = null;
    this.waterMesh = null;
  }

  getLocal(x, y, z) {
    return this.blocks[blockIndex(x, y, z)];
  }

  /** Recomputes the height map and vertical non-air bounds. */
  updateBounds() {
    let minY = WORLD_HEIGHT;
    let maxY = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let top = 0;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          if (this.blocks[blockIndex(x, y, z)] !== 0) {
            top = y + 1;
            break;
          }
        }
        this.heightMap[z * CHUNK_SIZE + x] = top;
        if (top - 1 > maxY) maxY = top - 1;
      }
    }
    for (let y = 0; y < WORLD_HEIGHT && minY === WORLD_HEIGHT; y++) {
      const base = y * CHUNK_SIZE * CHUNK_SIZE;
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        if (this.blocks[base + i] !== 0) {
          minY = y;
          break;
        }
      }
    }
    this.minY = minY;
    this.maxY = maxY;
  }

  disposeMeshes(scene) {
    for (const mesh of [this.opaqueMesh, this.waterMesh]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.opaqueMesh = null;
    this.waterMesh = null;
  }
}
