// Material registry: what can fill a cell of the world grid. Properties are
// flattened into typed lookup tables indexed by material id so the hot loops
// (meshing, lighting, physics) never touch objects.
//
// Terrain materials (dirt, sand, stone, ores…) belong here for good. The
// others are left over from the block prototype and are marked `legacy`
// below: trees and plants move to harvestable objects in Phase 5, and
// placed building blocks move to building pieces in Phase 6.

export const MAT = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WATER: 5,
  LOG: 6,
  LEAVES: 7,
  PLANKS: 8,
  COBBLESTONE: 9,
  GLASS: 10,
  BEDROCK: 11,
  GRAVEL: 12,
  SNOW: 13,
  COAL_ORE: 14,
  IRON_ORE: 15,
  TORCH: 16,
  GLOWSTONE: 17,
  TALL_GRASS: 18,
  RED_FLOWER: 19,
  YELLOW_FLOWER: 20,
  BRICKS: 21,
  SANDSTONE: 22,
};

/** Render modes used by the mesher. */
export const RENDER = { NONE: 0, SOLID: 1, CUTOUT: 2, CROSS: 3, WATER: 4 };

/**
 * Texture tile names, in texture-array layer order. The procedural texture
 * generator (textures.js) has one painter per name.
 */
export const TILES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'water', 'log_side', 'log_top',
  'leaves', 'planks', 'cobblestone', 'glass', 'bedrock', 'gravel', 'snow', 'snow_side',
  'coal_ore', 'iron_ore', 'torch', 'glowstone', 'tall_grass', 'red_flower', 'yellow_flower',
  'bricks', 'sandstone_side', 'sandstone_top',
];
const T = Object.fromEntries(TILES.map((name, i) => [name, i]));

// id, name, render, solid, opaque, light emission, light attenuation, hardness (s), drop, tiles [top, bottom, side]
const DEFS = [
  [MAT.AIR, 'Air', RENDER.NONE, false, false, 0, 0, 0, 0, [0, 0, 0]],
  [MAT.GRASS, 'Grass', RENDER.SOLID, true, true, 0, 15, 0.6, MAT.DIRT, [T.grass_top, T.dirt, T.grass_side]],
  [MAT.DIRT, 'Dirt', RENDER.SOLID, true, true, 0, 15, 0.5, MAT.DIRT, [T.dirt, T.dirt, T.dirt]],
  [MAT.STONE, 'Stone', RENDER.SOLID, true, true, 0, 15, 1.5, MAT.COBBLESTONE, [T.stone, T.stone, T.stone]],
  [MAT.SAND, 'Sand', RENDER.SOLID, true, true, 0, 15, 0.5, MAT.SAND, [T.sand, T.sand, T.sand]],
  [MAT.WATER, 'Water', RENDER.WATER, false, false, 0, 2, Infinity, 0, [T.water, T.water, T.water]],
  [MAT.LOG, 'Oak Log', RENDER.SOLID, true, true, 0, 15, 1.2, MAT.LOG, [T.log_top, T.log_top, T.log_side]],
  [MAT.LEAVES, 'Leaves', RENDER.CUTOUT, true, false, 0, 1, 0.2, MAT.LEAVES, [T.leaves, T.leaves, T.leaves]],
  [MAT.PLANKS, 'Planks', RENDER.SOLID, true, true, 0, 15, 1.0, MAT.PLANKS, [T.planks, T.planks, T.planks]],
  [MAT.COBBLESTONE, 'Cobblestone', RENDER.SOLID, true, true, 0, 15, 1.6, MAT.COBBLESTONE, [T.cobblestone, T.cobblestone, T.cobblestone]],
  [MAT.GLASS, 'Glass', RENDER.CUTOUT, true, false, 0, 0, 0.3, MAT.GLASS, [T.glass, T.glass, T.glass]],
  [MAT.BEDROCK, 'Bedrock', RENDER.SOLID, true, true, 0, 15, Infinity, 0, [T.bedrock, T.bedrock, T.bedrock]],
  [MAT.GRAVEL, 'Gravel', RENDER.SOLID, true, true, 0, 15, 0.6, MAT.GRAVEL, [T.gravel, T.gravel, T.gravel]],
  [MAT.SNOW, 'Snowy Stone', RENDER.SOLID, true, true, 0, 15, 0.8, MAT.SNOW, [T.snow, T.stone, T.snow_side]],
  [MAT.COAL_ORE, 'Coal Ore', RENDER.SOLID, true, true, 0, 15, 2.0, MAT.COAL_ORE, [T.coal_ore, T.coal_ore, T.coal_ore]],
  [MAT.IRON_ORE, 'Iron Ore', RENDER.SOLID, true, true, 0, 15, 2.4, MAT.IRON_ORE, [T.iron_ore, T.iron_ore, T.iron_ore]],
  [MAT.TORCH, 'Torch', RENDER.CROSS, false, false, 14, 0, 0, MAT.TORCH, [T.torch, T.torch, T.torch]],
  [MAT.GLOWSTONE, 'Glowstone', RENDER.SOLID, true, true, 15, 15, 0.4, MAT.GLOWSTONE, [T.glowstone, T.glowstone, T.glowstone]],
  [MAT.TALL_GRASS, 'Tall Grass', RENDER.CROSS, false, false, 0, 0, 0, 0, [T.tall_grass, T.tall_grass, T.tall_grass]],
  [MAT.RED_FLOWER, 'Poppy', RENDER.CROSS, false, false, 0, 0, 0, MAT.RED_FLOWER, [T.red_flower, T.red_flower, T.red_flower]],
  [MAT.YELLOW_FLOWER, 'Dandelion', RENDER.CROSS, false, false, 0, 0, 0, MAT.YELLOW_FLOWER, [T.yellow_flower, T.yellow_flower, T.yellow_flower]],
  [MAT.BRICKS, 'Bricks', RENDER.SOLID, true, true, 0, 15, 1.8, MAT.BRICKS, [T.bricks, T.bricks, T.bricks]],
  [MAT.SANDSTONE, 'Sandstone', RENDER.SOLID, true, true, 0, 15, 1.0, MAT.SANDSTONE, [T.sandstone_top, T.sandstone_top, T.sandstone_side]],
];

