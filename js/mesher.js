// Chunk mesher: turns a chunk's blocks + light into compact vertex buffers.
//
// • Hidden faces between opaque blocks are culled.
// • Every vertex gets smooth light (average of the 4 cells touching that
//   corner on the face side) and ambient occlusion from the 3 neighbours,
//   and quads are flipped along the brighter diagonal to avoid AO artefacts.
// • Vertex data is packed tight: Int16 positions (×16 fixed point), Uint8
//   texture coords/layer, Uint8 normalised light → 14 bytes per vertex.
// • Opaque + cutout + cross geometry share one BufferGeometry per chunk;
//   water goes into a second one so it can use the reflective shader.

import {
  MAT, RENDER, MAT_RENDER, MAT_OPAQUE, MAT_TILES,
} from './materials.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from './config.js';
import { blockIndex } from './chunk.js';

const P = CHUNK_SIZE + 2; // padded width
const PY = WORLD_HEIGHT + 2; // padded height
const pBlocks = new Uint8Array(P * P * PY);
const pLight = new Uint8Array(P * P * PY);
const pidx = (x, y, z) => ((y + 1) * P + (z + 1)) * P + (x + 1);
const offset = (dx, dy, dz) => (dy * P + dz) * P + dx;

const FIXED = 16; // position fixed-point scale
const WATER_DROP = 0.125; // how far a water surface sits below the block top

// Face table. U × V = normal, so corners (0,0) (1,0) (1,1) (0,1) wind CCW.
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], group: 2, shade: 0.72 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], group: 2, shade: 0.72 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], group: 2, shade: 0.86 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], group: 2, shade: 0.86 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], group: 0, shade: 1.0 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], group: 1, shade: 0.55 },
];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];

// Precompute, per face and corner: vertex offset and the padded-array
// offsets of the 4 light/AO sample cells (face cell, side1, side2, corner).
for (const f of FACES) {
  f.nOff = offset(...f.n);
  const origin = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    if (f.n[a] > 0) origin[a] += 1;
    if (f.u[a] < 0) origin[a] += 1;
    if (f.v[a] < 0) origin[a] += 1;
  }
  f.corners = CORNERS.map(([du, dv]) => {
    const pos = [0, 1, 2].map((a) => origin[a] + du * f.u[a] + dv * f.v[a]);
    const su = du ? 1 : -1;
    const sv = dv ? 1 : -1;
    const s1 = [0, 1, 2].map((a) => f.n[a] + su * f.u[a]);
    const s2 = [0, 1, 2].map((a) => f.n[a] + sv * f.v[a]);
    const c = [0, 1, 2].map((a) => f.n[a] + su * f.u[a] + sv * f.v[a]);
    return { pos, du, dv, side1: offset(...s1), side2: offset(...s2), corner: offset(...c) };
  });
}

/** Growable struct-of-arrays vertex buffer. */
class MeshBuffer {
  constructor(withTex) {
    this.withTex = withTex;
    this.capacity = 0;
    this.count = 0;
    this.indexCount = 0;
    this.grow(8192);
  }
  grow(verts) {
    const pos = new Int16Array(verts * 3);
    const light = new Uint8Array(verts * 4);
    const tex = this.withTex ? new Uint8Array(verts * 4) : null;
    const index = new Uint32Array((verts / 4) * 6);
    if (this.capacity) {
      pos.set(this.pos);
      light.set(this.light);
      if (tex) tex.set(this.tex);
      index.set(this.index);
    }
    Object.assign(this, { pos, light, tex, index, capacity: verts });
  }
  reset() {
    this.count = 0;
    this.indexCount = 0;
  }
  vertex(x, y, z, u, v, layer, sky, blk, ao) {
    if (this.count >= this.capacity) this.grow(this.capacity * 2);
    const i = this.count++;
    this.pos[i * 3] = Math.round(x * FIXED);
    this.pos[i * 3 + 1] = Math.round(y * FIXED);
    this.pos[i * 3 + 2] = Math.round(z * FIXED);
    this.light[i * 4] = sky;
    this.light[i * 4 + 1] = blk;
    this.light[i * 4 + 2] = ao;
    this.light[i * 4 + 3] = 255;
    if (this.tex) {
      this.tex[i * 4] = u;
      this.tex[i * 4 + 1] = v;
      this.tex[i * 4 + 2] = layer;
    }
  }
  /** Adds two triangles for the last 4 vertices; `flip` picks the 1–3 diagonal. */
  quad(flip) {
    const b = this.count - 4;
    const idx = this.index;
    let k = this.indexCount;
    if (flip) {
      idx[k++] = b + 1; idx[k++] = b + 2; idx[k++] = b + 3;
      idx[k++] = b + 1; idx[k++] = b + 3; idx[k++] = b;
    } else {
      idx[k++] = b; idx[k++] = b + 1; idx[k++] = b + 2;
      idx[k++] = b; idx[k++] = b + 2; idx[k++] = b + 3;
    }
    this.indexCount = k;
  }
  /** Copies the used range out into right-sized arrays. */
  export() {
    if (this.count === 0) return null;
    const n = this.count;
    return {
      position: this.pos.slice(0, n * 3),
      light: this.light.slice(0, n * 4),
      tex: this.tex ? this.tex.slice(0, n * 4) : null,
      index: n > 65535 ? this.index.slice(0, this.indexCount) : Uint16Array.from(this.index.subarray(0, this.indexCount)),
      vertexCount: n,
    };
  }
}

const solid = new MeshBuffer(true);
const water = new MeshBuffer(false);

