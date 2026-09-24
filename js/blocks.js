// Block registry. Properties are flattened into typed lookup tables indexed
// by block id so the hot loops (meshing, lighting, physics) never touch
// objects.

export const BLOCK = {
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
  [BLOCK.AIR, 'Air', RENDER.NONE, false, false, 0, 0, 0, 0, [0, 0, 0]],
  [BLOCK.GRASS, 'Grass', RENDER.SOLID, true, true, 0, 15, 0.6, BLOCK.DIRT, [T.grass_top, T.dirt, T.grass_side]],
  [BLOCK.DIRT, 'Dirt', RENDER.SOLID, true, true, 0, 15, 0.5, BLOCK.DIRT, [T.dirt, T.dirt, T.dirt]],
  [BLOCK.STONE, 'Stone', RENDER.SOLID, true, true, 0, 15, 1.5, BLOCK.COBBLESTONE, [T.stone, T.stone, T.stone]],
  [BLOCK.SAND, 'Sand', RENDER.SOLID, true, true, 0, 15, 0.5, BLOCK.SAND, [T.sand, T.sand, T.sand]],
  [BLOCK.WATER, 'Water', RENDER.WATER, false, false, 0, 2, Infinity, 0, [T.water, T.water, T.water]],
  [BLOCK.LOG, 'Oak Log', RENDER.SOLID, true, true, 0, 15, 1.2, BLOCK.LOG, [T.log_top, T.log_top, T.log_side]],
  [BLOCK.LEAVES, 'Leaves', RENDER.CUTOUT, true, false, 0, 1, 0.2, BLOCK.LEAVES, [T.leaves, T.leaves, T.leaves]],
  [BLOCK.PLANKS, 'Planks', RENDER.SOLID, true, true, 0, 15, 1.0, BLOCK.PLANKS, [T.planks, T.planks, T.planks]],
  [BLOCK.COBBLESTONE, 'Cobblestone', RENDER.SOLID, true, true, 0, 15, 1.6, BLOCK.COBBLESTONE, [T.cobblestone, T.cobblestone, T.cobblestone]],
  [BLOCK.GLASS, 'Glass', RENDER.CUTOUT, true, false, 0, 0, 0.3, BLOCK.GLASS, [T.glass, T.glass, T.glass]],
  [BLOCK.BEDROCK, 'Bedrock', RENDER.SOLID, true, true, 0, 15, Infinity, 0, [T.bedrock, T.bedrock, T.bedrock]],
  [BLOCK.GRAVEL, 'Gravel', RENDER.SOLID, true, true, 0, 15, 0.6, BLOCK.GRAVEL, [T.gravel, T.gravel, T.gravel]],
  [BLOCK.SNOW, 'Snowy Stone', RENDER.SOLID, true, true, 0, 15, 0.8, BLOCK.SNOW, [T.snow, T.stone, T.snow_side]],
  [BLOCK.COAL_ORE, 'Coal Ore', RENDER.SOLID, true, true, 0, 15, 2.0, BLOCK.COAL_ORE, [T.coal_ore, T.coal_ore, T.coal_ore]],
  [BLOCK.IRON_ORE, 'Iron Ore', RENDER.SOLID, true, true, 0, 15, 2.4, BLOCK.IRON_ORE, [T.iron_ore, T.iron_ore, T.iron_ore]],
  [BLOCK.TORCH, 'Torch', RENDER.CROSS, false, false, 14, 0, 0, BLOCK.TORCH, [T.torch, T.torch, T.torch]],
  [BLOCK.GLOWSTONE, 'Glowstone', RENDER.SOLID, true, true, 15, 15, 0.4, BLOCK.GLOWSTONE, [T.glowstone, T.glowstone, T.glowstone]],
  [BLOCK.TALL_GRASS, 'Tall Grass', RENDER.CROSS, false, false, 0, 0, 0, 0, [T.tall_grass, T.tall_grass, T.tall_grass]],
  [BLOCK.RED_FLOWER, 'Poppy', RENDER.CROSS, false, false, 0, 0, 0, BLOCK.RED_FLOWER, [T.red_flower, T.red_flower, T.red_flower]],
  [BLOCK.YELLOW_FLOWER, 'Dandelion', RENDER.CROSS, false, false, 0, 0, 0, BLOCK.YELLOW_FLOWER, [T.yellow_flower, T.yellow_flower, T.yellow_flower]],
  [BLOCK.BRICKS, 'Bricks', RENDER.SOLID, true, true, 0, 15, 1.8, BLOCK.BRICKS, [T.bricks, T.bricks, T.bricks]],
  [BLOCK.SANDSTONE, 'Sandstone', RENDER.SOLID, true, true, 0, 15, 1.0, BLOCK.SANDSTONE, [T.sandstone_top, T.sandstone_top, T.sandstone_side]],
];

const N = 256;
export const BLOCK_NAME = new Array(N).fill('Unknown');
export const BLOCK_RENDER = new Uint8Array(N);
export const BLOCK_SOLID = new Uint8Array(N); // collides with entities
export const BLOCK_OPAQUE = new Uint8Array(N); // fully blocks light and hides neighbour faces
export const BLOCK_EMIT = new Uint8Array(N); // emitted block light level
export const BLOCK_ATTEN = new Uint8Array(N); // extra light lost when light passes through
export const BLOCK_HARDNESS = new Float32Array(N);
export const BLOCK_DROP = new Uint8Array(N);
/** Texture layer per block & face: [top, bottom, side] packed as id * 3 + faceGroup. */
export const BLOCK_TILES = new Uint8Array(N * 3);

for (const [id, name, render, solid, opaque, emit, atten, hardness, drop, tiles] of DEFS) {
  BLOCK_NAME[id] = name;
  BLOCK_RENDER[id] = render;
  BLOCK_SOLID[id] = solid ? 1 : 0;
  BLOCK_OPAQUE[id] = opaque ? 1 : 0;
  BLOCK_EMIT[id] = emit;
  BLOCK_ATTEN[id] = atten;
  BLOCK_HARDNESS[id] = hardness;
  BLOCK_DROP[id] = drop;
  BLOCK_TILES[id * 3] = tiles[0];
  BLOCK_TILES[id * 3 + 1] = tiles[1];
  BLOCK_TILES[id * 3 + 2] = tiles[2];
}

/** Blocks that can be replaced by placing another block into their cell. */
export function isReplaceable(id) {
  return id === BLOCK.AIR || id === BLOCK.WATER || id === BLOCK.TALL_GRASS;
}

/** Blocks the player can pick and place (shown in the creative palette). */
export const PLACEABLE_BLOCKS = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.SAND, BLOCK.SANDSTONE,
  BLOCK.GRAVEL, BLOCK.LOG, BLOCK.PLANKS, BLOCK.LEAVES, BLOCK.GLASS, BLOCK.BRICKS,
  BLOCK.SNOW, BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GLOWSTONE, BLOCK.TORCH,
  BLOCK.RED_FLOWER, BLOCK.YELLOW_FLOWER,
];
