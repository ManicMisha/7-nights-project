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

/** Blocks that can be replaced by placing another block into their cell. */
export function isReplaceable(id) {
  return id === MAT.AIR || id === MAT.WATER || id === MAT.TALL_GRASS;
}

/** Blocks the player can pick and place (shown in the creative palette). */
export const PLACEABLE_MATERIALS = [
  MAT.GRASS, MAT.DIRT, MAT.STONE, MAT.COBBLESTONE, MAT.SAND, MAT.SANDSTONE,
  MAT.GRAVEL, MAT.LOG, MAT.PLANKS, MAT.LEAVES, MAT.GLASS, MAT.BRICKS,
  MAT.SNOW, MAT.COAL_ORE, MAT.IRON_ORE, MAT.GLOWSTONE, MAT.TORCH,
  MAT.RED_FLOWER, MAT.YELLOW_FLOWER,
];
