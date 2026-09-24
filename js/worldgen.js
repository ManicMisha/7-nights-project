// Deterministic, endless terrain generation.
//
// Each column gets a continuous surface height built from layered noise
// over domain-warped coordinates (so coastlines and hills don't look
// grid-aligned): a low-frequency "continentalness" field decides ocean vs.
// land, hills add rolling detail, masks carve lakes and winding rivers,
// terraces make stylized cliffs, and ridged noise raises mountain ranges.
//
// Every cell then gets a signed terrain density (distance to the surface,
// positive inside), with 3D noise for mountain overhangs and interpolated 3D
// noise for caves. The smooth mesher draws the zero crossing. Materials come
// from depth below the surface, biome and slope (rock on steep ground).

import { MAT, DENSITY_PER_METRE } from './materials.js';
import { cellIndex } from './chunk.js';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from './config.js';
import { SimplexNoise, hash2, hash3, smoothstep, lerp } from './noise.js';
import { HARVESTABLE, makeHarvestable } from './harvestables.js';

/**
 * Bump whenever a change to generation alters existing terrain. Saves record
 * the version that made their world, and a save from another version can't
 * be loaded (its edits would land on different terrain).
 * v2 (Phase 2): smooth density terrain with rivers, cliffs and overhangs.
 */
export const GENERATOR_VERSION = 2;

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, MOUNTAINS: 3, RIVER: 4 };
export const BIOME_NAME = ['Ocean', 'Beach', 'Plains', 'Mountains', 'River'];

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

// Columns sampled beyond the chunk edge: trees can cross borders (2) and
// slopes need one more column for central differences (1).
const PAD = 3;
const COLS = CHUNK_SIZE + PAD * 2;
const CAVE_STEP = 4;
const CAVE_NX = CHUNK_SIZE / CAVE_STEP + 1;
const CAVE_NY = WORLD_HEIGHT / CAVE_STEP + 1;

const CAVE_DEPTH = 5; // caves stay this far below the surface (except mountain entrances)
const TERRACE_STEP = 6; // height of a cliff terrace step, in metres

