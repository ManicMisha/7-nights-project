// Flood-fill voxel lighting with two 0–15 channels per cell:
//   • sky light  — 15 under open sky, travels straight down without loss and
//                  loses 1 per step sideways (more through water/leaves);
//   • block light — emitted by torches/glowstone, loses 1 per step.
// Light crosses chunk borders freely. Edits are handled incrementally with
// the classic two-queue "remove then re-flood" algorithm, so only the
// affected region is touched.

import { BLOCK_OPAQUE, BLOCK_ATTEN, BLOCK_EMIT } from './blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from './config.js';
import { blockIndex } from './chunk.js';

const SKY = 4; // bit shift of the sky nibble
const BLK = 0; // bit shift of the block-light nibble
const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0],
];
const DOWN = 5;

/** Growable FIFO of int tuples. */
class IntQueue {
  constructor(stride) {
    this.stride = stride;
    this.data = new Int32Array(4096 * stride);
    this.head = 0;
    this.tail = 0;
  }
  get empty() {
    return this.head === this.tail;
  }
  push(a, b, c, d = 0) {
    if (this.tail + this.stride > this.data.length) {
      if (this.head > 0) {
        this.data.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      }
      if (this.tail + this.stride > this.data.length) {
        const bigger = new Int32Array(this.data.length * 2);
        bigger.set(this.data.subarray(0, this.tail));
        this.data = bigger;
      }
    }
    const d0 = this.data;
    d0[this.tail] = a;
    d0[this.tail + 1] = b;
    d0[this.tail + 2] = c;
    if (this.stride > 3) d0[this.tail + 3] = d;
    this.tail += this.stride;
  }
  reset() {
    this.head = 0;
    this.tail = 0;
  }
}

export class LightEngine {
  constructor(world) {
    this.world = world;
    this.addQueue = new IntQueue(3);
    this.removeQueue = new IntQueue(4);
    this.dirty = new Set();
  }

  /** Chunk that may receive light: already lit, or currently being lit. */
  participating(cx, cz) {
    const chunk = this.world.getChunk(cx, cz);
    return chunk && (chunk.lit || chunk.lighting) ? chunk : null;
  }

  markDirty(chunk, lx, lz) {
    this.dirty.add(chunk);
    const w = this.world;
    const ex = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
    const ez = lz === 0 ? -1 : lz === CHUNK_SIZE - 1 ? 1 : 0;
    if (ex) { const n = w.getChunk(chunk.cx + ex, chunk.cz); if (n) this.dirty.add(n); }
    if (ez) { const n = w.getChunk(chunk.cx, chunk.cz + ez); if (n) this.dirty.add(n); }
    if (ex && ez) { const n = w.getChunk(chunk.cx + ex, chunk.cz + ez); if (n) this.dirty.add(n); }
  }

