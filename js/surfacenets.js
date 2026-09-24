// Surface Nets mesher: draws the terrain as a smooth surface where the
// density field crosses zero. The player never sees the grid cubes.
//
// Density samples sit at cell centres. For every "dual cell" (the cube
// between 8 neighbouring samples) that the surface passes through, one
// vertex is placed at the average of the zero crossings on its edges. For
// every sample edge that crosses the surface, one quad joins the 4 dual
// cells around that edge. Vertices are shared between quads, so the mesh is
// smooth and much lighter than cube faces.
//
// Seamless chunks: a chunk owns the sample edges that start inside it and
// reads one layer of samples from each neighbour. Vertices on a border are
// computed from the same samples in both chunks, so they match exactly.
//
// Vertex data (per vertex, 29 bytes): position (3 × f32), normal (3 × i8,
// from the density gradient), terrain-class weights (grass, soil, rock,
// sand; 4 × u8), light (sky, block, snow weight, ambient occlusion; 4 × u8)
// and ore amounts (coal, iron; 2 × u8). The shader blends the stylized
// class textures from these weights.

import { MAT_CLASS, MAT_ORE, TERRAIN_CLASS_COUNT, ORE } from './materials.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from './config.js';
import { cellIndex } from './chunk.js';

const P = CHUNK_SIZE + 2; // padded samples per horizontal axis: −1 … 16
const PY = WORLD_HEIGHT + 2; // padded vertically: −1 … WORLD_HEIGHT
const LAYER = P * P;
const sDens = new Int16Array(LAYER * PY);
const sMat = new Uint8Array(LAYER * PY);
const sLight = new Uint8Array(LAYER * PY);
const sidx = (x, y, z) => ((y + 1) * P + (z + 1)) * P + (x + 1);

// Dual-cell vertex index lookup, one slot per dual cell (−1 … 15 per axis).
const vIndex = new Int32Array(LAYER * PY);

// Corner offsets of a dual cell and its 12 edges (pairs of corner numbers).
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];
const CORNER_OFF = CORNERS.map(([x, y, z]) => (y * P + z) * P + x);
const classWeights = new Float32Array(TERRAIN_CLASS_COUNT);

// For each axis: the axis step, and the two in-plane axes u, v with u × v = axis.
const AXES = [
  { d: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { d: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { d: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
];
for (const a of AXES) {
  a.dOff = (a.d[1] * P + a.d[2]) * P + a.d[0];
  a.uOff = (a.u[1] * P + a.u[2]) * P + a.u[0];
  a.vOff = (a.v[1] * P + a.v[2]) * P + a.v[0];
}

class Buffers {
  constructor() {
    this.capacity = 0;
    this.count = 0;
    this.indexCount = 0;
    this.grow(8192);
  }
  grow(n) {
    const pos = new Float32Array(n * 3);
    const nrm = new Int8Array(n * 3);
    const mat = new Uint8Array(n * 4);
    const light = new Uint8Array(n * 4);
    const ore = new Uint8Array(n * 2);
    const index = new Uint32Array(n * 6);
    if (this.capacity) {
      pos.set(this.pos);
      nrm.set(this.nrm);
      mat.set(this.mat);
      light.set(this.light);
      ore.set(this.ore);
      index.set(this.index);
    }
    Object.assign(this, { pos, nrm, mat, light, ore, index, capacity: n });
  }
  reset() {
    this.count = 0;
    this.indexCount = 0;
  }
  ensure(vertices, indices) {
    while (this.count + vertices > this.capacity || this.indexCount + indices > this.capacity * 6) {
      this.grow(this.capacity * 2);
    }
  }
  export() {
    if (this.indexCount === 0) return null;
    const n = this.count;
    return {
      position: this.pos.slice(0, n * 3),
      normal: this.nrm.slice(0, n * 3),
      material: this.mat.slice(0, n * 4),
      light: this.light.slice(0, n * 4),
      ore: this.ore.slice(0, n * 2),
      index: n > 65535 ? this.index.slice(0, this.indexCount) : Uint16Array.from(this.index.subarray(0, this.indexCount)),
      vertexCount: n,
    };
  }
}

const out = new Buffers();
// Sample rows filled for the chunk being meshed (lo … hi).
let rowLo = 0;
let rowHi = 0;

/** Copies densities, materials and light for the chunk plus a 1-sample border. */
function gather(world, chunk, y0, y1) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const src = world.getChunk(chunk.cx + dx, chunk.cz + dz);
      const xs = dx === -1 ? CHUNK_SIZE - 1 : 0;
      const xe = dx === 1 ? 0 : CHUNK_SIZE - 1;
      const zs = dz === -1 ? CHUNK_SIZE - 1 : 0;
      const ze = dz === 1 ? 0 : CHUNK_SIZE - 1;
      for (let y = y0; y <= y1; y++) {
        for (let z = zs; z <= ze; z++) {
          let pi = sidx(xs + dx * CHUNK_SIZE, y, z + dz * CHUNK_SIZE);
          let si = cellIndex(xs, y, z);
          for (let x = xs; x <= xe; x++, pi++, si++) {
            if (src) {
              sDens[pi] = src.density[si];
              sMat[pi] = src.materials[si];
              sLight[pi] = src.light[si];
            } else {
              sDens[pi] = 127; // missing neighbour: treat as solid, no surface
              sMat[pi] = 0;
              sLight[pi] = 0;
            }
          }
        }
      }
    }
  }
}

