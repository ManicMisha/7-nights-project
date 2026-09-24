// Global, tweakable constants shared by every module.

export const CHUNK_SIZE = 16; // blocks along X and Z per chunk (must be 16: code uses >> 4 / & 15)
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;
export const WORLD_HEIGHT = 128; // blocks along Y
export const SEA_LEVEL = 48; // highest water cell
export const WATER_SURFACE_Y = SEA_LEVEL + 0.5; // water surface height (the middle of that cell)
export const MAX_LIGHT = 15;

export const DEFAULT_SETTINGS = {
  renderDistance: 6, // in chunks
  fov: 75,
  sensitivity: 1,
  waterReflections: true,
  dayLengthMinutes: 10,
};

export const PLAYER = {
  width: 0.6,
  height: 1.8,
  eyeHeight: 1.62,
  walkSpeed: 4.3,
  sprintSpeed: 6.2,
  flySpeed: 11,
  jumpVelocity: 8.6,
  gravity: 28,
  reach: 6,
  maxHealth: 20,
};

export const MOBS = {
  maxCount: 10,
  spawnInterval: 1.2, // seconds between spawn attempts
  despawnDistance: 96,
  maxSpawnLight: 5, // effective light (0–15) at or below which mobs may spawn
};

/**
 * Art-style palette (sRGB hex), mirrored from DESIGN.md. Terrain textures,
 * water and later models draw from these so the world stays coherent.
 */
export const PALETTE = {
  skyDay: 0x4da8f0,
  horizonDay: 0xbde6ff,
  sunlight: 0xffe9b8,
  grass: 0x6cc24a,
  grassShade: 0x3f8f3a,
  leaves: 0x4fae3b,
  dirt: 0x9c6b43,
  rock: 0x8e9196,
  rockDark: 0x5e6268,
  sand: 0xf2d99a,
  waterShallow: 0x3fe0d0,
  waterDeep: 0x1e7fc2,
  foam: 0xf4ffff,
  wood: 0xb9824a,
  woodDark: 0x7a4e2b,
  stoneBuilding: 0xa7a39a,
  brick: 0xb5553f,
  metal: 0x7f8a96,
  skyNight: 0x0b1026,
  fogNight: 0x1a2340,
  moonlight: 0x7e94c9,
  firelight: 0xffb45a,
  resource: 0xffd84d,
  enemy: 0xe0453a,
  snow: 0xf4f8fc,
};
