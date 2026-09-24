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