function fillLayer(y, density, light) {
  const start = sidx(-1, y, -1);
  sDens.fill(density, start, start + LAYER);
  sMat.fill(0, start, start + LAYER);
  sLight.fill(light, start, start + LAYER);
}

/** Vertical range of samples that can hold a surface for this chunk and its neighbours. */
function sampleRange(world, chunk) {
  let lo = WORLD_HEIGHT;
  let hi = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!c) continue;
      if (c.minY < lo) lo = c.minY;
      if (c.maxY > hi) hi = c.maxY;
    }
  }
  return [Math.max(-1, lo - 1), Math.min(WORLD_HEIGHT, hi + 1)];
}

/** Builds the smooth terrain mesh for a chunk (null if it has no surface). */
export function buildSmoothGeometry(world, chunk) {
  out.reset();
  const [lo, hi] = sampleRange(world, chunk);
  if (lo > hi) return null;
  rowLo = lo;
  rowHi = hi;
  gather(world, chunk, Math.max(0, lo), Math.min(WORLD_HEIGHT - 1, hi));
  if (lo < 0) fillLayer(-1, 127, 0);
  if (hi >= WORLD_HEIGHT) fillLayer(WORLD_HEIGHT, -127, 0xf0);

  // 1. One vertex per dual cell that the surface passes through.
  for (let y = lo; y < hi; y++) {
    for (let z = -1; z < CHUNK_SIZE; z++) {
      for (let x = -1; x < CHUNK_SIZE; x++) {
        const base = sidx(x, y, z);
        vIndex[base] = -1;
        let mask = 0;
        for (let c = 0; c < 8; c++) if (sDens[base + CORNER_OFF[c]] > 0) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue;
        out.ensure(1, 0);
        vIndex[base] = makeVertex(x, y, z, base, mask);
      }
    }
  }

  // 2. One quad per sample edge (owned by this chunk) that crosses the surface.
  for (let y = lo; y < hi; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const s = sidx(x, y, z);
        const inside = sDens[s] > 0;
        for (let a = 0; a < 3; a++) {
          // Horizontal edges need the dual cells below them; on the lowest
          // row every sample is empty, so there's nothing to join there.
          if (a !== 1 && y === lo) continue;
          const axis = AXES[a];
          if ((sDens[s + axis.dOff] > 0) === inside) continue;
          // The four dual cells around this edge.
          const c = s;
          const b = s - axis.vOff;
          const d = s - axis.uOff;
          const aa = s - axis.uOff - axis.vOff;
          const ia = vIndex[aa];
          const ib = vIndex[b];
          const ic = vIndex[c];
          const id = vIndex[d];
          if (ia < 0 || ib < 0 || ic < 0 || id < 0) continue;
          out.ensure(0, 6);
          if (inside) emitQuad(ia, ib, ic, id);
          else emitQuad(ia, id, ic, ib);
        }
      }
    }
  }
  return out.export();
}

