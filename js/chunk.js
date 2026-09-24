// A 16 × WORLD_HEIGHT × 16 column of the world grid. Each 1 m cell holds:
//   • a material id (what fills it: stone, dirt, water, air…),
//   • a signed density (how full it is: > 0 filled, ≤ 0 empty), and
//   • light (sky and block light, 4 bits each).
// It also holds the chunk's harvestable objects and, by reference, the
// player's saved changes (see ChunkDelta in save.js).

import { CHUNK_SIZE, WORLD_HEIGHT } from './config.js';
import { MAT, defaultDensity } from './materials.js';

export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

/** Index of a local cell coordinate. X varies fastest, then Z, then Y. */
export function cellIndex(x, y, z) {
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
    this.materials = new Uint8Array(CHUNK_VOLUME);
    // Signed terrain density per cell, −127…127, sampled at the cell centre
    // (DENSITY_PER_METRE units per metre from the surface). The cell is
    // filled with terrain when density > 0 (its material is then a terrain
    // material) and empty when ≤ 0 (air, water or a legacy block). The
    // smooth terrain surface is where density crosses zero.
    this.density = new Int8Array(CHUNK_VOLUME);
    // Light nibbles: high 4 bits = sky light, low 4 bits = block light.
    this.light = new Uint8Array(CHUNK_VOLUME);
    // Per column: lowest Y at and above which every cell is air.
    this.heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.minY = WORLD_HEIGHT; // lowest non-air Y (for fast meshing bounds)
    this.maxY = 0; // highest non-air Y

    // Harvestable objects generated in this chunk (trees, plants…), and the
    // saved state of any the player has harvested, keyed by record index.
    this.harvestables = [];
    this.harvestState = new Map();
    // Building pieces placed in this chunk, keyed by pieceKey().
    this.pieces = new Map();

    // Pipeline state: generated → lit → meshed.
    this.generated = false;
    this.lit = false;
    this.meshed = false;
    this.dirty = false; // needs a re-mesh

    this.opaqueMesh = null;
    this.waterMesh = null;
  }

  /** Sets every cell's density from its material alone (full or empty). */
  fillDensityFromMaterials() {
    const { materials, density } = this;
    for (let i = 0; i < CHUNK_VOLUME; i++) density[i] = defaultDensity(materials[i]);
  }

  /** Bytes of grid data held per chunk (for memory budgeting). */
  get byteSize() {
    return this.materials.byteLength + this.density.byteLength + this.light.byteLength + this.heightMap.byteLength;
  }

  /** Recomputes the height map and vertical non-air bounds. */
  updateBounds() {
    let minY = WORLD_HEIGHT;
    let maxY = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let top = 0;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          if (this.materials[cellIndex(x, y, z)] !== MAT.AIR) {
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
        if (this.materials[base + i] !== MAT.AIR) {
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