/** Copies the chunk and a 1-block border from its neighbours into the padded arrays. */
function gatherPadded(world, chunk, y0, y1) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const src = world.getChunk(chunk.cx + dx, chunk.cz + dz);
      const xs = dx === -1 ? CHUNK_SIZE - 1 : 0;
      const xe = dx === 1 ? 0 : CHUNK_SIZE - 1;
      const zs = dz === -1 ? CHUNK_SIZE - 1 : 0;
      const ze = dz === 1 ? 0 : CHUNK_SIZE - 1;
      for (let y = y0; y <= y1; y++) {
        for (let z = zs; z <= ze; z++) {
          const pz = z + dz * CHUNK_SIZE;
          let pi = pidx(xs + dx * CHUNK_SIZE, y, pz);
          let si = blockIndex(xs, y, z);
          for (let x = xs; x <= xe; x++, pi++, si++) {
            pBlocks[pi] = src ? src.blocks[si] : MAT.STONE;
            pLight[pi] = src ? src.light[si] : 0;
          }
        }
      }
    }
  }
}

function fillBoundaryLayer(y, block, light) {
  const start = pidx(-1, y, -1);
  pBlocks.fill(block, start, start + P * P);
  pLight.fill(light, start, start + P * P);
}

export function buildChunkGeometry(world, chunk) {
  solid.reset();
  water.reset();
  if (chunk.minY > chunk.maxY) return { solid: null, water: null };

  const y0 = chunk.minY;
  const y1 = chunk.maxY;
  gatherPadded(world, chunk, Math.max(0, y0 - 1), Math.min(WORLD_HEIGHT - 1, y1 + 1));
  if (y0 === 0) fillBoundaryLayer(-1, MAT.BEDROCK, 0);
  if (y1 === WORLD_HEIGHT - 1) fillBoundaryLayer(WORLD_HEIGHT, MAT.AIR, 0xf0);

  for (let y = y0; y <= y1; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      let p = pidx(0, y, z);
      for (let x = 0; x < CHUNK_SIZE; x++, p++) {
        const id = pBlocks[p];
        if (id === MAT.AIR) continue;
        const render = MAT_RENDER[id];
        if (render === RENDER.CROSS) emitCross(x, y, z, id, p);
        else if (render === RENDER.WATER) emitWater(x, y, z, p);
        else emitBlock(x, y, z, id, p);
      }
    }
  }
  return { solid: solid.export(), water: water.export() };
}

function emitBlock(x, y, z, id, p) {
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const nb = pBlocks[p + face.nOff];
    if (MAT_OPAQUE[nb]) continue;
    if (nb === id && id === MAT.GLASS) continue;
    const layer = MAT_TILES[id * 3 + face.group];
    const fp = p + face.nOff;
    let ao0 = 0;
    let ao1 = 0;
    let ao2 = 0;
    let ao3 = 0;
    for (let c = 0; c < 4; c++) {
      const corner = face.corners[c];
      const s1 = MAT_OPAQUE[pBlocks[p + corner.side1]];
      const s2 = MAT_OPAQUE[pBlocks[p + corner.side2]];
      const cc = MAT_OPAQUE[pBlocks[p + corner.corner]];
      const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);

      // Smooth light: average over the non-opaque cells around this corner.
      const l0 = pLight[fp];
      let sky = l0 >> 4;
      let blk = l0 & 15;
      let n = 1;
      if (!s1) { const l = pLight[p + corner.side1]; sky += l >> 4; blk += l & 15; n++; }
      if (!s2) { const l = pLight[p + corner.side2]; sky += l >> 4; blk += l & 15; n++; }
      if (!cc && !(s1 && s2)) { const l = pLight[p + corner.corner]; sky += l >> 4; blk += l & 15; n++; }

      const [px, py, pz] = corner.pos;
      solid.vertex(
        x + px, y + py, z + pz, corner.du, corner.dv, layer,
        Math.round((sky / n) * 17), Math.round((blk / n) * 17),
        Math.round(AO_CURVE[ao] * face.shade * 255),
      );
      if (c === 0) ao0 = ao; else if (c === 1) ao1 = ao; else if (c === 2) ao2 = ao; else ao3 = ao;
    }
    solid.quad(ao0 + ao2 < ao1 + ao3);
  }
}

const CROSS_QUADS = [
  [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15]],
  [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.15, 1, 0.85], [0.85, 1, 0.15]],
];

function emitCross(x, y, z, id, p) {
  const layer = MAT_TILES[id * 3 + 2];
  const l = pLight[p];
  const sky = (l >> 4) * 17;
  const blk = (l & 15) * 17;
  const ao = Math.round(0.9 * 255);
  for (const q of CROSS_QUADS) {
    // Front and back so the sprite is visible from both sides.
    for (const order of [[0, 1, 2, 3], [1, 0, 3, 2]]) {
      for (const k of order) {
        const [cx, cy, cz] = q[k];
        solid.vertex(x + cx, y + cy, z + cz, k === 1 || k === 2 ? 1 : 0, cy, layer, sky, blk, ao);
      }
      solid.quad(false);
    }
  }
}

function emitWater(x, y, z, p) {
  const aboveIsWater = pBlocks[p + offset(0, 1, 0)] === MAT.WATER;
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const nb = pBlocks[p + face.nOff];
    if (nb === MAT.WATER || MAT_OPAQUE[nb]) continue;
    const l = pLight[p + face.nOff] || pLight[p];
    const sky = (l >> 4) * 17;
    const blk = (l & 15) * 17;
    for (let c = 0; c < 4; c++) {
      const [px, py, pz] = face.corners[c].pos;
      const top = py === 1 && !aboveIsWater ? 1 - WATER_DROP : py;
      water.vertex(x + px, y + top, z + pz, 0, 0, 0, sky, blk, Math.round(face.shade * 255));
    }
    water.quad(false);
  }
}