function makeVertex(x, y, z, base, mask) {
  // Surface point: average of the edge crossings.
  let px = 0;
  let py = 0;
  let pz = 0;
  let n = 0;
  for (let e = 0; e < 12; e++) {
    const [c0, c1] = EDGES[e];
    const in0 = (mask >> c0) & 1;
    if (in0 === ((mask >> c1) & 1)) continue;
    const d0 = sDens[base + CORNER_OFF[c0]];
    const d1 = sDens[base + CORNER_OFF[c1]];
    const t = d0 / (d0 - d1);
    const a = CORNERS[c0];
    const b = CORNERS[c1];
    px += a[0] + (b[0] - a[0]) * t;
    py += a[1] + (b[1] - a[1]) * t;
    pz += a[2] + (b[2] - a[2]) * t;
    n++;
  }
  px /= n;
  py /= n;
  pz /= n;

  // Normal: the density gradient points into the terrain, so flip it.
  const d = (c) => sDens[base + CORNER_OFF[c]];
  let gx = (d(1) - d(0)) + (d(3) - d(2)) + (d(5) - d(4)) + (d(7) - d(6));
  let gy = (d(2) - d(0)) + (d(3) - d(1)) + (d(6) - d(4)) + (d(7) - d(5));
  let gz = (d(4) - d(0)) + (d(5) - d(1)) + (d(6) - d(2)) + (d(7) - d(3));
  const len = Math.hypot(gx, gy, gz) || 1;
  gx = -gx / len;
  gy = -gy / len;
  gz = -gz / len;

  // Terrain-class blend weights: each solid corner counts in proportion to
  // how close it is to the vertex, so materials fade into each other.
  classWeights.fill(0);
  let coal = 0;
  let iron = 0;
  let total = 0;
  for (let c = 0; c < 8; c++) {
    if (!((mask >> c) & 1)) continue;
    const [ox, oy, oz] = CORNERS[c];
    const w = (ox ? px : 1 - px) * (oy ? py : 1 - py) * (oz ? pz : 1 - pz) + 1e-3;
    const mat = sMat[base + CORNER_OFF[c]];
    classWeights[MAT_CLASS[mat]] += w;
    if (MAT_ORE[mat] === ORE.COAL) coal += w;
    else if (MAT_ORE[mat] === ORE.IRON) iron += w;
    total += w;
  }

  // Light: average over the empty corners (where light actually is).
  let sky = 0;
  let blk = 0;
  let empty = 0;
  for (let c = 0; c < 8; c++) {
    if ((mask >> c) & 1) continue;
    const l = sLight[base + CORNER_OFF[c]];
    sky += l >> 4;
    blk += l & 15;
    empty++;
  }

  // Ambient occlusion: how much solid terrain surrounds a point one metre out
  // from the surface (hollows and crevices get darker).
  const ao = occlusion(x + px + gx * 1.2, y + py + gy * 1.2, z + pz + gz * 1.2);

  const i = out.count++;
  // Samples sit at cell centres, hence the +0.5.
  out.pos[i * 3] = x + px + 0.5;
  out.pos[i * 3 + 1] = y + py + 0.5;
  out.pos[i * 3 + 2] = z + pz + 0.5;
  out.nrm[i * 3] = Math.round(gx * 127);
  out.nrm[i * 3 + 1] = Math.round(gy * 127);
  out.nrm[i * 3 + 2] = Math.round(gz * 127);
  for (let k = 0; k < 4; k++) out.mat[i * 4 + k] = Math.round((classWeights[k] / total) * 255);
  out.light[i * 4] = Math.round((sky / empty) * 17);
  out.light[i * 4 + 1] = Math.round((blk / empty) * 17);
  out.light[i * 4 + 2] = Math.round((classWeights[4] / total) * 255); // snow
  out.light[i * 4 + 3] = Math.round(ao * 255);
  out.ore[i * 2] = Math.round((coal / total) * 255);
  out.ore[i * 2 + 1] = Math.round((iron / total) * 255);
  return i;
}

/**
 * 1 = open, lower = enclosed: the interpolated amount of solid terrain at a
 * point in sample space (x, y, z), used for soft ambient occlusion.
 */
function occlusion(x, y, z) {
  const cx = Math.max(-1, Math.min(CHUNK_SIZE - 1e-3, x));
  const cy = Math.max(rowLo, Math.min(rowHi - 1e-3, y));
  const cz = Math.max(-1, Math.min(CHUNK_SIZE - 1e-3, z));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const z0 = Math.floor(cz);
  const tx = cx - x0;
  const ty = cy - y0;
  const tz = cz - z0;
  const base = sidx(x0, y0, z0);
  let solid = 0;
  for (let c = 0; c < 8; c++) {
    if (sDens[base + CORNER_OFF[c]] <= 0) continue;
    const [ox, oy, oz] = CORNERS[c];
    solid += (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz);
  }
  return 1 - 0.45 * solid;
}

function emitQuad(a, b, c, d) {
  // Split along the shorter diagonal for a nicer surface.
  const p = out.pos;
  const dist = (i, j) => (p[i * 3] - p[j * 3]) ** 2 + (p[i * 3 + 1] - p[j * 3 + 1]) ** 2 + (p[i * 3 + 2] - p[j * 3 + 2]) ** 2;
  const idx = out.index;
  let k = out.indexCount;
  if (dist(a, c) <= dist(b, d)) {
    idx[k++] = a; idx[k++] = b; idx[k++] = c;
    idx[k++] = a; idx[k++] = c; idx[k++] = d;
  } else {
    idx[k++] = a; idx[k++] = b; idx[k++] = d;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  out.indexCount = k;
}
