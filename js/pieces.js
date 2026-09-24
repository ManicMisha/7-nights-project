// Building-piece registry and placement keys. Pieces are placed on the
// same 1 m grid as terrain, but they aren't terrain: each chunk keeps a
// sparse map of the pieces in it (chunk.pieces), saved with the chunk.
//
// A grid cell has slots, so one cell can hold several pieces at once — a
// floor, a wall on each of its four edges, and one centre object (stairs,
// furniture…). Phase 6 builds the placement gameplay on top of this data.
//
// Type and tier ids are written into save files: never renumber them.

export const PIECE = {
  FOUNDATION: 1,
  FLOOR: 2,
  WALL: 3,
  DOORWAY: 4,
  WINDOW_WALL: 5,
  DOOR: 6,
  STAIRS: 7,
  ROOF: 8,
  FENCE: 9,
  CRAFTING_BENCH: 10,
  FURNACE: 11,
  CHEST: 12,
  BED: 13,
  CAMPFIRE: 14,
  TORCH: 15,
};

export const TIER = { WOOD: 0, STONE: 1, BRICK: 2, METAL: 3 };
export const TIER_NAME = ['Wood', 'Stone', 'Brick', 'Metal'];

/** Where in a cell a piece sits. */
export const SLOT = { FLOOR: 0, EDGE_N: 1, EDGE_E: 2, EDGE_S: 3, EDGE_W: 4, CENTER: 5 };
export const SLOTS_PER_CELL = 8; // room to grow

/**
 * name, slot kind ('floor' | 'edge' | 'center'), tiered (built from a
 * material tier) and base health (scaled by tier).
 */
export const PIECE_DEFS = {
  [PIECE.FOUNDATION]: { name: 'Foundation', slot: 'floor', tiered: true, health: 400 },
  [PIECE.FLOOR]: { name: 'Floor', slot: 'floor', tiered: true, health: 200 },
  [PIECE.WALL]: { name: 'Wall', slot: 'edge', tiered: true, health: 300 },
  [PIECE.DOORWAY]: { name: 'Doorway', slot: 'edge', tiered: true, health: 250 },
  [PIECE.WINDOW_WALL]: { name: 'Window wall', slot: 'edge', tiered: true, health: 250 },
  [PIECE.DOOR]: { name: 'Door', slot: 'edge', tiered: true, health: 150 },
  [PIECE.STAIRS]: { name: 'Stairs', slot: 'center', tiered: true, health: 200 },
  [PIECE.ROOF]: { name: 'Roof', slot: 'floor', tiered: true, health: 200 },
  [PIECE.FENCE]: { name: 'Fence', slot: 'edge', tiered: true, health: 120 },
  [PIECE.CRAFTING_BENCH]: { name: 'Crafting bench', slot: 'center', tiered: false, health: 150 },
  [PIECE.FURNACE]: { name: 'Furnace', slot: 'center', tiered: false, health: 300 },
  [PIECE.CHEST]: { name: 'Chest', slot: 'center', tiered: false, health: 150 },
  [PIECE.BED]: { name: 'Bed', slot: 'center', tiered: false, health: 100 },
  [PIECE.CAMPFIRE]: { name: 'Campfire', slot: 'center', tiered: false, health: 80 },
  [PIECE.TORCH]: { name: 'Torch', slot: 'center', tiered: false, health: 20 },
};

const TIER_HEALTH_SCALE = [1, 2, 3, 4.5];

/** Maximum health of a piece of `type` built in `tier`. */
export function pieceMaxHealth(type, tier) {
  const def = PIECE_DEFS[type];
  return Math.round(def.health * (def.tiered ? TIER_HEALTH_SCALE[tier] : 1));
}

/**
 * The slot a piece occupies. Edge pieces use their rotation (0–3, quarter
 * turns clockwise from north) to pick which edge of the cell they're on.
 */
export function pieceSlot(type, rotation) {
  const kind = PIECE_DEFS[type].slot;
  if (kind === 'floor') return SLOT.FLOOR;
  if (kind === 'center') return SLOT.CENTER;
  return SLOT.EDGE_N + (rotation & 3);
}

/** Map key of a piece within its chunk: cell index plus slot. */
export function pieceKey(cell, slot) {
  return cell * SLOTS_PER_CELL + slot;
}

export function pieceKeyCell(key) {
  return Math.floor(key / SLOTS_PER_CELL);
}

export function pieceKeySlot(key) {
  return key % SLOTS_PER_CELL;
}

/** A placed piece, as stored in chunk.pieces. */
export function makePiece(type, tier, rotation) {
  return { type, tier, rotation: rotation & 3, health: pieceMaxHealth(type, tier) };
}