const N = 256;
export const MAT_NAME = new Array(N).fill('Unknown');
export const MAT_RENDER = new Uint8Array(N);
export const MAT_SOLID = new Uint8Array(N); // collides with entities
export const MAT_OPAQUE = new Uint8Array(N); // fully blocks light and hides neighbour faces
export const MAT_EMIT = new Uint8Array(N); // emitted block light level
export const MAT_ATTEN = new Uint8Array(N); // extra light lost when light passes through
export const MAT_HARDNESS = new Float32Array(N);
export const MAT_DROP = new Uint8Array(N);
/** Texture layer per block & face: [top, bottom, side] packed as id * 3 + faceGroup. */
export const MAT_TILES = new Uint8Array(N * 3);

for (const [id, name, render, solid, opaque, emit, atten, hardness, drop, tiles] of DEFS) {
  MAT_NAME[id] = name;
  MAT_RENDER[id] = render;
  MAT_SOLID[id] = solid ? 1 : 0;
  MAT_OPAQUE[id] = opaque ? 1 : 0;
  MAT_EMIT[id] = emit;
  MAT_ATTEN[id] = atten;
  MAT_HARDNESS[id] = hardness;
  MAT_DROP[id] = drop;
  MAT_TILES[id * 3] = tiles[0];
  MAT_TILES[id * 3 + 1] = tiles[1];
  MAT_TILES[id * 3 + 2] = tiles[2];
}

/**
 * Terrain materials: the ones drawn as smooth ground by the Surface Nets
 * mesher. Density describes terrain only: a cell is filled with terrain
 * when its density is > 0, and then its material is always one of these.
 * Air, water and the legacy prototype blocks are "empty terrain"
 * (density ≤ 0); legacy blocks are still drawn as cubes until later phases
 * replace them.
 */
export const MAT_TERRAIN = new Uint8Array(N);
for (const id of [
  MAT.GRASS, MAT.DIRT, MAT.STONE, MAT.SAND, MAT.BEDROCK, MAT.GRAVEL, MAT.SNOW,
  MAT.COAL_ORE, MAT.IRON_ORE, MAT.SANDSTONE,
]) {
  MAT_TERRAIN[id] = 1;
}

/**
 * Flat colour per terrain material (sRGB hex, from the DESIGN.md palette).
 * Phase 2 draws terrain in these colours; Phase 3 adds stylized texturing.
 */
const TERRAIN_COLOURS = {
  [MAT.GRASS]: 0x6cc24a,
  [MAT.DIRT]: 0x9c6b43,
  [MAT.STONE]: 0x8e9196,
  [MAT.SAND]: 0xf2d99a,
  [MAT.BEDROCK]: 0x4a4b50,
  [MAT.GRAVEL]: 0x8a8580,
  [MAT.SNOW]: 0xf4f8fc,
  [MAT.COAL_ORE]: 0x5e6268,
  [MAT.IRON_ORE]: 0xa08070,
  [MAT.SANDSTONE]: 0xe0c98a,
};
/** sRGB colour bytes per material: [r, g, b] at id * 3. */
export const MAT_COLOUR = new Uint8Array(N * 3);
for (const [id, hex] of Object.entries(TERRAIN_COLOURS)) {
  MAT_COLOUR[id * 3] = (hex >> 16) & 255;
  MAT_COLOUR[id * 3 + 1] = (hex >> 8) & 255;
  MAT_COLOUR[id * 3 + 2] = hex & 255;
}

/** Density of a completely filled / completely empty cell. */
export const DENSITY_FULL = 127;
export const DENSITY_EMPTY = -127;

/** Density scale: density units per metre of distance to the surface. */
export const DENSITY_PER_METRE = 32;

/** Density a cell gets when it's set to `id` outright: full for terrain, empty otherwise. */
export function defaultDensity(id) {
  return MAT_TERRAIN[id] ? DENSITY_FULL : DENSITY_EMPTY;
}

/**
 * Materials left over from the block prototype, which later phases move out
 * of the grid: trees and plants become harvestable objects (Phase 5);
 * placed building blocks and lights become building pieces (Phase 6).
 */
export const MAT_LEGACY = new Uint8Array(N);
for (const id of [
  MAT.LOG, MAT.LEAVES, MAT.TALL_GRASS, MAT.RED_FLOWER, MAT.YELLOW_FLOWER, // → harvestables
  MAT.PLANKS, MAT.COBBLESTONE, MAT.GLASS, MAT.BRICKS, MAT.TORCH, MAT.GLOWSTONE, // → building pieces
]) {
  MAT_LEGACY[id] = 1;
}

/** Blocks that can be replaced by placing another block into their cell. */
export function isReplaceable(id) {
  return id === MAT.AIR || id === MAT.WATER || id === MAT.TALL_GRASS;
}
