// Chunk manager: streams chunks in and out around the player through a
// generate → light → mesh pipeline under a per-frame time budget, owns the
// block get/set API, and remembers player edits so unloaded chunks come
// back exactly as they were left.

import { Chunk, chunkKey, blockIndex } from './chunk.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from './config.js';
import { BLOCK, BLOCK_SOLID } from './blocks.js';
import { LightEngine } from './lighting.js';
import { buildChunkGeometry } from './mesher.js';

const THREE = window.THREE;

export class World {
  constructor(scene, generator, materials) {
    this.scene = scene;
    this.generator = generator;
    this.materials = materials; // { terrain, water }
    this.chunks = new Map();
    this.edits = new Map(); // chunkKey → Map(blockIndex → id)
    this.light = new LightEngine(this);
    this.renderDistance = 6;
    this.frameBudgetMs = 7;
    this.ringOffsets = [];
    this.buildRingOffsets();
    this.stats = { chunks: 0, meshed: 0, triangles: 0 };
  }

  setRenderDistance(d) {
    this.renderDistance = d;
    this.buildRingOffsets();
  }

  /**
   * Chunk offsets within the load radius, nearest first. Meshing a chunk
   * needs its 8 neighbours lit, and lighting needs its 8 neighbours
   * generated, so generation runs 2√2 chunks beyond the visible radius.
   */
  buildRingOffsets() {
    const r = this.renderDistance + 3;
    const out = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d <= r) out.push({ dx, dz, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    this.ringOffsets = out;
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Block id at a world position; null if that chunk isn't generated yet. */
  getBlock(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;
    const chunk = this.getChunk(x >> 4, z >> 4);
    if (!chunk || !chunk.generated) return null;
    return chunk.blocks[blockIndex(x & 15, y, z & 15)];
  }

  /** True if the cell blocks movement. Unloaded terrain counts as solid. */
  isSolid(x, y, z) {
    const id = this.getBlock(x, y, z);
    return id === null ? true : BLOCK_SOLID[id] === 1;
  }

  /** Packed light byte (sky << 4 | block) at a world position. */
  getLight(x, y, z) {
    if (y >= WORLD_HEIGHT) return 0xf0;
    if (y < 0) return 0;
    const chunk = this.getChunk(x >> 4, z >> 4);
    if (!chunk || !chunk.lit) return 0xf0;
    return chunk.light[blockIndex(x & 15, y, z & 15)];
  }

  /** Highest non-air block in a column (or -1). */
  surfaceY(x, z) {
    const chunk = this.getChunk(x >> 4, z >> 4);
    if (!chunk || !chunk.generated) return -1;
    return chunk.heightMap[(z & 15) * CHUNK_SIZE + (x & 15)] - 1;
  }

  /** Changes a block, updates lighting and synchronously re-meshes affected chunks. */
  setBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const chunk = this.getChunk(x >> 4, z >> 4);
    if (!chunk || !chunk.generated) return false;
    const lx = x & 15;
    const lz = z & 15;
    const i = blockIndex(lx, y, lz);
    if (chunk.blocks[i] === id) return false;
    chunk.blocks[i] = id;

    let edits = this.edits.get(chunk.key);
    if (!edits) this.edits.set(chunk.key, (edits = new Map()));
    edits.set(i, id);

    this.updateColumnBounds(chunk, lx, y, lz, id);

    const dirty = chunk.lit ? this.light.onBlockChanged(x, y, z, id) : new Set();
    dirty.add(chunk);
    // Neighbours whose border faces / AO depend on this cell.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk((x + dx) >> 4, (z + dz) >> 4);
        if (n) dirty.add(n);
      }
    }
    for (const c of dirty) {
      if (c.meshed && this.canMesh(c)) this.meshChunk(c);
      else if (c.meshed) c.dirty = true;
    }
    return true;
  }

  updateColumnBounds(chunk, lx, y, lz, id) {
    const col = lz * CHUNK_SIZE + lx;
    if (id !== BLOCK.AIR) {
      if (y < chunk.minY) chunk.minY = y;
      if (y > chunk.maxY) chunk.maxY = y;
      if (y + 1 > chunk.heightMap[col]) chunk.heightMap[col] = y + 1;
    } else if (y + 1 === chunk.heightMap[col]) {
      let top = y;
      while (top > 0 && chunk.blocks[blockIndex(lx, top - 1, lz)] === BLOCK.AIR) top--;
      chunk.heightMap[col] = top;
    }
  }

  neighboursReady(chunk, flag) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.getChunk(chunk.cx + dx, chunk.cz + dz);
        if (!n || !n[flag]) return false;
      }
    }
    return true;
  }

  canMesh(chunk) {
    return chunk.lit && this.neighboursReady(chunk, 'lit');
  }

  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    this.generator.generate(chunk);
    const edits = this.edits.get(chunk.key);
    if (edits) for (const [i, id] of edits) chunk.blocks[i] = id;
    chunk.updateBounds();
    chunk.generated = true;
    this.chunks.set(chunk.key, chunk);
    return chunk;
  }

  lightChunk(chunk) {
    const dirty = this.light.lightChunk(chunk);
    for (const c of dirty) if (c.meshed) c.dirty = true;
  }

  meshChunk(chunk) {
    const geo = buildChunkGeometry(this, chunk);
    chunk.disposeMeshes(this.scene);
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const sphere = new THREE.Sphere(
      new THREE.Vector3(CHUNK_SIZE / 2, (chunk.minY + chunk.maxY + 1) / 2, CHUNK_SIZE / 2),
      Math.sqrt(2 * (CHUNK_SIZE / 2) ** 2 + ((chunk.maxY - chunk.minY + 1) / 2) ** 2) + 1,
    );
    let triangles = 0;
    if (geo.solid) {
      chunk.opaqueMesh = this.createMesh(geo.solid, this.materials.terrain, sphere, ox, oz, true);
      triangles += geo.solid.index.length / 3;
    }
    if (geo.water) {
      chunk.waterMesh = this.createMesh(geo.water, this.materials.water, sphere, ox, oz, false);
      chunk.waterMesh.userData.isWater = true;
      triangles += geo.water.index.length / 3;
    }
    chunk.triangles = triangles;
    chunk.meshed = true;
    chunk.dirty = false;
  }

  createMesh(data, material, sphere, ox, oz, withTex) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('aLight', new THREE.BufferAttribute(data.light, 4, true));
    if (withTex) g.setAttribute('aTex', new THREE.BufferAttribute(data.tex, 4, false));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    // Positions are fixed-point, so give three.js the real bounds up front.
    g.boundingSphere = sphere.clone();
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(CHUNK_SIZE, WORLD_HEIGHT, CHUNK_SIZE));
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(ox, 0, oz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Streams the world around (px, pz). Work is done nearest-first and stops
   * once the frame budget is spent, so frame times stay smooth while
   * exploring. Returns true when nothing is left to do.
   */
  update(px, pz) {
    const pcx = Math.floor(px) >> 4;
    const pcz = Math.floor(pz) >> 4;
    const start = performance.now();
    const R = this.renderDistance;
    let idle = true;

    for (const { dx, dz, d } of this.ringOffsets) {
      if (performance.now() - start > this.frameBudgetMs) return false;
      const cx = pcx + dx;
      const cz = pcz + dz;
      let chunk = this.getChunk(cx, cz);
      if (!chunk) {
        chunk = this.generateChunk(cx, cz);
        idle = false;
      }
      if (d > R + 1.5) continue;
      if (!chunk.lit && this.neighboursReady(chunk, 'generated')) {
        this.lightChunk(chunk);
        idle = false;
      }
      if (d > R) continue;
      if ((!chunk.meshed || chunk.dirty) && this.canMesh(chunk)) {
        this.meshChunk(chunk);
        idle = false;
      }
    }

    this.unloadFar(pcx, pcz);
    return idle;
  }

  unloadFar(pcx, pcz) {
    const limit = this.renderDistance + 4.5;
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > limit * limit) {
        chunk.disposeMeshes(this.scene);
        this.chunks.delete(chunk.key);
      }
    }
  }

  /** Collects stats for the debug overlay. */
  collectStats() {
    let meshed = 0;
    let triangles = 0;
    for (const c of this.chunks.values()) {
      if (c.meshed) {
        meshed++;
        triangles += c.triangles || 0;
      }
    }
    this.stats.chunks = this.chunks.size;
    this.stats.meshed = meshed;
    this.stats.triangles = triangles;
    return this.stats;
  }

  /** Shows/hides every water mesh (used by the refraction/reflection passes). */
  setWaterVisible(visible) {
    for (const c of this.chunks.values()) if (c.waterMesh) c.waterMesh.visible = visible;
  }

  /**
   * Voxel DDA raycast. Returns the first targetable block hit within
   * `maxDist`, with the face normal, or null.
   */
  raycast(origin, dir, maxDist, predicate) {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x);
    const stepY = Math.sign(dir.y);
    const stepZ = Math.sign(dir.z);
    const tDeltaX = stepX ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ ? Math.abs(1 / dir.z) : Infinity;
    const frac = (v, s) => (s > 0 ? Math.ceil(v) - v : v - Math.floor(v));
    let tMaxX = stepX ? frac(origin.x, stepX) * tDeltaX : Infinity;
    let tMaxY = stepY ? frac(origin.y, stepY) * tDeltaY : Infinity;
    let tMaxZ = stepZ ? frac(origin.z, stepZ) * tDeltaZ : Infinity;
    const normal = [0, 0, 0];
    let t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== null && predicate(id)) {
        return { x, y, z, id, normal: normal.slice(), distance: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; normal[0] = -stepX; normal[1] = 0; normal[2] = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; normal[0] = 0; normal[1] = -stepY; normal[2] = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; normal[0] = 0; normal[1] = 0; normal[2] = -stepZ;
      }
    }
    return null;
  }
}