  /** Computes initial light for a freshly generated chunk (neighbours generated). */
  lightChunk(chunk) {
    const w = this.world;
    chunk.lighting = true;
    const { blocks, light, heightMap } = chunk;
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;
    light.fill(0);

    // Straight-down sunlight per column.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let level = 15;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const i = blockIndex(x, y, z);
          const id = blocks[i];
          if (BLOCK_OPAQUE[id]) level = 0;
          else if (BLOCK_ATTEN[id]) level = Math.max(0, level - BLOCK_ATTEN[id]);
          light[i] = (level << SKY) | BLOCK_EMIT[id];
        }
      }
    }

    // Seed the sideways spread where a column's lit region borders a darker
    // neighbour (under overhangs, into cave mouths, below water surfaces).
    const add = this.addQueue;
    add.reset();
    const neighbourTop = (x, z) => {
      if (x >= 0 && z >= 0 && x < CHUNK_SIZE && z < CHUNK_SIZE) return heightMap[z * CHUNK_SIZE + x];
      const n = w.getChunk(chunk.cx + (x < 0 ? -1 : x >= CHUNK_SIZE ? 1 : 0), chunk.cz + (z < 0 ? -1 : z >= CHUNK_SIZE ? 1 : 0));
      return n ? n.heightMap[(z & 15) * CHUNK_SIZE + (x & 15)] : 0;
    };
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const top = Math.max(
          heightMap[z * CHUNK_SIZE + x],
          neighbourTop(x + 1, z), neighbourTop(x - 1, z), neighbourTop(x, z + 1), neighbourTop(x, z - 1),
        );
        for (let y = 0; y < Math.min(WORLD_HEIGHT, top + 1); y++) {
          if ((light[blockIndex(x, y, z)] >> SKY) > 1) add.push(baseX + x, y, baseZ + z);
        }
      }
    }
    // Pull in light from already-lit neighbours across the border.
    const pull = (dx, dz) => {
      const n = w.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!n || !n.lit) return;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let k = 0; k < CHUNK_SIZE; k++) {
          const lx = dx === 1 ? 0 : dx === -1 ? CHUNK_SIZE - 1 : k;
          const lz = dz === 1 ? 0 : dz === -1 ? CHUNK_SIZE - 1 : k;
          const v = n.light[blockIndex(lx, y, lz)];
          if ((v & 0xee) !== 0) add.push(n.cx * CHUNK_SIZE + lx, y, n.cz * CHUNK_SIZE + lz);
        }
      }
    };
    pull(1, 0); pull(-1, 0); pull(0, 1); pull(0, -1);
    this.flood(add, SKY);

    // Block light: emitters in this chunk, plus the same border cells.
    add.head = 0;
    add.tail = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (BLOCK_EMIT[blocks[i]]) {
        const x = i & 15;
        const z = (i >> 4) & 15;
        const y = i >> 8;
        add.push(baseX + x, y, baseZ + z);
      }
    }
    pull(1, 0); pull(-1, 0); pull(0, 1); pull(0, -1);
    this.flood(add, BLK);

    chunk.lighting = false;
    chunk.lit = true;
    this.dirty.delete(chunk);
    return this.takeDirty();
  }

  /** Breadth-first spread of one light channel from every queued cell. */
  flood(queue, shift) {
    const q = queue;
    while (q.head < q.tail) {
      const x = q.data[q.head];
      const y = q.data[q.head + 1];
      const z = q.data[q.head + 2];
      q.head += 3;
      const chunk = this.participating(x >> 4, z >> 4);
      if (!chunk) continue;
      const level = (chunk.light[blockIndex(x & 15, y, z & 15)] >> shift) & 15;
      if (level <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const dir = DIRS[d];
        const ny = y + dir[1];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const nx = x + dir[0];
        const nz = z + dir[2];
        const nchunk = (nx >> 4) === chunk.cx && (nz >> 4) === chunk.cz ? chunk : this.participating(nx >> 4, nz >> 4);
        if (!nchunk) continue;
        const ni = blockIndex(nx & 15, ny, nz & 15);
        const id = nchunk.blocks[ni];
        if (BLOCK_OPAQUE[id]) continue;
        let next = level - 1 - BLOCK_ATTEN[id];
        if (shift === SKY && d === DOWN && level === 15 && BLOCK_ATTEN[id] === 0) next = 15;
        const cur = (nchunk.light[ni] >> shift) & 15;
        if (cur < next) {
          nchunk.light[ni] = (nchunk.light[ni] & ~(15 << shift)) | (next << shift);
          q.push(nx, ny, nz);
          if (nchunk !== chunk || (nx & 15) === 0 || (nx & 15) === 15 || (nz & 15) === 0 || (nz & 15) === 15) {
            this.markDirty(nchunk, nx & 15, nz & 15);
          } else {
            this.dirty.add(nchunk);
          }
        }
      }
    }
    q.reset();
  }

  /**
   * Updates light after the block at (x, y, z) changed to `newId`.
   * Returns the set of chunks whose light changed (they need re-meshing).
   */
  onBlockChanged(x, y, z, newId) {
    for (const shift of [SKY, BLK]) this.relight(x, y, z, newId, shift);
    return this.takeDirty();
  }

  relight(x, y, z, newId, shift) {
    const chunk = this.participating(x >> 4, z >> 4);
    if (!chunk) return;
    const i = blockIndex(x & 15, y, z & 15);
    const add = this.addQueue;
    const rem = this.removeQueue;
    add.reset();
    rem.reset();

    const old = (chunk.light[i] >> shift) & 15;
    chunk.light[i] &= ~(15 << shift);
    this.markDirty(chunk, x & 15, z & 15);
    if (old > 0) rem.push(x, y, z, old);

    // Un-light everything that was lit through this cell.
    while (rem.head < rem.tail) {
      const rx = rem.data[rem.head];
      const ry = rem.data[rem.head + 1];
      const rz = rem.data[rem.head + 2];
      const level = rem.data[rem.head + 3];
      rem.head += 4;
      for (let d = 0; d < 6; d++) {
        const dir = DIRS[d];
        const ny = ry + dir[1];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const nx = rx + dir[0];
        const nz = rz + dir[2];
        const nchunk = this.participating(nx >> 4, nz >> 4);
        if (!nchunk) continue;
        const ni = blockIndex(nx & 15, ny, nz & 15);
        const nl = (nchunk.light[ni] >> shift) & 15;
        if (nl === 0) continue;
        const litByUs = nl < level || (shift === SKY && d === DOWN && level === 15 && nl === 15);
        if (litByUs) {
          nchunk.light[ni] &= ~(15 << shift);
          this.markDirty(nchunk, nx & 15, nz & 15);
          rem.push(nx, ny, nz, nl);
          const emit = shift === BLK ? BLOCK_EMIT[nchunk.blocks[ni]] : 0;
          if (emit) {
            nchunk.light[ni] |= emit << shift;
            add.push(nx, ny, nz);
          }
        } else {
          add.push(nx, ny, nz);
        }
      }
    }
    rem.reset();

    // Re-seed the changed cell itself.
    if (shift === BLK && BLOCK_EMIT[newId]) {
      chunk.light[i] |= BLOCK_EMIT[newId] << shift;
      add.push(x, y, z);
    }
    if (!BLOCK_OPAQUE[newId]) {
      if (shift === SKY && y === WORLD_HEIGHT - 1) {
        chunk.light[i] |= Math.max(0, 15 - BLOCK_ATTEN[newId]) << shift;
        add.push(x, y, z);
      }
      for (const dir of DIRS) {
        const ny = y + dir[1];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        add.push(x + dir[0], ny, z + dir[2]);
      }
    }
    this.flood(add, shift);
  }

  takeDirty() {
    const out = this.dirty;
    this.dirty = new Set();
    return out;
  }
}
