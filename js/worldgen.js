// Deterministic, endless terrain generation.
//
// Height is built from layered noise: a low-frequency "continentalness"
// field decides ocean vs. land, hills add rolling detail, an inland lake
// mask carves water bodies, and a ridged-noise mountain mask raises stone
// ranges. Biomes are derived from those same fields so they always agree
// with the terrain shape. Caves are carved from interpolated 3D noise.

import { MAT } from './materials.js';
import { cellIndex } from './chunk.js';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from './config.js';
import { SimplexNoise, hash2, hash3, smoothstep, lerp } from './noise.js';
import { HARVESTABLE, makeHarvestable } from './harvestables.js';

/**
 * Bump whenever a change to generation alters existing terrain. Saves record
 * the version that made their world, and a save from another version can't
 * be loaded (its edits would land on different terrain).
 */
export const GENERATOR_VERSION = 1;

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, MOUNTAINS: 3 };
export const BIOME_NAME = ['Ocean', 'Beach', 'Plains', 'Mountains'];

// Continentalness → base height.
const CONTINENT_SPLINE = [
  [-1, 16], [-0.5, 28], [-0.22, 40], [-0.1, 46], [-0.02, 50], [0.15, 54], [0.45, 60], [1, 68],
];

function spline(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

// Legacy materials that still draw each plant type (until Phase 5).
const PLANT_MATERIAL = {
  [HARVESTABLE.TALL_GRASS]: MAT.TALL_GRASS,
  [HARVESTABLE.RED_FLOWER]: MAT.RED_FLOWER,
  [HARVESTABLE.YELLOW_FLOWER]: MAT.YELLOW_FLOWER,
};

const PAD = 2; // columns sampled beyond the chunk edge so trees can cross borders
const COLS = CHUNK_SIZE + PAD * 2;
const CAVE_STEP = 4;
const CAVE_NX = CHUNK_SIZE / CAVE_STEP + 1;
const CAVE_NY = WORLD_HEIGHT / CAVE_STEP + 1;

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.continent = new SimplexNoise(s ^ 0x1234567);
    this.hills = new SimplexNoise(s ^ 0x2345678);
    this.detail = new SimplexNoise(s ^ 0x3456789);
    this.lakes = new SimplexNoise(s ^ 0x456789a);
    this.mountainMask = new SimplexNoise(s ^ 0x56789ab);
    this.ridges = new SimplexNoise(s ^ 0x6789abc);
    this.forest = new SimplexNoise(s ^ 0x789abcd);
    this.caveA = new SimplexNoise(s ^ 0x89abcde);
    this.caveB = new SimplexNoise(s ^ 0x9abcdef);
    this.caveCheese = new SimplexNoise(s ^ 0xabcdef1);
    this.surface = new SimplexNoise(s ^ 0xbcdef12);

    // Scratch buffers reused across chunks.
    this.colHeight = new Int16Array(COLS * COLS);
    this.colBiome = new Uint8Array(COLS * COLS);
    this.caveField = new Float32Array(CAVE_NX * CAVE_NX * CAVE_NY);
  }

  /** Terrain height (first air block) and biome for a world column. */
  columnInfo(wx, wz) {
    const c = Math.max(-1, Math.min(1, this.continent.fbm2D(wx / 700, wz / 700, 4) * 1.7));
    let h = spline(CONTINENT_SPLINE, c);
    h += this.hills.fbm2D(wx / 140, wz / 140, 3) * 7 + this.detail.noise2D(wx / 32, wz / 32) * 1.5;

    const inland = smoothstep(0.02, 0.2, c);
    const m = smoothstep(0.12, 0.5, this.mountainMask.fbm2D(wx / 520, wz / 520, 2) * 1.6) * inland;
    const lake = smoothstep(0.32, 0.55, this.lakes.fbm2D(wx / 260, wz / 260, 2) * 1.5) * inland * (1 - m);
    h = lerp(h, SEA_LEVEL - 8 + this.detail.noise2D(wx / 20, wz / 20) * 2, lake);

    if (m > 0) {
      const ridge = this.ridges.ridged2D(wx / 230, wz / 230, 5);
      h += m * (Math.pow(ridge, 1.35) * 64 + 4) - m * 3;
    }
    const height = Math.max(4, Math.min(WORLD_HEIGHT - 12, Math.floor(h)));

    let biome;
    if (height <= SEA_LEVEL - 1) biome = BIOME.OCEAN;
    else if (height <= SEA_LEVEL + 2 && (c < 0.1 || lake > 0.15)) biome = BIOME.BEACH;
    else if (m > 0.3 && height > SEA_LEVEL + 16) biome = BIOME.MOUNTAINS;
    else biome = BIOME.PLAINS;
    return { height, biome, mountain: m };
  }

  /** Fills `chunk.materials` and `chunk.harvestables` for its position. */
  generate(chunk) {
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;
    const seed = this.seed;

    // 1. Column heights & biomes (padded for cross-border trees).
    let maxHeight = 0;
    for (let z = 0; z < COLS; z++) {
      for (let x = 0; x < COLS; x++) {
        const info = this.columnInfo(baseX + x - PAD, baseZ + z - PAD);
        this.colHeight[z * COLS + x] = info.height;
        this.colBiome[z * COLS + x] = info.biome;
        if (info.height > maxHeight) maxHeight = info.height;
      }
    }

    // 2. Sparse cave density field, trilinearly interpolated per block.
    this.sampleCaveField(baseX, baseZ, Math.min(WORLD_HEIGHT - 1, maxHeight + 2));

    // 3. Terrain column fill.
    const mats = chunk.materials;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const ci = (z + PAD) * COLS + (x + PAD);
        const height = this.colHeight[ci];
        const biome = this.colBiome[ci];
        const surfaceNoise = this.surface.noise2D(wx / 18, wz / 18);
        const soilDepth = 3 + Math.floor((surfaceNoise + 1) * 1.5);

        let top;
        let filler;
        let fillerDepth = soilDepth;
        switch (biome) {
          case BIOME.OCEAN:
            top = height > SEA_LEVEL - 7 ? MAT.SAND : surfaceNoise > 0.25 ? MAT.GRAVEL : MAT.DIRT;
            filler = top === MAT.SAND ? MAT.SAND : MAT.DIRT;
            break;
          case BIOME.BEACH:
            top = MAT.SAND;
            filler = MAT.SAND;
            fillerDepth = soilDepth + 1;
            break;
          case BIOME.MOUNTAINS:
            if (height > 94 + surfaceNoise * 6) top = MAT.SNOW;
            else if (height < SEA_LEVEL + 26 + surfaceNoise * 6) top = MAT.GRASS;
            else top = surfaceNoise > 0.55 ? MAT.GRAVEL : MAT.STONE;
            filler = top === MAT.GRASS ? MAT.DIRT : MAT.STONE;
            fillerDepth = top === MAT.GRASS ? 2 : 1;
            break;
          default:
            top = MAT.GRASS;
            filler = MAT.DIRT;
        }

        // Caves may breach the surface only in the mountains (cave entrances);
        // elsewhere they stay underground so beaches, lake beds and tree roots
        // are never undercut.
        const caveCeiling = biome === BIOME.MOUNTAINS ? height : height - 5;

        for (let y = 0; y < height; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash3(wx, y, wz, seed) < 0.5)) {
            id = MAT.BEDROCK;
          } else if (y === height - 1) {
            id = top;
          } else if (y >= height - 1 - fillerDepth) {
            id = filler;
            if (biome === BIOME.BEACH && y < height - 4) id = MAT.SANDSTONE;
          } else {
            id = MAT.STONE;
            if (hash3(wx >> 1, y >> 1, wz >> 1, seed ^ 0x55) < 0.018 && y < 110 && hash3(wx, y, wz, seed ^ 0x66) < 0.65) {
              id = MAT.COAL_ORE;
            } else if (y < 56 && hash3(wx >> 1, y >> 1, wz >> 1, seed ^ 0x77) < 0.009 && hash3(wx, y, wz, seed ^ 0x88) < 0.6) {
              id = MAT.IRON_ORE;
            }
          }
          if (y > 2 && y < caveCeiling && this.caveAt(x, y, z) > 0) id = MAT.AIR;
          mats[cellIndex(x, y, z)] = id;
        }
        for (let y = height; y <= SEA_LEVEL; y++) mats[cellIndex(x, y, z)] = MAT.WATER;
      }
    }

    // 4. Trees (including those rooted in neighbouring columns).
    for (let z = 0; z < COLS; z++) {
      for (let x = 0; x < COLS; x++) {
        const ci = z * COLS + x;
        if (this.colBiome[ci] !== BIOME.PLAINS) continue;
        const height = this.colHeight[ci];
        if (height <= SEA_LEVEL + 1 || height > WORLD_HEIGHT - 10) continue;
        const wx = baseX + x - PAD;
        const wz = baseZ + z - PAD;
        const density = 0.003 + 0.04 * smoothstep(0.1, 0.6, this.forest.fbm2D(wx / 110, wz / 110, 2));
        if (hash2(wx, wz, seed ^ 0x7ee) >= density) continue;
        const lx = x - PAD;
        const lz = z - PAD;
        const trunk = this.placeTree(chunk, lx, height, lz, wx, wz);
        // The tree belongs to the chunk its trunk stands in.
        if (lx >= 0 && lz >= 0 && lx < CHUNK_SIZE && lz < CHUNK_SIZE) {
          chunk.harvestables.push(makeHarvestable(HARVESTABLE.OAK_TREE, lx, height, lz, trunk));
        }
      }
    }

    // 5. Ground decorations (grass tufts & flowers) on plains.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const ci = (z + PAD) * COLS + (x + PAD);
        if (this.colBiome[ci] !== BIOME.PLAINS && this.colBiome[ci] !== BIOME.MOUNTAINS) continue;
        const y = this.colHeight[ci];
        if (y >= WORLD_HEIGHT - 1) continue;
        if (mats[cellIndex(x, y - 1, z)] !== MAT.GRASS || mats[cellIndex(x, y, z)] !== MAT.AIR) continue;
        const r = hash2(baseX + x, baseZ + z, seed ^ 0xdec);
        let plant = 0;
        if (r < 0.14) plant = HARVESTABLE.TALL_GRASS;
        else if (r < 0.15) plant = HARVESTABLE.RED_FLOWER;
        else if (r < 0.162) plant = HARVESTABLE.YELLOW_FLOWER;
        if (!plant) continue;
        mats[cellIndex(x, y, z)] = PLANT_MATERIAL[plant];
        chunk.harvestables.push(makeHarvestable(plant, x, y, z));
      }
    }
  }

  placeTree(chunk, lx, baseY, lz, wx, wz) {
    const seed = this.seed;
    const trunk = 4 + Math.floor(hash2(wx, wz, seed ^ 0x1ee) * 3);
    const topY = baseY + trunk;
    const set = (x, y, z, id, overwrite) => {
      if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      const i = cellIndex(x, y, z);
      const cur = chunk.materials[i];
      if (overwrite || cur === MAT.AIR || cur === MAT.TALL_GRASS) chunk.materials[i] = id;
    };
    for (let y = topY - 3; y <= topY; y++) {
      const radius = y >= topY - 1 ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
          if (corner && (y === topY || hash3(wx + dx, y, wz + dz, seed ^ 0x1eaf) < 0.5)) continue;
          set(lx + dx, y, lz + dz, MAT.LEAVES, false);
        }
      }
    }
    for (let y = baseY; y < topY; y++) set(lx, y, lz, MAT.LOG, true);
    set(lx, baseY - 1, lz, MAT.DIRT, true);
    return trunk;
  }

  sampleCaveField(baseX, baseZ, maxY) {
    const field = this.caveField;
    const ny = Math.min(CAVE_NY, Math.ceil(maxY / CAVE_STEP) + 2);
    this.caveRows = ny;
    for (let gy = 0; gy < ny; gy++) {
      const y = gy * CAVE_STEP;
      // Big "cheese" caverns only deep down; fade them out towards the top.
      const cheeseFade = 1 - smoothstep(24, 44, y);
      for (let gz = 0; gz < CAVE_NX; gz++) {
        for (let gx = 0; gx < CAVE_NX; gx++) {
          const wx = baseX + gx * CAVE_STEP;
          const wz = baseZ + gz * CAVE_STEP;
          // Spaghetti tunnels: the intersection of two noise iso-surfaces.
          const a = this.caveA.noise3D(wx / 52, y / 30, wz / 52);
          const b = this.caveB.noise3D(wx / 52, y / 30, wz / 52);
          const tunnel = 1 - (a * a + b * b) / 0.03;
          let v = tunnel;
          if (cheeseFade > 0) {
            const cheese = (this.caveCheese.noise3D(wx / 70, y / 34, wz / 70) - 0.55) * 8 * cheeseFade;
            if (cheese > v) v = cheese;
          }
          field[(gy * CAVE_NX + gz) * CAVE_NX + gx] = v;
        }
      }
    }
  }

  /** Interpolated cave density at a local block position; > 0 means air. */
  caveAt(x, y, z) {
    const gy = y / CAVE_STEP;
    const y0 = Math.floor(gy);
    if (y0 + 1 >= this.caveRows) return -1;
    const gx = x / CAVE_STEP;
    const gz = z / CAVE_STEP;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = gx - x0;
    const ty = gy - y0;
    const tz = gz - z0;
    const f = this.caveField;
    const idx = (yy, zz, xx) => (yy * CAVE_NX + zz) * CAVE_NX + xx;
    const c00 = lerp(f[idx(y0, z0, x0)], f[idx(y0, z0, x0 + 1)], tx);
    const c01 = lerp(f[idx(y0, z0 + 1, x0)], f[idx(y0, z0 + 1, x0 + 1)], tx);
    const c10 = lerp(f[idx(y0 + 1, z0, x0)], f[idx(y0 + 1, z0, x0 + 1)], tx);
    const c11 = lerp(f[idx(y0 + 1, z0 + 1, x0)], f[idx(y0 + 1, z0 + 1, x0 + 1)], tx);
    return lerp(lerp(c00, c01, tz), lerp(c10, c11, tz), ty);
  }
}