const clampDensity = (metres) => Math.max(-127, Math.min(127, Math.round(metres * DENSITY_PER_METRE)));

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
    this.warpX = new SimplexNoise(s ^ 0xcdef123);
    this.warpZ = new SimplexNoise(s ^ 0xdef1234);
    this.rivers = new SimplexNoise(s ^ 0xef12345);
    this.cliffs = new SimplexNoise(s ^ 0xf123456);
    this.overhang = new SimplexNoise(s ^ 0x1357924);
    this.ores = new SimplexNoise(s ^ 0x2468ace);

    // Scratch buffers reused across chunks.
    this.colSurface = new Float32Array(COLS * COLS);
    this.colBiome = new Uint8Array(COLS * COLS);
    this.colMountain = new Float32Array(COLS * COLS);
    this.caveField = new Float32Array(CAVE_NX * CAVE_NX * CAVE_NY);
    this.coalField = new Float32Array(CAVE_NX * CAVE_NX * CAVE_NY);
    this.ironField = new Float32Array(CAVE_NX * CAVE_NX * CAVE_NY);
  }

  /**
   * Continuous shape of a world column: `surface` is the terrain height in
   * metres (ignoring caves and overhangs), plus the biome and the mountain
   * and river weights.
   */
  column(wx, wz) {
    // Domain warp: bend the sampling coordinates so features meander.
    const qx = wx + this.warpX.fbm2D(wx / 300, wz / 300, 3) * 60;
    const qz = wz + this.warpZ.fbm2D(wx / 300 + 50, wz / 300 + 50, 3) * 60;

    const c = Math.max(-1, Math.min(1, this.continent.fbm2D(qx / 700, qz / 700, 4) * 1.7));
    let h = spline(CONTINENT_SPLINE, c);
    h += this.hills.fbm2D(qx / 140, qz / 140, 3) * 7 + this.detail.noise2D(qx / 32, qz / 32) * 1.5;

    const inland = smoothstep(0.02, 0.2, c);
    const m = smoothstep(0.12, 0.5, this.mountainMask.fbm2D(qx / 520, qz / 520, 2) * 1.6) * inland;
    const lake = smoothstep(0.32, 0.55, this.lakes.fbm2D(qx / 260, qz / 260, 2) * 1.5) * inland * (1 - m);
    h = lerp(h, SEA_LEVEL - 8 + this.detail.noise2D(qx / 20, qz / 20) * 2, lake);

    if (m > 0) {
      const ridge = this.ridges.ridged2D(qx / 230, qz / 230, 5);
      h += m * (Math.pow(ridge, 1.35) * 64 + 4) - m * 3;
    }

    // Stylized cliffs: pull hilly ground towards flat terraces with steep steps.
    const cliffMask = smoothstep(0.2, 0.55, this.cliffs.noise2D(qx / 210, qz / 210)) * inland
      * smoothstep(SEA_LEVEL + 4, SEA_LEVEL + 10, h) * (1 - m * 0.7);
    if (cliffMask > 0) {
      const t = (h - SEA_LEVEL) / TERRACE_STEP;
      const terraced = (Math.floor(t) + smoothstep(0.3, 0.7, t - Math.floor(t))) * TERRACE_STEP + SEA_LEVEL;
      h = lerp(h, terraced, cliffMask * 0.9);
    }

    // Rivers: winding lines where a noise field crosses zero. Banks slope
    // down to sea level and the channel is cut below it, so it fills with
    // water. Rivers fade out in high mountains.
    const rv = Math.abs(this.rivers.fbm2D(qx / 420, qz / 420, 3));
    const riverZone = inland * (1 - smoothstep(0.3, 0.6, m));
    const bank = (1 - smoothstep(0.03, 0.1, rv)) * riverZone;
    const channel = (1 - smoothstep(0.012, 0.03, rv)) * riverZone;
    h = lerp(h, Math.min(h, SEA_LEVEL + 1.5), bank);
    h = lerp(h, SEA_LEVEL - 3, channel);

    const surface = Math.max(4, Math.min(WORLD_HEIGHT - 12, h));

    let biome;
    if (channel > 0.5 && surface < SEA_LEVEL) biome = BIOME.RIVER;
    else if (surface < SEA_LEVEL - 0.5) biome = BIOME.OCEAN;
    else if (surface <= SEA_LEVEL + 2.5 && (c < 0.1 || lake > 0.15 || bank > 0.3)) biome = BIOME.BEACH;
    else if (m > 0.3 && surface > SEA_LEVEL + 16) biome = BIOME.MOUNTAINS;
    else biome = BIOME.PLAINS;
    return { surface, biome, mountain: m };
  }

  /**
   * Column summary used outside generation: `height` is the first empty cell
   * above the surface (ignoring caves and overhangs), plus the biome.
   */
  columnInfo(wx, wz) {
    const col = this.column(wx, wz);
    return { height: firstEmptyCell(col.surface), surface: col.surface, biome: col.biome, mountain: col.mountain };
  }

  /** Fills `chunk.materials`, `chunk.density` and `chunk.harvestables` for its position. */
  generate(chunk) {
    const baseX = chunk.cx * CHUNK_SIZE;
    const baseZ = chunk.cz * CHUNK_SIZE;
    const seed = this.seed;

    // 1. Column shapes (padded for slopes and cross-border trees).
    let maxSurface = 0;
    for (let z = 0; z < COLS; z++) {
      for (let x = 0; x < COLS; x++) {
        const col = this.column(baseX + x - PAD, baseZ + z - PAD);
        const i = z * COLS + x;
        this.colSurface[i] = col.surface;
        this.colBiome[i] = col.biome;
        this.colMountain[i] = col.mountain;
        if (col.surface > maxSurface) maxSurface = col.surface;
      }
    }

    // 2. Sparse 3D fields (caves, ore veins), trilinearly interpolated per cell.
    const topY = Math.min(WORLD_HEIGHT - 1, Math.ceil(maxSurface) + 12);
    this.sampleFields(baseX, baseZ, topY);

    // 3. Density and material for every cell.
    const mats = chunk.materials;
    const dens = chunk.density;
    dens.fill(-127);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const ci = (z + PAD) * COLS + (x + PAD);
        const surface = this.colSurface[ci];
        const biome = this.colBiome[ci];
        const mountain = this.colMountain[ci];
        const slope = this.slopeAt(x + PAD, z + PAD);
        const surfaceNoise = this.surface.noise2D(wx / 18, wz / 18);
        const { top, filler, fillerDepth } = this.surfaceLayers(biome, surface, slope, surfaceNoise);

        // Caves may breach the surface only in the mountains (cave entrances);
        // elsewhere, and near water, they stay underground.
        const caveCeiling = biome === BIOME.MOUNTAINS ? surface + 2 : surface - CAVE_DEPTH - (surface < SEA_LEVEL + 3 ? 4 : 0);
        const overhangBand = mountain > 0.2;
        // Scale height difference to (roughly) distance from the surface, so
        // density changes at the same rate in every direction and steep
        // slopes don't saturate the ±127 range (which makes them staircase).
        const toDistance = 1 / Math.sqrt(1 + slope * slope);
        const columnTop = Math.min(WORLD_HEIGHT - 1, Math.ceil(Math.max(surface, SEA_LEVEL)) + (overhangBand ? 10 : 1));

        for (let y = 0; y <= columnTop; y++) {
          const i = cellIndex(x, y, z);
          const centre = y + 0.5;
          let f = (surface - centre) * toDistance; // metres inside the terrain (> 0 = solid)
          if (overhangBand && Math.abs(f) < 10) {
            f += mountain * this.overhang.noise3D(wx / 40, y / 22, wz / 40) * 3.5;
          }
          if (y > 1 && y < caveCeiling) {
            const cave = this.fieldAt(this.caveField, x, y, z);
            if (cave > 0) f = Math.min(f, -cave * 3);
          }
          if (y === 0) f = 8; // unbreakable floor

          if (f > 0) {
            const depth = surface - centre;
            let id;
            if (y === 0 || (y <= 2 && hash3(wx, y, wz, seed) < 0.5)) id = MAT.BEDROCK;
            else if (depth < 0) id = MAT.STONE; // overhangs above the column surface
            else if (depth < 1) id = top;
            else if (depth < fillerDepth) id = biome === BIOME.BEACH && depth > 3.5 ? MAT.SANDSTONE : filler;
            else id = this.oreAt(x, y, z);
            mats[i] = id;
            dens[i] = Math.max(1, clampDensity(f));
          } else {
            // Open water above the column surface at or below sea level;
            // caves and overhang pockets stay dry.
            mats[i] = y <= SEA_LEVEL && centre > surface ? MAT.WATER : MAT.AIR;
            dens[i] = clampDensity(f);
          }
        }
      }
    }

    // 4. Trees (including those rooted in neighbouring columns).
    for (let z = 1; z < COLS - 1; z++) {
      for (let x = 1; x < COLS - 1; x++) {
        const ci = z * COLS + x;
        if (this.colBiome[ci] !== BIOME.PLAINS) continue;
        const surface = this.colSurface[ci];
        if (surface <= SEA_LEVEL + 1.5 || surface > WORLD_HEIGHT - 12) continue;
        if (this.slopeAt(x, z) > 0.6) continue;
        const wx = baseX + x - PAD;
        const wz = baseZ + z - PAD;
        const density = 0.003 + 0.04 * smoothstep(0.1, 0.6, this.forest.fbm2D(wx / 110, wz / 110, 2));
        if (hash2(wx, wz, seed ^ 0x7ee) >= density) continue;
        const lx = x - PAD;
        const lz = z - PAD;
        const base = firstEmptyCell(surface);
        const trunk = this.placeTree(chunk, lx, base, lz, wx, wz);
        // The tree belongs to the chunk its trunk stands in.
        if (lx >= 0 && lz >= 0 && lx < CHUNK_SIZE && lz < CHUNK_SIZE) {
          chunk.harvestables.push(makeHarvestable(HARVESTABLE.OAK_TREE, lx, base, lz, trunk));
        }
      }
    }

    // 5. Ground plants (grass tufts & flowers) on grass.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const ci = (z + PAD) * COLS + (x + PAD);
        const biome = this.colBiome[ci];
        if (biome !== BIOME.PLAINS && biome !== BIOME.MOUNTAINS) continue;
        const y = firstEmptyCell(this.colSurface[ci]);
        if (y >= WORLD_HEIGHT - 1 || y < 1) continue;
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

  /** Steepness (rise over run) of the padded column at (px, pz). */
  slopeAt(px, pz) {
    const s = this.colSurface;
    const dx = (s[pz * COLS + px + 1] - s[pz * COLS + px - 1]) / 2;
    const dz = (s[(pz + 1) * COLS + px] - s[(pz - 1) * COLS + px]) / 2;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Top material, filler material and filler depth (metres) for a column. */
  surfaceLayers(biome, surface, slope, noise) {
    const soilDepth = 3 + (noise + 1) * 1.5;
    switch (biome) {
      case BIOME.OCEAN:
      case BIOME.RIVER: {
        const top = surface > SEA_LEVEL - 7 ? MAT.SAND : noise > 0.25 ? MAT.GRAVEL : MAT.DIRT;
        return { top, filler: top === MAT.SAND ? MAT.SAND : MAT.DIRT, fillerDepth: soilDepth };
      }
      case BIOME.BEACH:
        return { top: MAT.SAND, filler: MAT.SAND, fillerDepth: soilDepth + 2 };
      case BIOME.MOUNTAINS: {
        if (surface > 94 + noise * 6 && slope < 1.3) return { top: MAT.SNOW, filler: MAT.STONE, fillerDepth: 1 };
        if (surface < SEA_LEVEL + 26 + noise * 6 && slope < 0.9) return { top: MAT.GRASS, filler: MAT.DIRT, fillerDepth: 2 };
        return { top: noise > 0.55 ? MAT.GRAVEL : MAT.STONE, filler: MAT.STONE, fillerDepth: 1 };
      }
      default:
        // Plains: grass right up to the rock of cliffs (the terrain shader
        // adds a thin earthy lip where grass meets steep ground).
        if (slope > 1.0) return { top: MAT.STONE, filler: MAT.STONE, fillerDepth: 1 };
        return { top: MAT.GRASS, filler: MAT.DIRT, fillerDepth: soilDepth };
    }
  }

  /** Stone, or ore where a vein field is strong enough. */
  oreAt(x, y, z) {
    if (y < 110 && this.fieldAt(this.coalField, x, y, z) > 0.62) return MAT.COAL_ORE;
    if (y < 56 && this.fieldAt(this.ironField, x, y, z) > 0.66) return MAT.IRON_ORE;
    return MAT.STONE;
  }

  placeTree(chunk, lx, baseY, lz, wx, wz) {
    const seed = this.seed;
    const trunk = 4 + Math.floor(hash2(wx, wz, seed ^ 0x1ee) * 3);
    const topY = baseY + trunk;
    const set = (x, y, z, id, overwrite) => {
      if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      const i = cellIndex(x, y, z);
      const cur = chunk.materials[i];
      if (overwrite || cur === MAT.AIR || cur === MAT.TALL_GRASS) {
        chunk.materials[i] = id;
        // Logs and leaves aren't terrain: the cell stays empty terrain.
        if (chunk.density[i] > 0) chunk.density[i] = -1;
      }
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
    // Plant the trunk: full soil under it and a trunk cell just past the
    // surface, so the smooth ground rises to meet the trunk instead of
    // leaving it floating.
    if (lx >= 0 && lz >= 0 && lx < CHUNK_SIZE && lz < CHUNK_SIZE && baseY > 0) {
      const below = cellIndex(lx, baseY - 1, lz);
      chunk.materials[below] = MAT.DIRT;
      chunk.density[below] = 127;
      chunk.density[cellIndex(lx, baseY, lz)] = -1;
    }
    return trunk;
  }

  /** Samples the cave and ore noise on a coarse grid for this chunk. */
  sampleFields(baseX, baseZ, maxY) {
    const ny = Math.min(CAVE_NY, Math.ceil(maxY / CAVE_STEP) + 2);
    this.fieldRows = ny;
    for (let gy = 0; gy < ny; gy++) {
      const y = gy * CAVE_STEP;
      // Big "cheese" caverns only deep down; fade them out towards the top.
      const cheeseFade = 1 - smoothstep(24, 44, y);
      for (let gz = 0; gz < CAVE_NX; gz++) {
        for (let gx = 0; gx < CAVE_NX; gx++) {
          const wx = baseX + gx * CAVE_STEP;
          const wz = baseZ + gz * CAVE_STEP;
          const i = (gy * CAVE_NX + gz) * CAVE_NX + gx;
          // Spaghetti tunnels: the intersection of two noise iso-surfaces.
          const a = this.caveA.noise3D(wx / 52, y / 30, wz / 52);
          const b = this.caveB.noise3D(wx / 52, y / 30, wz / 52);
          let v = 1 - (a * a + b * b) / 0.03;
          if (cheeseFade > 0) {
            const cheese = (this.caveCheese.noise3D(wx / 70, y / 34, wz / 70) - 0.55) * 8 * cheeseFade;
            if (cheese > v) v = cheese;
          }
          this.caveField[i] = v;
          // Ore veins: stretched horizontally so they read as seams in the rock.
          this.coalField[i] = this.ores.noise3D(wx / 14, y / 6, wz / 14);
          this.ironField[i] = this.ores.noise3D(wx / 11 + 100, y / 7, wz / 11 + 100);
        }
      }
    }
  }

  /** Trilinearly interpolated value of a coarse field at a local cell. */
  fieldAt(field, x, y, z) {
    const gy = y / CAVE_STEP;
    const y0 = Math.floor(gy);
    if (y0 + 1 >= this.fieldRows) return -1;
    const gx = x / CAVE_STEP;
    const gz = z / CAVE_STEP;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = gx - x0;
    const ty = gy - y0;
    const tz = gz - z0;
    const idx = (yy, zz, xx) => (yy * CAVE_NX + zz) * CAVE_NX + xx;
    const c00 = lerp(field[idx(y0, z0, x0)], field[idx(y0, z0, x0 + 1)], tx);
    const c01 = lerp(field[idx(y0, z0 + 1, x0)], field[idx(y0, z0 + 1, x0 + 1)], tx);
    const c10 = lerp(field[idx(y0 + 1, z0, x0)], field[idx(y0 + 1, z0, x0 + 1)], tx);
    const c11 = lerp(field[idx(y0 + 1, z0 + 1, x0)], field[idx(y0 + 1, z0 + 1, x0 + 1)], tx);
    return lerp(lerp(c00, c01, tz), lerp(c10, c11, tz), ty);
  }
}

/** First cell whose centre is above a column surface height. */
export function firstEmptyCell(surface) {
  return Math.floor(surface - 0.5) + 1;
}
